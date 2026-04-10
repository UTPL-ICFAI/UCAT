import express from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Create troubleshoot issue (supervisor and SE)
router.post('/', requireRole('supervisor', 'site_engineer'), async (req, res) => {
  try {
    const { project_id, title, description } = req.body;
    
    if (!project_id || !title) {
      return res.status(400).json({ error: 'project_id and title are required' });
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
      `INSERT INTO troubleshoot_issues (project_id, raised_by, title, description, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [project_id, req.user.id, title, description || null, 'open']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create troubleshoot issue error:', error);
    res.status(500).json({ error: 'Failed to create issue' });
  }
});

// Get troubleshoot issues
router.get('/', async (req, res) => {
  try {
    const { project_id, status } = req.query;
    
    let query = `SELECT ti.*, u1.name as raised_by_name, u2.name as escalated_to_name 
                 FROM troubleshoot_issues ti 
                 LEFT JOIN users u1 ON ti.raised_by = u1.id 
                 LEFT JOIN users u2 ON ti.escalated_to = u2.id 
                 WHERE 1=1`;
    const params = [];
    let paramIndex = 1;
    
    if (project_id) {
      query += ` AND ti.project_id = $${paramIndex}`;
      params.push(project_id);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND ti.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ' ORDER BY ti.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get troubleshoot issues error:', error);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

// Escalate issue to PM (SE only)
router.put('/:id/escalate', requireRole('site_engineer'), async (req, res) => {
  try {
    const { id } = req.params;
    const { escalated_to } = req.body;
    
    if (!escalated_to) {
      return res.status(400).json({ error: 'escalated_to is required' });
    }
    
    const issueResult = await pool.query('SELECT * FROM troubleshoot_issues WHERE id = $1', [id]);
    if (issueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    const issue = issueResult.rows[0];
    
    // Verify SE is assigned to this project
    const assignmentResult = await pool.query(
      'SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3',
      [issue.project_id, req.user.id, 'site_engineer']
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await pool.query(
      `UPDATE troubleshoot_issues 
       SET status = 'escalated', escalated_to = $1, escalated_at = now()
       WHERE id = $2
       RETURNING *`,
      [escalated_to, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Escalate issue error:', error);
    res.status(500).json({ error: 'Failed to escalate issue' });
  }
});

// Resolve issue (SA and PM)
router.put('/:id/resolve', requireRole('superadmin', 'project_manager'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const issueResult = await pool.query('SELECT * FROM troubleshoot_issues WHERE id = $1', [id]);
    if (issueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    const issue = issueResult.rows[0];
    
    // If PM, verify they are assigned to the project
    if (req.user.role === 'project_manager') {
      const assignmentResult = await pool.query(
        'SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3',
        [issue.project_id, req.user.id, 'project_manager']
      );
      
      if (assignmentResult.rows.length === 0) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    }
    
    const result = await pool.query(
      `UPDATE troubleshoot_issues 
       SET status = 'resolved', resolved_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Resolve issue error:', error);
    res.status(500).json({ error: 'Failed to resolve issue' });
  }
});

export default router;
