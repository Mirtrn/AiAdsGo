#!/usr/bin/env node
/**
 * 诊断脚本：检查指定用户的服务账号 mcc_customer_id 与 google_ads_accounts.parent_mcc_id 匹配情况
 * 在服务器 Docker 容器内运行:
 *   docker exec autoads node scripts/check-user-mcc-sa.js
 */
'use strict'

const { Client } = require('pg')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  console.log('✅ 数据库已连接\n')

  try {
    // 1. 找用户 (username = 15303826566)
    const userResult = await client.query(`
      SELECT id, username, email, role FROM users
      WHERE username = '15303826566' OR email LIKE '%15303826566%'
      ORDER BY id DESC LIMIT 3
    `)
    console.log('=== users (username=15303826566) ===')
    if (userResult.rows.length === 0) {
      console.log('❌ 未找到用户！')
      return
    }
    userResult.rows.forEach(r => console.log(JSON.stringify(r)))
    console.log()

    const userId = userResult.rows[0].id

    // 2. 查服务账号
    const sa = await client.query(`
      SELECT id, mcc_customer_id, is_active, created_at
      FROM google_ads_service_accounts
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId])
    console.log(`=== google_ads_service_accounts (user_id=${userId}) ===`)
    if (sa.rows.length === 0) {
      console.log('❌ 无服务账号记录')
    } else {
      sa.rows.forEach(r => console.log(JSON.stringify(r)))
    }
    console.log()

    // 3. 查 google_ads_accounts 的 parent_mcc_id 分布
    const gaa = await client.query(`
      SELECT id, customer_id, parent_mcc_id, is_active, is_deleted, account_name
      FROM google_ads_accounts
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId])
    console.log(`=== google_ads_accounts (user_id=${userId}, top10) ===`)
    if (gaa.rows.length === 0) {
      console.log('❌ 无广告账号记录')
    } else {
      gaa.rows.forEach(r => console.log(JSON.stringify(r)))
    }
    console.log()

    // 4. MCC 匹配分析
    if (sa.rows.length > 0 && gaa.rows.length > 0) {
      console.log('=== MCC 匹配分析 ===')
      const mccIds = [...new Set(gaa.rows.map(r => r.parent_mcc_id).filter(Boolean))]
      console.log('Ads账号中的 parent_mcc_id 集合:', mccIds)
      const saMccs = sa.rows.map(r => r.mcc_customer_id)
      console.log('SA 的 mcc_customer_id 集合:', saMccs)
      
      mccIds.forEach(mcc => {
        const matched = sa.rows.find(s => {
          const cleanSA = (s.mcc_customer_id || '').replace(/[\s-]/g, '')
          const cleanMCC = (mcc || '').replace(/[\s-]/g, '')
          return cleanSA === cleanMCC
        })
        console.log(`parent_mcc_id=${mcc} -> SA匹配: ${matched ? '✅ ' + matched.id : '❌ 无匹配！'}`)
      })
    }

    // 5. 查最近的 campaigns 及关联账号
    const camps = await client.query(`
      SELECT c.id, c.google_campaign_id, c.status,
             a.customer_id, a.parent_mcc_id, a.is_active as account_is_active
      FROM campaigns c
      LEFT JOIN google_ads_accounts a ON a.id = c.google_ads_account_id
      WHERE c.user_id = $1 AND c.status != 'REMOVED'
      ORDER BY c.updated_at DESC
      LIMIT 5
    `, [userId])
    console.log(`\n=== campaigns 最近5条 (user_id=${userId}) ===`)
    if (camps.rows.length === 0) {
      console.log('❌ 无活跃广告系列')
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
