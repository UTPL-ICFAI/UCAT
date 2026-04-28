// Import Express router for handling HTTP routes
const express = require("express");
// Create a new router instance
const router = express.Router();
// Import bcrypt for password hashing
const bcrypt = require("bcrypt");
// Import database connection pool
const db = require("../db");
// Import authentication middleware for protected routes
const { authenticate } = require("../middleware/auth");
// Import role-based authorization middleware
const { requireRole } = require("../middleware/role");

/**
 * POST /api/superadmin/users
 * Create a new user with validation and role-based permissions
 * Required: name, age (1-99), gender (enum), employment_id, role, user_id, password
 */
router.post(
  "/users",
  authenticate,
  requireRole(["superadmin"]),
  async (req, res) => {
    // Extract name from request body
    const { name, age, gender, employment_id, role, user_id, password } =
      req.body;
    // Validate name is provided and not empty
    if (!name || typeof name !== "string") {
      // Return 400 error if name is missing or invalid
      return res.status(400).json({ error: "Valid name is required" });
    }
    // Validate age is provided and within valid range (1-99)
    if (age === undefined || age === null || age < 1 || age > 99) {
      // Return 400 error if age is invalid
      return res.status(400).json({ error: "Age must be between 1 and 99" });
    }
    // Validate gender is one of the allowed values
    const validGenders = ["male", "female", "other"];
    if (gender && !validGenders.includes(gender.toLowerCase())) {
      // Return 400 error if gender is not valid
      return res
        .status(400)
        .json({ error: "Gender must be male, female, or other" });
    }
    // Validate employment_id is provided
    if (!employment_id) {
      // Return 400 error if employment ID is missing
      return res.status(400).json({ error: "Employment ID is required" });
    }
    // Validate role is one of the allowed user roles
    const validRoles = ["project_manager", "site_engineer", "supervisor"];
    if (!role || !validRoles.includes(role)) {
      // Return 400 error if role is not valid
      return res.status(400).json({ error: "Invalid role selected" });
    }
    // Validate user_id is provided and unique
    if (!user_id) {
      // Return 400 error if user ID is missing
      return res.status(400).json({ error: "User ID is required" });
    }
    // Validate password is provided and has minimum length
    if (!password || password.length < 6) {
      // Return 400 error if password is too short
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }
    // Start database transaction
    const client = await db.connect();
    try {
      // Begin transaction for atomic operations
      await client.query("BEGIN");
      // Check if employment_id already exists in database
      const existingEmp = await client.query(
        // SQL query to check for duplicate employment ID
        "SELECT id FROM users WHERE employment_id = $1",
        // Parameter: employment ID to check
        [employment_id],
      );
      // If employment ID exists, reject creation
      if (existingEmp.rows.length > 0) {
        // Rollback transaction on error
        await client.query("ROLLBACK");
        // Return 400 error for duplicate employment ID
        return res.status(400).json({ error: "Employment ID already exists" });
      }
      // Check if user_id already exists in database
      const existingUser = await client.query(
        // SQL query to check for duplicate user ID
        "SELECT id FROM users WHERE user_id = $1",
        // Parameter: user ID to check
        [user_id],
      );
      // If user ID exists, reject creation
      if (existingUser.rows.length > 0) {
        // Rollback transaction on error
        await client.query("ROLLBACK");
        // Return 400 error for duplicate user ID
        return res.status(400).json({ error: "User ID already exists" });
      }
      // Hash the password using bcrypt with 10 salt rounds
      const hashedPassword = await bcrypt.hash(password, 10);
      // Insert new user into users table
      const userResult = await client.query(
        // SQL INSERT statement for new user
        "INSERT INTO users (name, age, gender, employment_id, role, user_id, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id, name, age, gender, employment_id, role, user_id, created_at",
        // Parameters: name, age, gender, employment_id, role, user_id, password_hash
        [
          name,
          age,
          gender || null,
          employment_id,
          role,
          user_id,
          hashedPassword,
        ],
      );
      // Get the created user ID from result
      const createdUser = userResult.rows[0];
      // Get the new user's ID for permissions insertion
      const newUserId = createdUser.id;
      // Define role-based default permissions
      const defaultPermissions = {
        // Project managers can view, edit, manage users
        project_manager: {
          can_view: true,
          can_edit: true,
          can_delete: false,
          can_manage_users: true,
          can_manage_projects: false,
        },
        // Site engineers can view, edit, manage projects
        site_engineer: {
          can_view: true,
          can_edit: true,
          can_delete: false,
          can_manage_users: false,
          can_manage_projects: true,
        },
        // Supervisors can view and manage projects
        supervisor: {
          can_view: true,
          can_edit: false,
          can_delete: false,
          can_manage_users: false,
          can_manage_projects: true,
        },
      };
      // Get default permissions for this user's role
      const perms = defaultPermissions[role] || {
        can_view: true,
        can_edit: false,
        can_delete: false,
        can_manage_users: false,
        can_manage_projects: false,
      };
      // Insert default permissions for new user
      await client.query(
        // SQL INSERT statement for permissions
        "INSERT INTO permissions (user_id, can_view, can_edit, can_delete, can_manage_users, can_manage_projects, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
        // Parameters: user_id, can_view, can_edit, can_delete, can_manage_users, can_manage_projects
        [
          newUserId,
          perms.can_view,
          perms.can_edit,
          perms.can_delete,
          perms.can_manage_users,
          perms.can_manage_projects,
        ],
      );
      // Commit transaction to finalize changes
      await client.query("COMMIT");
      // Return 201 (Created) status with new user data
      return res.status(201).json(createdUser);
    } catch (error) {
      // Rollback transaction on any error
      await client.query("ROLLBACK");
      // Log error to console for debugging
      console.error("Error creating user:", error);
      // Return 500 error for internal server error
      return res.status(500).json({ error: "Failed to create user" });
    } finally {
      // Release database connection back to pool
      client.release();
    }
  },
);

/**
 * PUT /api/superadmin/users/:id
 * Update an existing user with dynamic SQL builder
 * Optional fields: name, age (1-99), gender, employment_id, role, password
 */
router.put(
  "/users/:id",
  authenticate,
  requireRole(["superadmin"]),
  async (req, res) => {
    // Extract user ID from URL parameter
    const userId = parseInt(req.params.id);
    // Extract fields from request body
    const { name, age, gender, employment_id, role, password } = req.body;
    // Validate user ID is a valid number
    if (isNaN(userId) || userId <= 0) {
      // Return 400 error if user ID is invalid
      return res.status(400).json({ error: "Invalid user ID" });
    }
    // Validate age if provided (must be 1-99 if present)
    if (age !== undefined && (age < 1 || age > 99)) {
      // Return 400 error if age is outside valid range
      return res.status(400).json({ error: "Age must be between 1 and 99" });
    }
    // Validate gender if provided (must be valid enum)
    const validGenders = ["male", "female", "other"];
    if (gender && !validGenders.includes(gender.toLowerCase())) {
      // Return 400 error if gender is invalid
      return res
        .status(400)
        .json({ error: "Gender must be male, female, or other" });
    }
    // Validate role if provided (must be valid user role)
    const validRoles = ["project_manager", "site_engineer", "supervisor"];
    if (role && !validRoles.includes(role)) {
      // Return 400 error if role is invalid
      return res.status(400).json({ error: "Invalid role selected" });
    }
    // Build dynamic SQL update statement based on provided fields
    const updateFields = [];
    // Array to store parameter values for SQL query
    const updateValues = [];
    // Counter for parameter placeholders ($1, $2, etc.)
    let paramCounter = 1;
    // Check if name is provided and add to update
    if (name !== undefined) {
      // Add name to update fields
      updateFields.push(`name = $${paramCounter}`);
      // Add name value to parameters
      updateValues.push(name);
      // Increment parameter counter
      paramCounter++;
    }
    // Check if age is provided and add to update
    if (age !== undefined) {
      // Add age to update fields
      updateFields.push(`age = $${paramCounter}`);
      // Add age value to parameters
      updateValues.push(age);
      // Increment parameter counter
      paramCounter++;
    }
    // Check if gender is provided and add to update
    if (gender !== undefined) {
      // Add gender to update fields
      updateFields.push(`gender = $${paramCounter}`);
      // Add gender value to parameters
      updateValues.push(gender || null);
      // Increment parameter counter
      paramCounter++;
    }
    // Check if employment_id is provided and add to update
    if (employment_id !== undefined) {
      // Add employment_id to update fields
      updateFields.push(`employment_id = $${paramCounter}`);
      // Add employment_id value to parameters
      updateValues.push(employment_id);
      // Increment parameter counter
      paramCounter++;
    }
    // Check if role is provided and add to update
    if (role !== undefined) {
      // Add role to update fields
      updateFields.push(`role = $${paramCounter}`);
      // Add role value to parameters
      updateValues.push(role);
      // Increment parameter counter
      paramCounter++;
    }
    // Check if password is provided and add hashed version to update
    if (password !== undefined && password) {
      // Hash the new password using bcrypt
      const hashedPassword = await bcrypt.hash(password, 10);
      // Add password_hash to update fields
      updateFields.push(`password_hash = $${paramCounter}`);
      // Add hashed password value to parameters
      updateValues.push(hashedPassword);
      // Increment parameter counter
      paramCounter++;
    }
    // Check if any fields were provided for update
    if (updateFields.length === 0) {
      // Return 400 error if no fields to update
      return res.status(400).json({ error: "No fields to update" });
    }
    // Add user ID as final parameter for WHERE clause
    updateValues.push(userId);
    // Build complete SQL UPDATE statement
    const sql = `UPDATE users SET ${updateFields.join(", ")} WHERE id = $${paramCounter} RETURNING id, name, age, gender, employment_id, role, user_id, created_at`;
    // Start database transaction
    const client = await db.connect();
    try {
      // Begin transaction for atomic operations
      await client.query("BEGIN");
      // Check if employment_id is being updated and is already in use
      if (employment_id !== undefined) {
        // Query for existing employment ID different from current user
        const existingEmp = await client.query(
          // SQL query to check for duplicate employment ID
          "SELECT id FROM users WHERE employment_id = $1 AND id != $2",
          // Parameters: employment_id to check, current user_id
          [employment_id, userId],
        );
        // If employment ID exists for another user, reject update
        if (existingEmp.rows.length > 0) {
          // Rollback transaction on error
          await client.query("ROLLBACK");
          // Return 400 error for duplicate employment ID
          return res
            .status(400)
            .json({ error: "Employment ID already in use" });
        }
      }
      // Execute the dynamic UPDATE query
      const result = await client.query(sql, updateValues);
      // Check if user was found and updated
      if (result.rows.length === 0) {
        // Rollback transaction if user not found
        await client.query("ROLLBACK");
        // Return 404 error if user doesn't exist
        return res.status(404).json({ error: "User not found" });
      }
      // Commit transaction to finalize changes
      await client.query("COMMIT");
      // Return 200 status with updated user data
      return res.status(200).json(result.rows[0]);
    } catch (error) {
      // Rollback transaction on any error
      await client.query("ROLLBACK");
      // Log error to console for debugging
      console.error("Error updating user:", error);
      // Return 500 error for internal server error
      return res.status(500).json({ error: "Failed to update user" });
    } finally {
      // Release database connection back to pool
      client.release();
    }
  },
);

/**
 * GET /api/superadmin/users
 * Retrieve all users except superadmin, with optional role filter
 * Query params: ?role=project_manager (optional for filtering by role)
 */
router.get(
  "/users",
  authenticate,
  requireRole(["superadmin"]),
  async (req, res) => {
    // Extract optional role parameter from query string
    const { role } = req.query;
    // Start building WHERE clause
    let whereClause = "WHERE role != $1";
    // Array to store parameter values
    const params = ["superadmin"];
    // Check if role filter is provided
    if (role) {
      // Add role filter to WHERE clause
      whereClause += ` AND role = $${params.length + 1}`;
      // Add role to parameters
      params.push(role);
    }
    try {
      // Query database for matching users
      const result = await db.query(
        // SQL SELECT statement with optional role filter
        `SELECT id, name, age, gender, employment_id, role, user_id, created_at FROM users ${whereClause} ORDER BY created_at DESC`,
        // Parameters: superadmin (always excluded), optional role filter
        params,
      );
      // Return 200 status with all matching users
      return res.status(200).json(result.rows);
    } catch (error) {
      // Log error to console for debugging
      console.error("Error fetching users:", error);
      // Return 500 error for internal server error
      return res.status(500).json({ error: "Failed to fetch users" });
    }
  },
);

/**
 * DELETE /api/superadmin/users/:id
 * Delete a user and cascade delete related permissions
 * Parameter: id (user ID to delete)
 */
router.delete(
  "/users/:id",
  authenticate,
  requireRole(["superadmin"]),
  async (req, res) => {
    // Extract user ID from URL parameter
    const userId = parseInt(req.params.id);
    // Validate user ID is a valid number
    if (isNaN(userId) || userId <= 0) {
      // Return 400 error if user ID is invalid
      return res.status(400).json({ error: "Invalid user ID" });
    }
    // Start database transaction
    const client = await db.connect();
    try {
      // Begin transaction for atomic operations
      await client.query("BEGIN");
      // Delete user permissions first (foreign key constraint)
      await client.query(
        // SQL DELETE statement for permissions
        "DELETE FROM permissions WHERE user_id = $1",
        // Parameter: user_id to delete permissions for
        [userId],
      );
      // Delete the user
      const result = await client.query(
        // SQL DELETE statement for user
        "DELETE FROM users WHERE id = $1 RETURNING id",
        // Parameter: user_id to delete
        [userId],
      );
      // Check if user was found and deleted
      if (result.rows.length === 0) {
        // Rollback transaction if user not found
        await client.query("ROLLBACK");
        // Return 404 error if user doesn't exist
        return res.status(404).json({ error: "User not found" });
      }
      // Commit transaction to finalize changes
      await client.query("COMMIT");
      // Return 200 status with success message
      return res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
      // Rollback transaction on any error
      await client.query("ROLLBACK");
      // Log error to console for debugging
      console.error("Error deleting user:", error);
      // Return 500 error for internal server error
      return res.status(500).json({ error: "Failed to delete user" });
    } finally {
      // Release database connection back to pool
      client.release();
    }
  },
);

/**
 * GET /api/superadmin/stats
 * Retrieve system statistics including KPI metrics and gender breakdown
 * Returns: totalProjects, activeProjects, totalUsers, openIssues, totalWorkers, totalDocuments
 */
router.get(
  "/stats",
  authenticate,
  requireRole(["superadmin"]),
  async (req, res) => {
    try {
      // Query total number of projects
      const projectsResult = await db.query(
        // SQL query to count all projects
        "SELECT COUNT(*) as count FROM projects",
      );
      // Extract total projects count from query result
      const totalProjects = parseInt(projectsResult.rows[0].count);
      // Query number of active projects (status = 'active')
      const activeResult = await db.query(
        // SQL query to count active projects
        "SELECT COUNT(*) as count FROM projects WHERE status = $1",
        // Parameter: active status
        ["active"],
      );
      // Extract active projects count from query result
      const activeProjects = parseInt(activeResult.rows[0].count);
      // Query total number of users excluding superadmin
      const usersResult = await db.query(
        // SQL query to count all non-superadmin users
        "SELECT COUNT(*) as count FROM users WHERE role != $1",
        // Parameter: superadmin role (excluded)
        ["superadmin"],
      );
      // Extract total users count from query result
      const totalUsers = parseInt(usersResult.rows[0].count);
      // Query number of open issues (status = 'open')
      const issuesResult = await db.query(
        // SQL query to count open issues
        "SELECT COUNT(*) as count FROM troubleshoot WHERE status = $1",
        // Parameter: open status
        ["open"],
      );
      // Extract open issues count from query result
      const openIssues = parseInt(issuesResult.rows[0].count);
      // Query total number of workers
      const workersResult = await db.query(
        // SQL query to count all workers
        "SELECT COUNT(*) as count FROM workers",
      );
      // Extract total workers count from query result
      const totalWorkers = parseInt(workersResult.rows[0].count);
      // Query total number of documents
      const documentsResult = await db.query(
        // SQL query to count approved template submission documents
        `SELECT COUNT(*) as count
       FROM daily_submissions ds
       JOIN documents d ON ds.document_id = d.id
       WHERE ds.status = 'approved'
         AND d.doc_type = 'template_submission'`,
      );
      // Extract total documents count from query result
      const totalDocuments = parseInt(documentsResult.rows[0].count);
      // Query gender breakdown of workers
      const genderResult = await db.query(
        // SQL query to count workers by gender
        "SELECT gender, COUNT(*) as count FROM workers GROUP BY gender",
      );
      // Initialize gender breakdown object
      const genderBreakdown = { male: 0, female: 0, other: 0 };
      // Loop through gender results and populate breakdown
      genderResult.rows.forEach((row) => {
        // Get the gender value (lowercase for consistency)
        const gender = row.gender ? row.gender.toLowerCase() : "other";
        // Assign count to matching gender key
        if (gender in genderBreakdown) {
          // Store count for this gender
          genderBreakdown[gender] = parseInt(row.count);
        }
      });
      // Return 200 status with all statistics
      return res.status(200).json({
        // Total projects count
        totalProjects,
        // Active projects count
        activeProjects,
        // Total non-superadmin users count
        totalUsers,
        // Open issues count
        openIssues,
        // Total workers count
        totalWorkers,
        // Total documents count
        totalDocuments,
        // Gender breakdown of workers
        genderBreakdown,
      });
    } catch (error) {
      // Log error to console for debugging
      console.error("Error fetching stats:", error);
      // Return 500 error for internal server error
      return res.status(500).json({ error: "Failed to fetch statistics" });
    }
  },
);

/**
 * GET /api/superadmin/permissions/all
 * Retrieve complete permissions matrix with role-based defaults
 * Returns: array of user permissions with all permission flags
 */
router.get(
  "/permissions/all",
  authenticate,
  requireRole(["superadmin"]),
  async (req, res) => {
    try {
      // Query all users with their permissions using LEFT JOIN
      const result = await db.query(
        // SQL LEFT JOIN to get users and their permissions
        `SELECT u.id, u.name, u.role, 
              COALESCE(p.can_view, true) as can_view,
              COALESCE(p.can_edit, false) as can_edit,
              COALESCE(p.can_delete, false) as can_delete,
              COALESCE(p.can_manage_users, false) as can_manage_users,
              COALESCE(p.can_manage_projects, false) as can_manage_projects
       FROM users u
       LEFT JOIN permissions p ON u.id = p.user_id
       WHERE u.role != $1
       ORDER BY u.name ASC`,
        // Parameter: superadmin role (excluded)
        ["superadmin"],
      );
      // Transform result rows to include user_name for display
      const permissions = result.rows.map((row) => ({
        // User ID
        user_id: row.id,
        // User display name
        user_name: row.name,
        // User role
        user_role: row.role,
        // Can view permission flag
        can_view: row.can_view,
        // Can edit permission flag
        can_edit: row.can_edit,
        // Can delete permission flag
        can_delete: row.can_delete,
        // Can manage users permission flag
        can_manage_users: row.can_manage_users,
        // Can manage projects permission flag
        can_manage_projects: row.can_manage_projects,
      }));
      // Return 200 status with permissions matrix
      return res.status(200).json(permissions);
    } catch (error) {
      // Log error to console for debugging
      console.error("Error fetching permissions:", error);
      // Return 500 error for internal server error
      return res.status(500).json({ error: "Failed to fetch permissions" });
    }
  },
);

/**
 * GET /api/superadmin/activity
 * Retrieve recent activity log from multiple tables
 * Returns: array of activity items ordered by most recent
 */
router.get(
  "/activity",
  authenticate,
  requireRole(["superadmin"]),
  async (req, res) => {
    try {
      // Query for recent user creation activity
      const usersActivity = await db.query(
        // SQL query for user creation activity
        `SELECT 'user_created' as type, name as description, created_at 
       FROM users 
       WHERE role != $1 
       ORDER BY created_at DESC LIMIT 10`,
        // Parameter: superadmin role (excluded from activity)
        ["superadmin"],
      );
      // Query for recent project creation activity
      const projectsActivity = await db.query(
        // SQL query for project creation activity
        `SELECT 'project_created' as type, name as description, created_at 
       FROM projects 
       ORDER BY created_at DESC LIMIT 10`,
      );
      // Query for recent issue creation activity
      const issuesActivity = await db.query(
        // SQL query for issue creation activity
        `SELECT 'issue_created' as type, title as description, created_at 
       FROM troubleshoot 
       ORDER BY created_at DESC LIMIT 10`,
      );
      // Combine all activity types into single array
      let allActivity = [
        // Spread user activity items
        ...usersActivity.rows.map((row) => ({
          // Activity type identifier
          type: row.type,
          // Activity description/name
          name: row.description,
          // Activity timestamp
          created_at: row.created_at,
        })),
        // Spread project activity items
        ...projectsActivity.rows.map((row) => ({
          // Activity type identifier
          type: row.type,
          // Activity description/name
          name: row.description,
          // Activity timestamp
          created_at: row.created_at,
        })),
        // Spread issue activity items
        ...issuesActivity.rows.map((row) => ({
          // Activity type identifier
          type: row.type,
          // Activity description/name
          name: row.description,
          // Activity timestamp
          created_at: row.created_at,
        })),
      ];
      // Sort combined activity by date (most recent first)
      allActivity.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );
      // Limit to 20 most recent activity items
      allActivity = allActivity.slice(0, 20);
      // Return 200 status with activity log
      return res.status(200).json(allActivity);
    } catch (error) {
      // Log error to console for debugging
      console.error("Error fetching activity:", error);
      // Return 500 error for internal server error
      return res.status(500).json({ error: "Failed to fetch activity" });
    }
  },
);

// Export the router for use in main application
module.exports = router;
