#!/usr/bin/env tsx
/**
 * 重建本地 SQLite 数据库（基于初始化 schema + migrations 增量迁移）
 *
 * 使用方式：
 *   1) 默认路径：tsx scripts/rebuild-sqlite-db.ts
 *   2) 指定路径：DATABASE_PATH=/path/to/autoads.db tsx scripts/rebuild-sqlite-db.ts
 *
 * 行为：
 * - 备份现有 DB / WAL / SHM 文件（同目录 .bak-时间戳 后缀）
 * - 用 migrations/000_init_schema_v2.sql 重建基础表结构
 * - 调用应用内 initializeDatabase() 执行增量迁移（migrations/ 下除 000_ 外的 .sql）
 */

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function moveIfExists(filePath: string, suffix: string): void {
  if (!fs.existsSync(filePath)) return
  const backupPath = `${filePath}.${suffix}`
  fs.renameSync(filePath, backupPath)
  console.log(`✅ 已备份: ${filePath} -> ${backupPath}`)
}

async function main() {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
  const dataDir = path.dirname(dbPath)
  const schemaPath = path.join(process.cwd(), 'migrations', '000_init_schema_v2.sql')

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`找不到初始化文件: ${schemaPath}`)
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const suffix = `bak-${timestamp()}`
  moveIfExists(dbPath, suffix)
  moveIfExists(`${dbPath}-wal`, suffix)
  moveIfExists(`${dbPath}-shm`, suffix)

  console.log(`\n🧱 使用初始化文件创建SQLite数据库: ${dbPath}`)
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8')
  const db = new Database(dbPath)
  try {
    db.pragma('foreign_keys = ON')
    db.exec(schemaSql)
  } finally {
    db.close()
  }
  console.log('✅ 初始化 schema 执行完成')

  console.log('\n🔄 执行增量迁移（migrations/）...')
  process.env.DATABASE_PATH = dbPath
  const { initializeDatabase } = await import('../src/lib/db-init')
  await initializeDatabase()

  const { closeDatabase } = await import('../src/lib/db')
  closeDatabase()

  console.log('\n🎉 SQLite 数据库重建完成')
}

main().catch((error) => {
  console.error('❌ 重建失败:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})

