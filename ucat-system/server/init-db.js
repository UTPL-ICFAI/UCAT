/**
 * Database Initialization Script
 * Creates all necessary tables and indexes from schema.sql
 */

import pool from "./db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log("📊 Initializing database schema...\n");

    // Read the schema.sql file
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");

    // Execute the schema
    await client.query(schema);

    console.log("✓ Database schema initialized successfully!\n");

    // Create default superadmin user
    const bcrypt = await import("bcrypt");

    const hashedPassword = await bcrypt.hash("superadmin", 10);

    await client.query(
      `
  INSERT INTO users (name, age, gender, employment_id, role, user_id, password_hash)
  VALUES (
    'Super Admin',
    30,
    'male',
    'EMP001',
    'superadmin',
    'superadmin',
    $1
  )
  ON CONFLICT (user_id) DO NOTHING;
`,
      [hashedPassword],
    );

    console.log("✓ Default superadmin user created (if not exists)\n");
  } catch (error) {
    console.error("❌ Error initializing database:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

initializeDatabase();
