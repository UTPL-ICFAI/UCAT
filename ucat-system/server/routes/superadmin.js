// Import Express framework for routing
import express from "express";
// Import database connection pool
import pool from "../db.js";
// Import bcrypt for password hashing
import bcrypt from "bcrypt";
// Import role-based access control middleware
import { requireRole } from "../middleware/role.js";

// Create Express router instance
const router = express.Router();

// ========================================
// GET /api/superadmin/stats - KPI Statistics
// ========================================
/**
 * Get dashboard KPI statistics with gender breakdown
 * Returns: projects, users, workers, documents, and issues counts
 * Requires: superadmin role authentication
 */
router.get("/stats", requireRole("superadmin"), async (req, res) => {
  // Handler: GET /api/superadmin/stats - Fetch all KPI statistics in single optimized query
  try {
    // Execute single combined query to fetch all statistics at once (much faster than 7 separate queries)
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM projects) as total_projects,
        (SELECT COUNT(*) FROM projects WHERE work_status IN ('active', 'ongoing')) as active_projects,
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM troubleshoot_issues WHERE status = 'open') as open_issues,
        (SELECT COUNT(*) FROM workers) as total_workers,
        (SELECT COUNT(*) FROM documents) as total_documents
    `);

    // Extract single result row from optimized query
    const row = stats.rows[0];
    // Initialize gender statistics object with all values at zero
    const genderStats = {};
    // Initialize male worker count to zero
    genderStats.male = 0;
    // Initialize female worker count to zero
    genderStats.female = 0;
    // Initialize other gender worker count to zero
    genderStats.other = 0;

    // Query gender breakdown separately (still fast since it's a single query)
    const genderBreakdown = await pool.query(`
      SELECT gender, COUNT(*) as count FROM workers WHERE gender IS NOT NULL GROUP BY gender
    `);
    // Iterate through database gender breakdown results
    genderBreakdown.rows.forEach((rowGender) => {
      // Set count for specific gender from database result
      genderStats[rowGender.gender] = parseInt(rowGender.count);
    });

    // Return all statistics as JSON response to client
    res.json({
      // Total number of all projects in system
      totalProjects: parseInt(row.total_projects),
      // Count of projects with active work status
      activeProjects: parseInt(row.active_projects),
      // Total count of user accounts created
      totalUsers: parseInt(row.total_users),
      // Number of open and unresolved issues
      openIssues: parseInt(row.open_issues),
      // Total workers currently registered on sites
      totalWorkers: parseInt(row.total_workers),
      // Total documents uploaded to system
      totalDocuments: parseInt(row.total_documents),
      // Gender breakdown of workers by type
      genderBreakdown: genderStats,
    });
    // Log successful stats retrieval
    console.log("Stats fetched successfully for superadmin");
  } catch (error) {
    // Log database error to console
    console.error("Error fetching stats:", error);
    // Return 500 error response to client
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// ========================================
// GET /api/superadmin/users - Get All Users
// ========================================
/**
 * Get all users from database (excluding superadmins)
 * Optional query params: ?role=X to filter by role
 * Returns: user objects with id, name, age, gender, employment_id, role, user_id, created_at
 * Requires: superadmin role authentication
 */
router.get("/users", requireRole("superadmin"), async (req, res) => {
  // Handler: GET /api/superadmin/users - Fetch all users with optional role filter
  try {
    // Get optional role filter from query string
    const roleFilter = req.query.role;
    // Build SQL query string with optional role filtering
    let query =
      "SELECT id, name, age, gender, employment_id, role, user_id, created_at FROM users WHERE role != $1";
    // Initialize query parameters array with superadmin exclusion
    let params = ["superadmin"];

    // Check if role filter is provided in query string
    if (roleFilter) {
      // Append role filter to WHERE clause
      query += " AND role = $2";
      // Add role filter value to parameters array
      params.push(roleFilter);
    }
    // Add ordering by created date descending
    query += " ORDER BY created_at DESC";

    // Execute query with parameters for parameterized queries (prevents SQL injection)
    const result = await pool.query(query, params);
    // Return array of user objects as JSON
    res.json(result.rows);
    // Log successful user retrieval
    console.log("Users fetched successfully");
  } catch (error) {
    // Log database error to console
    console.error("Error fetching users:", error);
    // Return 500 error response to client
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ========================================
// POST /api/superadmin/users - Create New User
// ========================================
/**
 * Create new user and setup default permissions
 * Body params: name, age (1-99), gender (male/female/other), employment_id, role, user_id, password
 * Returns: created user object with id
 * Requires: superadmin role authentication
 */
router.post("/users", requireRole("superadmin"), async (req, res) => {
  // Handler: POST /api/superadmin/users - Create new user in database
  try {
    // Destructure required fields from request body
    const { name, age, gender, employment_id, role, user_id, password } =
      req.body;

    // Check if employment_id already exists
    const empCheck = await pool.query(
      "SELECT id FROM users WHERE employment_id = $1",
      [employment_id],
    );

    if (empCheck.rows.length > 0) {
      return res.status(400).json({ error: "Employment ID already exists" });
    }

    // Check if user_id already exists
    const userCheck = await pool.query(
      "SELECT id FROM users WHERE user_id = $1",
      [user_id],
    );

    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "User ID already exists" });
    }

    // Validate that all required fields are present
    if (!name || !employment_id || !role || !user_id || !password) {
      // Return 400 error if required fields missing
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate age value is numeric and between 1 and 99
    if (age && (isNaN(age) || age < 1 || age > 99)) {
      // Return 400 error for invalid age
      return res.status(400).json({ error: "Age must be between 1 and 99" });
    }

    // Validate gender value is one of allowed enum values
    if (gender && !["male", "female", "other"].includes(gender.toLowerCase())) {
      // Return 400 error for invalid gender
      return res
        .status(400)
        .json({ error: "Gender must be male, female, or other" });
    }

    // Hash password using bcrypt with salt rounds of 10
    const hashedPassword = await bcrypt.hash(password, 10);
    // Hash password with bcrypt for secure storage (completes when done)

    // Insert new user record into database
    const userResult = await pool.query(
      // SQL insert statement for users table
      "INSERT INTO users (name, age, gender, employment_id, role, user_id, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, age, gender, employment_id, role, user_id, created_at",
      // Parameter values for placeholder variables
      [
        name,
        age || null,
        gender || null,
        employment_id,
        role,
        user_id,
        hashedPassword,
      ],
    );
    // Extract newly created user from result
    const newUser = userResult.rows[0];

    // Return newly created user object as JSON
    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: newUser,
    });
    // Log successful user creation
    console.log(`New user created: ${newUser.id} - ${newUser.name}`);
  } catch (error) {
    // Log database or validation error
    console.error("Error creating user:", error.message);
    // Return 500 error response to client
    res.status(500).json({ error: "Failed to create user" });
  }
});

// ========================================
// PUT /api/superadmin/users/:id - Update User
// ========================================
/**
 * Update existing user with optional fields
 * Body params: name, age (1-99), gender (male/female/other), employment_id, role, password (optional)
 * Returns: updated user object
 * Requires: superadmin role authentication
 */
router.put("/users/:id", requireRole("superadmin"), async (req, res) => {
  // Handler: PUT /api/superadmin/users/:id - Update user record in database
  try {
    // Get user ID from URL parameter
    const userId = req.params.id;
    // Destructure fields to update from request body
    const { name, age, gender, employment_id, role, password } = req.body;

    // Build dynamic SQL update query based on provided fields
    let updateFields = [];
    // Initialize parameter values array
    let values = [];
    // Initialize parameter counter starting at 1
    let paramIndex = 1;

    // Add name to update if provided
    if (name !== undefined) {
      // Add name field with placeholder
      updateFields.push(`name = $${paramIndex}`);
      // Add name value to parameters
      values.push(name);
      // Increment parameter counter
      paramIndex++;
    }

    // Add age to update if provided
    if (age !== undefined) {
      // Validate age is between 1 and 99
      if (age < 1 || age > 99) {
        // Return 400 error for invalid age
        return res.status(400).json({ error: "Age must be between 1 and 99" });
      }
      // Add age field with placeholder
      updateFields.push(`age = $${paramIndex}`);
      // Add age value to parameters
      values.push(age);
      // Increment parameter counter
      paramIndex++;
    }

    // Add gender to update if provided
    if (gender !== undefined) {
      // Validate gender is one of allowed enum values
      if (!["male", "female", "other"].includes(gender.toLowerCase())) {
        // Return 400 error for invalid gender
        return res
          .status(400)
          .json({ error: "Gender must be male, female, or other" });
      }
      // Add gender field with placeholder
      updateFields.push(`gender = $${paramIndex}`);
      // Add gender value to parameters
      values.push(gender);
      // Increment parameter counter
      paramIndex++;
    }

    // Add employment_id to update if provided
    if (employment_id !== undefined) {
      // Add employment_id field with placeholder
      updateFields.push(`employment_id = $${paramIndex}`);
      // Add employment_id value to parameters
      values.push(employment_id);
      // Increment parameter counter
      paramIndex++;
    }

    // Add role to update if provided
    if (role !== undefined) {
      // Add role field with placeholder
      updateFields.push(`role = $${paramIndex}`);
      // Add role value to parameters
      values.push(role);
      // Increment parameter counter
      paramIndex++;
    }

    // Handle optional password update
    if (password !== undefined && password !== "") {
      // Hash new password using bcrypt with 10 salt rounds
      const hashedPassword = await bcrypt.hash(password, 10);
      // Add password_hash field with placeholder
      updateFields.push(`password_hash = $${paramIndex}`);
      // Add hashed password value to parameters
      values.push(hashedPassword);
      // Increment parameter counter
      paramIndex++;
    }

    // Check if any fields were provided to update
    if (updateFields.length === 0) {
      // Return 400 error if no fields to update
      return res.status(400).json({ error: "No fields to update" });
    }

    // Add user ID as final parameter for WHERE clause
    values.push(userId);

    // Build final SQL query with dynamic update fields
    const query = `UPDATE users SET ${updateFields.join(", ")} WHERE id = $${paramIndex} RETURNING id, name, age, gender, employment_id, role, user_id, created_at`;

    // Execute update query with all parameter values
    const result = await pool.query(query, values);

    // Check if user was found and updated
    if (result.rows.length === 0) {
      // Return 404 error if user not found
      return res.status(404).json({ error: "User not found" });
    }

    // Return updated user object as JSON
    res.json(result.rows[0]);
    // Log successful user update
    console.log(`User updated: ${userId}`);
  } catch (error) {
    // Log database or validation error
    console.error("Error updating user:", error);
    // Return 500 error response to client
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ========================================
// DELETE /api/superadmin/users/:id - Delete User
// ========================================
/**
 * Delete user and their associated permissions
 * URL params: id (user ID to delete)
 * Returns: success message
 * Requires: superadmin role authentication
 */
router.delete("/users/:id", requireRole("superadmin"), async (req, res) => {
  // Handler: DELETE /api/superadmin/users/:id - Remove user from database
  try {
    // Get user ID from URL parameter
    const userId = req.params.id;

    // Delete user permissions first (foreign key constraint)
    await pool.query("DELETE FROM permissions WHERE user_id = $1", [userId]);
    // Delete user permissions from database

    // Delete the user record from database
    const result = await pool.query(
      "DELETE FROM users WHERE id = $1 RETURNING id",
      [userId],
    );
    // Execute delete query for user

    // Check if user was found and deleted
    if (result.rows.length === 0) {
      // Return 404 error if user not found
      return res.status(404).json({ error: "User not found" });
    }

    // Return success message to client
    res.json({ message: "User deleted successfully" });
    // Log successful user deletion
    console.log(`User deleted: ${userId}`);
  } catch (error) {
    // Log database error to console
    console.error("Error deleting user:", error);
    // Return 500 error response to client
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// ========================================
// GET /api/superadmin/permissions/all - Get All Permissions
// ========================================
/**
 * Get permissions matrix for all users
 * Returns: array of user objects with joined permissions
 * Uses LEFT JOIN to include users without explicit permissions (defaults applied)
 * Requires: superadmin role authentication
 */
router.get("/permissions/all", requireRole("superadmin"), async (req, res) => {
  // Handler: GET /api/superadmin/permissions/all - Fetch all users and their permissions
  try {
    // Query all users and build permissions matrix with default permissions based on role
    const result = await pool.query(`
      SELECT 
        u.id,
        u.name as user_name,
        u.role
      FROM users u
      WHERE u.role != 'superadmin'
      ORDER BY u.name ASC
    `);

    // Build permissions array with default values based on user role
    const permissions = result.rows.map((row) => {
      // Initialize permissions object for user
      let canView = true;
      // All users can view by default
      let canEdit = row.role === "project_manager";
      // Only project managers can edit
      let canDelete = row.role === "project_manager";
      // Only project managers can delete
      let canManageUsers = row.role === "project_manager";
      // Only project managers can manage users
      let canManageProjects = row.role === "project_manager";
      // Only project managers can manage projects

      // Return permission object for user
      return {
        // User unique identifier
        id: row.id,
        // User's full name
        user_name: row.user_name,
        // User's role in system
        role: row.role,
        // User can view records permission
        can_view: canView,
        // User can edit records permission
        can_edit: canEdit,
        // User can delete records permission
        can_delete: canDelete,
        // User can manage users permission
        can_manage_users: canManageUsers,
        // User can manage projects permission
        can_manage_projects: canManageProjects,
      };
    });

    // Return permissions array as JSON
    res.json(permissions);
    // Log successful permissions retrieval
    console.log("Permissions fetched successfully");
  } catch (error) {
    // Log database error to console
    console.error("Error fetching permissions:", error);
    // Return 500 error response to client
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

// ========================================
// GET /api/superadmin/activity - Get Recent Activity
// ========================================
/**
 * Get recent activity from system (user creations, project updates, etc)
 * Returns: array of activity objects with type, description, and timestamp
 * Requires: superadmin role authentication
 */
router.get("/activity", requireRole("superadmin"), async (req, res) => {
  // Handler: GET /api/superadmin/activity - Fetch recent system activity
  try {
    // Query recent user creation activity from users table
    const userActivity = await pool.query(`
      SELECT 'User Created' as type, name as description, created_at FROM users
      ORDER BY created_at DESC LIMIT 10
    `);
    // Query recent user creation records (ordered by date)

    // Query recent project creation activity from projects table
    const projectActivity = await pool.query(`
      SELECT 'Project Created' as type, name as description, created_at FROM projects
      ORDER BY created_at DESC LIMIT 10
    `);
    // Query recent project creation records (ordered by date)

    // Query recent task creation activity from tasks table
    const taskActivity = await pool.query(`
      SELECT 'Task Created' as type, title as description, created_at FROM tasks
      ORDER BY created_at DESC LIMIT 10
    `);
    // Query recent task creation records (ordered by date)

    // Combine all activity sources into single array
    let allActivity = [];
    // Initialize empty activity array
    allActivity = allActivity.concat(userActivity.rows);
    // Add user creation activity to array
    allActivity = allActivity.concat(projectActivity.rows);
    // Add project creation activity to array
    allActivity = allActivity.concat(taskActivity.rows);
    // Add task creation activity to array

    // Sort combined activity by created_at date in descending order (newest first)
    allActivity.sort((a, b) => {
      // Convert dates to timestamps
      const dateA = new Date(a.created_at).getTime();
      // Get timestamp for activity A
      const dateB = new Date(b.created_at).getTime();
      // Get timestamp for activity B
      // Return comparison (newest first)
      return dateB - dateA;
    });

    // Take only first 20 most recent activities
    const recentActivity = allActivity.slice(0, 20);
    // Limit to 20 most recent items

    // Return activity array as JSON
    res.json(recentActivity);
    // Log successful activity retrieval
    console.log("Activity fetched successfully");
  } catch (error) {
    // Log database error to console
    console.error("Error fetching activity:", error);
    // Return 500 error response to client
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// Export router for use in main server file
export default router;
// Export the Express router instance for mounting in app
