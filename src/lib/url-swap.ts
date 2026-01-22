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
import { boolParam } from './db-helpers'
import type {
  UrlSwapTask,
  UrlSwapTaskStatus,
  UrlSwapMode,
  CreateUrlSwapTaskRequest,
  UpdateUrlSwapTaskRequest,
  SwapHistoryEntry,
  UrlSwapTaskStats,
  UrlSwapGlobalStats,
  UrlSwapTaskListItem
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

  const swapMode: UrlSwapMode = normalizeUrlSwapMode(input.swap_mode)
  const manualAffiliateLinks = swapMode === 'manual'
    ? normalizeManualAffiliateLinks(input.manual_final_url_suffixes)
    : []

  if (swapMode === 'manual' && manualAffiliateLinks.length === 0) {
    throw new Error('方式二需要至少配置 1 个推广链接')
  }

  // 1. 验证任务配置
  const intervalMinutes = input.swap_interval_minutes ?? 60
  const durationDays = input.duration_days ?? 7
  const configValidation = validateTaskConfig(intervalMinutes, durationDays)
  if (!configValidation.valid) {
    throw new Error(configValidation.error)
  }

  // 2. 获取Offer信息
  const offer = await getOfferById(input.offer_id)
  if (!offer) {
    throw new Error('Offer不存在或已被删除')
  }

  if (swapMode === 'auto') {
    if (!offer.affiliate_link) {
      throw new Error('Offer未配置联盟推广链接，无法创建换链任务')
    }
  }

  // 3. 验证代理配置（方式一/方式二均需要）
  if (swapMode === 'auto' || swapMode === 'manual') {
    const validation = await validateUrlSwapTask(input.offer_id)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  // 4. 初始化当前URL（方式一：首次解析；方式二：使用Offer已保存的final_url/final_url_suffix）
  const resolved: { finalUrl: string | null; finalUrlSuffix: string | null } = swapMode === 'auto'
    ? await resolveAffiliateLink(offer.affiliate_link, {
        targetCountry: offer.target_country,
        skipCache: true
      })
    : {
        finalUrl: offer.final_url || null,
        finalUrlSuffix: offer.final_url_suffix || null,
      }

  // 5. 获取关联的Campaign
  const campaign = await getCampaignByOfferId(input.offer_id, userId)
  const googleCustomerId = normalizeNullableString(input.google_customer_id) ?? campaign?.customer_id ?? null
  const googleCampaignId = normalizeNullableString(input.google_campaign_id) ?? campaign?.campaign_id ?? null

  if (!googleCustomerId || !googleCampaignId) {
    throw new Error('缺少 Customer ID 或 Campaign ID，无法创建换链任务（请先完成Campaign发布并关联到Offer）')
  }

  // 6. 生成任务ID
  const taskId = crypto.randomUUID().toLowerCase()

  // 7. 计算首次执行时间
  const nextSwapAt = calculateNextSwapAt(intervalMinutes)

  // 手动模式：suffix列表延续旧逻辑，推广链接列表从头开始轮询
  let manualSuffixCursor = 0
  if (swapMode === 'manual' && manualAffiliateLinks.length > 0 && !hasHttpUrl(manualAffiliateLinks)) {
    const currentSuffix = (resolved.finalUrlSuffix || '').trim()
    if (currentSuffix) {
      const idx = manualAffiliateLinks.findIndex(s => s === currentSuffix)
      if (idx >= 0) manualSuffixCursor = (idx + 1) % manualAffiliateLinks.length
    }
  }

  // 8. 创建任务
  await db.exec(`
    INSERT INTO url_swap_tasks (
      id, user_id, offer_id,
      swap_interval_minutes, enabled, duration_days,
      swap_mode, manual_final_url_suffixes, manual_suffix_cursor,
      google_customer_id, google_campaign_id,
      current_final_url, current_final_url_suffix,
      progress, total_swaps, success_swaps, failed_swaps, url_changed_count,
      swap_history,
      status, started_at, next_swap_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    taskId,
    userId,
    input.offer_id,
    intervalMinutes,
    true,  // enabled
    durationDays,
    swapMode,
    JSON.stringify(manualAffiliateLinks),
    manualSuffixCursor,
    googleCustomerId,
    googleCampaignId,
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

  const isDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = FALSE OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const task = await db.queryOne<any>(`
    SELECT * FROM url_swap_tasks
    WHERE offer_id = ? AND user_id = ? AND ${isDeletedCondition}
    ORDER BY created_at DESC
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
): Promise<{ tasks: UrlSwapTaskListItem[]; total: number }> {
  const db = await getDatabase()
  const page = options.page || 1
  const limit = options.limit || 20
  const offset = (page - 1) * limit

  const isDeletedCondition = db.type === 'postgres' ? 'ust.is_deleted = FALSE' : 'ust.is_deleted = 0'
  let whereClause = `ust.user_id = ? AND ${isDeletedCondition}`
  const params: any[] = [userId]

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

  // 获取任务列表
  const tasks = await db.query<any>(`
    SELECT ust.*, o.offer_name
    FROM url_swap_tasks ust
    LEFT JOIN offers o ON ust.offer_id = o.id
    WHERE ${whereClause}
    ORDER BY ust.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset])

  return {
    tasks: tasks.map(row => {
      const task = parseUrlSwapTask(row) as UrlSwapTaskListItem
      if (row?.offer_name) task.offer_name = row.offer_name
      return task
    }),
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

  const existingTask = await getUrlSwapTaskById(id, userId)
  if (!existingTask) {
    throw new Error('任务不存在')
  }

  const normalizedGoogleCustomerId = updates.google_customer_id === ''
    ? null
    : updates.google_customer_id
  const normalizedGoogleCampaignId = updates.google_campaign_id === ''
    ? null
    : updates.google_campaign_id

  const swapModeAfter: UrlSwapMode = updates.swap_mode !== undefined
    ? normalizeUrlSwapMode(updates.swap_mode)
    : existingTask.swap_mode

  const manualAffiliateLinksAfter = updates.manual_final_url_suffixes !== undefined
    ? normalizeManualAffiliateLinks(updates.manual_final_url_suffixes)
    : existingTask.manual_final_url_suffixes

  if (swapModeAfter === 'manual' && manualAffiliateLinksAfter.length === 0) {
    throw new Error('方式二需要至少配置 1 个推广链接')
  }

  // 验证更新字段（用“更新后”的配置进行验证，避免仅更新单字段时误用默认值）
  if (updates.swap_interval_minutes !== undefined || updates.duration_days !== undefined) {
    const interval = updates.swap_interval_minutes ?? existingTask.swap_interval_minutes
    const duration = updates.duration_days ?? existingTask.duration_days
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

  if (updates.google_customer_id !== undefined) {
    fields.push('google_customer_id = ?')
    values.push(normalizedGoogleCustomerId)
  }

  if (updates.google_campaign_id !== undefined) {
    fields.push('google_campaign_id = ?')
    values.push(normalizedGoogleCampaignId)
  }

  if (updates.swap_mode !== undefined) {
    fields.push('swap_mode = ?')
    values.push(swapModeAfter)
  }

  if (updates.manual_final_url_suffixes !== undefined) {
    fields.push('manual_final_url_suffixes = ?')
    values.push(JSON.stringify(manualAffiliateLinksAfter))
  }

  // 手动模式：当切换模式或更新列表时，重算游标（suffix列表沿用旧逻辑，推广链接列表从头开始）
  if (
    swapModeAfter === 'manual' &&
    (updates.swap_mode !== undefined || updates.manual_final_url_suffixes !== undefined)
  ) {
    let nextCursor = 0
    if (!hasHttpUrl(manualAffiliateLinksAfter)) {
      const currentSuffix = (existingTask.current_final_url_suffix || '').trim()
      const idx = manualAffiliateLinksAfter.findIndex(s => s === currentSuffix)
      nextCursor = idx >= 0 ? (idx + 1) % manualAffiliateLinksAfter.length : 0
    }
    fields.push('manual_suffix_cursor = ?')
    values.push(nextCursor)
  }

  // 从 error 状态编辑更新，视为用户已干预：清理错误并恢复为 enabled
  // （disabled/completed 不自动恢复，仍需用户显式启用）
  const intervalAfterUpdate = updates.swap_interval_minutes ?? existingTask.swap_interval_minutes
  if (existingTask.status === 'error') {
    fields.push('status = ?')
    values.push('enabled')
    fields.push('consecutive_failures = ?')
    values.push(0)
    fields.push('error_message = NULL')
    fields.push('error_at = NULL')
    fields.push('next_swap_at = ?')
    values.push(calculateNextSwapAt(intervalAfterUpdate).toISOString())
  } else if (existingTask.status === 'enabled' && updates.swap_interval_minutes !== undefined) {
    // 已启用任务修改间隔：重新计算下一次执行时间，立即生效
    fields.push('next_swap_at = ?')
    values.push(calculateNextSwapAt(intervalAfterUpdate).toISOString())
  }

  if (fields.length === 0) {
    return existingTask
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

const URL_SWAP_ERROR_THRESHOLD = 3

/**
 * 设置任务错误状态
 *
 * @param id 任务ID
 * @param errorMessage 错误信息
 * @param errorType 错误类型（用于区分不同类型的错误）
 *
 * 连续失败策略：
 * - 任意错误：连续3个“执行周期”失败后标记为 error
 * - 单次失败：保持 enabled，等待下一个时间点继续执行
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

  const errorTypeLabel = errorType === 'link_resolution'
    ? '推广链接解析失败'
    : (errorType === 'google_ads_api' ? 'Google Ads API调用失败' : '任务执行失败')

  // 3. 确定新状态和错误信息（单次失败不进入 error，继续 enabled 等下次时间点）
  const shouldMarkError = newConsecutiveFailures >= URL_SWAP_ERROR_THRESHOLD
  const newStatus: UrlSwapTaskStatus = shouldMarkError ? 'error' : 'enabled'

  const enhancedMessage = shouldMarkError
    ? `🔴 ${errorTypeLabel}连续失败 ${newConsecutiveFailures} 次，任务已标记为错误状态。\n\n` +
      `错误详情: ${errorMessage}\n\n` +
      `建议操作：\n` +
      `${errorType === 'link_resolution'
        ? `1. 检查推广链接是否有效\n2. 检查代理可用性/Playwright资源是否足够`
        : (errorType === 'google_ads_api'
          ? `1. 检查Google Ads账号权限/配额\n2. 确认OAuth/服务账号配置有效`
          : `1. 查看日志定位具体失败原因`
        )
      }\n` +
      `2. 修复问题后在任务详情页重新启用任务`
    : `⚠️ ${errorTypeLabel}（连续失败 ${newConsecutiveFailures}/${URL_SWAP_ERROR_THRESHOLD}）。\n\n` +
      `错误详情: ${errorMessage}\n\n` +
      `系统将在下一个执行时间点继续尝试。连续失败${URL_SWAP_ERROR_THRESHOLD}次后将标记为错误状态。`

  if (shouldMarkError) {
    console.warn(`[url-swap] ⚠️ 任务进入错误状态（连续失败${newConsecutiveFailures}次）: ${id}`)
  } else {
    console.warn(`[url-swap] ⚠️ 任务失败但保持启用（连续失败${newConsecutiveFailures}/${URL_SWAP_ERROR_THRESHOLD}）: ${id}`)
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

  const isDeletedCondition = db.type === 'postgres'
    ? '(ust.is_deleted = FALSE OR ust.is_deleted IS NULL)'
    : '(ust.is_deleted = 0 OR ust.is_deleted IS NULL)'
  const nowCondition = db.type === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"

  // 🔒 用户禁用/过期后不再调度其任务（避免继续入队）
  const rows = await db.query<any>(`
    SELECT
      ust.*,
      u.package_expires_at as user_package_expires_at
    FROM url_swap_tasks ust
    INNER JOIN users u ON u.id = ust.user_id
    WHERE ust.status = 'enabled'
      AND ust.next_swap_at <= ${nowCondition}
      AND ust.started_at <= ${nowCondition}
      AND ${isDeletedCondition}
      AND u.is_active = ?
    ORDER BY ust.next_swap_at ASC
  `, [boolParam(true, db.type)])

  const now = Date.now()
  const tasks = rows.filter((row: any) => {
    const expiresAt = row.user_package_expires_at as string | null | undefined
    if (!expiresAt) return true
    const expiry = new Date(expiresAt)
    if (!Number.isFinite(expiry.getTime())) return false
    return expiry.getTime() >= now
  })

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
  newFinalUrl: string | null,
  newFinalUrlSuffix: string,
  options?: {
    manualSuffixCursor?: number
  }
): Promise<void> {
  const db = await getDatabase()
  const task = await getUrlSwapTaskById(taskId, 0)
  if (!task) return

  const now = new Date().toISOString()
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)

  const extraFields: string[] = []
  const extraValues: any[] = []
  if (options?.manualSuffixCursor !== undefined) {
    extraFields.push('manual_suffix_cursor = ?')
    extraValues.push(options.manualSuffixCursor)
  }

  await db.exec(`
    UPDATE url_swap_tasks
    SET current_final_url = COALESCE(?, current_final_url),
        current_final_url_suffix = ?,
        total_swaps = total_swaps + 1,
        success_swaps = success_swaps + 1,
        url_changed_count = url_changed_count + 1,
        consecutive_failures = 0,
        error_message = NULL,
        error_at = NULL,
        ${extraFields.length > 0 ? `${extraFields.join(', ')},` : ''}
        next_swap_at = ?,
        updated_at = ?
    WHERE id = ?
  `, [newFinalUrl, newFinalUrlSuffix, ...extraValues, nextSwapAt.toISOString(), now, taskId])

  console.log(`[url-swap] 换链成功更新: ${taskId}`)
}

/**
 * 手动模式：执行成功但suffix未变化（仍需前进游标）
 */
export async function updateTaskAfterManualAdvance(
  taskId: string,
  nextCursor: number
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  await db.exec(`
    UPDATE url_swap_tasks
    SET total_swaps = total_swaps + 1,
        success_swaps = success_swaps + 1,
        consecutive_failures = 0,
        error_message = NULL,
        error_at = NULL,
        manual_suffix_cursor = ?,
        updated_at = ?
    WHERE id = ?
  `, [nextCursor, now, taskId])
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
): Promise<{ tasks: (UrlSwapTask & { username?: string; offer_name?: string })[]; total: number }> {
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
    SELECT ust.*, u.username, o.offer_name
    FROM url_swap_tasks ust
    LEFT JOIN users u ON ust.user_id = u.id
    LEFT JOIN offers o ON ust.offer_id = o.id
    WHERE ${whereClause}
    ORDER BY ust.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset])

  return {
    tasks: tasks.map(t => ({
      ...parseUrlSwapTask(t),
      username: t.username,
      offer_name: t.offer_name
    })),
    total
  }
}

/**
 * 解析数据库记录为任务对象
 */
function calculateUrlSwapProgress(row: any): number {
  const status = String(row?.status || '')
  if (status === 'completed') return 100

  const durationDaysRaw = row?.duration_days
  const durationDays = typeof durationDaysRaw === 'number' ? durationDaysRaw : parseInt(String(durationDaysRaw ?? ''), 10)
  if (!Number.isFinite(durationDays) || durationDays <= 0) return 0
  if (durationDays === -1) return 0

  const startedAtRaw = row?.started_at
  if (!startedAtRaw) return 0
  const startedAtMs = new Date(startedAtRaw).getTime()
  if (!Number.isFinite(startedAtMs)) return 0

  const elapsedMs = Date.now() - startedAtMs
  const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24))
  if (elapsedDays <= 0) return 0

  return Math.min(100, Math.round((elapsedDays / durationDays) * 100))
}

function parseUrlSwapTask(row: any): UrlSwapTask {
  const swapMode = normalizeUrlSwapMode(row.swap_mode)
  const manualSuffixes = parseStringArrayJson(row.manual_final_url_suffixes)
  const manualCursorRaw = row.manual_suffix_cursor
  const manualSuffixCursor = typeof manualCursorRaw === 'number'
    ? manualCursorRaw
    : parseInt(String(manualCursorRaw ?? '0'), 10)

  return {
    id: row.id,
    user_id: row.user_id,
    offer_id: row.offer_id,
    swap_interval_minutes: row.swap_interval_minutes,
    enabled: Boolean(row.enabled),
    duration_days: row.duration_days,
    swap_mode: swapMode,
    manual_final_url_suffixes: manualSuffixes,
    manual_suffix_cursor: Number.isFinite(manualSuffixCursor) && manualSuffixCursor >= 0 ? manualSuffixCursor : 0,
    google_customer_id: row.google_customer_id,
    google_campaign_id: row.google_campaign_id,
    current_final_url: row.current_final_url,
    current_final_url_suffix: row.current_final_url_suffix,
    progress: calculateUrlSwapProgress(row),
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

function normalizeNullableString(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeUrlSwapMode(input: unknown): UrlSwapMode {
  return input === 'manual' ? 'manual' : 'auto'
}

function normalizeManualAffiliateLinks(input: unknown): string[] {
  if (!Array.isArray(input)) return []

  const out: string[] = []
  const seen = new Set<string>()

  for (const item of input) {
    if (typeof item !== 'string') continue
    let value = item.trim()
    if (!value) continue

    if (value.startsWith('?')) value = value.slice(1)
    value = value.trim()
    if (!value) continue

    const key = value
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }

  return out
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function hasHttpUrl(values: string[]): boolean {
  return values.some(isHttpUrl)
}

function parseStringArrayJson(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  }

  if (typeof input !== 'string' || !input.trim()) return []

  try {
    const parsed = JSON.parse(input)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  } catch {
    return []
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
