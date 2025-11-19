import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-please-change-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

export interface JWTPayload {
  userId: number
  email: string
  role: string
  packageType: string
  iat?: number
  exp?: number
}

/**
 * 生成JWT Token
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions)
}

/**
 * 验证JWT Token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload
    return decoded
  } catch (error) {
    console.error('JWT验证失败:', error)
    return null
  }
}

/**
 * 从请求头中提取Token
 *
 * ⚠️ DEPRECATED for user authentication - use HttpOnly Cookie only
 * This function is ONLY for system-level operations (e.g., cron job authentication with CRON_SECRET)
 *
 * @deprecated User authentication should ONLY use HttpOnly Cookie (auth_token)
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null

  // 支持 "Bearer <token>" 格式
  const parts = authHeader.split(' ')
  if (parts.length === 2 && parts[0] === 'Bearer') {
    return parts[1]
  }

  // 直接返回token
  return authHeader
}

/**
 * 解码Token（不验证签名，仅用于读取payload）
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload
    return decoded
  } catch (error) {
    console.error('JWT解码失败:', error)
    return null
  }
}
