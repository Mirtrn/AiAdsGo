/**
 * 重置管理员密码
 */
import { getSQLiteDatabase } from '../src/lib/db'
import { hashPassword } from '../src/lib/crypto'

async function main() {
  const username = 'autoads'
  const plainPassword = 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk='

  console.log('🔐 重置密码...')
  console.log('用户名:', username)
  console.log('明文密码:', plainPassword)

  // Hash密码
  const passwordHash = await hashPassword(plainPassword)
  console.log('生成的密码哈希:', passwordHash.substring(0, 30) + '...')

  // 更新数据库
  const db = getSQLiteDatabase()
  const stmt = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
  const result = stmt.run(passwordHash, username)

  console.log('✅ 密码已重置!')
  console.log('更新行数:', result.changes)

  // 验证
  const { verifyPassword } = await import('../src/lib/crypto')
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as any

  if (user) {
    const isValid = await verifyPassword(plainPassword, user.password_hash)
    console.log('验证密码:', isValid ? '✅ 正确' : '❌ 错误')
  }
}

main()
