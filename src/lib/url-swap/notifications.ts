/**
 * URL Swap 通知系统
 * src/lib/url-swap/notifications.ts
 *
 * 功能：发送换链接任务的通知
 * - 任务状态变更通知（暂停、完成）
 * - URL变化通知
 * - 错误通知
 *
 * 🆕 新增(2025-01-03): 支持日志记录、邮件通知、Webhook通知（可扩展）
 */

import { getDatabase } from '@/lib/db'

/**
 * 通知渠道类型
 */
export type NotificationChannel = 'log' | 'email' | 'webhook'

/**
 * 通知级别
 */
export type NotificationLevel = 'info' | 'warning' | 'error'

/**
 * 通知配置接口
 */
export interface NotificationConfig {
  channels: NotificationChannel[]  // 启用的通知渠道
  email?: string                    // 邮件地址（如果启用邮件通知）
  webhookUrl?: string               // Webhook URL（如果启用Webhook通知）
}

/**
 * 获取用户的通知配置
 *
 * 🔧 当前实现：仅支持日志通知，邮件和Webhook为未来扩展预留
 */
async function getUserNotificationConfig(userId: number): Promise<NotificationConfig> {
  // 🔧 TODO: 从数据库或用户设置中读取通知配置
  // 当前默认只使用日志通知
  return {
    channels: ['log']
  }
}

/**
 * 发送通知（核心函数）
 *
 * @param userId 用户ID
 * @param level 通知级别
 * @param title 通知标题
 * @param message 通知内容
 * @param metadata 附加元数据
 */
async function sendNotification(
  userId: number,
  level: NotificationLevel,
  title: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  const config = await getUserNotificationConfig(userId)

  // 1. 日志通知（总是启用）
  if (config.channels.includes('log')) {
    const levelEmoji = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌'
    }

    const prefix = levelEmoji[level] || '📢'
    console.log(`${prefix} [URL Swap Notification] [User ${userId}] ${title}`)
    console.log(`   ${message}`)
    if (metadata) {
      console.log(`   Metadata:`, JSON.stringify(metadata, null, 2))
    }
  }

  // 2. 邮件通知（可选，未来实现）
  if (config.channels.includes('email') && config.email) {
    // 🔧 TODO: 集成邮件服务（如 Nodemailer、SendGrid）
    console.log(`📧 [Email Notification] Would send to ${config.email}: ${title}`)
  }

  // 3. Webhook通知（可选，未来实现）
  if (config.channels.includes('webhook') && config.webhookUrl) {
    try {
      // 🔧 TODO: 发送HTTP POST请求到Webhook URL
      // await fetch(config.webhookUrl, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ userId, level, title, message, metadata })
      // })
      console.log(`🔔 [Webhook Notification] Would send to ${config.webhookUrl}`)
    } catch (error: any) {
      console.error(`❌ Webhook notification failed:`, error.message)
    }
  }

  // 4. 写入通知日志到数据库（可选，用于审计和追踪）
  try {
    await saveNotificationToDatabase(userId, level, title, message, metadata)
  } catch (dbError: any) {
    console.error(`❌ Failed to save notification to database:`, dbError.message)
  }
}

/**
 * 保存通知记录到数据库
 *
 * 🔧 注意：需要创建 url_swap_notifications 表
 */
async function saveNotificationToDatabase(
  userId: number,
  level: NotificationLevel,
  title: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  // 🔧 TODO: 如果需要持久化通知记录，创建 url_swap_notifications 表
  // const db = await getDatabase()
  // await db.exec(`
  //   INSERT INTO url_swap_notifications (user_id, level, title, message, metadata, created_at)
  //   VALUES (?, ?, ?, ?, ?, datetime('now'))
  // `, [userId, level, title, message, JSON.stringify(metadata || {})])
}

/**
 * 获取任务信息（用于生成通知内容）
 */
async function getTaskInfo(taskId: string): Promise<{
  userId: number
  offerId: number
  googleCampaignId: string | null
  currentFinalUrl: string | null
} | null> {
  const db = await getDatabase()
  const task = await db.queryOne<{
    user_id: number
    offer_id: number
    google_campaign_id: string | null
    current_final_url: string | null
  }>(`
    SELECT user_id, offer_id, google_campaign_id, current_final_url
    FROM url_swap_tasks
    WHERE id = ?
  `, [taskId])

  if (!task) return null

  // 转换为 camelCase
  return {
    userId: task.user_id,
    offerId: task.offer_id,
    googleCampaignId: task.google_campaign_id,
    currentFinalUrl: task.current_final_url
  }
}

// ==================== 公开的通知函数 ====================

/**
 * 任务暂停通知
 *
 * 触发时机：
 * - 任务因错误被自动暂停
 * - 用户手动暂停任务
 * - 达到最大失败次数
 *
 * @param taskId 任务ID
 * @param reason 暂停原因
 *
 * @example
 * await notifyUrlSwapTaskPaused('task-123', '连续失败3次，已自动暂停')
 */
export async function notifyUrlSwapTaskPaused(
  taskId: string,
  reason: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'warning',
    '换链接任务已暂停',
    `任务 ${taskId.substring(0, 8)}... 已暂停\n原因: ${reason}`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId,
      reason
    }
  )
}

/**
 * 任务完成通知
 *
 * 触发时机：
 * - 任务达到 duration_days 限制自动完成
 * - 用户手动标记任务完成
 *
 * @param taskId 任务ID
 *
 * @example
 * await notifyUrlSwapTaskCompleted('task-123')
 */
export async function notifyUrlSwapTaskCompleted(
  taskId: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'info',
    '换链接任务已完成',
    `任务 ${taskId.substring(0, 8)}... 已完成\nOffer ID: ${taskInfo.offerId}`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId
    }
  )
}

/**
 * URL变化通知
 *
 * 触发时机：
 * - 检测到推广链接的 Final URL 或 Final URL Suffix 发生变化
 * - Google Ads Campaign 已成功更新
 *
 * @param taskId 任务ID
 * @param oldUrl 旧的Final URL（含Suffix）
 * @param newUrl 新的Final URL（含Suffix）
 *
 * @example
 * await notifyUrlChanged(
 *   'task-123',
 *   'https://example.com?old=param',
 *   'https://example.com?new=param'
 * )
 */
export async function notifyUrlChanged(
  taskId: string,
  oldUrl: string,
  newUrl: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'info',
    '推广链接已自动更新',
    `任务 ${taskId.substring(0, 8)}... 检测到链接变化\n` +
    `旧链接: ${oldUrl.substring(0, 60)}...\n` +
    `新链接: ${newUrl.substring(0, 60)}...`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId,
      oldUrl,
      newUrl
    }
  )
}

/**
 * 换链错误通知
 *
 * 触发时机：
 * - 推广链接解析失败
 * - Google Ads API更新失败
 * - 域名发生非预期变化
 * - 其他系统错误
 *
 * @param taskId 任务ID
 * @param errorMessage 错误信息
 *
 * @example
 * await notifySwapError('task-123', 'Google Ads API调用失败: 401 Unauthorized')
 */
export async function notifySwapError(
  taskId: string,
  errorMessage: string
): Promise<void> {
  const taskInfo = await getTaskInfo(taskId)
  if (!taskInfo) {
    console.error(`❌ Task not found: ${taskId}`)
    return
  }

  await sendNotification(
    taskInfo.userId,
    'error',
    '换链接任务出错',
    `任务 ${taskId.substring(0, 8)}... 执行失败\n错误: ${errorMessage}`,
    {
      taskId,
      offerId: taskInfo.offerId,
      googleCampaignId: taskInfo.googleCampaignId,
      errorMessage
    }
  )
}

/**
 * 批量通知多个用户（管理员功能）
 *
 * 🔧 预留接口：用于系统级通知（如维护通知、功能更新）
 */
export async function notifyMultipleUsers(
  userIds: number[],
  level: NotificationLevel,
  title: string,
  message: string
): Promise<void> {
  for (const userId of userIds) {
    await sendNotification(userId, level, title, message)
  }
}
