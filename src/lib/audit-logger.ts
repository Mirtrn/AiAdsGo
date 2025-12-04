/**
 * 安全审计日志系统
 *
 * 功能：
 * - 记录所有安全相关事件
 * - 支持事件类型分类
 * - 提供查询和分析接口
 */

import { getDatabase } from './db'

/**
 * 审计事件类型枚举
 */
export enum AuditEventType {
  // 认证相关
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED = 'login_failed',
  LOGOUT = 'logout',
  ACCOUNT_LOCKED = 'account_locked',
  ACCOUNT_UNLOCKED = 'account_unlocked',

  // 密码相关
  PASSWORD_CHANGED = 'password_changed',
  PASSWORD_RESET_REQUESTED = 'password_reset_requested',
  PASSWORD_RESET_COMPLETED = 'password_reset_completed',

  // 权限相关
  PERMISSION_CHANGED = 'permission_changed',
  ROLE_CHANGED = 'role_changed',

  // 安全相关
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  UNAUTHORIZED_ACCESS_ATTEMPT = 'unauthorized_access_attempt',

  // 账户管理
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DISABLED = 'user_disabled',
  USER_ENABLED = 'user_enabled',

  // 敏感操作
  SENSITIVE_DATA_ACCESS = 'sensitive_data_access',
  CONFIGURATION_CHANGED = 'configuration_changed',
}

/**
 * 审计日志条目接口
 */
export interface AuditLogEntry {
  userId?: number // 可选：未登录的操作（如登录失败）可能没有userId
  eventType: AuditEventType
  ipAddress: string
  userAgent: string
  details?: Record<string, any> // 额外的上下文信息
  timestamp?: Date // 可选：默认为当前时间
}

/**
 * 记录审计事件
 *
 * @param entry 审计日志条目
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  const db = await getDatabase()

  try {
    const timestamp = entry.timestamp || new Date()

    await db.exec(`
      INSERT INTO audit_logs (user_id, event_type, ip_address, user_agent, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      entry.userId || null,
      entry.eventType,
      entry.ipAddress,
      entry.userAgent,
      entry.details ? JSON.stringify(entry.details) : null,
      timestamp.toISOString()
    ])
  } catch (error) {
    console.error('[AuditLogger] Failed to log audit event:', error)
    // 不抛出错误，避免影响业务流程
  }
}

/**
 * 查询审计日志
 */
export interface QueryAuditLogsOptions {
  userId?: number
  eventType?: AuditEventType | AuditEventType[]
  ipAddress?: string
  startDate?: Date
  endDate?: Date
  limit?: number
  offset?: number
}

export interface AuditLogResult {
  id: number
  user_id: number | null
  event_type: string
  ip_address: string
  user_agent: string
  details: string | null
  created_at: string
}

/**
 * 查询审计日志（支持多条件过滤）
 */
export async function queryAuditLogs(options: QueryAuditLogsOptions = {}): Promise<AuditLogResult[]> {
  const db = await getDatabase()

  let query = 'SELECT * FROM audit_logs WHERE 1=1'
  const params: any[] = []

  if (options.userId) {
    query += ' AND user_id = ?'
    params.push(options.userId)
  }

  if (options.eventType) {
    if (Array.isArray(options.eventType)) {
      query += ` AND event_type IN (${options.eventType.map(() => '?').join(',')})`
      params.push(...options.eventType)
    } else {
      query += ' AND event_type = ?'
      params.push(options.eventType)
    }
  }

  if (options.ipAddress) {
    query += ' AND ip_address = ?'
    params.push(options.ipAddress)
  }

  if (options.startDate) {
    query += ' AND created_at >= ?'
    params.push(options.startDate.toISOString())
  }

  if (options.endDate) {
    query += ' AND created_at <= ?'
    params.push(options.endDate.toISOString())
  }

  query += ' ORDER BY created_at DESC'

  if (options.limit) {
    query += ' LIMIT ?'
    params.push(options.limit)
  }

  if (options.offset) {
    query += ' OFFSET ?'
    params.push(options.offset)
  }

  return await db.query(query, params) as AuditLogResult[]
}

/**
 * 获取最近的可疑活动（用于安全监控）
 */
export async function getRecentSuspiciousActivity(hours: number = 24, limit: number = 50): Promise<AuditLogResult[]> {
  const startDate = new Date()
  startDate.setHours(startDate.getHours() - hours)

  return await queryAuditLogs({
    eventType: [
      AuditEventType.SUSPICIOUS_ACTIVITY,
      AuditEventType.RATE_LIMIT_EXCEEDED,
      AuditEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
      AuditEventType.ACCOUNT_LOCKED,
    ],
    startDate,
    limit,
  })
}

/**
 * 获取用户的审计历史（用于用户行为分析）
 */
export async function getUserAuditHistory(userId: number, limit: number = 100): Promise<AuditLogResult[]> {
  return await queryAuditLogs({
    userId,
    limit,
  })
}

/**
 * 获取特定IP的活动历史（用于IP行为分析）
 */
export async function getIpActivityHistory(ipAddress: string, hours: number = 24): Promise<AuditLogResult[]> {
  const startDate = new Date()
  startDate.setHours(startDate.getHours() - hours)

  return await queryAuditLogs({
    ipAddress,
    startDate,
  })
}

/**
 * 统计审计事件（用于安全报表）
 */
export interface AuditEventStats {
  event_type: string
  count: number
}

/**
 * 获取事件类型统计（最近N小时）
 */
export async function getEventTypeStats(hours: number = 24): Promise<AuditEventStats[]> {
  const db = await getDatabase()

  return await db.query(`
    SELECT event_type, COUNT(*) as count
    FROM audit_logs
    WHERE created_at > datetime('now', '-${hours} hours')
    GROUP BY event_type
    ORDER BY count DESC
  `, []) as AuditEventStats[]
}

/**
 * 清理旧的审计日志（保留策略：默认保留90天）
 */
export async function cleanupOldAuditLogs(retentionDays: number = 90): Promise<number> {
  const db = await getDatabase()

  const result = await db.exec(`
    DELETE FROM audit_logs
    WHERE created_at < datetime('now', '-${retentionDays} days')
  `, [])

  const deletedCount = result.changes || 0

  if (deletedCount > 0) {
    console.log(`[AuditLogger] Cleaned up ${deletedCount} audit logs older than ${retentionDays} days`)
  }

  return deletedCount
}

/**
 * 导出审计日志（CSV格式，用于离线分析）
 */
export async function exportAuditLogsToCSV(options: QueryAuditLogsOptions = {}): Promise<string> {
  const logs = await queryAuditLogs(options)

  const headers = ['ID', 'User ID', 'Event Type', 'IP Address', 'User Agent', 'Details', 'Created At']
  const rows = logs.map(log => [
    log.id,
    log.user_id || '',
    log.event_type,
    log.ip_address,
    log.user_agent,
    log.details || '',
    log.created_at,
  ])

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')

  return csv
}
