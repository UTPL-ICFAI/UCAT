import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";

const router = express.Router();

function normalizeProgressValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(100, Math.max(0, numericValue));
}

async function ensureProjectAccess(client, projectId, user) {
  if (user.role === "superadmin") {
    return true;
  }

  const assignmentResult = await client.query(
    `SELECT 1
     FROM project_assignments
     WHERE project_id = $1
       AND user_id = $2
       AND role = 'project_manager'`,
    [projectId, user.id],
  );

  return assignmentResult.rows.length > 0;
}

router.get("/:projectId", requireRole("project_manager", "superadmin"), async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectResult = await pool.query(
      `SELECT id, progress_percentage, progress_status
       FROM projects
       WHERE id = $1`,
      [projectId],
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (req.user.role !== "superadmin") {
      const accessResult = await pool.query(
        `SELECT 1
         FROM project_assignments
         WHERE project_id = $1
           AND user_id = $2
           AND role = 'project_manager'`,
        [projectId, req.user.id],
      );

      if (accessResult.rows.length === 0) {
        return res.status(403).json({ error: "Not allowed to view project progress" });
      }
    }

    const logsResult = await pool.query(
      `SELECT pl.id, pl.project_id, pl.logged_by, pl.log_date, pl.description, pl.increment_value, pl.progress_before, pl.progress_after, pl.created_at, u.name as logged_by_name
       FROM progress_logs pl
       LEFT JOIN users u ON u.id = pl.logged_by
       WHERE pl.project_id = $1
       ORDER BY pl.created_at ASC, pl.id ASC`,
      [projectId],
    );

    const project = projectResult.rows[0];
    res.json({
      success: true,
      progress_percentage: normalizeProgressValue(project.progress_percentage),
      progress_status: project.progress_status || "ongoing",
      logs: logsResult.rows,
    });
  } catch (error) {
    console.error("Error fetching project progress:", error);
    res.status(500).json({ error: "Failed to fetch project progress" });
  }
});

router.post(
  "/:projectId/log",
  requireRole("project_manager"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { projectId } = req.params;
      const description = String(req.body.description || "").trim();
      const incrementValue = Number(req.body.increment_value);

      if (!description) {
        return res.status(400).json({ error: "Description is required" });
      }
      if (!Number.isFinite(incrementValue) || incrementValue <= 0) {
        return res.status(400).json({ error: "Increment value must be greater than 0" });
      }

      await client.query("BEGIN");

      const hasAccess = await ensureProjectAccess(client, projectId, req.user);
      if (!hasAccess) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Not allowed to update this project" });
      }

      const projectResult = await client.query(
        `SELECT id, progress_percentage, progress_status
         FROM projects
         WHERE id = $1
         FOR UPDATE`,
        [projectId],
      );

      if (projectResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Project not found" });
      }

      const currentProgress = normalizeProgressValue(
        projectResult.rows[0].progress_percentage,
      );

      if (String(projectResult.rows[0].progress_status || "").toLowerCase() === "completed" || currentProgress >= 100) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Project progress is already complete" });
      }

      const nextProgress = Math.min(currentProgress + incrementValue, 100);

      const logResult = await client.query(
        `INSERT INTO progress_logs (
           project_id,
           logged_by,
           log_date,
           description,
           increment_value,
           progress_before,
           progress_after
         )
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)
         RETURNING id, project_id, logged_by, log_date, description, increment_value, progress_before, progress_after, created_at`,
        [projectId, req.user.id, description, incrementValue, currentProgress, nextProgress],
      );

      await client.query(
        `UPDATE projects
         SET progress_percentage = $1::numeric,
             progress_status = CASE WHEN $1::numeric >= 100 THEN 'completed' ELSE 'ongoing' END
         WHERE id = $2`,
        [nextProgress, projectId],
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message:
          nextProgress >= 100
            ? "Project ready for completion"
            : "Progress updated successfully",
        progress_percentage: nextProgress,
        log: logResult.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error logging project progress:", error);
      res.status(500).json({ error: "Failed to log project progress" });
    } finally {
      client.release();
    }
  },
);

router.put(
  "/:projectId/complete",
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const projectResult = await pool.query(
        `SELECT id, progress_percentage
         FROM projects
         WHERE id = $1`,
        [projectId],
      );

      if (projectResult.rows.length === 0) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (normalizeProgressValue(projectResult.rows[0].progress_percentage) < 100) {
        return res.status(400).json({ error: "Project progress must be 100 before completion" });
      }

      const result = await pool.query(
        `UPDATE projects
         SET work_status = 'completed',
             progress_status = 'completed',
             completion_marked_by = $1,
             completion_marked_at = NOW()
         WHERE id = $2
         RETURNING id, work_status, progress_status, progress_percentage, completion_marked_by, completion_marked_at`,
        [req.user.id, projectId],
      );

      res.json({
        success: true,
        message: "Project marked as completed",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Error completing project:", error);
      res.status(500).json({ error: "Failed to complete project" });
    }
  },
);

export default router;