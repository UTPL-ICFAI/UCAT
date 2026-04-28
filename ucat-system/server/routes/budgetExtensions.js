import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";
import { broadcastSSE } from "./sse.js";

const router = express.Router();

async function ensureProjectAssignment(projectId, userId) {
  const assignmentResult = await pool.query(
    "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  return assignmentResult.rows.length > 0;
}

async function getProjectBudget(projectId) {
  const projectResult = await pool.query(
    "SELECT total_budget FROM projects WHERE id = $1",
    [projectId],
  );
  return parseFloat(projectResult.rows[0]?.total_budget || 0);
}

async function getProjectSpent(projectId) {
  const spentResult = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total_spent FROM expense_entries WHERE project_id = $1",
    [projectId],
  );
  return parseFloat(spentResult.rows[0]?.total_spent || 0);
}

router.get("/", requireRole("project_manager"), async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: "project_id is required" });
    }

    const assigned = await ensureProjectAssignment(project_id, req.user.id);
    if (!assigned) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const result = await pool.query(
      `SELECT ber.*, u.name as requested_by_name, ru.name as reviewed_by_name
       FROM budget_extension_requests ber
       LEFT JOIN users u ON ber.requested_by = u.id
       LEFT JOIN users ru ON ber.reviewed_by = ru.id
       WHERE ber.project_id = $1 AND ber.requested_by = $2
       ORDER BY ber.created_at DESC`,
      [project_id, req.user.id],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching budget extension requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.post("/", requireRole("project_manager"), async (req, res) => {
  try {
    const { project_id, requested_amount, justification } = req.body;

    if (!project_id || !requested_amount || !justification) {
      return res
        .status(400)
        .json({ error: "project_id, requested_amount, and justification are required" });
    }

    const assigned = await ensureProjectAssignment(project_id, req.user.id);
    if (!assigned) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const pendingResult = await pool.query(
      "SELECT id FROM budget_extension_requests WHERE project_id = $1 AND status = 'pending'",
      [project_id],
    );

    if (pendingResult.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "A pending request already exists for this project" });
    }

    const totalBudget = await getProjectBudget(project_id);
    const totalSpent = await getProjectSpent(project_id);
    const percentUsed = totalBudget ? (totalSpent / totalBudget) * 100 : 0;

    const result = await pool.query(
      `INSERT INTO budget_extension_requests (
         project_id,
         requested_by,
         requested_amount,
         justification,
         status,
         budget_before,
         spent_before,
         percent_used_before
       )
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING *`,
      [
        project_id,
        req.user.id,
        requested_amount,
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

router.get("/admin", requireRole("superadmin"), async (req, res) => {
  try {
    const { project_id, status } = req.query;

    const params = [];
    let query = `SELECT
        ber.*, p.name as project_name,
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

router.post(
  "/:requestId/approve",
  requireRole("superadmin"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { requestId } = req.params;
      const { review_note } = req.body;

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
          .json({ error: "Only pending requests can be approved" });
      }

      const budgetResult = await client.query(
        `UPDATE projects
         SET total_budget = COALESCE(total_budget, 0) + $1
         WHERE id = $2
         RETURNING total_budget`,
        [request.requested_amount, request.project_id],
      );

      const updateResult = await client.query(
        `UPDATE budget_extension_requests
         SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE id = $3
         RETURNING *`,
        [req.user.id, review_note || null, requestId],
      );

      await client.query("COMMIT");

      const updatedBudget = parseFloat(
        budgetResult.rows[0]?.total_budget || 0,
      );

      broadcastSSE([request.requested_by], {
        type: "budget-extension-approved",
        data: {
          project_id: request.project_id,
          requested_amount: request.requested_amount,
          total_budget: updatedBudget,
        },
      });

      res.json(updateResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error approving budget extension:", error);
      res.status(500).json({ error: "Failed to approve request" });
    } finally {
      client.release();
    }
  },
);

router.post(
  "/:requestId/reject",
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const { review_note } = req.body;

      const requestResult = await pool.query(
        "SELECT * FROM budget_extension_requests WHERE id = $1",
        [requestId],
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({ error: "Request not found" });
      }

      const request = requestResult.rows[0];
      if (request.status !== "pending") {
        return res
          .status(400)
          .json({ error: "Only pending requests can be rejected" });
      }

      const updateResult = await pool.query(
        `UPDATE budget_extension_requests
         SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE id = $3
         RETURNING *`,
        [req.user.id, review_note || null, requestId],
      );

      broadcastSSE([request.requested_by], {
        type: "budget-extension-rejected",
        data: {
          project_id: request.project_id,
          requested_amount: request.requested_amount,
          review_note: review_note || "",
        },
      });

      res.json(updateResult.rows[0]);
    } catch (error) {
      console.error("Error rejecting budget extension:", error);
      res.status(500).json({ error: "Failed to reject request" });
    }
  },
);

export default router;
