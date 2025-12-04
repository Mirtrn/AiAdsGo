#!/usr/bin/env tsx
/**
 * 自动数据库初始化和迁移脚本
 *
 * 在服务启动时自动执行：
 * 1. 检测数据库是否已初始化
 * 2. 如果未初始化，执行完整初始化
 * 3. 如果已初始化，执行增量迁移
 *
 * 适用场景：
 * - 生产环境首次部署
 * - 生产环境更新部署
 * - 本地开发首次启动
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// 检测数据库类型
const DB_TYPE = process.env.DATABASE_URL ? 'postgres' : 'sqlite'
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const MIGRATIONS_DIR = DB_TYPE === 'postgres' ? 'pg-migrations' : 'migrations'

console.log('═'.repeat(60))
console.log('🚀 AutoAds 自动数据库配置')
console.log('═'.repeat(60))
console.log(`📊 数据库类型: ${DB_TYPE.toUpperCase()}`)
console.log(`📁 迁移目录: ${MIGRATIONS_DIR}`)

if (DB_TYPE === 'sqlite') {
  console.log(`📍 数据库路径: ${DB_PATH}`)
}
console.log('')

// ============================================================================
// 检测数据库是否已初始化
// ============================================================================

async function isDatabaseInitialized(): Promise<boolean> {
  if (DB_TYPE === 'postgres') {
    const postgres = (await import('postgres')).default
    const sql = postgres(process.env.DATABASE_URL!)

    try {
      // 检查 users 表是否存在
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'users'
        ) as exists
      `
      await sql.end()
      return result[0]?.exists || false
    } catch (error) {
      await sql.end()
      return false
    }
  } else {
    // SQLite: 检查数据库文件是否存在且包含 users 表
    if (!fs.existsSync(DB_PATH)) {
      return false
    }

    const Database = (await import('better-sqlite3')).default
    const db = new Database(DB_PATH)

    try {
      const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM sqlite_master
        WHERE type='table' AND name='users'
      `).get() as { count: number }

      db.close()
      return result.count > 0
    } catch (error) {
      db.close()
      return false
    }
  }
}

// ============================================================================
// SQLite 初始化
// ============================================================================

async function initSQLite() {
  console.log('📋 执行 SQLite 数据库初始化...\n')

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
    throw new Error(`Schema 文件不存在: ${sqlPath}`)
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

  // 连接数据库
  const db = new Database(DB_PATH)
  db.pragma('foreign_keys = ON')

  try {
    // 执行 Schema
    db.exec(sqlContent)

    const tableStats = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number }
    console.log(`✅ 创建了 ${tableStats.count} 个表`)

    // 创建管理员账号
    await createAdminUser(db, hashPassword)
  } finally {
    db.close()
  }
}

// ============================================================================
// PostgreSQL 初始化
// ============================================================================

async function initPostgres() {
  console.log('📋 执行 PostgreSQL 数据库初始化...\n')

  const postgres = (await import('postgres')).default
  const { hashPassword } = await import('../src/lib/crypto')

  // 读取 SQL 文件
  const sqlPath = path.join(process.cwd(), 'pg-migrations', '000_init_schema.pg.sql')
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Schema 文件不存在: ${sqlPath}`)
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

  // 连接数据库
  const sql = postgres(process.env.DATABASE_URL!)

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlContent)
    })

    const [stats] = await sql`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`
    console.log(`✅ 创建了 ${stats.count} 个表`)

    // 创建管理员账号
    await createAdminUserPg(sql, hashPassword)
  } finally {
    await sql.end()
  }
}

// ============================================================================
// SQLite 迁移
// ============================================================================

async function migrateSQLite() {
  console.log('📋 执行 SQLite 增量迁移...\n')

  const Database = (await import('better-sqlite3')).default
  const db = new Database(DB_PATH)
  db.pragma('foreign_keys = ON')

  try {
    // 确保 migration_history 表存在
    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    // 获取已执行的迁移
    const appliedMigrations = new Set(
      db.prepare('SELECT migration_name FROM migration_history').all()
        .map((row: any) => row.migration_name)
    )

    // 读取迁移文件
    const migrationsPath = path.join(process.cwd(), MIGRATIONS_DIR)
    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(f => f.endsWith('.sql') && !f.endsWith('.pg.sql'))
      .filter(f => !f.includes('000_init_schema')) // 跳过初始化文件
      .sort()

    let executedCount = 0

    for (const file of migrationFiles) {
      const migrationName = file.replace('.sql', '')

      if (appliedMigrations.has(migrationName)) {
        continue
      }

      console.log(`🔄 执行迁移: ${file}`)

      const sqlContent = fs.readFileSync(path.join(migrationsPath, file), 'utf-8')

      db.transaction(() => {
        db.exec(sqlContent)
        db.prepare('INSERT INTO migration_history (migration_name) VALUES (?)').run(migrationName)
      })()

      console.log(`✅ 完成: ${file}`)
      executedCount++
    }

    return executedCount
  } finally {
    db.close()
  }
}

// ============================================================================
// PostgreSQL 迁移
// ============================================================================

async function migratePostgres() {
  console.log('📋 执行 PostgreSQL 增量迁移...\n')

  const postgres = (await import('postgres')).default
  const sql = postgres(process.env.DATABASE_URL!)

  try {
    // 确保 migration_history 表存在
    await sql`
      CREATE TABLE IF NOT EXISTS migration_history (
        id SERIAL PRIMARY KEY,
        migration_name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `

    // 获取已执行的迁移
    const appliedRows = await sql`SELECT migration_name FROM migration_history`
    const appliedMigrations = new Set(appliedRows.map(row => row.migration_name))

    // 读取迁移文件
    const migrationsPath = path.join(process.cwd(), MIGRATIONS_DIR)
    const migrationFiles = fs.readdirSync(migrationsPath)
      .filter(f => f.endsWith('.pg.sql'))
      .filter(f => !f.includes('000_init_schema')) // 跳过初始化文件
      .sort()

    let executedCount = 0

    for (const file of migrationFiles) {
      const migrationName = file.replace('.pg.sql', '')

      if (appliedMigrations.has(migrationName)) {
        continue
      }

      console.log(`🔄 执行迁移: ${file}`)

      const sqlContent = fs.readFileSync(path.join(migrationsPath, file), 'utf-8')

      await sql.begin(async tx => {
        await tx.unsafe(sqlContent)
        await tx`INSERT INTO migration_history (migration_name) VALUES (${migrationName})`
      })

      console.log(`✅ 完成: ${file}`)
      executedCount++
    }

    return executedCount
  } finally {
    await sql.end()
  }
}

// ============================================================================
// 创建管理员账号
// ============================================================================

async function createAdminUser(db: any, hashPassword: (p: string) => Promise<string>) {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE username = 'autoads' OR role = 'admin'").get()

  if (existingAdmin) {
    console.log('✅ 管理员账号已存在')
    return
  }

  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64')
  const passwordHash = await hashPassword(defaultPassword)

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

async function createAdminUserPg(sql: any, hashPassword: (p: string) => Promise<string>) {
  const [existingAdmin] = await sql`SELECT id FROM users WHERE username = 'autoads' OR role = 'admin' LIMIT 1`

  if (existingAdmin) {
    console.log('✅ 管理员账号已存在')
    return
  }

  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64')
  const passwordHash = await hashPassword(defaultPassword)

  await sql`
    INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active)
    VALUES ('autoads', 'admin@autoads.com', ${passwordHash}, 'AutoAds Administrator', 'admin', 'lifetime', '2099-12-31 23:59:59', FALSE, TRUE)
  `

  console.log('✅ 默认管理员账号创建成功')
  printAdminCredentials(defaultPassword)
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
  console.log('')
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  try {
    const isInitialized = await isDatabaseInitialized()

    if (!isInitialized) {
      console.log('🆕 数据库未初始化，执行完整初始化流程...\n')

      if (DB_TYPE === 'postgres') {
        await initPostgres()
      } else {
        await initSQLite()
      }

      console.log('✅ 数据库初始化完成！\n')
    } else {
      console.log('✅ 数据库已初始化，检查增量迁移...\n')
    }

    // 执行增量迁移
    const executedCount = DB_TYPE === 'postgres'
      ? await migratePostgres()
      : await migrateSQLite()

    console.log('═'.repeat(60))
    if (executedCount > 0) {
      console.log(`✅ 成功执行 ${executedCount} 个增量迁移`)
    } else {
      console.log('✅ 数据库已是最新状态')
    }
    console.log('═'.repeat(60))
    console.log('')
  } catch (error: any) {
    console.error('\n❌ 数据库配置失败:', error.message)
    console.error(error)
    process.exit(1)
  }
}

main()
