#!/usr/bin/env tsx
/**
 * 自动将SQLite迁移文件转换为PostgreSQL版本
 * 运行: npx tsx scripts/convert-migrations-to-pg.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations')

// SQLite到PostgreSQL语法转换规则
function convertSqliteToPostgres(sql: string, filename: string): string {
  let converted = sql

  // 1. datetime('now') → CURRENT_TIMESTAMP
  converted = converted.replace(/datetime\('now'\)/g, 'CURRENT_TIMESTAMP')
  converted = converted.replace(/datetime\('now', '[^']+'\)/g, 'CURRENT_TIMESTAMP')

  // 2. AUTOINCREMENT → SERIAL (但在ALTER TABLE中不需要)
  // 对于CREATE TABLE，PostgreSQL使用SERIAL
  converted = converted.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')

  // 3. TEXT NOT NULL DEFAULT (datetime('now')) → TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  converted = converted.replace(/TEXT NOT NULL DEFAULT \(datetime\('now'\)\)/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
  converted = converted.replace(/TEXT NOT NULL DEFAULT \(datetime\('now', '[^']+'\)\)/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
  converted = converted.replace(/TEXT DEFAULT \(datetime\('now'\)\)/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')

  // 4. BOOLEAN存储：SQLite用INTEGER，PostgreSQL用BOOLEAN
  converted = converted.replace(/INTEGER NOT NULL DEFAULT 1\s*--.*must_change/gi, 'BOOLEAN NOT NULL DEFAULT TRUE')
  converted = converted.replace(/INTEGER NOT NULL DEFAULT 0/g, 'BOOLEAN NOT NULL DEFAULT FALSE')

  // 5. 处理SQLite特定的WHERE username IS NOT NULL语法（PostgreSQL也支持，保留）

  // 6. 添加IF NOT EXISTS到ALTER TABLE ADD COLUMN（PostgreSQL需要DO块）
  // 这个转换比较复杂，需要将每个ALTER TABLE ADD COLUMN包装成DO块

  // 检测是否有ALTER TABLE ADD COLUMN语句
  const alterTableRegex = /ALTER TABLE (\w+) ADD COLUMN (\w+) ([^;]+);/g
  let match
  const alterStatements: { table: string; column: string; def: string }[] = []

  while ((match = alterTableRegex.exec(converted)) !== null) {
    alterStatements.push({
      table: match[1],
      column: match[2],
      def: match[3].trim()
    })
  }

  // 如果有ALTER TABLE语句，转换为PostgreSQL的DO块
  if (alterStatements.length > 0) {
    for (const stmt of alterStatements) {
      const sqliteStmt = `ALTER TABLE ${stmt.table} ADD COLUMN ${stmt.column} ${stmt.def};`
      const pgStmt = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '${stmt.table}' AND column_name = '${stmt.column}') THEN
    ALTER TABLE ${stmt.table} ADD COLUMN ${stmt.column} ${stmt.def};
    RAISE NOTICE '✅ 添加 ${stmt.column} 字段到 ${stmt.table}';
  ELSE
    RAISE NOTICE '⏭️  ${stmt.column} 字段已存在于 ${stmt.table}';
  END IF;
END $$;`
      converted = converted.replace(sqliteStmt, pgStmt)
    }
  }

  // 7. 添加迁移历史记录
  const baseName = filename.replace('.sql', '').replace('.pg.sql', '')
  if (!converted.includes('INSERT INTO migration_history')) {
    converted += `

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('${baseName}.pg')
ON CONFLICT (migration_name) DO NOTHING;
`
  }

  return converted
}

async function main() {
  console.log('🔄 开始转换迁移文件...\n')

  // 获取所有.sql文件（排除.pg.sql和.sqlite.sql）
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .filter(f => !f.endsWith('.pg.sql'))
    .filter(f => !f.endsWith('.sqlite.sql'))
    .filter(f => !f.startsWith('000_'))  // 排除初始化文件
    .sort()

  let converted = 0
  let skipped = 0

  for (const file of files) {
    const pgFile = file.replace('.sql', '.pg.sql')
    const pgPath = path.join(MIGRATIONS_DIR, pgFile)

    // 检查是否已有.pg.sql版本
    if (fs.existsSync(pgPath)) {
      console.log(`⏭️  ${file} -> ${pgFile} (已存在)`)
      skipped++
      continue
    }

    // 读取SQLite版本
    const sqlPath = path.join(MIGRATIONS_DIR, file)
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

    // 转换为PostgreSQL语法
    const pgContent = convertSqliteToPostgres(sqlContent, file)

    // 写入.pg.sql文件
    fs.writeFileSync(pgPath, pgContent)
    console.log(`✅ ${file} -> ${pgFile}`)
    converted++
  }

  console.log(`\n📊 转换完成: ${converted} 个文件, 跳过: ${skipped} 个文件`)
}

main().catch(console.error)
