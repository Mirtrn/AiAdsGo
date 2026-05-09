#!/usr/bin/env node
// 查询指定手机号用户的服务账号和广告账号配置
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const phone = process.argv[2] || '15303826566';
  
  // 查用户ID
  const u = await pool.query("SELECT id, phone FROM users WHERE phone=$1 LIMIT 1", [phone]);
  console.log('User:', JSON.stringify(u.rows));
  if (!u.rows.length) { await pool.end(); return; }
  const userId = u.rows[0].id;
  
  // 查服务账号
  const sa = await pool.query(
    'SELECT id, mcc_customer_id, is_active, created_at FROM google_ads_service_accounts WHERE user_id=$1 ORDER BY created_at DESC',
    [userId]
  );
  console.log('Service Accounts:', JSON.stringify(sa.rows, null, 2));
  
  // 查google_ads_accounts（含parent_mcc_id）
  const gaa = await pool.query(
    'SELECT id, customer_id, parent_mcc_id, is_active, account_name FROM google_ads_accounts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
    [userId]
  );
  console.log('Ads Accounts (top10):', JSON.stringify(gaa.rows, null, 2));
  
  await pool.end();
}

main().catch(e => { console.error('ERROR:', e.message); pool.end(); process.exit(1); });
