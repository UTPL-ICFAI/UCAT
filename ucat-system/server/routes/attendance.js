import express from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Submit attendance (supervisor only)
router.post('/', requireRole('supervisor'), async (req, res) => {
  try {
    const { project_id, attendance_records } = req.body;
    
    if (!project_id || !attendance_records || !Array.isArray(attendance_records)) {
      return res.status(400).json({ error: 'project_id and attendance_records array are required' });
    }
    
    // Verify supervisor is assigned to this project
    const assignmentResult = await pool.query(
      'SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3',
      [project_id, req.user.id, 'supervisor']
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not assigned to this project' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const results = [];
      for (const record of attendance_records) {
        const { worker_id, date, status } = record;
        
        if (!worker_id || !date || !status) {
          throw new Error('Each record must have worker_id, date, and status');
        }
        
        const result = await client.query(
          `INSERT INTO attendance (worker_id, project_id, supervisor_id, date, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (worker_id, date) DO UPDATE SET status = $5
           RETURNING *`,
          [worker_id, project_id, req.user.id, date, status]
        );
        
        results.push(result.rows[0]);
      }
      
      await client.query('COMMIT');
      res.status(201).json(results);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Submit attendance error:', error);
    res.status(500).json({ error: 'Failed to submit attendance' });
  }
});

// Get attendance
router.get('/', async (req, res) => {
  try {
    const { project_id, date, worker_id } = req.query;
    
    let query = 'SELECT a.*, w.name as worker_name, u.name as supervisor_name FROM attendance a LEFT JOIN workers w ON a.worker_id = w.id LEFT JOIN users u ON a.supervisor_id = u.id WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (project_id) {
      query += ` AND a.project_id = $${paramIndex}`;
      params.push(project_id);
      paramIndex++;
    }
    
    if (date) {
      query += ` AND a.date = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }
    
    if (worker_id) {
      query += ` AND a.worker_id = $${paramIndex}`;
      params.push(worker_id);
      paramIndex++;
    }
    
    query += ' ORDER BY a.date DESC, a.worker_id';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

export default router;
