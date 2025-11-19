import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth, createUser, generateUniqueUsername } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

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

  // Get total count
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }

  // Get users
  const users = db.prepare(`
    SELECT id, username, email, display_name, role, package_type, package_expires_at, is_active, last_login_at, created_at 
    FROM users 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(limit, offset)

  return NextResponse.json({
    users,
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
    const { username, email, packageType, packageExpiresAt } = body

    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 })
    }

    if (!packageExpiresAt) {
      return NextResponse.json({ error: 'Package expiry date is required' }, { status: 400 })
    }

    // Check if username already exists
    const db = getDatabase()
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existingUser) {
      return NextResponse.json({ error: '用户名已存在，请重新生成' }, { status: 400 })
    }

    // Default password: auto11@20ads
    const defaultPassword = 'auto11@20ads'

    const newUser = await createUser({
      username,
      email: email || null,
      password: defaultPassword,
      role: 'user',
      packageType: packageType || 'trial',
      packageExpiresAt: packageExpiresAt,
      mustChangePassword: 1 // Force password change
    })

    return NextResponse.json({
      success: true,
      user: newUser,
      defaultPassword // Return this so admin can share it with the user
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
