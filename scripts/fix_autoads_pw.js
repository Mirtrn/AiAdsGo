const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function main() {
  const hash = await bcrypt.hash('Admin@2026', 10);
  console.log('Generated hash:', hash);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query(
    `UPDATE users SET password_hash=$1, is_active=true, failed_login_count=0, locked_until=NULL WHERE username='autoads' RETURNING id, username, is_active, failed_login_count`,
    [hash]
  );
  console.log('Updated:', JSON.stringify(res.rows));
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
