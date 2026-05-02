import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";

const router = express.Router();

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

// Create project (superadmin only)
router.post("/", requireRole("superadmin"), async (req, res) => {
  try {
    // Destructure all required and optional fields from request body
    const {
      name,
      location,
      city,
      description,
      work_status,
      start_date,
      end_date,
      contractor_name,
      contractor_contact,
      contractor_license,
      contractor_insurance_number,
      contractor_details,
      total_budget,
      budget_allocated,
      insurance_details,
      safety_certifications,
      projectManagers,
      siteEngineers,
      supervisors,
    } = req.body;

    // Validate required fields
    if (!name || !location || !city) {
      return res
        .status(400)
        .json({ error: "name, location, and city are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Insert project with all new construction industry fields
      const projectResult = await client.query(
        `INSERT INTO projects (name, location, city, description, work_status, start_date, end_date, contractor_name, contractor_contact, contractor_license, contractor_insurance_number, contractor_details, total_budget, budget_allocated, insurance_details, safety_certifications, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          name,
          location,
          city,
          description || null,
          work_status || "ongoing",
          start_date || null,
          end_date || null,
          contractor_name || null,
          contractor_contact || null,
          contractor_license || null,
          contractor_insurance_number || null,
          JSON.stringify(contractor_details || {}),
          total_budget || null,
          budget_allocated || null,
          JSON.stringify(insurance_details || {}),
          JSON.stringify(safety_certifications || {}),
          req.user.id,
        ],
      );

      const projectId = projectResult.rows[0].id;

      // Assign users to project
      const assignments = [];
      if (projectManagers && projectManagers.length > 0) {
        for (const userId of projectManagers) {
          assignments.push([projectId, userId, "project_manager"]);
        }
      }
      if (siteEngineers && siteEngineers.length > 0) {
        for (const userId of siteEngineers) {
          assignments.push([projectId, userId, "site_engineer"]);
        }
      }
      if (supervisors && supervisors.length > 0) {
        for (const userId of supervisors) {
          assignments.push([projectId, userId, "supervisor"]);
        }
      }

      for (const [projId, userId, assignRole] of assignments) {
        await client.query(
          `INSERT INTO project_assignments (project_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (project_id, user_id) DO NOTHING`,
          [projId, userId, assignRole],
        );
      }

      await client.query("COMMIT");
      res.status(201).json(projectResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create project error:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// Get projects (role-filtered)
router.get("/", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let query;
    let params;

    if (req.user.role === "superadmin") {
      query = "SELECT * FROM projects ORDER BY created_at DESC";
      params = [];
    } else {
      query = `
        SELECT DISTINCT p.* FROM projects p
        JOIN project_assignments pa ON p.id = pa.project_id
        WHERE pa.user_id = $1
        ORDER BY p.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Get projects error:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Get project details
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const projectResult = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [id],
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (req.user.role !== "superadmin") {
      const assignmentResult = await pool.query(
        "SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2",
        [id, req.user.id],
      );

      if (assignmentResult.rows.length === 0) {
        return res.status(403).json({ error: "Not assigned to this project" });
      }
    }

    const project = projectResult.rows[0];

    // Get assigned users
    const assignmentsResult = await pool.query(
      `SELECT pa.*, u.name, u.user_id, u.employment_id, u.id as account_id FROM project_assignments pa
       JOIN users u ON pa.user_id = u.id
       WHERE pa.project_id = $1`,
      [id],
    );

    res.json({
      ...project,
      allocated_budget: project.budget_allocated,
      assignments: assignmentsResult.rows,
    });
  } catch (error) {
    console.error("Get project details error:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Get project expenses (PM assigned or superadmin)
router.get(
  "/:id/expenses",
  requireRole("project_manager", "superadmin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (req.user.role !== "superadmin") {
        const assignmentResult = await pool.query(
          "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2",
          [id, req.user.id],
        );

        if (assignmentResult.rows.length === 0) {
          return res
            .status(403)
            .json({ error: "Not assigned to this project" });
        }
      }

      const expenseConfig = await getExpenseTableConfig();
      const result = await pool.query(
        `SELECT e.*, u.name as created_by_name
         FROM ${expenseConfig.table} e
         LEFT JOIN users u ON e.${expenseConfig.userColumn} = u.id
         WHERE e.project_id = $1
         ORDER BY e.${expenseConfig.dateColumn} DESC, e.created_at DESC`,
        [id],
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching project expenses:", error);
      res.status(500).json({ error: "Failed to fetch project expenses" });
    }
  },
);

// Get project budget summary and charts (PM assigned or superadmin)
router.get(
  "/:id/budget-summary",
  requireRole("project_manager", "superadmin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (req.user.role !== "superadmin") {
        const assignmentResult = await pool.query(
          "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2",
          [id, req.user.id],
        );

        if (assignmentResult.rows.length === 0) {
          return res
            .status(403)
            .json({ error: "Not assigned to this project" });
        }
      }

      const projectResult = await pool.query(
        "SELECT total_budget, budget_allocated FROM projects WHERE id = $1",
        [id],
      );
      const totalBudget = parseFloat(projectResult.rows[0]?.total_budget || 0);
      const allocatedBudget = parseFloat(
        projectResult.rows[0]?.budget_allocated || 0,
      );
      const surplusAmount = totalBudget - allocatedBudget;

      const expenseConfig = await getExpenseTableConfig();
      const spentResult = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total_spent FROM ${expenseConfig.table} WHERE project_id = $1`,
        [id],
      );
      const totalSpent = parseFloat(spentResult.rows[0]?.total_spent || 0);
      const remaining = totalBudget - totalSpent;
      const percentUsed = totalBudget ? totalSpent / totalBudget : 0;

      const categoryResult = await pool.query(
        `SELECT category, COALESCE(SUM(amount), 0) AS total
         FROM ${expenseConfig.table}
         WHERE project_id = $1
         GROUP BY category
         ORDER BY category ASC`,
        [id],
      );

      const periodResult = await pool.query(
        `SELECT DATE_TRUNC('month', ${expenseConfig.dateColumn}) AS period, COALESCE(SUM(amount), 0) AS total
         FROM ${expenseConfig.table}
         WHERE project_id = $1
         GROUP BY DATE_TRUNC('month', ${expenseConfig.dateColumn})
         ORDER BY period ASC`,
        [id],
      );

      res.json({
        summary: {
          allocated_budget: allocatedBudget,
          total_budget: totalBudget,
          surplus_amount: surplusAmount,
        },
        byCategory: categoryResult.rows,
        byPeriod: periodResult.rows,
      });
    } catch (error) {
      console.error("Error fetching budget summary:", error);
      res.status(500).json({ error: "Failed to fetch budget summary" });
    }
  },
);

// Update project (superadmin only)
router.put("/:id", requireRole("superadmin"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      location,
      city,
      description,
      work_status,
      start_date,
      end_date,
      contractor_name,
      contractor_contact,
      contractor_license,
      contractor_insurance_number,
      contractor_details,
      total_budget,
      budget_allocated,
      insurance_details,
      safety_certifications,
    } = req.body;

    // Update project with all construction industry fields
    const result = await pool.query(
      `UPDATE projects 
       SET name = COALESCE($1, name),
           location = COALESCE($2, location),
           city = COALESCE($3, city),
           description = COALESCE($4, description),
           work_status = COALESCE($5, work_status),
           start_date = COALESCE($6, start_date),
           end_date = COALESCE($7, end_date),
           contractor_name = COALESCE($8, contractor_name),
           contractor_contact = COALESCE($9, contractor_contact),
           contractor_license = COALESCE($10, contractor_license),
           contractor_insurance_number = COALESCE($11, contractor_insurance_number),
           contractor_details = COALESCE($12, contractor_details),
           total_budget = COALESCE($13, total_budget),
           budget_allocated = COALESCE($14, budget_allocated),
           insurance_details = COALESCE($15, insurance_details),
           safety_certifications = COALESCE($16, safety_certifications)
       WHERE id = $17
       RETURNING *`,
      [
        name || null,
        location || null,
        city || null,
        description || null,
        work_status || null,
        start_date || null,
        end_date || null,
        contractor_name || null,
        contractor_contact || null,
        contractor_license || null,
        contractor_insurance_number || null,
        contractor_details ? JSON.stringify(contractor_details) : null,
        total_budget || null,
        budget_allocated || null,
        insurance_details ? JSON.stringify(insurance_details) : null,
        safety_certifications ? JSON.stringify(safety_certifications) : null,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Update project error:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// Delete project (superadmin only)
router.delete("/:id", requireRole("superadmin"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const projectResult = await client.query(
      "SELECT id FROM projects WHERE id = $1 FOR UPDATE",
      [id],
    );

    if (projectResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Project not found" });
    }

    await client.query("DELETE FROM attendance WHERE project_id = $1", [id]);
    await client.query("DELETE FROM projects WHERE id = $1", [id]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete project error:", error);
    res.status(500).json({ error: "Failed to delete project" });
  } finally {
    client.release();
  }
});

export default router;
