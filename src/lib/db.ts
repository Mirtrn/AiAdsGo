import Database from 'better-sqlite3'
import postgres from 'postgres'
import path from 'path'

// 数据库类型枚举
export type DatabaseType = 'sqlite' | 'postgres'

// 统一的数据库接口
export interface DatabaseAdapter {
  type: DatabaseType
  query<T = any>(sql: string, params?: any[]): T[]
  queryOne<T = any>(sql: string, params?: any[]): T | undefined
  exec(sql: string, params?: any[]): { changes: number; lastInsertRowid?: number }
  transaction<T>(fn: () => T): T
  close(): void
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

  query<T = any>(sql: string, params: any[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  exec(sql: string, params: any[] = []): { changes: number; lastInsertRowid?: number } {
    const stmt = this.db.prepare(sql)
    const info = stmt.run(...params)
    return {
      changes: info.changes,
      lastInsertRowid: Number(info.lastInsertRowid)
    }
  }

  transaction<T>(fn: () => T): T {
    const transactionFn = this.db.transaction(fn)
    return transactionFn()
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
    this.sql = postgres(connectionString, {
      max: 10, // 最大连接数
      idle_timeout: 20, // 空闲超时（秒）
      connect_timeout: 10, // 连接超时（秒）
    })
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await this.sql.unsafe(sql, params)
    return result as T[]
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
        return await fn()
      } finally {
        this.sql = originalSql
      }
    })
  }

  async close(): Promise<void> {
    await this.sql.end()
  }

  // 获取原始 postgres.js 实例
  getRawConnection(): postgres.Sql {
    return this.sql
  }
}

// 同步版本的 PostgreSQL 适配器（用于兼容 SQLite 接口）
class PostgresSyncAdapter implements DatabaseAdapter {
  type: DatabaseType = 'postgres'
  private adapter: PostgresAdapter

  constructor(connectionString: string) {
    this.adapter = new PostgresAdapter(connectionString)
  }

  query<T = any>(sql: string, params: any[] = []): T[] {
    // 注意：这会阻塞事件循环，仅用于兼容性
    throw new Error('Synchronous query not supported for PostgreSQL. Use async version.')
  }

  queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
    throw new Error('Synchronous queryOne not supported for PostgreSQL. Use async version.')
  }

  exec(sql: string, params: any[] = []): { changes: number; lastInsertRowid?: number } {
    throw new Error('Synchronous exec not supported for PostgreSQL. Use async version.')
  }

  transaction<T>(fn: () => T): T {
    throw new Error('Synchronous transaction not supported for PostgreSQL. Use async version.')
  }

  close(): void {
    // 异步关闭但不等待
    this.adapter.close().catch(console.error)
  }

  // 获取异步适配器
  getAsyncAdapter(): PostgresAdapter {
    return this.adapter
  }
}

// 全局单例实例
let dbAdapter: DatabaseAdapter | null = null

/**
 * 获取数据库适配器实例（单例模式）
 * 自动检测 DATABASE_URL（PostgreSQL）或 DATABASE_PATH（SQLite）
 */
export function getDatabase(): DatabaseAdapter {
  if (!dbAdapter) {
    const databaseUrl = process.env.DATABASE_URL

    if (databaseUrl && databaseUrl.startsWith('postgres')) {
      // 使用 PostgreSQL
      console.log('🐘 Initializing PostgreSQL connection...')
      dbAdapter = new PostgresSyncAdapter(databaseUrl)
    } else {
      // 使用 SQLite
      const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
      console.log('📦 Initializing SQLite connection:', dbPath)
      dbAdapter = new SQLiteAdapter(dbPath)
    }
  }

  return dbAdapter
}

/**
 * 获取异步数据库适配器（PostgreSQL 专用）
 */
export function getAsyncDatabase(): PostgresAdapter {
  const db = getDatabase()
  if (db.type === 'postgres') {
    return (db as PostgresSyncAdapter).getAsyncAdapter()
  }
  throw new Error('Async database operations only supported for PostgreSQL')
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
  if (dbAdapter) {
    dbAdapter.close()
    dbAdapter = null
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
  if (db.type === 'postgres') {
    const asyncDb = getAsyncDatabase()
    return await asyncDb.transaction(fn)
  } else {
    // SQLite 同步事务转异步
    return Promise.resolve(
      (db as SQLiteAdapter).transaction(() => {
        // 将同步函数转换为异步执行
        return fn() as any
      })
    )
  }
}
