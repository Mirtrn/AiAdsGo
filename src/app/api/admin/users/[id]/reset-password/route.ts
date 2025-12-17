import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import bcrypt from 'bcrypt'
import { logPasswordReset, UserManagementContext } from '@/lib/audit-logger'

// 获取客户端IP地址
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }
  return 'unknown'
}

// POST: Reset user password
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = parseInt(params.id)
    const db = getDatabase()

    // Check if user exists
    const user = await db.queryOne('SELECT id, username FROM users WHERE id = ?', [userId]) as { id: number; username: string } | undefined
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Generate new random password (12 characters: letters + numbers)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let newPassword = ''
    for (let i = 0; i < 12; i++) {
      newPassword += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // Update user password and set must_change_password flag
    const result = await db.exec(`
      UPDATE users
      SET password_hash = ?, must_change_password = 1, updated_at = datetime('now')
      WHERE id = ?
    `, [hashedPassword, userId])

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
    }

    // 获取操作者的username（从数据库查询）
    const operator = await db.queryOne('SELECT username FROM users WHERE id = ?', [auth.user!.userId]) as { username: string } | undefined

    // 记录审计日志
    const auditContext: UserManagementContext = {
      operatorId: auth.user!.userId,
      operatorUsername: operator?.username || `user_${auth.user!.userId}`,
      targetUserId: userId,
      targetUsername: user.username || `user_${userId}`,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || 'Unknown',
    }
    await logPasswordReset(auditContext, 'admin_reset')

    return NextResponse.json({
      success: true,
      username: user.username,
      newPassword
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
