/**
 * Database initialization script.
 * Boots the current schema without dropping existing tables and seeds defaults.
 */

import pool from "./db.js";
import dotenv from "dotenv";
import { bootstrapDatabase } from "./bootstrap.js";

dotenv.config();

async function initializeDatabase() {
  try {
    console.log("📊 Initializing database schema...\n");
    await bootstrapDatabase();
    console.log("✓ Database schema initialized successfully!\n");
    console.log("✓ Default superadmin user created (if not exists)\n");
  } catch (error) {
    console.error("❌ Error initializing database:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initializeDatabase();
