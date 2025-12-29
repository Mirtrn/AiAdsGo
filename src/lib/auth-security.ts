/**
 * 登录安全机制 - 暴力破解保护
 *
 * 功能:
 * - 登录失败计数
 * - 账户自动锁定（5次失败，锁定15分钟）
 * - 登录尝试日志记录
 * - 锁定状态检查
 */

import { getDatabase } from './db'
import { User } from './auth'
import { logAuditEvent, AuditEventType } from './audit-logger'

// 安全配置
const MAX_FAILED_ATTEMPTS = 5 // 最大失败尝试次数
const LOCKOUT_DURATION_MINUTES = 15 // 锁定时长（分钟）

/**
 * 检查账户是否被锁定
 *
 * @throws {Error} 如果账户被锁定，抛出包含剩余时间的错误
 */
export async function checkAccountLockout(user: User): Promise<void> {
  if (user.locked_until) {
    const lockoutEnd = new Date(user.locked_until)
    const now = new Date()

    if (lockoutEnd > now) {
      const minutesRemaining = Math.ceil((lockoutEnd.getTime() - now.getTime()) / 60000)
      throw new Error(`账户已被锁定，请在${minutesRemaining}分钟后重试`)
    } else {
      // 锁定期已过期，重置失败计数
      await resetFailedAttempts(user.id)
    }
  }
}

/**
 * 记录登录失败，并在达到阈值时锁定账户
 */
export async function recordFailedLogin(userId: number, ipAddress: string = 'unknown', userAgent: string = 'unknown'): Promise<void> {
  const db = await getDatabase()
  const db_type = db.type

  // 增加失败计数
  const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime(\'now\')'
  await db.exec(`
    UPDATE users
    SET failed_login_count = failed_login_count + 1,
        last_failed_login = ${nowFunc}
    WHERE id = ?
  `, [userId])

  // 检查是否需要锁定账户
  const user = await db.queryOne('SELECT failed_login_count FROM users WHERE id = ?', [userId]) as { failed_login_count: number } | null

  if (user && user.failed_login_count >= MAX_FAILED_ATTEMPTS) {
    // 锁定账户
    const lockUntilFunc = db_type === 'postgres'
      ? `NOW() + INTERVAL '${LOCKOUT_DURATION_MINUTES} minutes'`
      : `datetime('now', '+${LOCKOUT_DURATION_MINUTES} minutes')`
    await db.exec(`
      UPDATE users
      SET locked_until = ${lockUntilFunc}
      WHERE id = ?
    `, [userId])

    console.warn(`[Security] User ${userId} locked due to ${MAX_FAILED_ATTEMPTS} failed login attempts`)

    // 记录账户锁定事件
    await logAuditEvent({
      userId,
      eventType: AuditEventType.ACCOUNT_LOCKED,
      ipAddress,
      userAgent,
      details: {
        reason: 'max_failed_attempts_exceeded',
        failed_attempts: user.failed_login_count,
        lockout_duration_minutes: LOCKOUT_DURATION_MINUTES,
      },
    })
  }
}

/**
 * 重置失败尝试计数（登录成功或锁定期过期时调用）
 */
export async function resetFailedAttempts(userId: number): Promise<void> {
  const db = await getDatabase()
  await db.exec(`
    UPDATE users
    SET failed_login_count = 0,
        locked_until = NULL,
        last_failed_login = NULL
    WHERE id = ?
  `, [userId])
}

/**
 * 记录登录尝试到audit表
 *
 * @param usernameOrEmail 用户名或邮箱
 * @param ipAddress 客户端IP地址
 * @param userAgent 客户端User-Agent
 * @param success 是否登录成功
 * @param failureReason 失败原因（可选）
 */
export async function logLoginAttempt(
  usernameOrEmail: string,
  ipAddress: string,
  userAgent: string,
  success: boolean,
  failureReason?: string
): Promise<void> {
  const db = await getDatabase()
  const db_type = db.type

  try {
    // PostgreSQL使用布尔值，SQLite使用整数
    const successValue = db_type === 'postgres' ? success : (success ? 1 : 0)
    await db.exec(`
      INSERT INTO login_attempts (username_or_email, ip_address, user_agent, success, failure_reason)
      VALUES (?, ?, ?, ?, ?)
    `, [
      usernameOrEmail,
      ipAddress,
      userAgent,
      successValue,
      failureReason || null
    ])
  } catch (error) {
    console.error('[Security] Failed to log login attempt:', error)
    // 不抛出错误，避免影响登录流程
  }
}

/**
 * 获取最近的失败登录尝试（用于分析攻击模式）
 */
export async function getRecentFailedAttempts(
  hours: number = 1,
  limit: number = 100
): Promise<Array<{
  username_or_email: string
  ip_address: string
  user_agent: string
  failure_reason: string
  attempted_at: string
}>> {
  const db = await getDatabase()
  const db_type = db.type
  const timeCondition = db_type === 'postgres'
    ? `attempted_at > NOW() - INTERVAL '${hours} hours'`
    : `attempted_at > datetime('now', '-${hours} hours')`

  return await db.query(`
    SELECT username_or_email, ip_address, user_agent, failure_reason, attempted_at
    FROM login_attempts
    WHERE success = 0
      AND ${timeCondition}
    ORDER BY attempted_at DESC
    LIMIT ?
  `, [limit]) as any[]
}

/**
 * 获取当前被锁定的账户列表（管理员功能）
 */
export async function getLockedAccounts(): Promise<Array<{
  id: number
  username: string | null
  email: string
  locked_until: string
  failed_login_count: number
}>> {
  const db = await getDatabase()
  const db_type = db.type
  const nowFunc = db_type === 'postgres' ? 'NOW()' : 'datetime(\'now\')'

  return await db.query(`
    SELECT id, username, email, locked_until, failed_login_count
    FROM users
    WHERE locked_until > ${nowFunc}
    ORDER BY locked_until DESC
  `, []) as any[]
}

/**
 * 手动解锁账户（管理员功能）
 */
export async function unlockAccount(userId: number): Promise<void> {
  const db = await getDatabase()

  await db.exec(`
    UPDATE users
    SET locked_until = NULL,
        failed_login_count = 0,
        last_failed_login = NULL
    WHERE id = ?
  `, [userId])

  console.log(`[Security] Account ${userId} manually unlocked by admin`)
}

/**
 * 获取IP的登录尝试次数（用于IP级别的速率限制检测）
 */
export async function getIpLoginAttempts(ipAddress: string, minutes: number = 5): Promise<number> {
  const db = await getDatabase()
  const db_type = db.type
  const timeCondition = db_type === 'postgres'
    ? `attempted_at > NOW() - INTERVAL '${minutes} minutes'`
    : `attempted_at > datetime('now', '-${minutes} minutes')`

  const result = await db.queryOne(`
    SELECT COUNT(*) as count
    FROM login_attempts
    WHERE ip_address = ?
      AND ${timeCondition}
  `, [ipAddress]) as { count: number } | null

  return result?.count || 0
}

/**
 * 检查是否为可疑IP（短时间内大量失败尝试）
 */
export async function isSuspiciousIp(ipAddress: string): Promise<boolean> {
  const attempts = await getIpLoginAttempts(ipAddress, 5)
  return attempts > 10 // 5分钟内超过10次尝试视为可疑
}
