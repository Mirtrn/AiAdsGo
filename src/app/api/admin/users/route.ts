import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, createUser, generateUniqueUsername } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * 🔧 修复(2025-12-11): 转换数据库字段名为 camelCase
 * 规范: API响应使用 camelCase，数据库字段使用 snake_case
 */
function transformUserToApiResponse(user: any) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    packageType: user.package_type,
    packageExpiresAt: user.package_expires_at,
    isActive: user.is_active,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    lockedUntil: user.locked_until,
    failedLoginCount: user.failed_login_count
  }
}

// GET: List all users (paginated)
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const offset = (page - 1) * limit

  const db = getDatabase()

  let query = `
      SELECT
        id,
        username,
        email,
        display_name,
        role,
        package_type,
        package_expires_at,
        is_active,
        last_login_at,
        created_at,
        locked_until,
        failed_login_count
      FROM users
      WHERE 1=1
    `
  let countQuery = `SELECT COUNT(*) as count FROM users WHERE 1=1`
  const params: any[] = []

  // Search filter
  const search = searchParams.get('search')
  if (search) {
    const searchCondition = ` AND (username LIKE ? OR email LIKE ?)`
    query += searchCondition
    countQuery += searchCondition
    params.push(`%${search}%`, `%${search}%`)
  }

  // Role filter
  const role = searchParams.get('role')
  if (role && role !== 'all') {
    const roleCondition = ` AND role = ?`
    query += roleCondition
    countQuery += roleCondition
    params.push(role)
  }

  // Status filter
  const status = searchParams.get('status')
  if (status && status !== 'all') {
    const statusCondition = ` AND is_active = ?`
    query += statusCondition
    countQuery += statusCondition
    params.push(status === 'active' ? 1 : 0)
  }

  // Package type filter
  const packageType = searchParams.get('package')
  if (packageType && packageType !== 'all') {
    const packageCondition = ` AND package_type = ?`
    query += packageCondition
    countQuery += packageCondition
    params.push(packageType)
  }

  // Pagination
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`

  // Get total count
  const total = await db.queryOne(countQuery, [...params]) as { count: number }

  // Get users
  const users = await db.query(query, [...params, limit, offset])

  return NextResponse.json({
    users: users.map(transformUserToApiResponse),
    pagination: {
      total: total.count,
      page,
      limit,
      totalPages: Math.ceil(total.count / limit)
    }
  })
}

// POST: Create new user
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      username,
      displayName,
      email,
      packageType,
      packageExpiresAt,
      validUntil, // 前端可能发送此字段
      role
    } = body

    // 支持前端发送 validUntil 或 packageExpiresAt
    const expiresAt = packageExpiresAt || validUntil

    if (!expiresAt) {
      return NextResponse.json({ error: 'Package expiry date is required' }, { status: 400 })
    }

    // Default password: auto11@20ads
    const defaultPassword = 'auto11@20ads'

    // 如果提供了username，检查是否已存在
    if (username) {
      const db = getDatabase()
      const existingUser = await db.queryOne('SELECT id FROM users WHERE username = ?', [username])
      if (existingUser) {
        return NextResponse.json({ error: '用户名已存在，请重新生成' }, { status: 400 })
      }
    }

    const newUser = await createUser({
      username: username || undefined, // 让createUser自动生成
      displayName: displayName || undefined,
      email: email || undefined, // 可选字段
      password: defaultPassword,
      role: role || 'user',
      packageType: packageType || 'trial',
      packageExpiresAt: expiresAt,
      mustChangePassword: 1 // Force password change
    })

    return NextResponse.json({
      success: true,
      data: {
        user: newUser,
        defaultPassword // Return this so admin can share it with the user
      }
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
