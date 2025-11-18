import crypto from 'crypto'
import bcrypt from 'bcrypt'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64) // 32 bytes hex = 64 chars
const IV_LENGTH = parseInt(process.env.ENCRYPTION_IV_LENGTH || '16', 10)
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10)

/**
 * 使用AES-256-GCM加密敏感数据
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // 格式: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * 解密AES-256-GCM加密的数据
 */
export function decrypt(encryptedData: string): string | null {
  try {
    const parts = encryptedData.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format')
    }

    const [ivHex, authTagHex, encrypted] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const key = Buffer.from(ENCRYPTION_KEY, 'hex')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    console.error('解密失败:', error)
    return null
  }
}

/**
 * 使用bcrypt哈希密码
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS)
}

/**
 * 验证密码
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash)
}

/**
 * 生成随机密钥（用于初始化配置）
 */
export function generateRandomKey(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex')
}
