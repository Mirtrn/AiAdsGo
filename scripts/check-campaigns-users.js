#!/usr/bin/env node
/**
 * 诊断：查找有活跃 campaigns 的用户，并检查其 SA 配置
 */
'use strict'

const { Client } = require('pg')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  console.log('✅ 数据库已连接\n')

  try {
    // 1. 查有活跃 campaigns 的用户
    const usersWithCamps = await client.query(`
      SELECT u.id, u.username, COUNT(c.id) as camp_count
      FROM users u
      JOIN campaigns c ON c.user_id = u.id
      WHERE c.status != 'REMOVED'
        AND c.is_deleted = FALSE
        AND c.google_campaign_id IS NOT NULL
      GROUP BY u.id, u.username
      ORDER BY camp_count DESC
      LIMIT 10
    `)
    console.log('=== 有活跃campaigns的用户 (top10) ===')
    usersWithCamps.rows.forEach(r => console.log(JSON.stringify(r)))
    console.log()

    // 2. 检查每个用户的 SA + parent_mcc_id 匹配情况
    for (const user of usersWithCamps.rows.slice(0, 5)) {
      const userId = user.id
      console.log(`\n--- 用户 id=${userId} username=${user.username} (${user.camp_count}个campaigns) ---`)

      const sa = await client.query(
        'SELECT id, mcc_customer_id, is_active FROM google_ads_service_accounts WHERE user_id=$1 ORDER BY created_at DESC',
        [userId]
      )
      console.log('SAs:', sa.rows.map(r => `mcc=${r.mcc_customer_id} active=${r.is_active}`).join(', '))

      const gaa = await client.query(
        'SELECT DISTINCT parent_mcc_id FROM google_ads_accounts WHERE user_id=$1 AND is_active=TRUE AND is_deleted=FALSE',
        [userId]
      )
      console.log('Ads账号 parent_mcc_id集合:', gaa.rows.map(r => r.parent_mcc_id || 'NULL').join(', '))

      // MCC匹配检查
      for (const row of gaa.rows) {
        const mcc = row.parent_mcc_id
        if (!mcc) {
          // null mcc - 取最新SA
          const fallback = sa.rows[0]
          console.log(`  parent_mcc_id=NULL → 回退最新SA: ${fallback ? fallback.mcc_customer_id : '❌无SA'}`)
        } else {
          const cleanMcc = mcc.replace(/[\s-]/g, '')
          const matched = sa.rows.find(s => (s.mcc_customer_id || '').replace(/[\s-]/g, '') === cleanMcc)
          console.log(`  parent_mcc_id=${mcc} → ${matched ? '✅匹配SA mcc=' + matched.mcc_customer_id : '❌无匹配SA！'}`)
        }
      }
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
