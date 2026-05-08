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
    .replace(/^CREATE INDEX .*$/gm, '');
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
  const columnResult = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'users'`,
  );

  const availableColumns = new Set(columnResult.rows.map((row) => row.column_name));
  const values = {
    name: 'Super Admin',
    username: 'superadmin',
    age: 45,
    gender: 'other',
    employment_id: 'SA001',
    role: 'superadmin',
    user_id: 'superadmin',
    password: 'superadmin',
    password_hash: hashedPassword,
    permissions: {},
    created_at: new Date(),
  };

  const insertColumns = Object.keys(values).filter((column) => availableColumns.has(column));
  const insertValues = insertColumns.map((column) => values[column]);
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);

  const createdUser = await client.query(
    `INSERT INTO users (${insertColumns.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING id`,
    insertValues,
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

async function ensureUsersCompatibility(client) {
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100)');
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER');
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(20)');
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20)');
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id VARCHAR(50)');
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_id VARCHAR(50)');
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT');
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb`);
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()');
  await ensurePasswordHashColumn(client);
}

async function ensureTemplatesCompatibility(client) {
  await client.query('ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id INTEGER');
  await client.query('ALTER TABLE templates ADD COLUMN IF NOT EXISTS description TEXT');
  await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS fields JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS rows JSONB DEFAULT '[]'::jsonb`);
  await client.query('ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false');
  await client.query('ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true');
}

async function ensureCostConfigCompatibility(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cost_configs (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      cost_per_meter NUMERIC(12, 4) NOT NULL DEFAULT 0,
      cost_per_kilometer NUMERIC(12, 4) NOT NULL DEFAULT 0,
      currency VARCHAR(20) NOT NULL DEFAULT 'INR',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function ensureProjectProgressCompatibility(client) {
  await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress_percentage NUMERIC(5,2) NOT NULL DEFAULT 0');
  await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress_status VARCHAR(20) NOT NULL DEFAULT 'ongoing'");
  await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS completion_marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS completion_marked_at TIMESTAMPTZ');

  await client.query(`
    CREATE TABLE IF NOT EXISTS progress_logs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      logged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      log_date DATE NOT NULL DEFAULT CURRENT_DATE,
      description TEXT NOT NULL,
      increment_value NUMERIC(12, 2) NOT NULL CHECK (increment_value > 0),
      progress_before NUMERIC(5,2) NOT NULL DEFAULT 0,
      progress_after NUMERIC(5,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const checkConstraintResult = await client.query(
    `SELECT 1
     FROM pg_constraint
     WHERE conrelid = 'projects'::regclass
       AND conname = 'projects_progress_percentage_check'`,
  );

  if (checkConstraintResult.rows.length === 0) {
    await client.query(`
      ALTER TABLE projects
      ADD CONSTRAINT projects_progress_percentage_check
      CHECK (progress_percentage >= 0 AND progress_percentage <= 100)
    `);
  }
}

async function ensureUserIndexes(client) {
  const usersRoleColumn = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'users'
       AND column_name = 'role'`,
  );

  const usersUserIdColumn = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'users'
       AND column_name = 'user_id'`,
  );

  if (usersRoleColumn.rows.length > 0) {
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
  }

  if (usersUserIdColumn.rows.length > 0) {
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)');
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
    await ensureUsersCompatibility(client);
    await ensureTemplatesCompatibility(client);
    await ensureCostConfigCompatibility(client);
    await ensureProjectProgressCompatibility(client);

    const superadminId = await ensureSuperadmin(client);
    await ensureDefaultTemplates(client, superadminId);

    await ensureUserIndexes(client);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}