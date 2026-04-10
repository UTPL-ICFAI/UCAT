import express from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Record daily budget (SE or PM)
router.post('/', requireRole('project_manager', 'site_engineer'), async (req, res) => {
  try {
    const { project_id, date, amount_spent, note } = req.body;
    
    if (!project_id || !date || amount_spent === undefined) {
      return res.status(400).json({ error: 'project_id, date, and amount_spent are required' });
    }
    
    // Verify user is assigned to this project
    const assignmentResult = await pool.query(
      `SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2`,
      [project_id, req.user.id]
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not assigned to this project' });
    }
    
    const result = await pool.query(
      `INSERT INTO daily_budget_tracking (project_id, recorded_by, date, amount_spent, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [project_id, req.user.id, date, amount_spent, note || null]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Record budget error:', error);
    res.status(500).json({ error: 'Failed to record budget' });
  }
});

// Get budget tracking
router.get('/', async (req, res) => {
  try {
    const { project_id, date } = req.query;
    
    let query = `SELECT dbt.*, u.name as recorded_by_name 
                 FROM daily_budget_tracking dbt 
                 LEFT JOIN users u ON dbt.recorded_by = u.id 
                 WHERE 1=1`;
    const params = [];
    let paramIndex = 1;
    
    if (project_id) {
      query += ` AND dbt.project_id = $${paramIndex}`;
      params.push(project_id);
      paramIndex++;
    }
    
    if (date) {
      query += ` AND dbt.date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }
    
    query += ' ORDER BY dbt.date DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({ error: 'Failed to fetch budget tracking' });
  }
});

export default router;
