#!/usr/bin/env node
/**
 * backfill-rescrape.js
 * 纯 Node.js 脚本，直接推送 Redis 任务，补全缺失 extracted_keywords 的 offer。
 *
 * 用法（在容器内执行）:
 *   node /app/backfill-rescrape.js [--apply] [--limit=100] [--dry-run]
 *
 * 环境变量:
 *   DATABASE_URL  PostgreSQL 连接串
 *   REDIS_URL     Redis 连接串
 *
 * 队列格式（autoads:production:queue:bg:）:
 *   - tasks hash    -> 存储任务详情 JSON
 *   - pending:all   -> zset，score = seconds*10000 + priorityRank*1000 + msRemainder
 *   - pending:scrape -> zset（类型队列）
 *   - user:{id}:pending -> zset（用户队列）
 *   - priorityRank: low=2, normal=1, high=0
 */

const { Client: PgClient } = require('pg')
const Redis = require('ioredis')
const { v4: uuidv4 } = require('uuid')

// ── 参数解析 ────────────────────────────────────────────
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const LIMIT_ARG = args.find(a => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null
const BATCH_SIZE = 50
const DELAY_MS = 300

const KEY_PREFIX = 'autoads:production:queue:bg:'

function getKey(suffix) {
  return `${KEY_PREFIX}${suffix}`
}

function getPriorityScore(createdAt) {
  // low priority: rank=2
  const availableAt = createdAt
  const seconds = Math.floor(availableAt / 1000)
  const msRemainder = availableAt % 1000
  const priorityRank = 2  // low
  return seconds * 10000 + priorityRank * 1000 + msRemainder
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  const mode = APPLY ? 'APPLY' : 'DRY-RUN'

  const dbUrl = process.env.DATABASE_URL
  const redisUrl = process.env.REDIS_URL

  if (!dbUrl) { console.error('❌ Missing DATABASE_URL'); process.exit(1) }
  if (APPLY && !redisUrl) { console.error('❌ Missing REDIS_URL (required for --apply)'); process.exit(1) }

  console.log('='.repeat(60))
  console.log('🔁 Backfill Re-scrape:补全 extracted_keywords 缺失的 offer')
  console.log('='.repeat(60))
  console.log(`[mode]    ${mode}`)
  console.log(`[limit]   ${LIMIT ?? '(all)'}`)

  // 连接 PG
  const db = new PgClient({ connectionString: dbUrl })
  await db.connect()

  let redis = null
  if (APPLY && redisUrl) {
    redis = new Redis(redisUrl)
    console.log('[redis]   已连接')
  }

  try {
    // 查询受影响的 offer
    const limitClause = LIMIT ? `LIMIT ${LIMIT}` : ''
    const res = await db.query(`
      SELECT
        id, user_id,
        COALESCE(affiliate_link, url) AS url,
        COALESCE(brand, offer_name, '') AS brand,
        COALESCE(target_country, 'US') AS target_country
      FROM offers
      WHERE
        is_deleted = FALSE
        AND scraped_at IS NOT NULL
        AND (extracted_keywords IS NULL OR extracted_keywords::text = '[]')
      ORDER BY scraped_at DESC
      ${limitClause}
    `)

    const rows = res.rows
    console.log(`\n📊 受影响 offer 数量: ${rows.length}`)

    if (rows.length === 0) {
      console.log('🎉 没有需要 backfill 的 offer，退出。')
      return
    }

    // 输出前10条预览
    console.log('\n前 10 条预览:')
    for (const row of rows.slice(0, 10)) {
      console.log(`  #${row.id} user=${row.user_id} [${row.target_country}] ${(row.url || '').slice(0, 80)}`)
    }

    if (!APPLY) {
      console.log(`\n⚠️  DRY-RUN: 未实际推送任务。加 --apply 参数执行。`)
      return
    }

    // 批量推送
    let enqueued = 0, skipped = 0, failed = 0

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      process.stdout.write(`[batch ${batchNum}] ${i + 1}–${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} `)

      for (const row of batch) {
        const url = (row.url || '').trim()
        if (!url) {
          process.stdout.write('s')
          skipped++
          continue
        }

        const taskId = uuidv4()
        const createdAt = Date.now()
        const task = {
          id: taskId,
          type: 'scrape',
          data: {
            offerId: row.id,
            url,
            brand: row.brand || '',
            target_country: row.target_country || 'US',
          },
          userId: row.user_id,
          priority: 'low',
          status: 'pending',
          requireProxy: true,
          createdAt,
          retryCount: 0,
          maxRetries: 2,
        }

        try {
          const score = getPriorityScore(createdAt)
          const pipeline = redis.pipeline()

          // 存储任务
          pipeline.hset(getKey('tasks'), taskId, JSON.stringify(task))

          // 加入各队列
          pipeline.zadd(getKey('pending:scrape'), score, taskId)
          pipeline.zadd(getKey('pending:all'), score, taskId)
          pipeline.zadd(getKey(`user:${row.user_id}:pending`), score, taskId)

          await pipeline.exec()
          process.stdout.write('.')
          enqueued++
        } catch (err) {
          process.stdout.write('x')
          failed++
        }
      }

      process.stdout.write('\n')

      if (i + BATCH_SIZE < rows.length) {
        await sleep(DELAY_MS)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('📊 Summary')
    console.log('='.repeat(60))
    console.log(`total=${rows.length}  enqueued=${enqueued}  skipped=${skipped}  failed=${failed}`)
    console.log(`\n✅ Done. ${enqueued} 个任务已推送到 Redis 队列（low priority）`)

  } finally {
    await db.end()
    if (redis) {
      redis.disconnect()
    }
  }
}

main().catch(err => {
  console.error('❌ Script failed:', err)
  process.exit(1)
})
