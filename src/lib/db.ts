import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

let db: Database.Database | null = null

/**
 * 获取数据库连接实例（单例模式）
 */
export function getDatabase(): Database.Database {
  if (!db) {
    // 确保data目录存在
    const fs = require('fs')
    const dataDir = path.dirname(dbPath)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    db = new Database(dbPath, { verbose: console.log })

    // 启用外键约束
    db.pragma('foreign_keys = ON')

    // 性能优化配置
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('cache_size = -64000') // 64MB cache
    db.pragma('temp_store = MEMORY')
  }

  return db
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * 执行数据库事务
 */
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase()
  const transactionFn = database.transaction(fn)
  return transactionFn(database)
}
