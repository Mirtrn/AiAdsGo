import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getSQLiteDatabase } from '@/lib/db'

/**
 * GET /api/admin/users/:id/login-history
 * 获取指定用户的登录历史记录
 */
export const GET = withAuth(
  async (request: NextRequest, user, context) => {
    try {
      const userId = parseInt(context?.params?.id || '0', 10)
      if (!userId) {
        return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
      }

      const db = getSQLiteDatabase()

      // 获取登录尝试记录（成功和失败）
      const { searchParams } = new URL(request.url)
      const limit = parseInt(searchParams.get('limit') || '50', 10)
      const offset = parseInt(searchParams.get('offset') || '0', 10)

      // 获取用户信息
      const targetUser = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userId) as { username: string; email: string } | undefined

      if (!targetUser) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 })
      }

      // 查询登录尝试记录（使用username或email匹配）
      const loginAttempts = db.prepare(`
        SELECT
          id,
          username_or_email,
          ip_address,
          user_agent,
          success,
          failure_reason,
          attempted_at
        FROM login_attempts
        WHERE username_or_email IN (?, ?)
        ORDER BY attempted_at DESC
        LIMIT ? OFFSET ?
      `).all(targetUser.username, targetUser.email || targetUser.username, limit, offset) as any[]

      // 获取总记录数
      const totalResult = db.prepare(`
        SELECT COUNT(*) as total
        FROM login_attempts
        WHERE username_or_email IN (?, ?)
      `).get(targetUser.username, targetUser.email || targetUser.username) as { total: number }

      // 获取审计日志中的登录成功记录
      const auditLogs = db.prepare(`
        SELECT
          id,
          event_type,
          ip_address,
          user_agent,
          details,
          created_at
        FROM audit_logs
        WHERE user_id = ?
          AND event_type IN ('login_success', 'login_failed', 'account_locked')
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, limit, offset) as any[]

      // 合并并排序记录
      const combinedRecords = [
        ...loginAttempts.map(record => ({
          type: 'login_attempt',
          id: record.id,
          success: record.success === 1,
          ipAddress: record.ip_address,
          userAgent: record.user_agent,
          failureReason: record.failure_reason,
          timestamp: record.attempted_at,
        })),
        ...auditLogs.map(log => ({
          type: 'audit_log',
          id: log.id,
          eventType: log.event_type,
          ipAddress: log.ip_address,
          userAgent: log.user_agent,
          details: log.details ? JSON.parse(log.details) : null,
          timestamp: log.created_at,
        }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      return NextResponse.json({
        user: {
          id: userId,
          username: targetUser.username,
          email: targetUser.email,
        },
        records: combinedRecords.slice(0, limit),
        pagination: {
          total: totalResult.total,
          limit,
          offset,
        }
      })
    } catch (error: any) {
      console.error('获取登录历史失败:', error)
      return NextResponse.json(
        { error: error.message || '获取登录历史失败' },
        { status: 500 }
      )
    }
  },
  { requireAdmin: true }
)
