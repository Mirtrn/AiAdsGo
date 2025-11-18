import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { hashPassword } from '@/lib/crypto'
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt'

/**
 * GET /api/admin/users/[id]
 * 获取单个用户详情(仅管理员)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAdminAuth(request)
    if (authResult.error) {
      return authResult.error
    }

    const userId = parseInt(params.id)
    if (isNaN(userId)) {
      return NextResponse.json(
        { error: '无效的用户ID' },
        { status: 400 }
      )
    }

    const db = getDatabase()
    const user = db.prepare(`
      SELECT
        id, username, email, display_name, role, package_type,
        valid_from, valid_until, is_active, must_change_password,
        last_login_at, created_at, created_by
      FROM users WHERE id = ?
    `).get(userId)

    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: { user },
    })

  } catch (error) {
    console.error('获取用户详情失败:', error)
    return NextResponse.json(
      { error: '获取用户详情失败' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/admin/users/[id]
 * 更新用户信息(仅管理员)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAdminAuth(request)
    if (authResult.error) {
      return authResult.error
    }

    const userId = parseInt(params.id)
    if (isNaN(userId)) {
      return NextResponse.json(
        { error: '无效的用户ID' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const {
      displayName,
      email,
      role,
      packageType,
      validFrom,
      validUntil,
      isActive,
      resetPassword,
    } = body

    const db = getDatabase()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    // 构建更新语句
    const updates: string[] = []
    const values: any[] = []

    if (displayName !== undefined) {
      updates.push('display_name = ?')
      values.push(displayName)
    }

    if (email !== undefined) {
      updates.push('email = ?')
      values.push(email || null)
    }

    if (role !== undefined) {
      updates.push('role = ?')
      values.push(role)
    }

    if (packageType !== undefined) {
      updates.push('package_type = ?')
      values.push(packageType)
    }

    if (validFrom !== undefined) {
      updates.push('valid_from = ?')
      values.push(validFrom)
    }

    if (validUntil !== undefined) {
      updates.push('valid_until = ?')
      values.push(validUntil)
    }

    if (isActive !== undefined) {
      updates.push('is_active = ?')
      values.push(isActive ? 1 : 0)
    }

    // 重置密码
    if (resetPassword) {
      const defaultPassword = 'auto11@20ads'
      const passwordHash = await hashPassword(defaultPassword)
      updates.push('password_hash = ?')
      updates.push('must_change_password = ?')
      values.push(passwordHash, 1)
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: '没有需要更新的字段' },
        { status: 400 }
      )
    }

    // 添加updated_at
    updates.push("updated_at = datetime('now')")

    // 执行更新
    values.push(userId)
    const updateQuery = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = ?
    `
    db.prepare(updateQuery).run(...values)

    // 获取更新后的用户
    const updatedUser = db.prepare(`
      SELECT
        id, username, email, display_name, role, package_type,
        valid_from, valid_until, is_active, must_change_password,
        last_login_at, created_at, updated_at
      FROM users WHERE id = ?
    `).get(userId)

    return NextResponse.json({
      success: true,
      message: '用户更新成功',
      data: { user: updatedUser },
    })

  } catch (error: any) {
    console.error('更新用户失败:', error)

    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return NextResponse.json(
        { error: '邮箱已被其他用户使用' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: '更新用户失败' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/users/[id]
 * 删除用户(仅管理员)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAdminAuth(request)
    if (authResult.error) {
      return authResult.error
    }

    const userId = parseInt(params.id)
    if (isNaN(userId)) {
      return NextResponse.json(
        { error: '无效的用户ID' },
        { status: 400 }
      )
    }

    const db = getDatabase()

    // 检查用户是否存在
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as any
    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      )
    }

    // 防止删除管理员账号
    if (user.role === 'admin') {
      return NextResponse.json(
        { error: '不能删除管理员账号' },
        { status: 403 }
      )
    }

    // 删除用户
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)

    return NextResponse.json({
      success: true,
      message: '用户删除成功',
    })

  } catch (error) {
    console.error('删除用户失败:', error)
    return NextResponse.json(
      { error: '删除用户失败' },
      { status: 500 }
    )
  }
}

/**
 * 验证管理员权限
 */
async function verifyAdminAuth(request: NextRequest): Promise<{
  userId?: number
  error?: NextResponse
}> {
  const authHeader = request.headers.get('authorization')
  const token = extractTokenFromHeader(authHeader)

  if (!token) {
    return {
      error: NextResponse.json(
        { error: '未提供认证token' },
        { status: 401 }
      )
    }
  }

  const payload = verifyToken(token)
  if (!payload) {
    return {
      error: NextResponse.json(
        { error: 'Token无效或已过期' },
        { status: 401 }
      )
    }
  }

  if (payload.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: '需要管理员权限' },
        { status: 403 }
      )
    }
  }

  return { userId: payload.userId }
}
