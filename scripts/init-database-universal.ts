/**
 * 通用数据库初始化工具
 * 支持 PostgreSQL 和 SQLite
 *
 * 使用方法：
 * - PostgreSQL: DATABASE_URL=postgres://... tsx scripts/init-database-universal.ts
 * - SQLite: tsx scripts/init-database-universal.ts
 */

import { getDatabase } from '../src/lib/db'
import { hashPassword } from '../src/lib/crypto'
import fs from 'fs'
import path from 'path'

const DB_TYPE = process.env.DATABASE_URL ? 'postgres' : 'sqlite'

console.log(`🚀 开始初始化${DB_TYPE === 'postgres' ? 'PostgreSQL' : 'SQLite'}数据库...\n`)

async function initializeDatabase() {
  try {
    const db = getDatabase()
    console.log(`✅ 数据库类型: ${db.type}`)
    console.log(`✅ 数据库连接成功\n`)

    // 读取相应的初始化SQL文件
    const sqlFile = db.type === 'postgres'
      ? path.join(process.cwd(), 'migrations', '000_init_schema.pg.sql')
      : path.join(process.cwd(), 'migrations', '000_init_schema.sql')

    if (!fs.existsSync(sqlFile)) {
      console.error(`❌ 初始化脚本不存在: ${sqlFile}`)
      console.log('\n💡 提示: 请先创建初始化脚本:')
      console.log(`   - PostgreSQL: migrations/000_init_schema.pg.sql`)
      console.log(`   - SQLite: migrations/000_init_schema.sql`)
      process.exit(1)
    }

    console.log(`📄 读取初始化脚本: ${path.basename(sqlFile)}`)
    const sqlContent = fs.readFileSync(sqlFile, 'utf-8')

    // 根据数据库类型执行SQL
    if (db.type === 'postgres') {
      await executePostgresInit(db, sqlContent)
    } else {
      await executeSQLiteInit(db, sqlContent)
    }

    // 创建管理员账号
    await createAdminUser(db)

    // 显示统计信息
    await showStatistics(db)

    console.log('\n✅ 数据库初始化完成！\n')

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error)
    process.exit(1)
  } finally {
    const db = getDatabase()
    await db.close()
  }
}

async function executePostgresInit(db: any, sqlContent: string) {
  console.log('\n📋 执行PostgreSQL初始化脚本...\n')

  // PostgreSQL可以直接执行整个SQL文件（因为支持事务）
  const sql = (db as any).getRawConnection()
  await sql.begin(async (tx: any) => {
    await tx.unsafe(sqlContent)
  })

  console.log('✅ PostgreSQL Schema初始化完成')
}

async function executeSQLiteInit(db: any, sqlContent: string) {
  console.log('\n📋 执行SQLite初始化脚本...\n')

  // SQLite需要分割SQL语句单独执行
  const rawDb = (db as any).getRawDatabase()

  // 分割SQL语句（按分号+换行符）
  const statements = sqlContent
    .split(/;\s*\n/)
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

  console.log(`📊 共 ${statements.length} 条SQL语句\n`)

  // 使用事务执行
  const transaction = rawDb.transaction(() => {
    for (const stmt of statements) {
      try {
        if (stmt.toUpperCase().startsWith('CREATE TABLE')) {
          const tableName = stmt.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i)?.[1]
          rawDb.exec(stmt)
          console.log(`✅ ${tableName}表`)
        } else if (stmt.toUpperCase().startsWith('CREATE INDEX')) {
          const indexName = stmt.match(/CREATE INDEX (?:IF NOT EXISTS )?(\w+)/i)?.[1]
          rawDb.exec(stmt)
          console.log(`✅ 索引: ${indexName}`)
        } else if (stmt.toUpperCase().startsWith('INSERT INTO')) {
          rawDb.exec(stmt)
        } else {
          rawDb.exec(stmt)
        }
      } catch (error: any) {
        if (!error.message.includes('already exists')) {
          console.error(`⚠️  执行失败: ${stmt.substring(0, 50)}...`)
          console.error(`   错误: ${error.message}`)
        }
      }
    }
  })

  transaction()
  console.log('\n✅ SQLite Schema初始化完成')
}

async function createAdminUser(db: any) {
  console.log('\n👤 创建默认管理员账号...')

  // 检查是否已存在管理员
  const existingAdmin = await db.queryOne(
    "SELECT id FROM users WHERE username = $1 OR role = $2",
    ['autoads', 'admin']
  )

  // 生成密码
  const crypto = require('crypto')
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64')
  const passwordHash = await hashPassword(defaultPassword)

  if (existingAdmin) {
    console.log('⚠️  管理员账号已存在，更新密码...')
    await db.exec(
      `UPDATE users
       SET password_hash = $1, is_active = $2, must_change_password = $3
       WHERE username = $4 OR role = $5`,
      [passwordHash, true, false, 'autoads', 'admin']
    )
    console.log('✅ 管理员密码已更新')
  } else {
    // 插入新管理员
    const expiresAt = db.type === 'postgres'
      ? '2099-12-31 23:59:59'
      : '2099-12-31T23:59:59.000Z'

    await db.exec(
      `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'autoads',
        'admin@autoads.com',
        passwordHash,
        'AutoAds Administrator',
        'admin',
        'lifetime',
        expiresAt,
        false,
        true
      ]
    )

    console.log('✅ 默认管理员账号创建成功')
    console.log('\n🔑 管理员登录信息:')
    console.log('   用户名: autoads')
    console.log('   密码:', defaultPassword)
    console.log('   邮箱: admin@autoads.com')
    console.log('\n⚠️  重要提示:')
    console.log('   1. 请将密码保存到密码管理器')
    console.log('   2. 生产环境请使用 DEFAULT_ADMIN_PASSWORD 环境变量设置强密码')
    console.log('   3. 首次登录后建议修改密码')
  }
}

async function showStatistics(db: any) {
  console.log('\n📊 统计信息:')

  try {
    if (db.type === 'postgres') {
      const tableCount = await db.queryOne(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
      )
      const indexCount = await db.queryOne(
        "SELECT COUNT(*) as count FROM pg_indexes WHERE schemaname = 'public'"
      )
      const settingsCount = await db.queryOne(
        "SELECT COUNT(*) as count FROM system_settings"
      )

      console.log(`   - 数据表数量: ${tableCount.count}`)
      console.log(`   - 索引数量: ${indexCount.count}`)
      console.log(`   - 默认配置项: ${settingsCount.count}`)
    } else {
      const tableCount = await db.queryOne(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
      )
      const indexCount = await db.queryOne(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='index'"
      )
      const settingsCount = await db.queryOne(
        "SELECT COUNT(*) as count FROM system_settings"
      )

      console.log(`   - 数据表数量: ${tableCount.count}`)
      console.log(`   - 索引数量: ${indexCount.count}`)
      console.log(`   - 默认配置项: ${settingsCount.count}`)
    }
  } catch (error) {
    console.log('   - 统计信息获取失败（可能是首次初始化）')
  }
}

// 运行初始化
initializeDatabase()
