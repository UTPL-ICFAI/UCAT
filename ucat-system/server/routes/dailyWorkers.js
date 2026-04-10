// Import Express framework for routing
import express from 'express';
// Import database connection pool
import pool from '../db.js';
// Import role-based access control middleware
import { requireRole } from '../middleware/role.js';

// Create Express router instance
const router = express.Router();

// ========================================
// POST /api/daily-workers - Add daily labour worker
// ========================================
router.post('/', requireRole('site_engineer', 'superadmin', 'project_manager'), async (req, res) => {
  try {
    const { project_id, work_date, worker_name, gender, worker_category } = req.body;
    const userId = req.user.id;
    
    // Validate inputs
    if (!project_id || !work_date || !worker_name) {
      return res.status(400).json({ error: 'Project ID, work_date, and worker_name required' });
    }
    
    // Insert daily worker
    const result = await pool.query(`
      INSERT INTO daily_workers (
        project_id,
        work_date,
        added_by,
        worker_name,
        gender,
        worker_category
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (project_id, work_date, worker_name)
      DO UPDATE SET
        gender = $5,
        worker_category = $6
      RETURNING *
    `, [project_id, work_date, userId, worker_name, gender, worker_category]);
    
    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error adding daily worker:', error);
    res.status(500).json({ success: false, error: 'Failed to add worker' });
  }
});

// ========================================
// GET /api/daily-workers/:projectId/:date - Get daily workers for a project on specific date
// ========================================
router.get('/:projectId/:date', requireRole('site_engineer', 'supervisor', 'superadmin', 'project_manager'), async (req, res) => {
  try {
    const { projectId, date } = req.params;
    
    const result = await pool.query(`
      SELECT 
        id,
        worker_name,
        gender,
        worker_category,
        work_date,
        attendance_marked,
        attendance_marked_by,
        attendance_marked_at,
        created_at
      FROM daily_workers
      WHERE project_id = $1 AND work_date = $2
      ORDER BY worker_name ASC
    `, [projectId, date]);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching daily workers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch workers' });
  }
});

// ========================================
// POST /api/daily-workers/:workerId/mark-attendance - Mark worker attendance
// ========================================
router.post('/:workerId/mark-attendance', requireRole('supervisor', 'site_engineer', 'superadmin', 'project_manager'), async (req, res) => {
  try {
    const { workerId } = req.params;
    const userId = req.user.id;
    
    // Update worker as attendance marked
    const result = await pool.query(`
      UPDATE daily_workers
      SET 
        attendance_marked = true,
        attendance_marked_by = $1,
        attendance_marked_at = now()
      WHERE id = $2
      RETURNING *
    `, [userId, workerId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Worker not found' });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ success: false, error: 'Failed to mark attendance' });
  }
});

// ========================================
// DELETE /api/daily-workers/:workerId - Remove daily worker
// ========================================
router.delete('/:workerId', requireRole('site_engineer', 'superadmin', 'project_manager'), async (req, res) => {
  try {
    const { workerId } = req.params;
    
    await pool.query(`
      DELETE FROM daily_workers WHERE id = $1
    `, [workerId]);
    
    res.json({
      success: true,
      message: 'Worker removed'
    });
  } catch (error) {
    console.error('Error removing worker:', error);
    res.status(500).json({ success: false, error: 'Failed to remove worker' });
  }
});

export default router;
