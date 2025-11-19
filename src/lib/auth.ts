import { NextRequest } from 'next/server'
import { getDatabase } from './db'
import { hashPassword, verifyPassword } from './crypto'
import { generateToken, JWTPayload, verifyToken } from './jwt'

export interface User {
  id: number
  username: string | null
  email: string
  password_hash: string | null
  display_name: string | null
  google_id: string | null
  profile_picture: string | null
  role: string
  package_type: string
  package_expires_at: string | null
  must_change_password: number
  is_active: number
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateUserInput {
  username?: string
  email: string
  password?: string
  displayName?: string
  googleId?: string
  profilePicture?: string
  role?: string
  packageType?: string
  packageExpiresAt?: string
  mustChangePassword?: number
}

export interface LoginResponse {
  token: string
  user: {
    id: number
    username: string | null
    email: string
    displayName: string | null
    role: string
    packageType: string
    packageExpiresAt: string | null
  }
  mustChangePassword?: boolean
}

/**
 * 通过邮箱查找用户
 */
export function findUserByEmail(email: string): User | null {
  const db = getDatabase()
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined
  return user || null
}

/**
 * 通过用户名查找用户
 */
export function findUserByUsername(username: string): User | null {
  const db = getDatabase()
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined
  return user || null
}

/**
 * 通过用户名或邮箱查找用户
 */
export function findUserByUsernameOrEmail(usernameOrEmail: string): User | null {
  const db = getDatabase()
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(usernameOrEmail, usernameOrEmail) as User | undefined
  return user || null
}

/**
 * 通过Google ID查找用户
 */
export function findUserByGoogleId(googleId: string): User | null {
  const db = getDatabase()
  const user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) as User | undefined
  return user || null
}

/**
 * 通过ID查找用户
 */
export function findUserById(id: number): User | null {
  const db = getDatabase()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
  return user || null
}

/**
 * 生成唯一的动物用户名 (8-12位)
 */
export function generateUniqueUsername(): string {
  const animals = ['panda', 'tiger', 'lion', 'eagle', 'shark', 'wolf', 'bear', 'hawk', 'fox', 'owl', 'deer', 'cat', 'dog', 'fish']
  const adjectives = ['fast', 'brave', 'wise', 'calm', 'wild', 'cool', 'kind', 'bold', 'epic', 'rare']

  let username = ''
  let isUnique = false
  const db = getDatabase()

  while (!isUnique) {
    const animal = animals[Math.floor(Math.random() * animals.length)]
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)]
    const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0')

    // 组合: adj + animal + num (e.g., wiseowl123)
    // 确保长度在 8-12 之间
    let temp = `${adjective}${animal}${num}`
    if (temp.length > 12) {
      temp = `${animal}${num}` // fallback
    }
    if (temp.length < 8) {
      temp = `${adjective}${animal}${num}9` // padding
    }

    username = temp.substring(0, 12) // truncate to max 12

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (!existing) {
      isUnique = true
    }
  }
  return username
}

/**
 * 创建新用户
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const db = getDatabase()

  // 检查邮箱是否已存在
  const existingUser = findUserByEmail(input.email)
  if (existingUser) {
    throw new Error('该邮箱已被注册')
  }

  // 如果提供了密码，进行哈希处理
  let passwordHash: string | null = null
  if (input.password) {
    passwordHash = await hashPassword(input.password)
  }

  // 如果没有提供用户名，自动生成
  const username = input.username || generateUniqueUsername()

  const result = db.prepare(`
    INSERT INTO users (
      username, email, password_hash, display_name, google_id, profile_picture, role, package_type, package_expires_at, must_change_password
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    username,
    input.email,
    passwordHash,
    input.displayName || null,
    input.googleId || null,
    input.profilePicture || null,
    input.role || 'user',
    input.packageType || 'trial',
    input.packageExpiresAt || null,
    input.mustChangePassword !== undefined ? input.mustChangePassword : 1
  )

  const user = findUserById(result.lastInsertRowid as number)
  if (!user) {
    throw new Error('用户创建失败')
  }

  return user
}

/**
 * 更新用户最后登录时间
 */
export function updateLastLogin(userId: number): void {
  const db = getDatabase()
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(userId)
}

/**
 * 用户名/邮箱密码登录
 */
export async function loginWithPassword(usernameOrEmail: string, password: string): Promise<LoginResponse> {
  const user = findUserByUsernameOrEmail(usernameOrEmail)

  if (!user) {
    throw new Error('用户不存在')
  }

  if (!user.password_hash) {
    throw new Error('该账户未设置密码')
  }

  if (!user.is_active) {
    throw new Error('账户已被禁用')
  }

  // 检查套餐有效期
  if (user.package_expires_at) {
    const expiryDate = new Date(user.package_expires_at)
    if (expiryDate < new Date()) {
      throw new Error('套餐已过期，请购买或升级套餐')
    }
  }

  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    throw new Error('密码错误')
  }

  // 更新最后登录时间
  updateLastLogin(user.id)

  // 生成JWT token
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    packageType: user.package_type,
  })

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      packageType: user.package_type,
      packageExpiresAt: user.package_expires_at
    },
    mustChangePassword: !!user.must_change_password,
  }
}

/**
 * Google OAuth登录或注册
 */
export async function loginWithGoogle(googleProfile: {
  id: string
  email: string
  name?: string
  picture?: string
}): Promise<LoginResponse> {
  let user = findUserByGoogleId(googleProfile.id)

  // 如果用户不存在，创建新用户
  if (!user) {
    // 检查邮箱是否已被其他账户使用
    const existingUser = findUserByEmail(googleProfile.email)
    if (existingUser) {
      // 绑定Google ID到现有账户
      const db = getDatabase()
      db.prepare(`
        UPDATE users
        SET google_id = ?, profile_picture = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(googleProfile.id, googleProfile.picture || null, existingUser.id)

      user = findUserById(existingUser.id)
    } else {
      // 创建新用户
      user = await createUser({
        email: googleProfile.email,
        googleId: googleProfile.id,
        displayName: googleProfile.name,
        profilePicture: googleProfile.picture,
        mustChangePassword: 0 // Google login doesn't need password change
      })
    }
  }

  if (!user) {
    throw new Error('登录失败')
  }

  if (!user.is_active) {
    throw new Error('账户已被禁用')
  }

  // 检查套餐有效期
  if (user.package_expires_at) {
    const expiryDate = new Date(user.package_expires_at)
    if (expiryDate < new Date()) {
      throw new Error('套餐已过期，请购买或升级套餐')
    }
  }

  // 更新最后登录时间
  updateLastLogin(user.id)

  // 生成JWT token
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    packageType: user.package_type,
  })

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      packageType: user.package_type,
      packageExpiresAt: user.package_expires_at
    },
    mustChangePassword: !!user.must_change_password,
  }
}

/**
 * 验证用户套餐权限
 */
export function checkPackageAccess(user: User, requiredPackage: string): boolean {
  const packageLevels = {
    trial: 0,
    annual: 1,
    lifetime: 2,
    enterprise: 3,
  }

  const userLevel = packageLevels[user.package_type as keyof typeof packageLevels] || 0
  const requiredLevel = packageLevels[requiredPackage as keyof typeof packageLevels] || 0

  // 检查套餐是否过期
  if (user.package_expires_at) {
    const expiryDate = new Date(user.package_expires_at)
    if (expiryDate < new Date()) {
      return false
    }
  }

  return userLevel >= requiredLevel
}

/**
 * 验证API请求的认证状态
 */
export interface AuthResult {
  authenticated: boolean
  user: {
    userId: number
    email: string
    role: string
    packageType: string
  } | null
  error?: string
}

export async function verifyAuth(request: NextRequest): Promise<AuthResult> {
  try {
    // 从Cookie读取token（HttpOnly Cookie方式）
    const token = request.cookies.get('auth_token')?.value

    if (!token) {
      return {
        authenticated: false,
        user: null,
        error: '未提供认证token',
      }
    }

    // 验证token
    const payload = verifyToken(token)
    if (!payload) {
      return {
        authenticated: false,
        user: null,
        error: 'Token无效或已过期',
      }
    }

    // 验证用户是否存在且激活
    const user = findUserById(payload.userId)
    if (!user) {
      return {
        authenticated: false,
        user: null,
        error: '用户不存在',
      }
    }

    if (!user.is_active) {
      return {
        authenticated: false,
        user: null,
        error: '账户已被禁用',
      }
    }

    // 检查套餐有效期
    if (user.package_expires_at) {
      const expiryDate = new Date(user.package_expires_at)
      if (expiryDate < new Date()) {
        return {
          authenticated: false,
          user: null,
          error: '套餐已过期',
        }
      }
    }

    return {
      authenticated: true,
      user: {
        userId: user.id,
        email: user.email,
        role: user.role,
        packageType: user.package_type,
      },
    }
  } catch (error: any) {
    console.error('认证验证失败:', error)
    return {
      authenticated: false,
      user: null,
      error: error.message || '认证失败',
    }
  }
}
