// Import Express framework for routing HTTP requests
import express from 'express';
// Create Express router instance for defining worker-related routes
const router = express.Router();
// Import database connection pool from db configuration
import pool from '../db.js';
// Import role-based authorization middleware for access control
import { requireRole } from '../middleware/role.js';

// ============================================================================
// GET /api/workers/supervisors?project_id=X
// ============================================================================
// Retrieve all supervisors assigned to a specific project for dropdown population
// Purpose: When adding workers, populate supervisor selection dropdown
// Authentication: Requires site_engineer or superadmin role
// Query Parameters: project_id (required) - ID of project to get supervisors for
// Returns: Array of { id, name, user_id } objects for matching supervisors
router.get('/supervisors', requireRole(['site_engineer', 'superadmin']), async (req, res) => {
  // Extract project_id from query string parameters
  const { project_id } = req.query;
  
  // Validate project_id parameter is provided and is a number
  if (!project_id || isNaN(project_id)) {
    // Return 400 Bad Request if project_id missing or invalid
    return res.status(400).json({ error: 'project_id is required and must be a number' });
  }

  // Try to execute database query to fetch supervisors
  try {
    // Query database for supervisors assigned to this project
    const result = await pool.query(
      `SELECT u.id, u.name, u.user_id 
       FROM users u
       JOIN project_assignments pa ON pa.user_id = u.id
       WHERE pa.project_id = $1 AND pa.role = 'supervisor'
       ORDER BY u.name`,
      // First parameter: project ID
      [project_id]
    );

    // Send array of supervisors back to client as JSON
    res.json(result.rows);
  } catch (error) {
    // Log error details to console for debugging server issues
    console.error('Get supervisors error:', error);
    // Send 500 Internal Server Error response to client
    res.status(500).json({ error: 'Failed to fetch supervisors' });
  }
});

// ============================================================================
// GET /api/workers?project_id=X
// ============================================================================
// Retrieve all workers for a specific project assigned to current site engineer
// Purpose: Load worker list for site engineer's project details page
// Authentication: Requires site_engineer, supervisor, or superadmin role
// Query Parameters: project_id (required) - ID of project to get workers for
// Returns: Array of worker objects with supervisor_name joined from users table
router.get('/', requireRole(['site_engineer', 'supervisor', 'superadmin']), async (req, res) => {
  // Extract project_id from query string parameters
  const { project_id } = req.query;
  
  // Validate project_id parameter is provided and is a number
  if (!project_id || isNaN(project_id)) {
    // Return 400 Bad Request if project_id missing or invalid
    return res.status(400).json({ error: 'project_id is required and must be a number' });
  }

  // Extract current user ID from JWT token (set by authentication middleware)
  const userId = req.user.id;
  // Extract current user role from JWT token (set by authentication middleware)
  const userRole = req.user.role;

  // Try to execute database query to fetch workers
  try {
    // Build query: superadmin sees all workers, others only see their own
    const query = userRole === 'superadmin'
      ? `SELECT w.*, u.name as supervisor_name 
         FROM workers w
         LEFT JOIN users u ON u.id = w.supervisor_id
         WHERE w.project_id = $1
         ORDER BY w.created_at DESC`
      : `SELECT w.*, u.name as supervisor_name 
         FROM workers w
         LEFT JOIN users u ON u.id = w.supervisor_id
         WHERE w.project_id = $1 AND w.site_engineer_id = $2
         ORDER BY w.created_at DESC`;
    
    // Build parameter array: project_id + user_id (if not superadmin)
    const params = userRole === 'superadmin' ? [project_id] : [project_id, userId];
    // Execute the parameterized query with appropriate parameters
    const result = await pool.query(query, params);

    // Send array of workers back to client as JSON
    res.json(result.rows);
  } catch (error) {
    // Log error details to console for debugging server issues
    console.error('Get workers error:', error);
    // Send 500 Internal Server Error response to client
    res.status(500).json({ error: 'Failed to fetch workers' });
  }
});

// ============================================================================
// POST /api/workers
// ============================================================================
// Create a new worker record and assign to a supervisor
// Purpose: Add worker to project from site engineer dashboard
// Authentication: Requires site_engineer or superadmin role
// Body Parameters:
//   - name (required): Worker full name (non-empty string)
//   - age (required): Worker age (integer 1-99)
//   - gender (required): Worker gender (male, female, other)
//   - project_id (required): ID of project worker is assigned to
//   - supervisor_id (required): ID of supervisor managing this worker
// Returns: Created worker object with auto-generated id, timestamps, etc.
router.post('/', requireRole(['site_engineer', 'superadmin']), async (req, res) => {
  // Destructure all required fields from request body JSON
  const { name, age, gender, project_id, supervisor_id } = req.body;
  
  // Validate name field - must be non-empty string
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    // Return 400 Bad Request if name is missing or empty
    return res.status(400).json({ error: 'Worker name is required and must be non-empty' });
  }

  // Validate age field - must be integer between 1 and 99
  if (!Number.isInteger(Number(age)) || age < 1 || age > 99) {
    // Return 400 Bad Request if age not integer or outside range 1-99
    return res.status(400).json({ error: 'Age must be an integer between 1 and 99' });
  }

  // Validate gender field - must be one of enum values (lowercase)
  const genderLower = gender?.toLowerCase();
  if (!['male', 'female', 'other'].includes(genderLower)) {
    // Return 400 Bad Request if gender not one of allowed values
    return res.status(400).json({ error: 'Gender must be male, female, or other' });
  }

  // Validate project_id field - must be provided and numeric
  if (!project_id || isNaN(project_id)) {
    // Return 400 Bad Request if project_id missing or invalid
    return res.status(400).json({ error: 'project_id is required and must be numeric' });
  }

  // Validate supervisor_id field - must be provided and numeric
  if (!supervisor_id || isNaN(supervisor_id)) {
    // Return 400 Bad Request if supervisor_id missing or invalid
    return res.status(400).json({ error: 'supervisor_id is required and must be numeric' });
  }

  // Try to insert new worker into database
  try {
    // First verify that the selected supervisor is actually assigned to this project
    const supervCheck = await pool.query(
      `SELECT id FROM project_assignments 
       WHERE project_id = $1 AND user_id = $2 AND role = 'supervisor'`,
      // First parameter: project ID, Second parameter: supervisor user ID
      [project_id, supervisor_id]
    );

    // If supervisor not assigned to project, return error
    if (supervCheck.rows.length === 0) {
      // Return 400 Bad Request if supervisor not properly assigned
      return res.status(400).json({ error: 'Selected supervisor is not assigned to this project' });
    }

    // Extract current site engineer ID from JWT token (never trust client-sent value)
    const siteEngineerId = req.user.id;

    // Insert new worker record into workers table with all required fields
    const result = await pool.query(
      `INSERT INTO workers (name, age, gender, project_id, supervisor_id, site_engineer_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      // Parameters: name, age, gender, project_id, supervisor_id, site_engineer_id
      [
        name.trim(), // Worker name (trimmed to remove whitespace)
        parseInt(age), // Worker age (converted to integer)
        genderLower, // Worker gender (lowercase for database consistency)
        parseInt(project_id), // Project ID (converted to integer)
        parseInt(supervisor_id), // Supervisor ID (converted to integer)
        siteEngineerId // Site engineer ID from JWT (set by server, not client)
      ]
    );

    // Extract the newly created worker record
    const newWorker = result.rows[0];

    // Fetch supervisor name to include in response
    const supervResult = await pool.query(
      `SELECT name FROM users WHERE id = $1`,
      // First parameter: supervisor ID to fetch name for
      [supervisor_id]
    );

    // Add supervisor_name to worker object
    newWorker.supervisor_name = supervResult.rows[0]?.name || '';

    // Send 201 Created status with newly created worker data as JSON
    res.status(201).json(newWorker);
  } catch (error) {
    // Log error details to console for debugging server issues
    console.error('Create worker error:', error);
    // Send 500 Internal Server Error response to client
    res.status(500).json({ error: 'Failed to create worker' });
  }
});

// ============================================================================
// DELETE /api/workers/:id
// ============================================================================
// Delete a worker from the database
// Purpose: Remove worker from project when no longer needed
// Authentication: Requires site_engineer (owner), supervisor, or superadmin role
// URL Parameters: id (required) - ID of worker to delete
// Returns: Success message on deletion
// Ownership: Site engineer must be the one who created the worker (except superadmin)
router.delete('/:id', requireRole(['site_engineer', 'supervisor', 'superadmin']), async (req, res) => {
  // Extract worker ID from URL path parameter
  const { id } = req.params;
  
  // Validate worker ID is provided and is numeric
  if (!id || isNaN(id)) {
    // Return 400 Bad Request if worker ID is invalid
    return res.status(400).json({ error: 'Invalid worker ID' });
  }

  // Extract current user ID from JWT token
  const userId = req.user.id;
  // Extract current user role from JWT token
  const userRole = req.user.role;

  // Try to delete the worker
  try {
    // First fetch the worker record to verify it exists and check ownership
    const workerResult = await pool.query(
      `SELECT site_engineer_id, id FROM workers WHERE id = $1`,
      // First parameter: worker ID to fetch
      [parseInt(id)]
    );

    // If no worker found with that ID, return 404
    if (workerResult.rows.length === 0) {
      // Return 404 Not Found if worker doesn't exist
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Extract worker data from query result
    const worker = workerResult.rows[0];

    // Check authorization: only site engineer owner or superadmin can delete
    if (userRole !== 'superadmin' && worker.site_engineer_id !== userId) {
      // Return 403 Forbidden if user not authorized to delete this worker
      return res.status(403).json({ error: 'Unauthorized to delete this worker' });
    }

    // Delete the worker record from database using worker ID
    await pool.query(
      `DELETE FROM workers WHERE id = $1`,
      // First parameter: worker ID to delete
      [parseInt(id)]
    );

    // Send 200 OK response with success message
    res.json({ message: 'Worker deleted successfully' });
  } catch (error) {
    // Log error details to console for debugging server issues
    console.error('Delete worker error:', error);
    // Send 500 Internal Server Error response to client
    res.status(500).json({ error: 'Failed to delete worker' });
  }
});

// Export router to be imported and used in main server file
export default router;
