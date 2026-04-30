import pool from './db.js';
import dotenv from 'dotenv';
import { bootstrapDatabase } from './bootstrap.js';

dotenv.config();

async function seed() {
  try {
    await bootstrapDatabase();
    console.log('\n✓ Seeding complete!');
    console.log('\n📋 DEFAULT SUPERADMIN CREDENTIALS:');
    console.log('═══════════════════════════════════════════════════');
    console.log('User ID: superadmin');
    console.log('Password: superadmin');
    console.log('\nNOTE: Use superadmin account to create additional users!');
    console.log('═══════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
