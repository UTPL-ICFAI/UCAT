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
// POST /api/daily-reports - Create Daily Report & Document
// ========================================
/**
 * Create a daily progress report and convert to Excel document
 * Body params: project_id, tunnelType, tunnelStartChainage, etc.
 * Returns: document object with file path and metadata
 * Requires: site_engineer role authentication
 */
router.post('/', requireRole('site_engineer'), async (req, res) => {
  try {
    // Destructure all report fields from request body
    const {
      project_id,
      tunnelType,
      tunnelStartChainage,
      tunnelEndChainage,
      faceCurrentChainage,
      tunnelLength,
      steelRDB,
      rockClass,
      latticeGirders,
      monthPerDay,
      targetTarget,
      todaysProgress,
      progressThisMonth,
      tillLastMonth,
      totalProgressUpToDate,
      balance,
      percentageCompleted,
      remarks
    } = req.body;

    // Validate required fields
    if (!project_id || !tunnelType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get project details to include in document
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
      ['DAILY PROGRESS REPORT'],
      ['Project Name:', project.name],
      ['Submitted By:', req.user.name],
      ['Date:', new Date().toISOString().split('T')[0]],
      ['Time:', new Date().toLocaleTimeString()],
      [],
      ['TUNNEL DETAILS'],
      ['Tunnel Type', tunnelType],
      ['Tunnel Start Chainage', tunnelStartChainage],
      ['Tunnel End Chainage', tunnelEndChainage],
      ['Face Current Chainage', faceCurrentChainage],
      [],
      ['TUNNEL PROPERTIES'],
      ['Tunnel Length/SCOPE (m)', tunnelLength],
      ['Steel RDB (No.)', steelRDB],
      ['Rock Class', rockClass],
      ['Lattice Girders (Nos)', latticeGirders],
      [],
      ['MONTHLY TARGETS'],
      ['Month Per day (m)', monthPerDay],
      ['Target Target (m)', targetTarget],
      [],
      ['PROGRESS'],
      ["Today's Progress (m)", todaysProgress],
      ['Progress for This Month (m)', progressThisMonth],
      [],
      ['SUMMARY'],
      ['Till Last Month (m)', tillLastMonth],
      ['Total Progress Up To Date (m)', totalProgressUpToDate],
      ['Balance (m)', balance],
      ['% Age Completed', percentageCompleted + '%'],
      [],
      ['FORMULAS (Calculated Fields)'],
      ['Total Progress =', '=SUM(C27:C28)', `(Till Last Month + This Month = ${parseFloat(tillLastMonth || 0) + parseFloat(progressThisMonth || 0)})`],
      ['Balance =', '=C14-C30', `(Total Length - Total Progress = ${parseFloat(tunnelLength || 0) - (parseFloat(tillLastMonth || 0) + parseFloat(progressThisMonth || 0))})`],
      ['% Completed =', '=(C30/C14)*100', `((Total Progress / Length) * 100 = ${((parseFloat(totalProgressUpToDate || 0) / parseFloat(tunnelLength || 1)) * 100).toFixed(2)}%)`],
      [],
      ['REMARKS'],
      [remarks || 'No remarks']
    ]);

    // Add formulas to specific cells for Excel to calculate
    // Cell D30: Total Progress formula (Till Last Month + This Month)
    worksheet['D30'] = { f: 'C27+C28', v: parseFloat(tillLastMonth || 0) + parseFloat(progressThisMonth || 0) };
    
    // Cell D31: Balance formula (Total Length - Total Progress)
    worksheet['D31'] = { f: 'C14-D30', v: parseFloat(tunnelLength || 0) - (parseFloat(tillLastMonth || 0) + parseFloat(progressThisMonth || 0)) };
    
    // Cell D32: Percentage formula ((Total Progress / Length) * 100)
    worksheet['D32'] = { f: '(D30/C14)*100', v: ((parseFloat(totalProgressUpToDate || 0) / parseFloat(tunnelLength || 1)) * 100).toFixed(2) };

    // Set column widths for better readability
    worksheet['!cols'] = [
      { wch: 30 },
      { wch: 20 },
      { wch: 15 },
      { wch: 40 }
    ];

    // Add worksheet to workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Daily Report');

    // Generate unique filename
    const filename = `daily_report_${uuidv4()}_${Date.now()}.xlsx`;
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
        `Daily Progress Report - ${tunnelType}`,
        filepath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        req.user.id,
        filename,
        fs.statSync(filepath).size,
        'available'
      ]
    );

    const document = docResult.rows[0];

    // Return created document with full details
    res.status(201).json({
      success: true,
      message: 'Daily report created and converted to document',
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

    console.log(`Daily report created: ${filename} for project ${project_id}`);
  } catch (error) {
    console.error('Error creating daily report:', error);
    res.status(500).json({ error: 'Failed to create daily report' });
  }
});

// ========================================
// GET /api/daily-reports/:projectId - Get Project Reports
// ========================================
/**
 * Get all daily reports for a specific project
 * URL params: projectId (project ID)
 * Returns: array of document objects
 * Requires: authentication
 */
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    // Query all documents for project that are daily reports
    const result = await pool.query(
      `SELECT id, project_id, title, file_path, uploaded_by_id, created_at, status, file_type
       FROM documents
       WHERE project_id = $1 AND title LIKE '%Daily Progress Report%'
       ORDER BY created_at DESC`,
      [projectId]
    );

    res.json(result.rows);
    console.log(`Retrieved ${result.rows.length} daily reports for project ${projectId}`);
  } catch (error) {
    console.error('Error fetching daily reports:', error);
    res.status(500).json({ error: 'Failed to fetch daily reports' });
  }
});

export default router;
