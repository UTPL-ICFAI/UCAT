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
    "SELECT total_budget, budget_allocated FROM projects WHERE id = $1",
    [projectId],
  );
  const totalBudget = parseFloat(
    projectResult.rows[0]?.total_budget ||
      projectResult.rows[0]?.budget_allocated ||
      0,
  );

  const expenseConfig = await getExpenseTableConfig();
  const spentResult = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_spent FROM ${expenseConfig.table} WHERE project_id = $1`,
    [projectId],
  );
  const totalSpent = parseFloat(spentResult.rows[0]?.total_spent || 0);
  const remaining = totalBudget - totalSpent;
  const percentUsed = totalBudget ? totalSpent / totalBudget : 0;

  return { totalBudget, totalSpent, remaining, percentUsed };
}

async function updateBudgetAlerts(projectId, percentUsed) {
  try {
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
  } catch (error) {
    if (error && error.code === "42P01") {
      return { warn75Triggered: false, warn100Triggered: false };
    }
    throw error;
  }
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

function normalizeExpensePayload(body) {
  return {
    projectId: body.projectId ?? body.project_id,
    description: body.description,
    category: body.category,
    amount: body.amount,
    date: body.date ?? body.expense_date,
    notes: body.notes,
  };
}

async function getExpenseTableConfig() {
  const result = await pool.query(
    "SELECT to_regclass('public.expenses') AS table_name",
  );
  if (result.rows[0]?.table_name) {
    return { table: "expenses", dateColumn: "date", userColumn: "user_id" };
  }
  return {
    table: "expense_entries",
    dateColumn: "expense_date",
    userColumn: "created_by",
  };
}

router.post("/", requireRole("project_manager"), async (req, res) => {
  try {
    const { projectId, description, category, amount, date, notes } =
      normalizeExpensePayload(req.body);

    if (!projectId || !description || !category || amount === undefined) {
      return res.status(400).json({
        error: "projectId, description, category, and amount are required",
      });
    }

    const assigned = await ensureProjectAssignment(projectId, req.user.id);
    if (!assigned) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const amountValue = Number(amount);
    const preSummary = await fetchBudgetSummary(projectId);
    if (preSummary.totalBudget > 0 && preSummary.remaining <= 0) {
      return res
        .status(400)
        .json({ error: "Budget exhausted. Add more budget to log expenses." });
    }
    if (preSummary.totalBudget > 0 && amountValue > preSummary.remaining) {
      return res.status(400).json({
        error: "Expense exceeds remaining budget.",
        remaining: preSummary.remaining,
      });
    }

    const expenseDate = date || new Date().toISOString().split("T")[0];

    const expenseConfig = await getExpenseTableConfig();
    const insertQuery =
      expenseConfig.table === "expenses"
        ? `INSERT INTO expenses (project_id, user_id, description, category, amount, date, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`
        : `INSERT INTO expense_entries (project_id, created_by, description, category, amount, expense_date, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`;

    const result = await pool.query(insertQuery, [
      projectId,
      req.user.id,
      description,
      category,
      amountValue,
      expenseDate,
      notes || null,
    ]);

    const summary = await fetchBudgetSummary(projectId);
    const alertStatus = await updateBudgetAlerts(
      projectId,
      summary.percentUsed,
    );

    if (alertStatus.warn75Triggered) {
      await notifyProjectManagers(projectId, {
        type: "budget-warning",
        data: {
          project_id: projectId,
          threshold: 75,
          percent_used: summary.percentUsed,
          total_budget: summary.totalBudget,
          total_spent: summary.totalSpent,
        },
      });
    }

    if (alertStatus.warn100Triggered) {
      await notifyProjectManagers(projectId, {
        type: "budget-critical",
        data: {
          project_id: projectId,
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
    if (error && error.code === "42P01") {
      return res.status(500).json({
        error: "Expense tables not found. Run the expense migration.",
      });
    }
    res.status(500).json({ error: "Failed to log expense" });
  }
});

router.delete(
  "/:expenseId",
  requireRole("project_manager"),
  async (req, res) => {
    try {
      const { expenseId } = req.params;

      const expenseConfig = await getExpenseTableConfig();
      const expenseResult = await pool.query(
        `SELECT id, project_id, ${expenseConfig.userColumn} AS user_id
         FROM ${expenseConfig.table}
         WHERE id = $1`,
        [expenseId],
      );

      if (expenseResult.rows.length === 0) {
        return res.status(404).json({ error: "Expense not found" });
      }

      const expense = expenseResult.rows[0];
      if (expense.user_id !== req.user.id) {
        return res
          .status(403)
          .json({ error: "You can only delete expenses you created" });
      }

      await pool.query(`DELETE FROM ${expenseConfig.table} WHERE id = $1`, [
        expenseId,
      ]);

      const summary = await fetchBudgetSummary(expense.project_id);

      res.json({ success: true, summary });
    } catch (error) {
      console.error("Error deleting expense:", error);
      res.status(500).json({ error: "Failed to delete expense" });
    }
  },
);

export default router;
