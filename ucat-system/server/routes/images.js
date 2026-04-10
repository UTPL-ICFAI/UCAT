import express from 'express';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Setup multer for image uploads
const imagesDir = './uploads/images';
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectDir = path.join(imagesDir, String(req.body.project_id));
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
  const allowedMimes = ['image/jpeg', 'image/png'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG and PNG images are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

// Upload images (supervisor only)
router.post('/', upload.array('images', 10), requireRole('supervisor'), async (req, res) => {
  try {
    const { project_id, description } = req.body;
    
    if (!project_id || !req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'project_id and at least one image are required' });
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
      for (const file of req.files) {
        const filePath = path.join('uploads/images', String(project_id), file.filename);
        
        const result = await client.query(
          `INSERT INTO site_images (project_id, uploaded_by, file_path, original_name, description, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [project_id, req.user.id, filePath, file.originalname, description || null, 'pending']
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
    console.error('Upload images error:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

// Get images
router.get('/', async (req, res) => {
  try {
    const { project_id, status } = req.query;
    
    let query = `SELECT si.*, u1.name as uploaded_by_name, u2.name as approved_by_name 
                 FROM site_images si 
                 LEFT JOIN users u1 ON si.uploaded_by = u1.id 
                 LEFT JOIN users u2 ON si.approved_by = u2.id
                 WHERE 1=1`;
    const params = [];
    let paramIndex = 1;
    
    if (project_id) {
      query += ` AND si.project_id = $${paramIndex}`;
      params.push(project_id);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND si.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ' ORDER BY si.upload_timestamp DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// Approve image (SE only)
router.put('/:id/approve', requireRole('site_engineer'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const imageResult = await pool.query('SELECT * FROM site_images WHERE id = $1', [id]);
    if (imageResult.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    const image = imageResult.rows[0];
    
    // Verify SE is assigned to this project
    const assignmentResult = await pool.query(
      'SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3',
      [image.project_id, req.user.id, 'site_engineer']
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await pool.query(
      `UPDATE site_images 
       SET status = 'approved', approved_by = $1, approved_at = now()
       WHERE id = $2
       RETURNING *`,
      [req.user.id, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Approve image error:', error);
    res.status(500).json({ error: 'Failed to approve image' });
  }
});

// Reject image (SE only)
router.put('/:id/reject', requireRole('site_engineer'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const imageResult = await pool.query('SELECT * FROM site_images WHERE id = $1', [id]);
    if (imageResult.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    const image = imageResult.rows[0];
    
    // Verify SE is assigned to this project
    const assignmentResult = await pool.query(
      'SELECT * FROM project_assignments WHERE project_id = $1 AND user_id = $2 AND role = $3',
      [image.project_id, req.user.id, 'site_engineer']
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await pool.query(
      `UPDATE site_images 
       SET status = 'rejected', approved_by = $1, approved_at = now()
       WHERE id = $2
       RETURNING *`,
      [req.user.id, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Reject image error:', error);
    res.status(500).json({ error: 'Failed to reject image' });
  }
});

export default router;
