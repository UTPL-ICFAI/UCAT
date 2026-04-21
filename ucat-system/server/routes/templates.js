// Import Express framework for routing
import express from 'express';
// Import database connection pool
import pool from '../db.js';
// Import role-based access control middleware
import { requireRole } from '../middleware/role.js';
// Import xlsx library for Excel generation
import xlsx from 'xlsx';
// Import path for file operations
import path from 'path';
// Import fs for file system operations
import fs from 'fs';
// Import uuid for unique identifiers
import { v4 as uuidv4 } from 'uuid';

// Create Express router instance
const router = express.Router();

// ========================================
// POST /api/templates - Create Custom Template
// ========================================
/**
 * Create a custom document template with user-defined fields
 * Body params: name, description, fields (array of field objects)
 * Returns: created template object
 * Requires: site_engineer or project_manager role authentication
 */
router.post('/', requireRole('site_engineer', 'project_manager', 'supervisor', 'superadmin'), async (req, res) => {
  try {
    const { name, description, fields, rows, is_default, template_type, columns, row_limit } = req.body;
    const templateType = template_type || 'form';

    // Validate required fields - either fields (simple) or rows (advanced) must be provided
    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }

    if (templateType === 'table') {
      if (!columns || columns.length === 0) {
        return res.status(400).json({ error: 'Table templates require at least one column' });
      }
    } else if ((!fields || fields.length === 0) && (!rows || rows.length === 0)) {
      return res.status(400).json({ error: 'Form templates require at least one field or row' });
    }

    // Store template in database
    const result = await pool.query(
      `INSERT INTO templates (user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active, created_at`,
      [
        req.user.id,
        name,
        description || null,
        templateType,
        JSON.stringify(templateType === 'form' ? (fields || []) : []),
        JSON.stringify(templateType === 'form' ? (rows || []) : []),
        JSON.stringify(templateType === 'table' ? (columns || []) : []),
        row_limit || null,
        is_default || false,
        true
      ]
    );

    const template = result.rows[0];

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      template: {
        id: template.id,
        user_id: template.user_id,
        name: template.name,
        description: template.description,
        template_type: template.template_type || 'form',
        fields: typeof template.fields === 'string' ? JSON.parse(template.fields || '[]') : (template.fields || []),
        rows: typeof template.rows === 'string' ? JSON.parse(template.rows || '[]') : (template.rows || []),
        columns: typeof template.columns === 'string' ? JSON.parse(template.columns || '[]') : (template.columns || []),
        row_limit: template.row_limit,
        is_default: template.is_default,
        is_active: template.is_active,
        created_at: template.created_at
      }
    });

    console.log(`Template created: ${template.id} - ${template.name} by user ${req.user.id}`);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// ========================================
// GET /api/templates - Get All Templates
// ========================================
/**
 * Get all available templates
 * Returns: array of template objects
 * Requires: authentication
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active, created_at
       FROM templates
       WHERE is_active = true
       ORDER BY created_at DESC`
    );

    const templates = result.rows.map(t => ({
      id: t.id,
      user_id: t.user_id,
      name: t.name,
      description: t.description,
      template_type: t.template_type || 'form',
      fields: typeof t.fields === 'string' ? JSON.parse(t.fields) : t.fields || [],
      rows: typeof t.rows === 'string' ? JSON.parse(t.rows) : t.rows || [],
      columns: typeof t.columns === 'string' ? JSON.parse(t.columns) : t.columns || [],
      row_limit: t.row_limit,
      is_default: t.is_default,
      is_active: t.is_active,
      created_at: t.created_at
    }));

    res.json({
      success: true,
      templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// ========================================
// POST /api/templates/:templateId/submit - Submit Template and Generate Document
// ========================================
/**
 * Submit filled template data and generate Excel document
 * Body params: project_id, data (field values), formulas (optional array of formula configs)
 * Returns: document object with file path and metadata
 * Requires: authentication
 */
router.post('/:templateId/submit', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { project_id, data, formulas } = req.body;

    // Validate required fields
    if (!project_id || !data) {
      return res.status(400).json({ error: 'Project ID and data are required' });
    }

    // Get template details
    const templateResult = await pool.query(
      'SELECT name, fields FROM templates WHERE id = $1 AND is_active = true',
      [templateId]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = templateResult.rows[0];
    const templateFields = JSON.parse(template.fields);

    // Get project details
    const projectResult = await pool.query(
      'SELECT id, name FROM projects WHERE id = $1',
      [project_id]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = projectResult.rows[0];

    // Create Excel workbook with data
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      [`${template.name} - ${project.name}`],
      [`Submitted By:`, req.user.name],
      [`Date:`, new Date().toISOString().split('T')[0]],
      [`Time:`, new Date().toLocaleTimeString()],
      []
    ]);

    // Add field headers and data rows
    const headerRow = templateFields.map(f => f.label);
    const dataRow = templateFields.map(f => data[f.name] || '');
    
    worksheet['!data'] = worksheet['!data'] || [];
    worksheet['!data'].push(headerRow);
    worksheet['!data'].push(dataRow);

    // Add formulas if provided
    let formulaRowIndex = headerRow.length + 6; // Start after data
    if (formulas && formulas.length > 0) {
      worksheet['!data'].push([]); // Blank row
      formulas.forEach((formula, idx) => {
        const rowIndex = formulaRowIndex + idx + 1;
        const cellRef = xlsx.utils.encode_col(formula.column) + (rowIndex + 1);
        
        // Create formula cell with proper Excel syntax
        let excelFormula = '';
        if (formula.type === 'sum') {
          excelFormula = `=SUM(${xlsx.utils.encode_col(formula.column)}2:${xlsx.utils.encode_col(formula.column)}${rowIndex})`;
        } else if (formula.type === 'count') {
          excelFormula = `=COUNT(${xlsx.utils.encode_col(formula.column)}2:${xlsx.utils.encode_col(formula.column)}${rowIndex})`;
        } else if (formula.type === 'average') {
          excelFormula = `=AVERAGE(${xlsx.utils.encode_col(formula.column)}2:${xlsx.utils.encode_col(formula.column)}${rowIndex})`;
        }

        if (excelFormula) {
          worksheet[cellRef] = { f: excelFormula, v: formula.label };
        }
      });
    }

    // Convert data to sheet format
    const dataSheet = xlsx.utils.aoa_to_sheet(worksheet['!data'] || [headerRow, dataRow]);
    dataSheet['!cols'] = templateFields.map(() => ({ wch: 20 }));

    // Clear previous worksheet data and use new one
    xlsx.utils.book_append_sheet(workbook, dataSheet, 'Report');

    // Generate unique filename
    const filename = `template_${template.name.replace(/\s+/g, '_')}_${uuidv4()}_${Date.now()}.xlsx`;
    const filepath = path.join('uploads', filename);

    // Ensure uploads directory exists
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads', { recursive: true });
    }

    // Write Excel file to disk
    xlsx.writeFile(workbook, filepath);

    // Save document metadata to database
    const docResult = await pool.query(
      `INSERT INTO documents (project_id, title, file_path, file_type, uploaded_by_id, original_name, file_size, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, project_id, title, file_path, file_type, uploaded_by_id, created_at, status`,
      [
        project_id,
        `${template.name} - ${project.name}`,
        filepath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        req.user.id,
        filename,
        fs.statSync(filepath).size,
        'available'
      ]
    );

    const document = docResult.rows[0];

    res.status(201).json({
      success: true,
      message: 'Template submitted and document created',
      document: {
        id: document.id,
        project_id: document.project_id,
        title: document.title,
        file_path: document.file_path,
        file_type: document.file_type,
        uploaded_by_id: document.uploaded_by_id,
        created_at: document.created_at,
        status: document.status
      }
    });

    console.log(`Template submitted: ${filename} for project ${project_id}`);
  } catch (error) {
    console.error('Error submitting template:', error);
    res.status(500).json({ error: 'Failed to submit template' });
  }
});

// ========================================
// PUT /api/templates/:templateId - Update Template
// ========================================
/**
 * Update an existing template
 * URL params: templateId (template ID)
 * Body params: name, description, fields, rows, is_default
 * Returns: updated template object
 * Requires: authentication
 */
router.put('/:templateId', requireRole('site_engineer', 'project_manager', 'supervisor', 'superadmin'), async (req, res) => {
  try {
    const { templateId } = req.params;
    const { name, description, fields, rows, is_default, template_type, columns, row_limit } = req.body;
    const templateType = template_type || 'form';

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }

    if (templateType === 'table') {
      if (!columns || columns.length === 0) {
        return res.status(400).json({ error: 'Table templates require at least one column' });
      }
    } else if ((!fields || fields.length === 0) && (!rows || rows.length === 0)) {
      return res.status(400).json({ error: 'Form templates require at least one field or row' });
    }

    // Update template in database
    const result = await pool.query(
      `UPDATE templates 
       SET name = $1,
           description = $2,
           template_type = $3,
           fields = $4,
           rows = $5,
           columns = $6,
           row_limit = $7,
           is_default = $8
       WHERE id = $9
       RETURNING id, user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active, created_at`,
      [
        name,
        description || null,
        templateType,
        JSON.stringify(templateType === 'form' ? (fields || []) : []),
        JSON.stringify(templateType === 'form' ? (rows || []) : []),
        JSON.stringify(templateType === 'table' ? (columns || []) : []),
        row_limit || null,
        is_default || false,
        templateId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = result.rows[0];

    res.json({
      success: true,
      message: 'Template updated successfully',
      template: {
        id: template.id,
        user_id: template.user_id,
        name: template.name,
        description: template.description,
        template_type: template.template_type || 'form',
        fields: typeof template.fields === 'string' ? JSON.parse(template.fields || '[]') : (template.fields || []),
        rows: typeof template.rows === 'string' ? JSON.parse(template.rows || '[]') : (template.rows || []),
        columns: typeof template.columns === 'string' ? JSON.parse(template.columns || '[]') : (template.columns || []),
        row_limit: template.row_limit,
        is_default: template.is_default,
        is_active: template.is_active,
        created_at: template.created_at
      }
    });

    console.log(`Template updated: ${template.id} - ${template.name}`);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// ========================================
// DELETE /api/templates/:templateId - Delete Template
// ========================================
/**
 * Soft delete a template (mark as inactive)
 * URL params: templateId (template ID)
 * Returns: success message
 * Requires: authentication
 */
router.delete('/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;

    // Soft delete by marking as inactive
    const result = await pool.query(
      'UPDATE templates SET is_active = false WHERE id = $1 RETURNING id',
      [templateId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ success: true, message: 'Template deleted successfully' });
    console.log(`Template deleted: ${templateId}`);
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
