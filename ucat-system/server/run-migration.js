import fs from 'fs';
import path from 'path';
import pool from './db.js';

async function runMigration() {
  const migrationFile = process.argv[2];

  if (!migrationFile) {
    console.error('Migration file path is required.');
    process.exit(1);
  }

  const fullPath = path.isAbsolute(migrationFile)
    ? migrationFile
    : path.join(process.cwd(), migrationFile);

  const sql = fs.readFileSync(fullPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully:', fullPath);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
