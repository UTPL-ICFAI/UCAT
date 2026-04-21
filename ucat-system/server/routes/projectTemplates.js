// Import Express framework for routing
import express from 'express';
// Import database connection pool
import pool from '../db.js';
// Import role-based access control middleware
import { requireRole } from '../middleware/role.js';

// Create Express router instance
const router = express.Router();

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  return value;
}

// ========================================
// GET /api/project-templates/:projectId - Get all templates for a project
// ========================================
router.get('/:projectId', requireRole('superadmin', 'project_manager', 'site_engineer'), async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Get all templates assigned to this project
    const result = await pool.query(`
      SELECT 
        pt.id,
        pt.project_id,
        pt.template_id,
        t.name,
        t.description,
        t.template_type,
        t.fields,
        t.rows,
        t.columns,
        t.row_limit,
        pt.repetition_type,
        pt.repetition_days,
        pt.is_active,
        pt.assigned_at,
        u.name as assigned_by_name
      FROM project_templates pt
      JOIN templates t ON pt.template_id = t.id
      JOIN users u ON pt.assigned_by = u.id
      WHERE pt.project_id = $1 AND pt.is_active = true
      ORDER BY pt.assigned_at DESC
    `, [projectId]);
    
    res.json({
      success: true,
      data: result.rows.map(row => ({
        ...row,
        template: {
          id: row.template_id,
          name: row.name,
          description: row.description,
          template_type: row.template_type || 'form',
          fields: parseJson(row.fields, []),
          rows: parseJson(row.rows, []),
          columns: parseJson(row.columns, []),
          row_limit: row.row_limit
        }
      }))
    });
  } catch (error) {
    console.error('Error fetching project templates:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch templates' });
  }
});

// ========================================
// POST /api/project-templates - Assign template to project
// ========================================
router.post('/', requireRole('superadmin'), async (req, res) => {
  try {
    const { projectId, templateId, repetitionType = 'daily', repetitionDays } = req.body;
    const userId = req.user.id;
    
    // Validate inputs
    if (!projectId || !templateId) {
      return res.status(400).json({ error: 'Project ID and Template ID required' });
    }
    
    // Insert project template assignment
    const result = await pool.query(`
      INSERT INTO project_templates (
        project_id, 
        template_id, 
        assigned_by, 
        repetition_type, 
        repetition_days,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (project_id, template_id) 
      DO UPDATE SET 
        is_active = true,
        repetition_type = $4,
        repetition_days = $5
      RETURNING *
    `, [
      projectId, 
      templateId, 
      userId, 
      repetitionType,
      JSON.stringify(repetitionDays || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    ]);
    
    res.status(201).json({
      success: true,
      projectTemplate: result.rows[0]
    });
  } catch (error) {
    console.error('Error assigning template to project:', error);
    res.status(500).json({ success: false, error: 'Failed to assign template' });
  }
});

// ========================================
// DELETE /api/project-templates/:projectTemplateId - Remove template from project
// ========================================
router.delete('/:projectTemplateId', requireRole('superadmin'), async (req, res) => {
  try {
    const { projectTemplateId } = req.params;
    
    // Mark as inactive instead of deleting
    await pool.query(`
      UPDATE project_templates 
      SET is_active = false 
      WHERE id = $1
    `, [projectTemplateId]);
    
    res.json({
      success: true,
      message: 'Template removed from project'
    });
  } catch (error) {
    console.error('Error removing template:', error);
    res.status(500).json({ success: false, error: 'Failed to remove template' });
  }
});

// ========================================
// POST /api/project-templates/submit - Site engineer submits filled template
// ========================================
router.post('/:projectTemplateId/submit', requireRole('site_engineer'), async (req, res) => {
  try {
    const { projectTemplateId } = req.params;
    const { data, submissionDate } = req.body;
    const userId = req.user.id;
    
    // Get project template details
    const ptResult = await pool.query(`
      SELECT project_id, template_id FROM project_templates WHERE id = $1
    `, [projectTemplateId]);
    
    if (ptResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project template not found' });
    }
    
    const { project_id, template_id } = ptResult.rows[0];

    const templateResult = await pool.query(
      `SELECT id, name, template_type, fields, rows, columns, row_limit
       FROM templates
       WHERE id = $1`,
      [template_id]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const templateRow = templateResult.rows[0];
    const templateSnapshot = {
      id: templateRow.id,
      name: templateRow.name,
      template_type: templateRow.template_type || 'form',
      fields: parseJson(templateRow.fields, []),
      rows: parseJson(templateRow.rows, []),
      columns: parseJson(templateRow.columns, []),
      row_limit: templateRow.row_limit
    };

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Submission data is required' });
    }

    if (templateSnapshot.template_type === 'table') {
      const rowData = Array.isArray(data.rows) ? data.rows : [];
      if (rowData.length === 0) {
        return res.status(400).json({ error: 'Table submissions require at least one row' });
      }
      if (templateSnapshot.row_limit && rowData.length > templateSnapshot.row_limit) {
        return res.status(400).json({ error: 'Row limit exceeded for this template' });
      }
    } else {
      const fieldData = Array.isArray(data.fields) ? data.fields : [];
      const requiredFields = (templateSnapshot.fields || []).filter(field => field.required);
      const missing = requiredFields.filter(field => !fieldData.find(item => item.label === field.label && String(item.value || '').trim() !== ''));
      if (missing.length > 0) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
    }
    
    // Insert daily submission
    const result = await pool.query(`
      INSERT INTO daily_submissions (
        project_id,
        template_id,
        submitted_by,
        submission_date,
        data,
        template_snapshot,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'submitted')
      ON CONFLICT (project_id, template_id, submission_date)
      DO UPDATE SET
        data = $5,
        template_snapshot = $6,
        status = 'submitted'
      RETURNING *
    `, [
      project_id,
      template_id,
      userId,
      submissionDate,
      JSON.stringify(data),
      JSON.stringify(templateSnapshot)
    ]);
    
    res.status(201).json({
      success: true,
      submission: result.rows[0]
    });
  } catch (error) {
    console.error('Error submitting template:', error);
    res.status(500).json({ success: false, error: 'Failed to submit template' });
  }
});

// ========================================
// GET /api/project-templates/:projectId/submissions - Get all submissions for project
// ========================================
router.get('/:projectId/submissions', requireRole('superadmin', 'project_manager', 'site_engineer'), async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        ds.id,
        ds.project_id,
        ds.template_id,
        t.name as template_name,
        t.template_type,
        t.columns,
        t.row_limit,
        ds.submitted_by,
        u.name as submitted_by_name,
        ds.submission_date,
        ds.data,
        ds.template_snapshot,
        ds.status,
        ds.reviewed_by,
        ru.name as reviewed_by_name,
        ds.reviewed_at
      FROM daily_submissions ds
      JOIN templates t ON ds.template_id = t.id
      JOIN users u ON ds.submitted_by = u.id
      LEFT JOIN users ru ON ds.reviewed_by = ru.id
      WHERE ds.project_id = $1
      ORDER BY ds.submission_date DESC, ds.created_at DESC
    `, [projectId]);
    
    res.json({
      success: true,
      data: result.rows.map(row => ({
        ...row,
        data: parseJson(row.data, {}),
        template_snapshot: parseJson(row.template_snapshot, null),
        template: {
          id: row.template_id,
          name: row.template_name,
          template_type: row.template_type || 'form',
          columns: parseJson(row.columns, []),
          row_limit: row.row_limit
        }
      }))
    });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch submissions' });
  }
});

// ========================================
// GET /api/project-templates/submissions/:submissionId - Get single submission details
// ========================================
router.get('/submissions/:submissionId', requireRole('superadmin', 'project_manager', 'site_engineer'), async (req, res) => {
  try {
    const { submissionId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        ds.id,
        ds.project_id,
        ds.template_id,
        t.name as template_name,
        t.template_type,
        t.fields,
        t.rows,
        t.columns,
        t.row_limit,
        ds.submitted_by,
        u.name as submitted_by_name,
        ds.submission_date,
        ds.data,
        ds.template_snapshot,
        ds.status,
        ds.reviewed_by,
        ru.name as reviewed_by_name,
        ds.review_comment,
        ds.reviewed_at,
        ds.created_at
      FROM daily_submissions ds
      JOIN templates t ON ds.template_id = t.id
      JOIN users u ON ds.submitted_by = u.id
      LEFT JOIN users ru ON ds.reviewed_by = ru.id
      WHERE ds.id = $1
    `, [submissionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        project_id: row.project_id,
        template_id: row.template_id,
        template_snapshot: parseJson(row.template_snapshot, null),
        template: {
          name: row.template_name,
          template_type: row.template_type || 'form',
          fields: parseJson(row.fields, []),
          rows: parseJson(row.rows, []),
          columns: parseJson(row.columns, []),
          row_limit: row.row_limit
        },
        submitted_by: row.submitted_by_name,
        submission_date: row.submission_date,
        data: parseJson(row.data, {}),
        status: row.status,
        reviewed_by: row.reviewed_by_name,
        review_comment: row.review_comment,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at
      }
    });
  } catch (error) {
    console.error('Error fetching submission:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch submission' });
  }
});

// ========================================
// POST /api/project-templates/submissions/:submissionId/approve - Approve submission
// ========================================
router.post('/submissions/:submissionId/approve', requireRole('superadmin', 'project_manager'), async (req, res) => {
  try {
    const { submissionId } = req.params;
    const userId = req.user.id;
    
    const result = await pool.query(`
      UPDATE daily_submissions
      SET 
        status = 'approved',
        reviewed_by = $1,
        reviewed_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [userId, submissionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    res.json({
      success: true,
      message: 'Submission approved',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error approving submission:', error);
    res.status(500).json({ success: false, error: 'Failed to approve submission' });
  }
});

// ========================================
// POST /api/project-templates/submissions/:submissionId/reject - Reject submission
// ========================================
router.post('/submissions/:submissionId/reject', requireRole('superadmin', 'project_manager'), async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { review_comment } = req.body;
    const userId = req.user.id;
    
    const result = await pool.query(`
      UPDATE daily_submissions
      SET 
        status = 'rejected',
        reviewed_by = $1,
        review_comment = $2,
        reviewed_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [userId, review_comment || '', submissionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    res.json({
      success: true,
      message: 'Submission rejected',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error rejecting submission:', error);
    res.status(500).json({ success: false, error: 'Failed to reject submission' });
  }
});

export default router;
