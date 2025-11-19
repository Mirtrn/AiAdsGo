import Database from 'better-sqlite3'
import bcrypt from 'bcrypt'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🔧 创建管理员用户...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)

async function createAdminUser() {
  try {
    // 检查是否已存在管理员用户
    const existingAdmin = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .get('autoads', 'admin@autoads.com')

    if (existingAdmin) {
      console.log('⚠️  管理员用户已存在，删除并重新创建...')
      db.prepare('DELETE FROM users WHERE username = ? OR email = ?')
        .run('autoads', 'admin@autoads.com')
    }

    // 生成密码哈希
    const password = '***REMOVED***'
    const passwordHash = await bcrypt.hash(password, 10)

    // 套餐过期时间（2099年12月31日）
    const packageExpiresAt = '2099-12-31T23:59:59.000Z'

    // 插入管理员用户
    const result = db.prepare(`
      INSERT INTO users (
        username,
        email,
        password_hash,
        display_name,
        role,
        package_type,
        package_expires_at,
        must_change_password,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'autoads',
      'admin@autoads.com',
      passwordHash,
      'AutoAds Administrator',
      'admin',
      'lifetime',
      packageExpiresAt,
      0, // 不需要强制修改密码
      1  // 激活状态
    )

    console.log('✅ 管理员用户创建成功！')
    console.log('')
    console.log('📋 账户信息：')
    console.log('   用户名: autoads')
    console.log('   密码: ***REMOVED***')
    console.log('   邮箱: admin@autoads.com')
    console.log('   角色: admin')
    console.log('   套餐: lifetime (终身买断制)')
    console.log('   套餐有效期: 2099-12-31 (永久有效)')
    console.log('')
    console.log('🎉 现在可以使用这个账户登录了！')

  } catch (error) {
    console.error('❌ 创建管理员用户失败:', error)
    process.exit(1)
  } finally {
    db.close()
  }
}

createAdminUser()
