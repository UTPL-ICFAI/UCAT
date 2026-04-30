import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let pool;

if (process.env.DATABASE_URL) {
  // 🔥 Production / Railway / Supabase
  console.log("🌐 Using REMOTE database");

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // required for Railway/Supabase
    },
  });

} else {
  // 🧠 Local development
  console.log("💻 Using LOCAL database");

  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'ucat_db',
    password: process.env.DB_PASSWORD || undefined,
  });
}

// Debug connection
pool.on('connect', () => {
  console.log('✅ Connected to database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected DB error:', err);
});

export default pool;