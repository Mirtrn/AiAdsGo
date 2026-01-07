/**
 * 换链接任务核心业务逻辑
 * src/lib/url-swap.ts
 *
 * 功能：换链接任务的CRUD操作和数据访问
 */

import { getDatabase } from './db'
import { resolveAffiliateLink } from './url-resolver-enhanced'
import { calculateNextSwapAt } from './url-swap-time'
import { validateUrlSwapTask, validateTaskConfig } from './url-swap-validator'
import type {
  UrlSwapTask,
  UrlSwapTaskStatus,
  CreateUrlSwapTaskRequest,
  UpdateUrlSwapTaskRequest,
  SwapHistoryEntry,
  UrlSwapTaskStats,
  UrlSwapGlobalStats
} from './url-swap-types'

/**
 * 创建换链接任务
 */
export async function createUrlSwapTask(
  userId: number,
  input: CreateUrlSwapTaskRequest
): Promise<UrlSwapTask> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  // 1. 验证任务配置
  const intervalMinutes = input.swap_interval_minutes || 60
  const durationDays = input.duration_days || 7
  const configValidation = validateTaskConfig(intervalMinutes, durationDays)
  if (!configValidation.valid) {
    throw new Error(configValidation.error)
  }

  // 2. 获取Offer信息
  const offer = await getOfferById(input.offer_id)
  if (!offer) {
    throw new Error('Offer不存在或已被删除')
  }

  // 3. 验证代理配置
  const validation = await validateUrlSwapTask(input.offer_id)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  // 4. 解析推广链接（首次解析，禁用缓存）
  const resolved = await resolveAffiliateLink(offer.affiliate_link, {
    targetCountry: offer.target_country,
    skipCache: true
  })

  // 5. 获取关联的Campaign
  const campaign = await getCampaignByOfferId(input.offer_id, userId)

  // 6. 生成任务ID
  const taskId = crypto.randomUUID().toLowerCase()

  // 7. 计算首次执行时间
  const nextSwapAt = calculateNextSwapAt(intervalMinutes)

  // 8. 创建任务
  await db.exec(`
    INSERT INTO url_swap_tasks (
      id, user_id, offer_id,
      swap_interval_minutes, enabled, duration_days,
      google_customer_id, google_campaign_id,
      current_final_url, current_final_url_suffix,
      progress, total_swaps, success_swaps, failed_swaps, url_changed_count,
      swap_history,
      status, started_at, next_swap_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    taskId,
    userId,
    input.offer_id,
    intervalMinutes,
    true,  // enabled
    durationDays,
    campaign?.customer_id || null,
    campaign?.campaign_id || null,
    resolved.finalUrl,
    resolved.finalUrlSuffix,
    0, 0, 0, 0, 0,
    JSON.stringify([]),  // 空历史
    'enabled',
    now,
    nextSwapAt.toISOString(),
    now,
    now
  ])

  console.log(`[url-swap] 创建换链接任务成功: ${taskId}`)

  return (await getUrlSwapTaskById(taskId, userId))!
}

/**
 * 获取任务（带权限验证）
 */
export async function getUrlSwapTaskById(
  id: string,
  userId: number
): Promise<UrlSwapTask | null> {
  const db = await getDatabase()

  const isDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = FALSE OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const task = userId === 0
    ? await db.queryOne<any>(`
        SELECT * FROM url_swap_tasks
        WHERE id = ? AND ${isDeletedCondition}
      `, [id])
    : await db.queryOne<any>(`
        SELECT * FROM url_swap_tasks
        WHERE id = ? AND user_id = ? AND ${isDeletedCondition}
      `, [id, userId])

  if (!task) return null

  return parseUrlSwapTask(task)
}

/**
 * 根据Offer ID获取任务
 */
export async function getUrlSwapTaskByOfferId(
  offerId: number,
  userId: number
): Promise<UrlSwapTask | null> {
  const db = await getDatabase()

  const task = await db.queryOne<any>(`
    SELECT * FROM url_swap_tasks
    WHERE offer_id = ? AND user_id = ?
  `, [offerId, userId])

  if (!task) return null

  return parseUrlSwapTask(task)
}

/**
 * 检查Offer是否已有关联任务
 */
export async function hasUrlSwapTask(offerId: number, userId: number): Promise<boolean> {
  const task = await getUrlSwapTaskByOfferId(offerId, userId)
  return task !== null && task.status !== 'completed'
}

/**
 * 获取任务列表
 */
export async function getUrlSwapTasks(
  userId: number,
  options: {
    status?: UrlSwapTaskStatus
    page?: number
    limit?: number
  } = {}
): Promise<{ tasks: UrlSwapTask[]; total: number }> {
  const db = await getDatabase()
  const page = options.page || 1
  const limit = options.limit || 20
  const offset = (page - 1) * limit

  const isDeletedCondition = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'
  let whereClause = `user_id = ? AND ${isDeletedCondition}`
  const params: any[] = [userId]

  if (options.status) {
    whereClause += ' AND status = ?'
    params.push(options.status)
  }

  // 获取总数
  const countResult = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM url_swap_tasks
    WHERE ${whereClause}
  `, params)

  const total = countResult?.count || 0

  // 获取任务列表
  const tasks = await db.query<any>(`
    SELECT * FROM url_swap_tasks
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset])

  return {
    tasks: tasks.map(parseUrlSwapTask),
    total
  }
}

/**
 * 更新任务配置
 */
export async function updateUrlSwapTask(
  id: string,
  userId: number,
  updates: UpdateUrlSwapTaskRequest
): Promise<UrlSwapTask> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  // 验证更新字段
  if (updates.swap_interval_minutes !== undefined || updates.duration_days !== undefined) {
    const interval = updates.swap_interval_minutes || 60
    const duration = updates.duration_days || 7
    const validation = validateTaskConfig(interval, duration)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.swap_interval_minutes !== undefined) {
    fields.push('swap_interval_minutes = ?')
    values.push(updates.swap_interval_minutes)
  }

  if (updates.duration_days !== undefined) {
    fields.push('duration_days = ?')
    values.push(updates.duration_days)
  }

  if (fields.length === 0) {
    return (await getUrlSwapTaskById(id, userId))!
  }

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id, userId)

  await db.exec(`
    UPDATE url_swap_tasks
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `, values)

  console.log(`[url-swap] 更新任务配置: ${id}`)

  return (await getUrlSwapTaskById(id, userId))!
}

/**
 * 禁用任务
 */
export async function disableUrlSwapTask(id: string, userId: number): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  await db.exec(`
    UPDATE url_swap_tasks
    SET status = 'disabled', updated_at = ?
    WHERE id = ? AND user_id = ?
  `, [now, id, userId])

  console.log(`[url-swap] 禁用任务: ${id}`)
}

/**
 * 启用任务
 */
export async function enableUrlSwapTask(id: string, userId: number): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const task = await getUrlSwapTaskById(id, userId)

  if (!task) {
    throw new Error('任务不存在')
  }

  // 计算下次执行时间
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)

  await db.exec(`
    UPDATE url_swap_tasks
    SET status = 'enabled', next_swap_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `, [nextSwapAt.toISOString(), now, id, userId])

  console.log(`[url-swap] 启用任务: ${id}`)
}

/**
 * 错误类型
 */
export type UrlSwapErrorType = 'link_resolution' | 'google_ads_api' | 'other'

/**
 * 设置任务错误状态
 *
 * @param id 任务ID
 * @param errorMessage 错误信息
 * @param errorType 错误类型（用于区分不同类型的错误）
 *
 * 连续失败策略：
 * - 链接解析失败（link_resolution）：连续3个时间间隔失败后自动暂停（disabled）
 * - Google Ads API失败（google_ads_api）：连续3个时间间隔失败后自动暂停（disabled）
 * - 其他错误（other）：仅设置error状态，不自动暂停
 */
export async function setTaskError(
  id: string,
  errorMessage: string,
  errorType: UrlSwapErrorType = 'other'
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  // 1. 查询当前任务状态
  const task = await db.queryOne<{
    consecutive_failures: number
    failed_swaps: number
    total_swaps: number
  }>(`
    SELECT consecutive_failures, failed_swaps, total_swaps
    FROM url_swap_tasks
    WHERE id = ?
  `, [id])

  if (!task) {
    console.error(`[url-swap] 任务不存在: ${id}`)
    return
  }

  // 2. 计算新的连续失败次数
  const newConsecutiveFailures = task.consecutive_failures + 1

  // 3. 确定新状态和错误信息
  let newStatus: UrlSwapTaskStatus = 'error'
  let enhancedMessage = errorMessage

  // 需要自动暂停的错误类型：链接解析失败、Google Ads API失败
  const shouldAutoPause = errorType === 'link_resolution' || errorType === 'google_ads_api'

  if (shouldAutoPause) {
    const isOAuthInvalidGrant = errorType === 'google_ads_api' && (
      errorMessage.includes('invalid_grant') ||
      errorMessage.includes('Token has been expired') ||
      errorMessage.includes('Token has been revoked') ||
      errorMessage.includes('Token has been expired or revoked')
    )

    // 构建错误类型描述
    const errorTypeLabel = errorType === 'link_resolution'
      ? '推广链接解析失败'
      : (isOAuthInvalidGrant ? 'Google OAuth 授权已过期或被撤销' : 'Google Ads API调用失败')

    // invalid_grant 属于不可自愈错误，立即暂停避免无意义重试
    const autoPauseThreshold = isOAuthInvalidGrant ? 1 : 3

    if (newConsecutiveFailures >= autoPauseThreshold) {
      // 连续3次失败后自动暂停
      newStatus = 'disabled'
      enhancedMessage = `🔴 ${errorTypeLabel}连续失败 ${newConsecutiveFailures} 次，任务已自动暂停。\n\n` +
        `错误详情: ${errorMessage}\n\n` +
        `建议操作：\n` +
        `${errorType === 'link_resolution' ?
          `1. 检查推广链接是否有效\n2. 确认链接未过期或被撤销` :
          (isOAuthInvalidGrant
            ? `1. 前往设置页面重新授权 Google Ads（OAuth）\n2. 或删除失效的OAuth配置并改用服务账号（如已配置）`
            : `1. 检查Google Ads账号权限和配额\n2. 确认OAuth授权有效\n3. 检查服务账号配置（如使用）`
          )
        }\n` +
        `4. 修复问题后，在任务详情页重新启用任务`

      console.warn(`[url-swap] ⚠️ 任务自动暂停（${errorType}连续失败${newConsecutiveFailures}次）: ${id}`)
    } else {
      // 尚未达到暂停阈值
      newStatus = 'error'
      enhancedMessage = `⚠️ ${errorTypeLabel}（连续失败 ${newConsecutiveFailures}/${autoPauseThreshold}）。\n\n` +
        `错误详情: ${errorMessage}\n\n` +
        `系统将在下个时间间隔继续尝试。连续失败${autoPauseThreshold}次后将自动暂停任务。`

      console.warn(`[url-swap] ⚠️ ${errorType}失败 ${newConsecutiveFailures}/${autoPauseThreshold}: ${id}`)
    }
  } else {
    // 其他错误：仅设置error状态，不自动暂停
    newStatus = 'error'
    enhancedMessage = errorMessage
    console.error(`[url-swap] 任务错误: ${id} - ${errorMessage}`)
  }

  // 4. 更新数据库
  await db.exec(`
    UPDATE url_swap_tasks
    SET
      status = ?,
      error_message = ?,
      error_at = ?,
      consecutive_failures = ?,
      updated_at = ?
    WHERE id = ?
  `, [newStatus, enhancedMessage, now, newConsecutiveFailures, now, id])

  console.log(`[url-swap] 任务错误已记录: ${id} (连续失败: ${newConsecutiveFailures}, 状态: ${newStatus})`)
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
  id: string,
  status: UrlSwapTaskStatus,
  nextSwapAt?: string
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  if (nextSwapAt) {
    await db.exec(`
      UPDATE url_swap_tasks
      SET status = ?, next_swap_at = ?, updated_at = ?
      WHERE id = ?
    `, [status, nextSwapAt, now, id])
  } else {
    await db.exec(`
      UPDATE url_swap_tasks
      SET status = ?, updated_at = ?
      WHERE id = ?
    `, [status, now, id])
  }
}

/**
 * 获取待处理的任务（用于调度器）
 */
export async function getPendingTasks(): Promise<UrlSwapTask[]> {
  const db = await getDatabase()

  const isDeletedCondition = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'
  const nowCondition = db.type === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"

  const tasks = await db.query<any>(`
    SELECT * FROM url_swap_tasks
    WHERE status = 'enabled'
      AND next_swap_at <= ${nowCondition}
      AND started_at <= ${nowCondition}
      AND ${isDeletedCondition}
    ORDER BY next_swap_at ASC
  `)

  return tasks.map(parseUrlSwapTask)
}

/**
 * 记录换链历史
 */
export async function recordSwapHistory(
  taskId: string,
  entry: SwapHistoryEntry
): Promise<void> {
  const db = await getDatabase()
  const task = await getUrlSwapTaskById(taskId, 0)  // 使用userId=0避免权限检查

  if (!task) return

  const existingHistory = task.swap_history || []
  existingHistory.push(entry)

  // 只保留最近100条记录
  if (existingHistory.length > 100) {
    existingHistory.splice(0, existingHistory.length - 100)
  }

  await db.exec(`
    UPDATE url_swap_tasks
    SET swap_history = ?, updated_at = ?
    WHERE id = ?
  `, [JSON.stringify(existingHistory), new Date().toISOString(), taskId])
}

/**
 * 换链成功后更新任务
 */
export async function updateTaskAfterSwap(
  taskId: string,
  newFinalUrl: string,
  newFinalUrlSuffix: string
): Promise<void> {
  const db = await getDatabase()
  const task = await getUrlSwapTaskById(taskId, 0)
  if (!task) return

  const now = new Date().toISOString()
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)

  await db.exec(`
    UPDATE url_swap_tasks
    SET current_final_url = ?,
        current_final_url_suffix = ?,
        total_swaps = total_swaps + 1,
        success_swaps = success_swaps + 1,
        url_changed_count = url_changed_count + 1,
        consecutive_failures = 0,
        error_message = NULL,
        error_at = NULL,
        next_swap_at = ?,
        updated_at = ?
    WHERE id = ?
  `, [newFinalUrl, newFinalUrlSuffix, nextSwapAt.toISOString(), now, taskId])

  console.log(`[url-swap] 换链成功更新: ${taskId}`)
}

/**
 * 获取任务统计
 */
export async function getUrlSwapTaskStats(taskId: string, userId: number): Promise<UrlSwapTaskStats> {
  const task = await getUrlSwapTaskById(taskId, userId)
  if (!task) {
    throw new Error('任务不存在')
  }

  const successRate = task.total_swaps > 0
    ? Math.round((task.success_swaps / task.total_swaps) * 100)
    : 0

  return {
    swap_count: task.total_swaps,
    success_count: task.success_swaps,
    failed_count: task.failed_swaps,
    success_rate: successRate,
    last_swap_at: task.swap_history.length > 0
      ? task.swap_history[task.swap_history.length - 1].swapped_at
      : null,
    next_swap_at: task.next_swap_at,
    current_final_url: task.current_final_url || '',
    current_final_url_suffix: task.current_final_url_suffix || '',
    status: task.status
  }
}

/**
 * 获取当前用户的统计
 */
export async function getUrlSwapUserStats(userId: number): Promise<UrlSwapGlobalStats> {
  const db = await getDatabase()

  const isDeletedCondition = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

  const stats = await db.queryOne<any>(`
    SELECT
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) as active_tasks,
      SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled_tasks,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      COALESCE(SUM(total_swaps), 0) as total_swaps,
      COALESCE(SUM(success_swaps), 0) as success_swaps,
      COALESCE(SUM(failed_swaps), 0) as failed_swaps,
      COALESCE(SUM(url_changed_count), 0) as url_changed_count
    FROM url_swap_tasks
    WHERE user_id = ? AND ${isDeletedCondition}
  `, [userId])

  const successRate = stats.total_swaps > 0
    ? Math.round((stats.success_swaps / stats.total_swaps) * 100)
    : 0

  return {
    total_tasks: stats.total_tasks || 0,
    active_tasks: stats.active_tasks || 0,
    disabled_tasks: stats.disabled_tasks || 0,
    error_tasks: stats.error_tasks || 0,
    completed_tasks: stats.completed_tasks || 0,
    total_swaps: stats.total_swaps || 0,
    success_swaps: stats.success_swaps || 0,
    failed_swaps: stats.failed_swaps || 0,
    url_changed_count: stats.url_changed_count || 0,
    success_rate: successRate
  }
}

/**
 * 获取全局统计（管理员）
 */
export async function getUrlSwapGlobalStats(): Promise<UrlSwapGlobalStats> {
  const db = await getDatabase()

  const isDeletedCondition = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'

  const stats = await db.queryOne<any>(`
    SELECT
      COUNT(*) as total_tasks,
      SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) as active_tasks,
      SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled_tasks,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_tasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      COALESCE(SUM(total_swaps), 0) as total_swaps,
      COALESCE(SUM(success_swaps), 0) as success_swaps,
      COALESCE(SUM(failed_swaps), 0) as failed_swaps,
      COALESCE(SUM(url_changed_count), 0) as url_changed_count
    FROM url_swap_tasks
    WHERE ${isDeletedCondition}
  `)

  const successRate = stats.total_swaps > 0
    ? Math.round((stats.success_swaps / stats.total_swaps) * 100)
    : 0

  return {
    total_tasks: stats.total_tasks || 0,
    active_tasks: stats.active_tasks || 0,
    disabled_tasks: stats.disabled_tasks || 0,
    error_tasks: stats.error_tasks || 0,
    completed_tasks: stats.completed_tasks || 0,
    total_swaps: stats.total_swaps || 0,
    success_swaps: stats.success_swaps || 0,
    failed_swaps: stats.failed_swaps || 0,
    url_changed_count: stats.url_changed_count || 0,
    success_rate: successRate
  }
}

/**
 * 获取所有任务列表（管理员）
 */
export async function getAllUrlSwapTasks(
  options: {
    status?: UrlSwapTaskStatus
    page?: number
    limit?: number
  } = {}
): Promise<{ tasks: (UrlSwapTask & { username?: string })[]; total: number }> {
  const db = await getDatabase()
  const page = options.page || 1
  const limit = options.limit || 20
  const offset = (page - 1) * limit

  const isDeletedCondition = db.type === 'postgres' ? 'ust.is_deleted = FALSE' : 'ust.is_deleted = 0'
  let whereClause = isDeletedCondition
  const params: any[] = []

  if (options.status) {
    whereClause += ' AND ust.status = ?'
    params.push(options.status)
  }

  // 获取总数
  const countResult = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM url_swap_tasks ust
    WHERE ${whereClause}
  `, params)

  const total = countResult?.count || 0

  // 获取任务列表（关联用户表）
  const tasks = await db.query<any>(`
    SELECT ust.*, u.username
    FROM url_swap_tasks ust
    LEFT JOIN users u ON ust.user_id = u.id
    WHERE ${whereClause}
    ORDER BY ust.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset])

  return {
    tasks: tasks.map(t => ({
      ...parseUrlSwapTask(t),
      username: t.username
    })),
    total
  }
}

/**
 * 解析数据库记录为任务对象
 */
function parseUrlSwapTask(row: any): UrlSwapTask {
  return {
    id: row.id,
    user_id: row.user_id,
    offer_id: row.offer_id,
    swap_interval_minutes: row.swap_interval_minutes,
    enabled: Boolean(row.enabled),
    duration_days: row.duration_days,
    google_customer_id: row.google_customer_id,
    google_campaign_id: row.google_campaign_id,
    current_final_url: row.current_final_url,
    current_final_url_suffix: row.current_final_url_suffix,
    progress: row.progress || 0,
    total_swaps: row.total_swaps || 0,
    success_swaps: row.success_swaps || 0,
    failed_swaps: row.failed_swaps || 0,
    url_changed_count: row.url_changed_count || 0,
    consecutive_failures: row.consecutive_failures || 0,
    swap_history: typeof row.swap_history === 'string'
      ? JSON.parse(row.swap_history)
      : row.swap_history || [],
    status: row.status,
    error_message: row.error_message,
    error_at: row.error_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    next_swap_at: row.next_swap_at,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

/**
 * 辅助函数：获取Offer信息
 */
export async function getOfferById(offerId: number): Promise<any | null> {
  const db = await getDatabase()
  const isDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = FALSE OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  return db.queryOne(`
    SELECT * FROM offers
    WHERE id = ? AND ${isDeletedCondition}
  `, [offerId])
}

/**
 * 辅助函数：根据Offer ID获取关联的Campaign
 */
export async function getCampaignByOfferId(
  offerId: number,
  userId?: number
): Promise<{ customer_id: string | null; campaign_id: string | null } | null> {
  const db = await getDatabase()
  const isDeletedCondition = db.type === 'postgres' ? 'c.is_deleted = FALSE' : 'c.is_deleted = 0'

  const params: any[] = [offerId]
  let userCondition = ''
  if (userId && userId > 0) {
    userCondition = 'AND c.user_id = ?'
    params.push(userId)
  }

  const row = await db.queryOne<any>(`
    SELECT
      gaa.customer_id as customer_id,
      COALESCE(NULLIF(c.google_campaign_id, ''), NULLIF(c.campaign_id, '')) as campaign_id
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id = ?
      ${userCondition}
      AND ${isDeletedCondition}
      AND c.status != 'REMOVED'
      AND (
        (c.google_campaign_id IS NOT NULL AND c.google_campaign_id != '')
        OR (c.campaign_id IS NOT NULL AND c.campaign_id != '')
      )
    ORDER BY c.created_at DESC
    LIMIT 1
  `, params)

  if (!row) return null
  return {
    customer_id: row.customer_id || null,
    campaign_id: row.campaign_id || null,
  }
}
