#!/usr/bin/env node
/**
 * 诊断脚本：检查用户 ID=12 的 Google Ads 凭证状态
 * 在服务器 Docker 容器内运行:
 *   docker exec <app-container> node scripts/check-user12-credentials.js
 */
'use strict'

const { Client } = require('pg')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  console.log('✅ 数据库已连接\n')

  try {
    // 1. google_ads_credentials
    const creds = await client.query(`
      SELECT
        id,
        user_id,
        CASE WHEN client_id IS NOT NULL AND client_id != '' THEN '✅有' ELSE '❌空' END AS client_id,
        CASE WHEN client_secret IS NOT NULL AND client_secret != '' THEN '✅有' ELSE '❌空' END AS client_secret,
        CASE WHEN developer_token IS NOT NULL AND developer_token != '' THEN '✅有' ELSE '❌空' END AS developer_token,
        CASE WHEN login_customer_id IS NOT NULL AND login_customer_id != '' THEN login_customer_id ELSE '❌空' END AS login_customer_id,
        is_active,
        updated_at
      FROM google_ads_credentials
      WHERE user_id = 12
      ORDER BY updated_at DESC
      LIMIT 5
    `)
    console.log('=== google_ads_credentials (user_id=12) ===')
    if (creds.rows.length === 0) {
      console.log('❌ 无任何记录！')
    } else {
      creds.rows.forEach(r => console.log(JSON.stringify(r)))
    }
    console.log()

    // 2. system_settings - google_ads 分类
    const settings = await client.query(`
      SELECT
        key,
        CASE WHEN value IS NOT NULL AND value != '' THEN '✅有值' ELSE '❌空' END AS has_value,
        updated_at
      FROM system_settings
      WHERE user_id = 12 AND category = 'google_ads'
      ORDER BY key
    `)
    console.log('=== system_settings (user_id=12, category=google_ads) ===')
    if (settings.rows.length === 0) {
      console.log('❌ 无任何 system_settings 记录')
    } else {
      settings.rows.forEach(r => console.log(JSON.stringify(r)))
    }
    console.log()

    // 3. google_ads_service_accounts
    const sa = await client.query(`
      SELECT id, is_active, mcc_customer_id, updated_at
      FROM google_ads_service_accounts
      WHERE user_id = 12
      ORDER BY updated_at DESC
      LIMIT 3
    `)
    console.log('=== google_ads_service_accounts (user_id=12) ===')
    if (sa.rows.length === 0) {
      console.log('❌ 无服务账号记录')
    } else {
      sa.rows.forEach(r => console.log(JSON.stringify(r)))
    }
    console.log()

    // 4. 查看用户基本信息
    const user = await client.query(`
      SELECT id, username, email, role, created_at
      FROM users WHERE id = 12
    `)
    console.log('=== users (id=12) ===')
    if (user.rows.length === 0) {
      console.log('❌ 用户不存在！')
    } else {
      console.log(JSON.stringify(user.rows[0]))
    }
    console.log()

    // 5. 查看该用户的 campaigns 是否有 google_ads_account_id
    const camps = await client.query(`
      SELECT c.id, c.google_campaign_id, c.google_ads_account_id, c.status,
             a.customer_id, a.is_active as account_is_active
      FROM campaigns c
      LEFT JOIN google_ads_accounts a ON a.id = c.google_ads_account_id
      WHERE c.user_id = 12
      ORDER BY c.updated_at DESC
      LIMIT 5
    `)
    console.log('=== campaigns (user_id=12, latest 5) ===')
    if (camps.rows.length === 0) {
      console.log('❌ 无广告系列记录')
    } else {
      camps.rows.forEach(r => console.log(JSON.stringify(r)))
    }

  } finally {
    await client.end()
    console.log('\n✅ 诊断完成')
  }
}

main().catch(e => {
  console.error('❌ 错误:', e.message)
  process.exit(1)
})
