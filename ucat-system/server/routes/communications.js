import express from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Send communication message (PM, SE, and Supervisor)
router.post('/', requireRole('project_manager', 'site_engineer', 'supervisor'), async (req, res) => {
  try {
    const { project_id, message } = req.body;
    
    if (!project_id || !message) {
      return res.status(400).json({ error: 'project_id and message are required' });
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
      `INSERT INTO communications (project_id, sender_id, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [project_id, req.user.id, message]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get communications
router.get('/', async (req, res) => {
  try {
    const { project_id } = req.query;
    
    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }
    
    const result = await pool.query(
      `SELECT c.*, u.name as sender_name 
       FROM communications c 
       LEFT JOIN users u ON c.sender_id = u.id 
       WHERE c.project_id = $1 
       ORDER BY c.sent_at DESC`,
      [project_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get communications error:', error);
    res.status(500).json({ error: 'Failed to fetch communications' });
  }
});

export default router;
