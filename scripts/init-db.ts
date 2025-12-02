#!/usr/bin/env tsx
/**
 * 统一数据库初始化脚本
 *
 * 自动检测数据库类型并执行初始化：
 * - 有 DATABASE_URL 环境变量 → PostgreSQL
 * - 无 DATABASE_URL 环境变量 → SQLite
 *
 * 用法:
 *   SQLite:     npx tsx scripts/init-db.ts
 *   PostgreSQL: DATABASE_URL=postgres://... npx tsx scripts/init-db.ts
 *
 * 环境变量:
 *   DATABASE_URL         - PostgreSQL 连接字符串
 *   DATABASE_PATH        - SQLite 数据库路径（默认: data/autoads.db）
 *   DEFAULT_ADMIN_PASSWORD - 默认管理员密码（不设置则随机生成）
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// 检测数据库类型
const DB_TYPE = process.env.DATABASE_URL ? 'postgres' : 'sqlite'
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('═'.repeat(60))
console.log('🚀 AutoAds 数据库初始化')
console.log('═'.repeat(60))
console.log(`📊 数据库类型: ${DB_TYPE.toUpperCase()}`)

if (DB_TYPE === 'sqlite') {
  console.log(`📍 数据库路径: ${DB_PATH}`)
}
console.log('')

// ============================================================================
// SQLite 初始化
// ============================================================================

async function initSQLite() {
  const Database = (await import('better-sqlite3')).default
  const { hashPassword } = await import('../src/lib/crypto')

  // 确保数据目录存在
  const dataDir = path.dirname(DB_PATH)
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log('✅ 创建数据目录:', dataDir)
  }

  // 读取 SQL 文件
  const sqlPath = path.join(process.cwd(), 'migrations', '000_init_schema.sqlite.sql')
  if (!fs.existsSync(sqlPath)) {
    console.error('❌ SQLite Schema 文件不存在:', sqlPath)
    console.log('💡 请先运行: npx tsx scripts/generate-schema.ts')
    process.exit(1)
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

  // 连接数据库
  const db = new Database(DB_PATH)
  console.log('✅ 数据库连接成功')

  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 执行 SQL（直接执行整个文件）
  console.log('\n📋 执行 Schema 初始化...\n')

  try {
    // better-sqlite3 的 exec 方法可以执行多条 SQL 语句
    db.exec(sqlContent)

    // 统计结果
    const tableStats = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number }
    const indexStats = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").get() as { count: number }

    console.log(`✅ 创建了 ${tableStats.count} 个表`)
    console.log(`✅ 创建了 ${indexStats.count} 个索引`)
  } catch (error: any) {
    console.error(`\n❌ Schema 执行失败: ${error.message}`)
    throw error
  }

  // 创建管理员账号
  await createAdminUser(db, hashPassword)

  // 显示统计
  const stats = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get() as { count: number }
  console.log(`\n📊 数据库统计: ${stats.count} 个表`)

  db.close()
}

// ============================================================================
// PostgreSQL 初始化
// ============================================================================

async function initPostgres() {
  const postgres = (await import('postgres')).default
  const { hashPassword } = await import('../src/lib/crypto')

  // 读取 SQL 文件
  const sqlPath = path.join(process.cwd(), 'migrations', '000_init_schema.pg.sql')
  if (!fs.existsSync(sqlPath)) {
    console.error('❌ PostgreSQL Schema 文件不存在:', sqlPath)
    console.log('💡 请先运行: npx tsx scripts/generate-schema.ts')
    process.exit(1)
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

  // 连接数据库
  const sql = postgres(process.env.DATABASE_URL!)
  console.log('✅ 数据库连接成功')

  // 执行 SQL
  console.log('\n📋 执行 Schema 初始化...\n')

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlContent)
    })

    console.log('✅ Schema 初始化完成')

    // 创建管理员账号
    await createAdminUserPg(sql, hashPassword)

    // 显示统计
    const [stats] = await sql`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`
    console.log(`\n📊 数据库统计: ${stats.count} 个表`)
  } finally {
    await sql.end()
  }
}

// ============================================================================
// 创建管理员账号
// ============================================================================

async function createAdminUser(db: any, hashPassword: (p: string) => Promise<string>) {
  console.log('\n👤 检查管理员账号...')

  const existingAdmin = db.prepare("SELECT id FROM users WHERE username = 'autoads' OR role = 'admin'").get()

  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64')
  const passwordHash = await hashPassword(defaultPassword)

  if (existingAdmin) {
    db.prepare(`
      UPDATE users SET password_hash = ?, is_active = 1, must_change_password = 0
      WHERE username = 'autoads' OR role = 'admin'
    `).run(passwordHash)
    console.log('✅ 管理员密码已更新')
  } else {
    db.prepare(`
      INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'autoads',
      'admin@autoads.com',
      passwordHash,
      'AutoAds Administrator',
      'admin',
      'lifetime',
      '2099-12-31T23:59:59.000Z',
      0,
      1
    )

    console.log('✅ 默认管理员账号创建成功')
    printAdminCredentials(defaultPassword)
  }
}

async function createAdminUserPg(sql: any, hashPassword: (p: string) => Promise<string>) {
  console.log('\n👤 检查管理员账号...')

  const [existingAdmin] = await sql`SELECT id FROM users WHERE username = 'autoads' OR role = 'admin' LIMIT 1`

  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64')
  const passwordHash = await hashPassword(defaultPassword)

  if (existingAdmin) {
    await sql`
      UPDATE users SET password_hash = ${passwordHash}, is_active = TRUE, must_change_password = FALSE
      WHERE username = 'autoads' OR role = 'admin'
    `
    console.log('✅ 管理员密码已更新')
  } else {
    await sql`
      INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active)
      VALUES ('autoads', 'admin@autoads.com', ${passwordHash}, 'AutoAds Administrator', 'admin', 'lifetime', '2099-12-31 23:59:59', FALSE, TRUE)
    `

    console.log('✅ 默认管理员账号创建成功')
    printAdminCredentials(defaultPassword)
  }
}

function printAdminCredentials(password: string) {
  console.log('')
  console.log('┌' + '─'.repeat(50) + '┐')
  console.log('│ 🔑 管理员登录信息'.padEnd(51) + '│')
  console.log('├' + '─'.repeat(50) + '┤')
  console.log(`│   用户名: autoads`.padEnd(51) + '│')
  console.log(`│   密码: ${password}`.padEnd(51) + '│')
  console.log(`│   邮箱: admin@autoads.com`.padEnd(51) + '│')
  console.log('├' + '─'.repeat(50) + '┤')
  console.log('│ ⚠️  请妥善保存密码！'.padEnd(51) + '│')
  console.log('└' + '─'.repeat(50) + '┘')
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  try {
    if (DB_TYPE === 'postgres') {
      await initPostgres()
    } else {
      await initSQLite()
    }

    console.log('\n' + '═'.repeat(60))
    console.log('✅ 数据库初始化完成！')
    console.log('═'.repeat(60))
  } catch (error) {
    console.error('\n❌ 数据库初始化失败:', error)
    process.exit(1)
  }
}

main()
