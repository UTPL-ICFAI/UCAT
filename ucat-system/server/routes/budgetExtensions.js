import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";
import { broadcastSSE } from "./sse.js";

const router = express.Router();

async function getExpenseTableConfig() {
  const result = await pool.query(
    "SELECT to_regclass('public.expenses') AS table_name",
  );
  if (result.rows[0]?.table_name) {
    return { table: "expenses" };
  }
  return { table: "expense_entries" };
}

async function ensureProjectAssignment(projectId, userId) {
  const assignmentResult = await pool.query(
    "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  return assignmentResult.rows.length > 0;
}

async function getProjectBudget(projectId) {
  const projectResult = await pool.query(
    "SELECT total_budget, budget_allocated FROM projects WHERE id = $1",
    [projectId],
  );
  return parseFloat(
    projectResult.rows[0]?.total_budget ||
      projectResult.rows[0]?.budget_allocated ||
      0,
  );
}

async function getProjectSpent(projectId) {
  const expenseConfig = await getExpenseTableConfig();
  const spentResult = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_spent FROM ${expenseConfig.table} WHERE project_id = $1`,
    [projectId],
  );
  return parseFloat(spentResult.rows[0]?.total_spent || 0);
}

router.get("/my", requireRole("project_manager"), async (req, res) => {
  try {
    const projectId = req.query.projectId || req.query.project_id;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const assigned = await ensureProjectAssignment(projectId, req.user.id);
    if (!assigned) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const result = await pool.query(
      `SELECT ber.*, 
         COALESCE(ber.amount_requested, ber.requested_amount) AS amount_requested,
         u.name as requested_by_name, ru.name as reviewed_by_name
       FROM budget_extension_requests ber
       LEFT JOIN users u ON ber.requested_by = u.id
       LEFT JOIN users ru ON ber.reviewed_by = ru.id
       WHERE ber.project_id = $1 AND ber.requested_by = $2
       ORDER BY ber.created_at DESC`,
      [projectId, req.user.id],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching budget extension requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.post("/", requireRole("project_manager"), async (req, res) => {
  try {
    const projectId = req.body.projectId || req.body.project_id;
    const amountRequested =
      req.body.amount_requested ?? req.body.requested_amount ?? req.body.amount;
    const justification = req.body.justification;

    if (!projectId || !amountRequested || !justification) {
      return res.status(400).json({
        error: "projectId, amount_requested, and justification are required",
      });
    }

    const assigned = await ensureProjectAssignment(projectId, req.user.id);
    if (!assigned) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const pendingResult = await pool.query(
      "SELECT id FROM budget_extension_requests WHERE project_id = $1 AND status = 'pending'",
      [projectId],
    );

    if (pendingResult.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "A pending request already exists for this project" });
    }

    const totalBudget = await getProjectBudget(projectId);
    const totalSpent = await getProjectSpent(projectId);
    const percentUsed = totalBudget ? (totalSpent / totalBudget) * 100 : 0;

    const result = await pool.query(
      `INSERT INTO budget_extension_requests (
         project_id,
         requested_by,
         requested_amount,
         amount_requested,
         justification,
         status,
         budget_before,
         spent_before,
         percent_used_before
       )
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
       RETURNING *`,
      [
        projectId,
        req.user.id,
        amountRequested,
        amountRequested,
        justification,
        totalBudget,
        totalSpent,
        percentUsed,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating budget extension request:", error);
    res.status(500).json({ error: "Failed to create request" });
  }
});

router.get("/", requireRole("superadmin"), async (req, res) => {
  try {
    const { project_id, status } = req.query;

    const params = [];
    let query = `SELECT
      ber.*, 
      COALESCE(ber.amount_requested, ber.requested_amount) AS amount_requested,
      p.name as project_name,
        u.name as requested_by_name,
        ru.name as reviewed_by_name
      FROM budget_extension_requests ber
      JOIN projects p ON ber.project_id = p.id
      LEFT JOIN users u ON ber.requested_by = u.id
      LEFT JOIN users ru ON ber.reviewed_by = ru.id
      WHERE 1=1`;

    if (project_id) {
      params.push(project_id);
      query += ` AND ber.project_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND ber.status = $${params.length}`;
    }

    query += " ORDER BY ber.created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching admin budget requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.patch("/:requestId", requireRole("superadmin"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const { status, review_note } = req.body;

    if (!status || !["approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ error: "status must be approved or rejected" });
    }

    await client.query("BEGIN");

    const requestResult = await client.query(
      "SELECT * FROM budget_extension_requests WHERE id = $1 FOR UPDATE",
      [requestId],
    );

    if (requestResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Request not found" });
    }

    const request = requestResult.rows[0];
    if (request.status !== "pending") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Only pending requests can be updated" });
    }

    let updatedBudget = null;
    const amountRequested =
      request.amount_requested ?? request.requested_amount ?? 0;

    if (status === "approved") {
      const budgetResult = await client.query(
        `UPDATE projects
           SET total_budget = COALESCE(total_budget, 0) + $1
           WHERE id = $2
           RETURNING total_budget`,
        [amountRequested, request.project_id],
      );
      updatedBudget = parseFloat(budgetResult.rows[0]?.total_budget || 0);
    }

    const updateResult = await client.query(
      `UPDATE budget_extension_requests
         SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3
         WHERE id = $4
         RETURNING *`,
      [status, req.user.id, review_note || null, requestId],
    );

    await client.query("COMMIT");

    if (status === "approved") {
      broadcastSSE([request.requested_by], {
        type: "budget-extension-approved",
        data: {
          project_id: request.project_id,
          amount_requested: amountRequested,
          total_budget: updatedBudget,
        },
      });
    } else {
      broadcastSSE([request.requested_by], {
        type: "budget-extension-rejected",
        data: {
          project_id: request.project_id,
          amount_requested: amountRequested,
          review_note: review_note || "",
        },
      });
    }

    res.json(updateResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating budget extension:", error);
    res.status(500).json({ error: "Failed to update request" });
  } finally {
    client.release();
  }
});

export default router;
