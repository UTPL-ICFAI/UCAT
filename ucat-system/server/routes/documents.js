import express from 'express';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Setup multer for document uploads
const docsDir = './uploads/documents';
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectDir = path.join(docsDir, String(req.body.project_id));
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    cb(null, projectDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '_' + file.originalname;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['application/pdf', 'application/zip', 'image/png', 'image/jpeg'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, ZIP, PNG, and JPEG files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Upload document (PM and SE)
router.post('/', upload.single('document'), requireRole('project_manager', 'site_engineer'), async (req, res) => {
  try {
    const { project_id, title, doc_type, revision_no, drawing_no, discipline, sub_discipline, design_status, doc_status, package: pkg, corridor, category, confidential, revision_date, doc_date, weightage, remarks } = req.body;
    
    if (!project_id || !req.file) {
      return res.status(400).json({ error: 'project_id and document file are required' });
    }
    
    // Verify user is assigned to this project
    const assignmentResult = await pool.query(
      `SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role IN ($3, $4)`,
      [project_id, req.user.id, 'project_manager', 'site_engineer']
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not assigned to this project' });
    }
    
    const filePath = path.join('uploads/documents', String(project_id), req.file.filename);
    
    const result = await pool.query(
      `INSERT INTO documents (project_id, uploaded_by, title, file_path, original_name, doc_type, revision_no, drawing_no, discipline, sub_discipline, design_status, doc_status, package, corridor, category, confidential, revision_date, doc_date, weightage, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [project_id, req.user.id, title || null, filePath, req.file.originalname, doc_type || null, revision_no || null, drawing_no || null, discipline || null, sub_discipline || null, design_status || null, doc_status || null, pkg || null, corridor || null, category || null, confidential === 'true' || false, revision_date || null, doc_date || null, weightage || null, remarks || null]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Get documents
router.get('/', async (req, res) => {
  try {
    const { project_id, doc_type, status, filter_by_assigned } = req.query;
    
    let query = `SELECT d.*, u.name as uploaded_by_name 
                 FROM documents d 
                 LEFT JOIN users u ON d.uploaded_by = u.id 
                 WHERE 1=1`;
    const params = [];
    let paramIndex = 1;
    
    // If filter_by_assigned is true, only show documents from user's assigned projects
    if (filter_by_assigned === 'true') {
      query += ` AND d.project_id IN (
                   SELECT project_id FROM project_assignments WHERE user_id = $${paramIndex}
                 )`;
      params.push(req.user.id);
      paramIndex++;
    }
    
    if (project_id) {
      query += ` AND d.project_id = $${paramIndex}`;
      params.push(project_id);
      paramIndex++;
    }
    
    if (doc_type) {
      query += ` AND d.doc_type = $${paramIndex}`;
      params.push(doc_type);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND d.doc_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ' ORDER BY d.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Search documents
router.get('/search', async (req, res) => {
  try {
    const { q, project_id } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    let query = `SELECT d.*, u.name as uploaded_by_name 
                 FROM documents d 
                 LEFT JOIN users u ON d.uploaded_by = u.id 
                 WHERE (d.title ILIKE $1 OR d.drawing_no ILIKE $1 OR d.discipline ILIKE $1)`;
    const params = [`%${q}%`];
    
    if (project_id) {
      query += ' AND d.project_id = $2';
      params.push(project_id);
    }
    
    query += ' ORDER BY d.created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Search documents error:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

export default router;
