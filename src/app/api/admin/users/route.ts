import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { hashPassword } from '@/lib/crypto'
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt'
import { generateAnimalUsername } from '@/lib/animal-name-generator'

/**
 * GET /api/admin/users
 * 获取用户列表(仅管理员)
 */
export async function GET(request: NextRequest) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request)
    if (authResult.error) {
      return authResult.error
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '10')
    const search = searchParams.get('search') || ''
    const role = searchParams.get('role') || ''
    const packageType = searchParams.get('packageType') || ''

    const db = getDatabase()

    // 构建查询条件
    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (search) {
      whereClause += ' AND (username LIKE ? OR email LIKE ? OR display_name LIKE ?)'
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    if (role) {
      whereClause += ' AND role = ?'
      params.push(role)
    }

    if (packageType) {
      whereClause += ' AND package_type = ?'
      params.push(packageType)
    }

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`
    const countResult = db.prepare(countQuery).get(...params) as { total: number }
    const total = countResult.total

    // 查询用户列表
    const offset = (page - 1) * pageSize
    const usersQuery = `
      SELECT
        id, username, email, display_name, role, package_type,
        valid_from, valid_until, is_active, must_change_password,
        last_login_at, created_at, created_by
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
    const users = db.prepare(usersQuery).all(...params, pageSize, offset)

    return NextResponse.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    return NextResponse.json(
      { error: '获取用户列表失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/users
 * 创建新用户(仅管理员)
 */
export async function POST(request: NextRequest) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request)
    if (authResult.error) {
      return authResult.error
    }

    const body = await request.json()
    const {
      displayName,
      email,
      packageType,
      validFrom,
      validUntil,
      role = 'user',
    } = body

    // 验证必填字段
    if (!displayName || !packageType || !validFrom || !validUntil) {
      return NextResponse.json(
        { error: '显示名称、套餐类型、有效期为必填项' },
        { status: 400 }
      )
    }

    // 生成动物名用户名
    let username: string
    try {
      username = generateAnimalUsername()
    } catch (error) {
      return NextResponse.json(
        { error: '生成用户名失败，请稍后重试' },
        { status: 500 }
      )
    }

    // 生成默认密码哈希
    const defaultPassword = 'auto11@20ads'
    const passwordHash = await hashPassword(defaultPassword)

    const db = getDatabase()

    // 插入用户
    const result = db.prepare(`
      INSERT INTO users (
        username, password_hash, display_name, email, role, package_type,
        valid_from, valid_until, must_change_password, is_active, created_by,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      username,
      passwordHash,
      displayName,
      email || null,
      role,
      packageType,
      validFrom,
      validUntil,
      1, // must_change_password = 1 (新用户必须修改密码)
      1, // is_active = 1 (默认启用)
      authResult.userId
    )

    // 查询新创建的用户
    const newUser = db.prepare(`
      SELECT
        id, username, email, display_name, role, package_type,
        valid_from, valid_until, is_active, must_change_password,
        created_at
      FROM users WHERE id = ?
    `).get(result.lastInsertRowid)

    return NextResponse.json({
      success: true,
      message: '用户创建成功',
      data: {
        user: newUser,
        defaultPassword, // 返回默认密码供管理员记录
      },
    }, { status: 201 })

  } catch (error: any) {
    console.error('创建用户失败:', error)

    // 处理唯一约束冲突
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return NextResponse.json(
        { error: '用户名或邮箱已存在' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: '创建用户失败' },
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
