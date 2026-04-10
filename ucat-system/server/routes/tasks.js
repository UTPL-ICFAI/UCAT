import express from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Create task (PM only)
router.post('/', requireRole('project_manager'), async (req, res) => {
  try {
    const { project_id, assigned_to, title, description, due_date, status } = req.body;
    
    if (!project_id || !assigned_to || !title) {
      return res.status(400).json({ error: 'project_id, assigned_to, and title are required' });
    }
    
    // Verify PM is assigned to this project
    const assignmentResult = await pool.query(
      'SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3',
      [project_id, req.user.id, 'project_manager']
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not assigned to this project' });
    }
    
    const result = await pool.query(
      `INSERT INTO tasks (project_id, assigned_to, assigned_by, title, description, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [project_id, assigned_to, req.user.id, title, description || null, due_date || null, status || 'pending']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Get tasks
router.get('/', async (req, res) => {
  try {
    const { project_id, assigned_to, status } = req.query;
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (project_id) {
      query += ` AND project_id = $${paramIndex}`;
      params.push(project_id);
      paramIndex++;
    }
    
    if (assigned_to) {
      query += ` AND assigned_to = $${paramIndex}`;
      params.push(assigned_to);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Update task
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, title, description, due_date } = req.body;
    
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const task = taskResult.rows[0];
    
    // Verify authorization (PM or assigned SE)
    if (req.user.role === 'project_manager') {
      const assignmentResult = await pool.query(
        'SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3',
        [task.project_id, req.user.id, 'project_manager']
      );
      if (assignmentResult.rows.length === 0) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    } else if (req.user.role === 'site_engineer') {
      if (task.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    } else {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await pool.query(
      `UPDATE tasks 
       SET status = COALESCE($1, status),
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           due_date = COALESCE($4, due_date),
           updated_at = now()
       WHERE id = $5
       RETURNING *`,
      [status || null, title || null, description || null, due_date || null, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

export default router;
