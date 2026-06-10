/**
 * 批量任务状态恢复模块
 *
 * 功能：
 * 1. 在系统启动时，队列清理后，同步更新数据库状态
 * 2. 基于子任务实际状态，更新batch_tasks和upload_records状态
 * 3. 修复服务重启导致的队列与数据库状态不一致问题
 *
 * 执行时机：
 * - 在队列系统调用clearAllUnfinished()清理Redis任务后执行
 * - 确保数据库状态与队列系统保持一致
 *
 * 关键设计：
 * - 队列清理（Redis）：clearAllUnfinished() 清理所有未完成的队列任务
 * - 数据库同步（SQLite/PostgreSQL）：本模块同步更新数据库中的状态记录
 *
 * 🔥 修复（2025-12-11）：解决服务重启后upload_records一直显示"处理中"的问题
 */

import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import type { OfferExtractionTaskData } from '@/lib/queue/executors/offer-extraction-executor'

type UploadRecordForSync = {
  id: string
  batch_id: string
  file_name?: string | null
  valid_count: number | string
  status: string
}

type BatchUploadSyncResult = {
  checked: number
  updated: number
  finalized: number
  details: Array<{
    uploadRecordId: string
    batchId: string
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial'
    completed: number
    failed: number
    pending: number
    running: number
    total: number
  }>
}

type PendingOfferTaskForRequeue = {
  id: string
  user_id: number | string
  batch_id: string
  affiliate_link: string
  target_country: string
  page_type?: string | null
  store_product_links?: unknown
  brand_name?: string | null
  product_price?: string | null
  commission_payout?: string | null
  skip_cache?: boolean | number | string | null
  skip_warmup?: boolean | number | string | null
}

type PendingOfferTaskRequeueResult = {
  checked: number
  requeued: number
  failed: number
  taskIds: string[]
  errors: Array<{ taskId: string; message: string }>
}

function toCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function calculateSuccessRate(completed: number, total: number): number {
  return total > 0 ? Math.round((completed / total) * 1000) / 10 : 0
}

function resolveTerminalStatus(completed: number, failed: number): 'completed' | 'failed' | 'partial' {
  if (failed === 0) return 'completed'
  if (completed === 0) return 'failed'
  return 'partial'
}

function toBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function normalizeStringArray(value: unknown): string[] | undefined {
  const normalize = (items: unknown[]): string[] => {
    return Array.from(
      new Set(
        items
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      )
    )
  }

  if (Array.isArray(value)) {
    const items = normalize(value)
    return items.length > 0 ? items : undefined
  }

  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const items = normalize(parsed)
      return items.length > 0 ? items : undefined
    }
  } catch {
    // Fall through to a lightweight delimiter fallback for legacy text values.
  }

  const items = normalize(trimmed.split(/[\n,]+/))
  return items.length > 0 ? items : undefined
}

function normalizePageType(value: unknown): 'store' | 'product' {
  return value === 'store' ? 'store' : 'product'
}

function getPendingRequeueAgeMs(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10 * 60 * 1000
}

/**
 * 保守同步 upload_records / batch_tasks 与 offer_tasks 的状态。
 *
 * 与 recoverBatchTaskStatus 不同：这里不会把仍有 pending/running 子任务的批次提前终结。
 * 适合在页面查询、健康检查、管理员同步中反复调用。
 */
export async function syncUploadRecordsFromOfferTasks(params: {
  userId?: number
  batchId?: string
} = {}): Promise<BatchUploadSyncResult> {
  const db = getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  let whereClause = "status IN ('pending', 'processing')"
  const queryParams: any[] = []

  if (typeof params.userId === 'number' && Number.isFinite(params.userId)) {
    whereClause += ' AND user_id = ?'
    queryParams.push(params.userId)
  }

  if (params.batchId) {
    whereClause += ' AND batch_id = ?'
    queryParams.push(params.batchId)
  }

  const records = await db.query<UploadRecordForSync>(`
    SELECT id, batch_id, file_name, valid_count, status
    FROM upload_records
    WHERE ${whereClause}
    ORDER BY uploaded_at ASC
  `, queryParams)

  const result: BatchUploadSyncResult = {
    checked: records.length,
    updated: 0,
    finalized: 0,
    details: [],
  }

  for (const record of records) {
    const childStats = await db.query<{
      status: string
      count: number | string
    }>(`
      SELECT status, COUNT(*) as count
      FROM offer_tasks
      WHERE batch_id = ?
      GROUP BY status
    `, [record.batch_id])

    const statsMap: Record<string, number> = {}
    for (const row of childStats) {
      statsMap[row.status] = toCount(row.count)
    }

    const completed = statsMap.completed || 0
    const failed = statsMap.failed || 0
    const pending = statsMap.pending || 0
    const running = statsMap.running || 0
    const validCount = toCount(record.valid_count)
    const observedTotal = completed + failed + pending + running
    const total = validCount > 0 ? validCount : observedTotal
    const successRate = calculateSuccessRate(completed, total)
    const terminalCount = completed + failed
    const canFinalize = total > 0 && terminalCount >= total && pending === 0 && running === 0

    if (canFinalize) {
      const finalStatus = resolveTerminalStatus(completed, failed)

      await db.exec(`
        UPDATE batch_tasks
        SET
          status = ?,
          completed_count = ?,
          failed_count = ?,
          completed_at = COALESCE(completed_at, ${nowFunc}),
          updated_at = ${nowFunc}
        WHERE id = ?
      `, [finalStatus, completed, failed, record.batch_id])

      await db.exec(`
        UPDATE upload_records
        SET
          status = ?,
          processed_count = ?,
          failed_count = ?,
          success_rate = ?,
          completed_at = COALESCE(completed_at, ${nowFunc}),
          updated_at = ${nowFunc}
        WHERE id = ?
      `, [finalStatus, completed, failed, successRate, record.id])

      result.finalized++
      result.details.push({
        uploadRecordId: record.id,
        batchId: record.batch_id,
        status: finalStatus,
        completed,
        failed,
        pending,
        running,
        total,
      })
    } else {
      const liveBatchStatus = observedTotal > 0 ? 'running' : 'pending'
      const liveUploadStatus = observedTotal > 0 ? 'processing' : 'pending'

      await db.exec(`
        UPDATE batch_tasks
        SET
          completed_count = ?,
          failed_count = ?,
          status = CASE WHEN status = 'pending' THEN ? ELSE status END,
          updated_at = ${nowFunc}
        WHERE id = ?
      `, [completed, failed, liveBatchStatus, record.batch_id])

      await db.exec(`
        UPDATE upload_records
        SET
          processed_count = ?,
          failed_count = ?,
          success_rate = ?,
          status = CASE WHEN status = 'pending' THEN ? ELSE status END,
          updated_at = ${nowFunc}
        WHERE id = ?
      `, [completed, failed, successRate, liveUploadStatus, record.id])

      result.details.push({
        uploadRecordId: record.id,
        batchId: record.batch_id,
        status: liveUploadStatus,
        completed,
        failed,
        pending,
        running,
        total,
      })
    }

    result.updated++
  }

  return result
}

/**
 * 重新入队仍处于 pending 的批量 offer 子任务。
 *
 * 用于处理“数据库 offer_tasks 还在 pending，但 Redis/内存队列中对应任务丢失”的情况。
 * 只处理仍处于 pending/processing 的上传批次，并且默认要求 pending 超过 10 分钟，避免与正常排队竞争。
 */
export async function requeuePendingOfferTasksForActiveUploads(params: {
  userId?: number
  batchId?: string
  limit?: number
  minPendingAgeMs?: number
} = {}): Promise<PendingOfferTaskRequeueResult> {
  const db = getDatabase()
  const minPendingAgeMs = getPendingRequeueAgeMs(
    params.minPendingAgeMs ?? process.env.BATCH_OFFER_PENDING_REQUEUE_AFTER_MS
  )
  const minPendingAgeSeconds = Math.ceil(minPendingAgeMs / 1000)
  const limit = Math.max(1, Math.min(500, Math.floor(Number(params.limit || 100))))
  const ageClause = db.type === 'postgres'
    ? `ot.created_at < NOW() - INTERVAL '${minPendingAgeSeconds} seconds'`
    : `ot.created_at < datetime('now', '-${minPendingAgeSeconds} seconds')`

  const whereParts = [
    "ot.status = 'pending'",
    "ur.status IN ('pending', 'processing')",
    ageClause,
  ]
  const queryParams: any[] = []

  if (typeof params.userId === 'number' && Number.isFinite(params.userId)) {
    whereParts.push('ot.user_id = ?')
    queryParams.push(params.userId)
  }

  if (params.batchId) {
    whereParts.push('ot.batch_id = ?')
    queryParams.push(params.batchId)
  }

  queryParams.push(limit)

  const pendingTasks = await db.query<PendingOfferTaskForRequeue>(`
    SELECT
      ot.id,
      ot.user_id,
      ot.batch_id,
      ot.affiliate_link,
      ot.target_country,
      ot.page_type,
      ot.store_product_links,
      ot.brand_name,
      ot.product_price,
      ot.commission_payout,
      ot.skip_cache,
      ot.skip_warmup
    FROM offer_tasks ot
    INNER JOIN upload_records ur ON ur.batch_id = ot.batch_id
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ot.created_at ASC
    LIMIT ?
  `, queryParams)

  const result: PendingOfferTaskRequeueResult = {
    checked: pendingTasks.length,
    requeued: 0,
    failed: 0,
    taskIds: [],
    errors: [],
  }

  if (pendingTasks.length === 0) {
    return result
  }

  const { getQueueManager } = await import('@/lib/queue/unified-queue-manager')
  const queue = getQueueManager()

  for (const pendingTask of pendingTasks) {
    const userId = toCount(pendingTask.user_id)
    const affiliateLink = (pendingTask.affiliate_link || '').trim()
    const targetCountry = (pendingTask.target_country || '').trim()

    if (!userId || !affiliateLink || !targetCountry) {
      result.failed++
      result.errors.push({
        taskId: pendingTask.id,
        message: '缺少 user_id / affiliate_link / target_country，无法重新入队',
      })
      continue
    }

    const pageType = normalizePageType(pendingTask.page_type)
    const storeProductLinks = pageType === 'store'
      ? normalizeStringArray(pendingTask.store_product_links)
      : undefined
    const brandName = (pendingTask.brand_name || '').trim()

    const taskData: OfferExtractionTaskData = {
      affiliateLink,
      targetCountry,
      skipCache: toBooleanFlag(pendingTask.skip_cache),
      skipWarmup: toBooleanFlag(pendingTask.skip_warmup),
      productPrice: pendingTask.product_price || undefined,
      commissionPayout: pendingTask.commission_payout || undefined,
      brandName: brandName || undefined,
      pageType,
      storeProductLinks,
    }

    try {
      await queue.enqueue(
        'offer-extraction',
        taskData,
        userId,
        {
          priority: 'normal',
          requireProxy: true,
          maxRetries: 2,
          taskId: pendingTask.id,
        }
      )
      result.requeued++
      result.taskIds.push(pendingTask.id)
    } catch (error: any) {
      result.failed++
      result.errors.push({
        taskId: pendingTask.id,
        message: error?.message || String(error),
      })
    }
  }

  return result
}

/**
 * 恢复所有未完成的批量任务状态
 *
 * 策略：
 * 1. 队列清理后，所有running/pending的队列任务已被删除
 * 2. 数据库中offer_tasks的状态是最终真相来源
 * 3. 基于offer_tasks状态，同步更新batch_tasks和upload_records
 */
export async function recoverBatchTaskStatus(): Promise<void> {
  const db = getDatabase()

  try {
    console.log('🔍 开始同步批量任务数据库状态...')

    // 1. 查询所有未完成的upload_records（status为pending或processing）
    // 🔧 2025-12-23: 先检查表是否存在，避免SQLite/PostgreSQL未初始化错误
    let pendingRecords: any[] = []
    try {
      // 检查upload_records表是否存在（支持SQLite和PostgreSQL）
      let tableExists = false
      if (db.type === 'sqlite') {
        const result = await db.query<{ count: number }>(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='upload_records'"
        )
        tableExists = result[0].count > 0
      } else {
        const result = await db.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
          ['upload_records']
        )
        tableExists = result[0].exists
      }

      if (tableExists) {
        // 表存在，查询数据
        pendingRecords = await db.query<{
          id: string
          batch_id: string
          file_name: string
          valid_count: number
          status: string
        }>(`
          SELECT id, batch_id, file_name, valid_count, status
          FROM upload_records
          WHERE status IN ('pending', 'processing')
          ORDER BY uploaded_at ASC
        `)
      } else {
        console.log('⚠️ upload_records表不存在，跳过批量任务状态恢复')
        return
      }
    } catch (uploadError) {
      console.warn('⚠️ 检查upload_records表失败:', uploadError)
      console.log('⚠️ 批量任务状态同步跳过（非关键错误）')
      return
    }

    if (!pendingRecords || pendingRecords.length === 0) {
      console.log('✅ 没有需要同步的批量任务')
      return
    }

    console.log(`📦 发现 ${pendingRecords.length} 个未完成的批量任务记录，开始同步状态...`)

    let recoveredCount = 0
    let skippedCount = 0

    // 2. 逐个检查并修复状态
    for (const record of pendingRecords) {
      try {
        await recoverSingleBatchTask(db, record.batch_id, record.id, record.valid_count)
        recoveredCount++
      } catch (error: any) {
        console.error(`❌ 同步批量任务状态失败: batch_id=${record.batch_id}:`, error.message)
        skippedCount++
      }
    }

    console.log(`✅ 批量任务状态同步完成: 成功=${recoveredCount}, 跳过=${skippedCount}`)

  } catch (error: any) {
    console.error('❌ 批量任务状态同步失败:', error)
    throw error
  }
}

/**
 * 恢复单个批量任务的状态
 *
 * 逻辑：
 * 1. 队列已清理：服务重启时，Redis中的任务队列已被清空
 * 2. 数据库真相：offer_tasks表中的状态是唯一可靠的真相来源
 * 3. 状态判断：
 *    - 如果所有子任务都是completed/failed → 批量任务已完成
 *    - 如果还有pending/running的子任务 → 保留原状态（但实际队列已清空，这些任务不会再执行）
 */
async function recoverSingleBatchTask(
  db: DatabaseAdapter,
  batchId: string,
  uploadRecordId: string,
  validCount: number
): Promise<void> {
  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 1. 查询所有子任务的实际状态（数据库是唯一真相来源）
  const childStats = await db.query<{
    status: string
    count: number | string  // PostgreSQL COUNT(*) 返回 bigint，pg 驱动序列化为字符串
  }>(`
    SELECT status, COUNT(*) as count
    FROM offer_tasks
    WHERE batch_id = ?
    GROUP BY status
  `, [batchId])

  // 2. 统计子任务状态
  // 🔧 Bug #12 修复：PostgreSQL COUNT(*) 返回 bigint 字符串，必须 Number() 转换
  // 否则 completed + failed 会变为字符串拼接（'2' + '3' = '23'），导致判断错误
  const statsMap: Record<string, number> = {}
  for (const row of childStats) {
    statsMap[row.status] = Number(row.count)
  }

  const completed = statsMap['completed'] || 0
  const failed = statsMap['failed'] || 0
  const pending = statsMap['pending'] || 0
  const running = statsMap['running'] || 0
  const total = validCount // 使用upload_records中的valid_count作为总数

  console.log(`📊 批量任务状态统计: batch_id=${batchId}, total=${total}, completed=${completed}, failed=${failed}, pending=${pending}, running=${running}`)

  // 3. 判断最终状态
  let finalStatus: 'completed' | 'failed' | 'partial'

  // 🔥 关键修复：服务重启后，即使数据库中有pending/running的子任务记录，
  // 由于队列已被清空，这些任务实际上不会再执行，应该标记为最终状态

  if (completed + failed === 0) {
    // 特殊情况：没有任何已完成或失败的任务（可能刚创建就重启了）
    finalStatus = 'failed'
    console.log(`⚠️ 批量任务无进展: batch_id=${batchId}, 标记为失败`)
  } else if (completed + failed >= total) {
    // 正常情况：所有任务都有最终状态
    if (failed === 0) {
      finalStatus = 'completed' // 全部成功
    } else if (completed === 0) {
      finalStatus = 'failed' // 全部失败
    } else {
      finalStatus = 'partial' // 部分成功
    }
  } else {
    // 部分任务未完成：由于队列已清理，剩余任务不会执行，标记为partial
    finalStatus = 'partial'
    console.log(`⚠️ 批量任务部分完成: batch_id=${batchId}, completed=${completed}, failed=${failed}, unfinished=${total - completed - failed}`)
  }

  // 4. 计算成功率
  const successRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0

  // 5. 更新batch_tasks状态
  await db.exec(`
    UPDATE batch_tasks
    SET
      status = ?,
      completed_count = ?,
      failed_count = ?,
      completed_at = COALESCE(completed_at, ${nowFunc}),
      updated_at = ${nowFunc}
    WHERE id = ?
  `, [finalStatus, completed, failed, batchId])

  // 6. 更新upload_records状态
  await db.exec(`
    UPDATE upload_records
    SET
      status = ?,
      processed_count = ?,
      failed_count = ?,
      success_rate = ?,
      completed_at = COALESCE(completed_at, ${nowFunc}),
      updated_at = ${nowFunc}
    WHERE id = ?
  `, [finalStatus, completed, failed, successRate, uploadRecordId])

  console.log(`✅ 批量任务状态已同步: batch_id=${batchId}, status=${finalStatus}, completed=${completed}/${total}, success_rate=${successRate}%`)
}

/**
 * 手动运行脚本入口（用于CLI调用）
 */
export async function runBatchRecovery() {
  console.log('🚀 开始批量任务状态恢复...')
  await recoverBatchTaskStatus()
  console.log('✅ 批量任务状态恢复完成')
}
