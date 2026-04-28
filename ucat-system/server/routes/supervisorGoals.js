import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";

const router = express.Router();
let supervisorGoalsSchemaEnsured = false;
let supervisorGoalsSchemaEnsuringPromise = null;

async function ensureSupervisorGoalsCompatibility() {
  if (supervisorGoalsSchemaEnsured) return;
  if (supervisorGoalsSchemaEnsuringPromise) {
    await supervisorGoalsSchemaEnsuringPromise;
    return;
  }

  supervisorGoalsSchemaEnsuringPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS supervisor_goals (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id),
      assigned_to INTEGER REFERENCES users(id),
      title VARCHAR(200) NOT NULL,
      description TEXT,
      due_date DATE,
      status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    ALTER TABLE supervisor_goals
      ADD COLUMN IF NOT EXISTS project_id INTEGER,
      ADD COLUMN IF NOT EXISTS assigned_by INTEGER,
      ADD COLUMN IF NOT EXISTS assigned_to INTEGER,
      ADD COLUMN IF NOT EXISTS title VARCHAR(200),
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS due_date DATE,
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

    CREATE INDEX IF NOT EXISTS idx_supervisor_goals_project_id ON supervisor_goals(project_id);
    CREATE INDEX IF NOT EXISTS idx_supervisor_goals_assigned_to ON supervisor_goals(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_supervisor_goals_assigned_by ON supervisor_goals(assigned_by);
  `);

  try {
    await supervisorGoalsSchemaEnsuringPromise;
    supervisorGoalsSchemaEnsured = true;
  } finally {
    supervisorGoalsSchemaEnsuringPromise = null;
  }
}

router.use(async (req, res, next) => {
  try {
    await ensureSupervisorGoalsCompatibility();
    next();
  } catch (error) {
    console.error("Supervisor goals schema compatibility check failed:", error);
    next(error);
  }
});

router.post("/", requireRole("site_engineer"), async (req, res) => {
  try {
    const { project_id, assigned_to, title, description, due_date } = req.body;

    if (!project_id || !assigned_to || !title) {
      return res
        .status(400)
        .json({ error: "project_id, assigned_to, and title are required" });
    }

    const seAssignment = await pool.query(
      "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3",
      [project_id, req.user.id, "site_engineer"],
    );

    if (seAssignment.rows.length === 0) {
      return res.status(403).json({ error: "Not assigned to this project" });
    }

    const supervisorAssignment = await pool.query(
      "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3",
      [project_id, assigned_to, "supervisor"],
    );

    if (supervisorAssignment.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "Supervisor is not assigned to this project" });
    }

    const result = await pool.query(
      `INSERT INTO supervisor_goals
       (project_id, assigned_by, assigned_to, title, description, due_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        project_id,
        req.user.id,
        assigned_to,
        title,
        description || null,
        due_date || null,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Create supervisor goal error:", error);
    res.status(500).json({ error: "Failed to create goal" });
  }
});

router.get("/my-assigned", requireRole("site_engineer"), async (req, res) => {
  try {
    const { project_id } = req.query;
    const params = [req.user.id];
    let query = `
      SELECT sg.*, u.name AS supervisor_name, p.name AS project_name
      FROM supervisor_goals sg
      JOIN users u ON sg.assigned_to = u.id
      JOIN projects p ON sg.project_id = p.id
      WHERE sg.assigned_by = $1
    `;

    if (project_id) {
      query += " AND sg.project_id = $2";
      params.push(project_id);
    }

    query += " ORDER BY sg.created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Get assigned goals error:", error);
    res.status(500).json({ error: "Failed to fetch goals" });
  }
});

router.get("/my", requireRole("supervisor"), async (req, res) => {
  try {
    const { project_id } = req.query;
    const params = [req.user.id];
    let query = `
      SELECT sg.*, u.name AS assigned_by_name, p.name AS project_name
      FROM supervisor_goals sg
      JOIN users u ON sg.assigned_by = u.id
      JOIN projects p ON sg.project_id = p.id
      JOIN project_assignments pa
        ON pa.project_id = sg.project_id
       AND pa.user_id = $1
       AND pa.role = 'supervisor'
      WHERE sg.assigned_to = $1
    `;

    if (project_id) {
      query += " AND sg.project_id = $2";
      params.push(project_id);
    }

    query += " ORDER BY sg.created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Get my goals error:", error);
    res.status(500).json({ error: "Failed to fetch goals" });
  }
});

router.get(
  "/project/:projectId",
  requireRole("project_manager", "superadmin"),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      if (req.user.role === "project_manager") {
        const assignment = await pool.query(
          "SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3",
          [projectId, req.user.id, "project_manager"],
        );
        if (assignment.rows.length === 0) {
          return res
            .status(403)
            .json({ error: "Not assigned to this project" });
        }
      }

      const result = await pool.query(
        `SELECT sg.*, 
                u1.name AS assigned_by_name,
                u2.name AS supervisor_name
         FROM supervisor_goals sg
         JOIN users u1 ON sg.assigned_by = u1.id
         JOIN users u2 ON sg.assigned_to = u2.id
         WHERE sg.project_id = $1
         ORDER BY sg.created_at DESC`,
        [projectId],
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Get project goals error:", error);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  },
);

router.put(
  "/:id",
  requireRole("supervisor", "superadmin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (
        !status ||
        !["pending", "in_progress", "completed"].includes(status)
      ) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const goalResult = await pool.query(
        "SELECT * FROM supervisor_goals WHERE id = $1",
        [id],
      );

      if (goalResult.rows.length === 0) {
        return res.status(404).json({ error: "Goal not found" });
      }

      const goal = goalResult.rows[0];

      if (req.user.role === "supervisor" && goal.assigned_to !== req.user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const result = await pool.query(
        `UPDATE supervisor_goals
       SET status = $1,
           updated_at = now()
       WHERE id = $2
       RETURNING *`,
        [status, id],
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Update supervisor goal error:", error);
      res.status(500).json({ error: "Failed to update goal" });
    }
  },
);

export default router;
