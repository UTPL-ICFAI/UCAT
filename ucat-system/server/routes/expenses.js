import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";
import { broadcastSSE } from "./sse.js";

const router = express.Router();

const WARN_75_THRESHOLD = 0.75;
const WARN_100_THRESHOLD = 1.0;

async function ensureProjectAssignment(projectId, userId) {
  const assignmentResult = await pool.query(
    "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  return assignmentResult.rows.length > 0;
}

async function fetchBudgetSummary(projectId) {
  const projectResult = await pool.query(
    "SELECT total_budget FROM projects WHERE id = $1",
    [projectId],
  );
  const totalBudget = parseFloat(projectResult.rows[0]?.total_budget || 0);

  const spentResult = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total_spent FROM expense_entries WHERE project_id = $1",
    [projectId],
  );
  const totalSpent = parseFloat(spentResult.rows[0]?.total_spent || 0);
  const remaining = totalBudget - totalSpent;
  const percentUsed = totalBudget ? totalSpent / totalBudget : 0;

  return { totalBudget, totalSpent, remaining, percentUsed };
}

async function updateBudgetAlerts(projectId, percentUsed) {
  await pool.query(
    "INSERT INTO project_budget_alerts (project_id) VALUES ($1) ON CONFLICT (project_id) DO NOTHING",
    [projectId],
  );

  const alertResult = await pool.query(
    "SELECT warned_75, warned_100 FROM project_budget_alerts WHERE project_id = $1",
    [projectId],
  );
  const alertRow = alertResult.rows[0] || {
    warned_75: false,
    warned_100: false,
  };

  const updates = [];
  let warn75Triggered = false;
  let warn100Triggered = false;

  if (!alertRow.warned_75 && percentUsed >= WARN_75_THRESHOLD) {
    updates.push("warned_75 = true");
    warn75Triggered = true;
  }
  if (!alertRow.warned_100 && percentUsed >= WARN_100_THRESHOLD) {
    updates.push("warned_100 = true");
    warn100Triggered = true;
  }

  if (updates.length > 0) {
    updates.push("updated_at = NOW()");
    await pool.query(
      `UPDATE project_budget_alerts SET ${updates.join(", ")} WHERE project_id = $1`,
      [projectId],
    );
  }

  return { warn75Triggered, warn100Triggered };
}

async function notifyProjectManagers(projectId, event) {
  const pmResult = await pool.query(
    "SELECT user_id FROM project_assignments WHERE project_id = $1 AND role = 'project_manager'",
    [projectId],
  );
  const userIds = pmResult.rows.map((row) => row.user_id);
  if (userIds.length > 0) {
    broadcastSSE(userIds, event);
  }
}

router.get("/summary", requireRole("project_manager"), async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: "project_id is required" });
    }

    const assigned = await ensureProjectAssignment(project_id, req.user.id);
    if (!assigned) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const summary = await fetchBudgetSummary(project_id);

    const categoryResult = await pool.query(
      `SELECT category, COALESCE(SUM(amount), 0) AS total
       FROM expense_entries
       WHERE project_id = $1
       GROUP BY category
       ORDER BY category ASC`,
      [project_id],
    );

    const periodResult = await pool.query(
      `SELECT DATE_TRUNC('month', expense_date) AS period, COALESCE(SUM(amount), 0) AS total
       FROM expense_entries
       WHERE project_id = $1
       GROUP BY DATE_TRUNC('month', expense_date)
       ORDER BY period ASC`,
      [project_id],
    );

    res.json({
      summary,
      byCategory: categoryResult.rows,
      byPeriod: periodResult.rows,
    });
  } catch (error) {
    console.error("Error fetching expense summary:", error);
    res.status(500).json({ error: "Failed to fetch expense summary" });
  }
});

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
      `SELECT ee.*, u.name as created_by_name
       FROM expense_entries ee
       LEFT JOIN users u ON ee.created_by = u.id
       WHERE ee.project_id = $1
       ORDER BY ee.expense_date DESC, ee.created_at DESC`,
      [project_id],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

router.post("/", requireRole("project_manager"), async (req, res) => {
  try {
    const {
      project_id,
      description,
      category,
      amount,
      expense_date,
      notes,
    } = req.body;

    if (!project_id || !description || !category || amount === undefined) {
      return res
        .status(400)
        .json({ error: "project_id, description, category, and amount are required" });
    }

    const assigned = await ensureProjectAssignment(project_id, req.user.id);
    if (!assigned) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const expenseDate = expense_date || new Date().toISOString().split("T")[0];

    const result = await pool.query(
      `INSERT INTO expense_entries (project_id, description, category, amount, expense_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        project_id,
        description,
        category,
        amount,
        expenseDate,
        notes || null,
        req.user.id,
      ],
    );

    const summary = await fetchBudgetSummary(project_id);
    const alertStatus = await updateBudgetAlerts(
      project_id,
      summary.percentUsed,
    );

    if (alertStatus.warn75Triggered) {
      await notifyProjectManagers(project_id, {
        type: "budget-warning",
        data: {
          project_id,
          threshold: 75,
          percent_used: summary.percentUsed,
          total_budget: summary.totalBudget,
          total_spent: summary.totalSpent,
        },
      });
    }

    if (alertStatus.warn100Triggered) {
      await notifyProjectManagers(project_id, {
        type: "budget-critical",
        data: {
          project_id,
          threshold: 100,
          percent_used: summary.percentUsed,
          total_budget: summary.totalBudget,
          total_spent: summary.totalSpent,
        },
      });
    }

    res.status(201).json({
      expense: result.rows[0],
      summary,
      alerts: alertStatus,
    });
  } catch (error) {
    console.error("Error logging expense:", error);
    res.status(500).json({ error: "Failed to log expense" });
  }
});

router.delete("/:expenseId", requireRole("project_manager"), async (req, res) => {
  try {
    const { expenseId } = req.params;

    const expenseResult = await pool.query(
      "SELECT id, project_id, created_by FROM expense_entries WHERE id = $1",
      [expenseId],
    );

    if (expenseResult.rows.length === 0) {
      return res.status(404).json({ error: "Expense not found" });
    }

    const expense = expenseResult.rows[0];
    if (expense.created_by !== req.user.id) {
      return res
        .status(403)
        .json({ error: "You can only delete expenses you created" });
    }

    await pool.query("DELETE FROM expense_entries WHERE id = $1", [expenseId]);

    const summary = await fetchBudgetSummary(expense.project_id);

    res.json({ success: true, summary });
  } catch (error) {
    console.error("Error deleting expense:", error);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

export default router;
