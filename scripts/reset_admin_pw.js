const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const NEW_PASSWORD = 'Admin@2026';

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // 生成新密码 hash
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);

  // 重置密码、启用账号、清除失败计数
  const updateRes = await client.query(
    "UPDATE users SET password_hash=$1, is_active=true, failed_login_count=0, locked_until=NULL WHERE role='admin' OR username='autoads' RETURNING id, username, role, is_active, failed_login_count",
    [hash]
  );
  console.log('\n=== 已重置的账号 ===');
  console.table(updateRes.rows);
  console.log('\n✅ 新密码: ' + NEW_PASSWORD);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
