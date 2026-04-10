import pool from './db.js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { defaultDailyProgressReport, defaultSafetyChecklist, defaultWeeklyStatusReport } from './default-templates.js';

dotenv.config();

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding initial superadmin user...\n');
    
    // Define only the initial superadmin user
    const superadminUser = {
      name: 'Super Admin',
      age: 45,
      employment_id: 'SA001',
      role: 'superadmin',
      user_id: 'superadmin',
      password: 'superadmin'
    };

    console.log('Creating superadmin user...');
    const hashedPassword = await bcrypt.hash(superadminUser.password, 10);
    
    const result = await client.query(
      `INSERT INTO users (name, age, gender, employment_id, role, user_id, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING id`,
      [superadminUser.name, superadminUser.age, 'other', superadminUser.employment_id, superadminUser.role, superadminUser.user_id, hashedPassword]
    );
    
    let superadminId;
    if (result.rows.length > 0) {
      superadminId = result.rows[0].id;
      console.log(`  ✓ Created superadmin: ${superadminUser.user_id}`);
    } else {
      console.log(`  ~ ${superadminUser.user_id} already exists`);
      // Get existing superadmin ID
      const existingAdmin = await client.query('SELECT id FROM users WHERE user_id = $1', ['superadmin']);
      superadminId = existingAdmin.rows[0].id;
    }
    
    // Seed default templates
    console.log('\nSeeding default templates...');
    const templates = [
      defaultDailyProgressReport,
      defaultSafetyChecklist,
      defaultWeeklyStatusReport
    ];
    
    for (const template of templates) {
      const templateResult = await client.query(
        `INSERT INTO templates (user_id, name, description, fields, rows, is_default, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING
         RETURNING id, name`,
        [
          superadminId,
          template.name,
          template.description,
          JSON.stringify(template.fields),
          JSON.stringify(template.rows),
          true,
          true
        ]
      );
      
      if (templateResult.rows.length > 0) {
        console.log(`  ✓ Created template: ${template.name}`);
      } else {
        console.log(`  ~ Template already exists: ${template.name}`);
      }
    }
    
    console.log('\n✓ Seeding complete!');
    console.log('\n📋 DEFAULT SUPERADMIN CREDENTIALS:');
    console.log('═══════════════════════════════════════════════════');
    console.log(`User ID: ${superadminUser.user_id}`);
    console.log(`Password: ${superadminUser.password}`);
    console.log('\nNOTE: Use superadmin account to create additional users!');
    console.log('═══════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
