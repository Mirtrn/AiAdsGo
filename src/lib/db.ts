import Database from 'better-sqlite3'
import postgres from 'postgres'
import path from 'path'

// 数据库类型枚举
export type DatabaseType = 'sqlite' | 'postgres'

// 统一的数据库接口（支持异步操作）
export interface DatabaseAdapter {
  type: DatabaseType
  query<T = any>(sql: string, params?: any[]): Promise<T[]>
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | undefined>
  exec(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number }>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void> | void
}

// SQLite 适配器
class SQLiteAdapter implements DatabaseAdapter {
  type: DatabaseType = 'sqlite'
  private db: Database.Database

  constructor(dbPath: string) {
    // 确保data目录存在
    const fs = require('fs')
    const dataDir = path.dirname(dbPath)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    this.db = new Database(dbPath, { verbose: console.log })

    // 启用外键约束
    this.db.pragma('foreign_keys = ON')

    // 性能优化配置
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('cache_size = -64000') // 64MB cache
    this.db.pragma('temp_store = MEMORY')
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return Promise.resolve(this.db.prepare(sql).all(...params) as T[])
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return Promise.resolve(this.db.prepare(sql).get(...params) as T | undefined)
  }

  async exec(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number }> {
    const stmt = this.db.prepare(sql)
    const info = stmt.run(...params)
    return Promise.resolve({
      changes: info.changes,
      lastInsertRowid: Number(info.lastInsertRowid)
    })
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const transactionFn = this.db.transaction(async () => await fn())
    return await transactionFn()
  }

  close(): void {
    this.db.close()
  }

  // 获取原始 SQLite 实例（用于兼容现有代码）
  getRawDatabase(): Database.Database {
    return this.db
  }
}

// PostgreSQL 适配器
class PostgresAdapter implements DatabaseAdapter {
  type: DatabaseType = 'postgres'
  private sql: postgres.Sql

  constructor(connectionString: string) {
    // 移除postgres.js不支持的连接参数
    const cleanedUrl = connectionString.replace(/[?&]directConnection=[^&]*/g, '')

    this.sql = postgres(cleanedUrl, {
      max: 10, // 最大连接数
      idle_timeout: 20, // 空闲超时（秒）
      connect_timeout: 10, // 连接超时（秒）
    })
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await this.sql.unsafe(sql, params)
    return result as unknown as T[]
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const result = await this.sql.unsafe(sql, params)
    return result[0] as T | undefined
  }

  async exec(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number }> {
    const result = await this.sql.unsafe(sql, params)
    return {
      changes: result.count || 0,
      lastInsertRowid: result[0]?.id
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return await this.sql.begin(async (tx) => {
      // 临时替换 sql 实例为事务实例
      const originalSql = this.sql
      this.sql = tx as any
      try {
        return await fn() as Promise<T>
      } finally {
        this.sql = originalSql
      }
    }) as Promise<T>
  }

  async close(): Promise<void> {
    await this.sql.end()
  }

  // 获取原始 postgres.js 实例
  getRawConnection(): postgres.Sql {
    return this.sql
  }
}

// 全局单例实例 - 使用 global 对象防止热重载时重置
declare global {
  var __dbAdapter: DatabaseAdapter | undefined
}

/**
 * 获取数据库适配器实例（单例模式）
 * 自动检测 DATABASE_URL（PostgreSQL）或 DATABASE_PATH（SQLite）
 *
 * 使用 global 对象存储实例，防止 Next.js 热重载时重新初始化
 */
export function getDatabase(): DatabaseAdapter {
  if (!global.__dbAdapter) {
    const databaseUrl = process.env.DATABASE_URL

    if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
      // 使用 PostgreSQL
      console.log('🐘 Initializing PostgreSQL connection...')
      global.__dbAdapter = new PostgresAdapter(databaseUrl)
    } else {
      // 使用 SQLite
      const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
      console.log('📦 Initializing SQLite connection:', dbPath)
      global.__dbAdapter = new SQLiteAdapter(dbPath)
    }
  }

  return global.__dbAdapter!
}

/**
 * 获取 SQLite 原始实例（用于兼容现有代码）
 * @deprecated 请使用 getDatabase() 获取适配器
 */
export function getSQLiteDatabase(): Database.Database {
  const db = getDatabase()
  if (db.type === 'sqlite') {
    return (db as SQLiteAdapter).getRawDatabase()
  }
  throw new Error('SQLite operations only supported when using SQLite database')
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (global.__dbAdapter) {
    global.__dbAdapter.close()
    global.__dbAdapter = undefined
  }
}

/**
 * 执行数据库事务（同步版本，仅支持 SQLite）
 * @deprecated 请使用 getDatabase().transaction() 或异步版本
 */
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase()
  if (database.type === 'sqlite') {
    const sqliteDb = (database as SQLiteAdapter).getRawDatabase()
    const transactionFn = sqliteDb.transaction(fn)
    return transactionFn(sqliteDb)
  }
  throw new Error('Synchronous transaction only supported for SQLite. Use async transaction for PostgreSQL.')
}

/**
 * 执行异步数据库事务（支持 PostgreSQL 和 SQLite）
 */
export async function asyncTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = getDatabase()
  return await db.transaction(fn)
}
