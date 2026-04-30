import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import pool from './db.js';
import {
  defaultDailyProgressReport,
  defaultSafetyChecklist,
  defaultWeeklyStatusReport,
} from './default-templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildBootstrapSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  return schema
    .replace(/^DROP TABLE IF EXISTS .*$/gm, '')
    .replace(/CREATE TABLE\s+/g, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/CREATE INDEX\s+/g, 'CREATE INDEX IF NOT EXISTS ');
}

async function ensureSuperadmin(client) {
  const existingUser = await client.query(
    'SELECT id FROM users WHERE user_id = $1',
    ['superadmin'],
  );

  if (existingUser.rows.length > 0) {
    return existingUser.rows[0].id;
  }

  const hashedPassword = await bcrypt.hash('superadmin', 10);
  const createdUser = await client.query(
    `INSERT INTO users (name, age, gender, employment_id, role, user_id, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    ['Super Admin', 45, 'other', 'SA001', 'superadmin', 'superadmin', hashedPassword],
  );

  return createdUser.rows[0].id;
}

async function ensurePasswordHashColumn(client) {
  const columnResult = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_name = 'users'
       AND column_name = 'password_hash'`,
  );

  if (columnResult.rows.length === 0) {
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT');
  }
}

async function ensureDefaultTemplates(client, ownerId) {
  const templates = [
    defaultDailyProgressReport,
    defaultSafetyChecklist,
    defaultWeeklyStatusReport,
  ];

  for (const template of templates) {
    const existingTemplate = await client.query(
      'SELECT id FROM templates WHERE name = $1 LIMIT 1',
      [template.name],
    );

    if (existingTemplate.rows.length > 0) {
      continue;
    }

    await client.query(
      `INSERT INTO templates (user_id, name, description, fields, rows, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ownerId,
        template.name,
        template.description,
        JSON.stringify(template.fields),
        JSON.stringify(template.rows),
        true,
        true,
      ],
    );
  }
}

export async function bootstrapDatabase() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(buildBootstrapSchema());
    await ensurePasswordHashColumn(client);

    const superadminId = await ensureSuperadmin(client);
    await ensureDefaultTemplates(client, superadminId);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}