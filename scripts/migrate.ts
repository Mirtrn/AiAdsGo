#!/usr/bin/env tsx
/**
 * 统一数据库迁移脚本
 *
 * 自动检测数据库类型并执行增量迁移：
 * - 有 DATABASE_URL 环境变量 → PostgreSQL（使用 pg-migrations/）
 * - 无 DATABASE_URL 环境变量 → SQLite（使用 migrations/）
 *
 * 用法:
 *   SQLite:     npm run migrate
 *   PostgreSQL: DATABASE_URL=postgres://... npm run migrate
 *
 * 环境变量:
 *   DATABASE_URL  - PostgreSQL 连接字符串
 *   DATABASE_PATH - SQLite 数据库路径（默认: data/autoads.db）
 */

import fs from 'fs'
import path from 'path'

// 检测数据库类型
const DB_TYPE = process.env.DATABASE_URL ? 'postgres' : 'sqlite'
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const MIGRATIONS_DIR = DB_TYPE === 'postgres' ? 'pg-migrations' : 'migrations'

console.log('═'.repeat(60))
console.log('🔄 AutoAds 数据库迁移')
console.log('═'.repeat(60))
console.log(`📊 数据库类型: ${DB_TYPE.toUpperCase()}`)
console.log(`📁 迁移目录: ${MIGRATIONS_DIR}`)

if (DB_TYPE === 'sqlite') {
  console.log(`📍 数据库路径: ${DB_PATH}`)
}
console.log('')

// ============================================================================
// SQLite 迁移
// ============================================================================

async function migrateSQLite() {
  const Database = (await import('better-sqlite3')).default

  // 检查数据库是否存在
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ 数据库不存在，请先运行初始化: npm run db:init')
    process.exit(1)
  }

  const db = new Database(DB_PATH)
  db.pragma('foreign_keys = ON')
  console.log('✅ 数据库连接成功\n')

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

  /**
   * SQLite 幂等性增强：
   * - SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   * - 为避免重复执行迁移时报 `duplicate column name`，这里在执行前自动跳过已存在的ADD COLUMN语句（仅限单行语句）
   */
  const makeSqliteMigrationIdempotent = (sqlContent: string): string => {
    const lines = sqlContent.split('\n')
    const out: string[] = []

    for (const line of lines) {
      const match = line.match(/^\s*ALTER\s+TABLE\s+([^\s]+)\s+ADD\s+COLUMN\s+([^\s;]+)\b/i)
      if (!match) {
        out.push(line)
        continue
      }

      const rawTable = match[1]
      const rawColumn = match[2]

      const table = rawTable.replace(/^["'`]|["'`]$/g, '')
      const column = rawColumn.replace(/^["'`]|["'`]$/g, '')

      // 仅对简单标识符做幂等跳过，复杂/带点的名称保持原样执行
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
        out.push(line)
        continue
      }

      try {
        const tableQuoted = table.replace(/'/g, "''")
        const exists = db.prepare(
          `SELECT 1 AS ok FROM pragma_table_info('${tableQuoted}') WHERE name = ? LIMIT 1`
        ).get(column) as { ok: 1 } | undefined

        if (exists) {
          out.push(`-- [idempotent] skipped: ${line.trim()}`)
          continue
        }
      } catch {
        // 查询失败时，不做跳过，按原语句执行，让迁移流程暴露真实问题
      }

      out.push(line)
    }

    return out.join('\n')
  }

  console.log(`📋 发现 ${migrationFiles.length} 个迁移文件`)
  console.log(`✅ 已执行 ${appliedMigrations.size} 个迁移\n`)

  let executedCount = 0

  for (const file of migrationFiles) {
    const migrationName = file.replace('.sql', '')

    if (appliedMigrations.has(migrationName)) {
      console.log(`⏭️  跳过: ${file} (已执行)`)
      continue
    }

    console.log(`🔄 执行: ${file}`)

    try {
      const rawContent = fs.readFileSync(path.join(migrationsPath, file), 'utf-8')
      const sqlContent = makeSqliteMigrationIdempotent(rawContent)

      // 在事务中执行迁移
      db.transaction(() => {
        db.exec(sqlContent)
        db.prepare('INSERT INTO migration_history (migration_name) VALUES (?)').run(migrationName)
      })()

      console.log(`✅ 完成: ${file}\n`)
      executedCount++
    } catch (error: any) {
      console.error(`❌ 失败: ${file}`)
      console.error(`   错误: ${error.message}\n`)
      db.close()
      process.exit(1)
    }
  }

  db.close()
  return executedCount
}

// ============================================================================
// PostgreSQL 迁移
// ============================================================================

async function migratePostgres() {
  const postgres = (await import('postgres')).default
  const sql = postgres(process.env.DATABASE_URL!)
  console.log('✅ 数据库连接成功\n')

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

    console.log(`📋 发现 ${migrationFiles.length} 个迁移文件`)
    console.log(`✅ 已执行 ${appliedMigrations.size} 个迁移\n`)

    let executedCount = 0

    for (const file of migrationFiles) {
      const migrationName = file.replace('.pg.sql', '')

      if (appliedMigrations.has(migrationName)) {
        console.log(`⏭️  跳过: ${file} (已执行)`)
        continue
      }

      console.log(`🔄 执行: ${file}`)

      try {
        const sqlContent = fs.readFileSync(path.join(migrationsPath, file), 'utf-8')

        // 在事务中执行迁移
        await sql.begin(async tx => {
          await tx.unsafe(sqlContent)
          await tx`INSERT INTO migration_history (migration_name) VALUES (${migrationName})`
        })

        console.log(`✅ 完成: ${file}\n`)
        executedCount++
      } catch (error: any) {
        console.error(`❌ 失败: ${file}`)
        console.error(`   错误: ${error.message}\n`)
        await sql.end()
        process.exit(1)
      }
    }

    return executedCount
  } finally {
    await sql.end()
  }
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  try {
    const executedCount = DB_TYPE === 'postgres'
      ? await migratePostgres()
      : await migrateSQLite()

    console.log('═'.repeat(60))
    if (executedCount > 0) {
      console.log(`✅ 成功执行 ${executedCount} 个迁移！`)
    } else {
      console.log('✅ 数据库已是最新状态，无需迁移')
    }
    console.log('═'.repeat(60))
  } catch (error) {
    console.error('\n❌ 数据库迁移失败:', error)
    process.exit(1)
  }
}

main()
