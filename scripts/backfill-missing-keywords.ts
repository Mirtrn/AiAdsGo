#!/usr/bin/env tsx
/**
 * 批量回填（Backfill）缺失 extracted_keywords/headlines/descriptions 的 Offer
 *
 * 背景：2026-05-07 Fix1~Fix4 部署前抓取的 offer 因 bug 导致提取字段为空。
 *       共影响 ~746 个 offer（561 product + 185 store）。
 *       本脚本查询所有受影响 offer 并重新触发抓取。
 *
 * 运行示例（dry-run，检查计划，不执行）：
 *   NODE_ENV=production DATABASE_URL='postgresql://...' REDIS_URL='redis://...' \
 *   tsx scripts/backfill-missing-keywords.ts
 *
 * 实际执行：
 *   NODE_ENV=production DATABASE_URL='postgresql://...' REDIS_URL='redis://...' \
 *   tsx scripts/backfill-missing-keywords.ts --apply
 *
 * 可选参数：
 *   --apply             实际执行（默认 dry-run）
 *   --batch-size=50     每批提交数量（默认50，避免队列瞬间爆满）
 *   --delay-ms=200      批次间隔毫秒（默认200）
 *   --limit=100         最多处理 N 个 offer（默认全部）
 *   --user-id=X         只处理特定用户的 offer
 */

import { closeDatabase, getDatabase } from '@/lib/db'
import { triggerOfferScraping, OfferScrapingPriority } from '@/lib/offer-scraping'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'

interface Args {
  apply: boolean
  batchSize: number
  delayMs: number
  limit: number | null
  userId: number | null
}

interface OfferRow {
  id: number
  user_id: number
  url: string | null
  affiliate_link: string | null
  brand: string | null
  offer_name: string | null
  target_country: string | null
  page_type: string | null
  is_deleted: unknown
}

type ResultRow =
  | { offerId: number; status: 'enqueued'; taskId: string }
  | { offerId: number; status: 'skipped'; reason: string }
  | { offerId: number; status: 'failed'; reason: string }

function parseArgs(argv: string[]): Args {
  const out: Args = {
    apply: false,
    batchSize: 50,
    delayMs: 200,
    limit: null,
    userId: null,
  }
  for (const arg of argv) {
    if (arg === '--apply') { out.apply = true; continue }
    if (arg === '--dry-run') { out.apply = false; continue }
    if (arg.startsWith('--batch-size=')) {
      out.batchSize = Math.max(1, Number(arg.slice('--batch-size='.length)))
      continue
    }
    if (arg.startsWith('--delay-ms=')) {
      out.delayMs = Math.max(0, Number(arg.slice('--delay-ms='.length)))
      continue
    }
    if (arg.startsWith('--limit=')) {
      out.limit = Math.max(1, Number(arg.slice('--limit='.length)))
      continue
    }
    if (arg.startsWith('--user-id=')) {
      out.userId = Number(arg.slice('--user-id='.length))
      continue
    }
  }
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isDeletedFlag(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase()
    return n !== '' && n !== '0' && n !== 'f' && n !== 'false' && n !== 'null'
  }
  return Boolean(value)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.apply ? 'APPLY' : 'DRY-RUN'

  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL environment variable')
  }
  if (args.apply && !process.env.REDIS_URL) {
    throw new Error('Missing REDIS_URL environment variable (required for --apply)')
  }

  console.log('='.repeat(60))
  console.log('🔁 Backfill: Re-scrape offers missing extracted keywords')
  console.log('='.repeat(60))
  console.log(`[mode]       ${mode}`)
  console.log(`[batch_size] ${args.batchSize}`)
  console.log(`[delay_ms]   ${args.delayMs}`)
  console.log(`[limit]      ${args.limit ?? '(all)'}`)
  console.log(`[user_id]    ${args.userId ?? '(all users)'}`)

  const db = getDatabase()

  // 关闭自动消费，避免本脚本在本地执行任务
  const queue = getQueueManager({ autoStartOnEnqueue: false })

  try {
    await queue.ensureInitialized()
    const runtime = queue.getRuntimeInfo()
    console.log(`[queue] adapter=${runtime.adapter}, connected=${runtime.connected}`)

    if (args.apply && runtime.adapter !== 'RedisQueueAdapter') {
      throw new Error(`Queue adapter is not Redis (${runtime.adapter}); refusing to enqueue in apply mode`)
    }
    if (args.apply && !runtime.connected) {
      throw new Error('Queue adapter is not connected; refusing to enqueue')
    }

    // 构建查询：找出所有缺失 extracted_keywords 或为空数组的 offer
    const conditions: string[] = [
      'is_deleted = FALSE',
      'scraped_at IS NOT NULL',
      "(extracted_keywords IS NULL OR extracted_keywords::text = '[]')",
    ]
    const params: unknown[] = []

    if (args.userId !== null) {
      params.push(args.userId)
      conditions.push(`user_id = $${params.length}`)
    }

    const limitClause = args.limit !== null ? `LIMIT ${args.limit}` : ''

    const sql = `
      SELECT id, user_id, url, affiliate_link, brand, offer_name, target_country, page_type, is_deleted
      FROM offers
      WHERE ${conditions.join(' AND ')}
      ORDER BY scraped_at DESC
      ${limitClause}
    `

    console.log('\n📊 Querying affected offers...')
    const rows = await db.query<OfferRow>(sql, params)
    console.log(`✅ Found ${rows.length} affected offers`)

    if (rows.length === 0) {
      console.log('🎉 No offers to backfill. Done.')
      return
    }

    // 统计
    const storeCount = rows.filter((r: OfferRow) => r.page_type === 'store').length
    const productCount = rows.filter((r: OfferRow) => r.page_type === 'product').length
    console.log(`   - product: ${productCount}`)
    console.log(`   - store:   ${storeCount}`)

    if (!args.apply) {
      console.log('\n⚠️  DRY-RUN mode: no tasks will be enqueued.')
      console.log('   Add --apply to actually trigger re-scraping.')
      console.log('\nSample offers (first 10):')
      for (const row of rows.slice(0, 10)) {
        const url = normalizeString(row.affiliate_link) || normalizeString(row.url) || '(no url)'
        console.log(`   #${row.id} [${row.page_type}] user=${row.user_id} ${url}`)
      }
      return
    }

    // 批量处理
    const results: ResultRow[] = []
    let batchNum = 0

    for (let i = 0; i < rows.length; i += args.batchSize) {
      const batch = rows.slice(i, i + args.batchSize)
      batchNum++
      console.log(`\n[batch ${batchNum}] Processing ${i + 1}–${Math.min(i + args.batchSize, rows.length)} of ${rows.length}...`)

      for (const row of batch) {
        const offerId = row.id

        if (isDeletedFlag(row.is_deleted)) {
          results.push({ offerId, status: 'skipped', reason: 'offer_deleted' })
          continue
        }

        const url = normalizeString(row.affiliate_link) || normalizeString(row.url)
        if (!url) {
          results.push({ offerId, status: 'skipped', reason: 'missing_url' })
          continue
        }

        const targetCountry = normalizeString(row.target_country).toUpperCase() || 'US'
        const brand = normalizeString(row.brand) || normalizeString(row.offer_name) || ''

        try {
          const taskId = await triggerOfferScraping(
            offerId,
            row.user_id,
            url,
            brand,
            targetCountry,
            OfferScrapingPriority.BACKGROUND  // 后台低优先级，不影响正常用户
          )
          results.push({ offerId, status: 'enqueued', taskId })
          process.stdout.write('.')
        } catch (error: any) {
          results.push({ offerId, status: 'failed', reason: error?.message || String(error) })
          process.stdout.write('x')
        }
      }

      process.stdout.write('\n')

      // 批次间隔，避免队列瞬间爆满
      if (i + args.batchSize < rows.length && args.delayMs > 0) {
        await sleep(args.delayMs)
      }
    }

    // 汇总
    const enqueued = results.filter((r) => r.status === 'enqueued') as Array<{ offerId: number; status: 'enqueued'; taskId: string }>
    const failed = results.filter((r) => r.status === 'failed')
    const skipped = results.filter((r) => r.status === 'skipped')

    console.log('\n' + '='.repeat(60))
    console.log('📊 Summary')
    console.log('='.repeat(60))
    console.log(`total=${results.length}  enqueued=${enqueued.length}  failed=${failed.length}  skipped=${skipped.length}`)

    if (failed.length > 0) {
      console.log('\n[failed]')
      for (const row of failed) {
        console.log(`  #${row.offerId}\t${row.reason}`)
      }
    }
    if (skipped.length > 0) {
      console.log('\n[skipped]')
      for (const row of skipped) {
        console.log(`  #${row.offerId}\t${row.reason}`)
      }
    }

    console.log(`\n✅ Done. ${enqueued.length} offers enqueued for re-scraping.`)
    console.log(`   These will be processed by the queue at BACKGROUND priority.`)

  } finally {
    // 清理：断开队列连接
    const adapter = (queue as any)?.adapter
    if (adapter && typeof adapter.disconnect === 'function') {
      try {
        await adapter.disconnect()
      } catch (e: any) {
        console.warn(`⚠️  queue adapter disconnect failed: ${e?.message || String(e)}`)
      }
    }
  }
}

main()
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    closeDatabase()
  })
