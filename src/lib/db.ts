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

    // 🔥 仅开发环境启用verbose日志（减少生产环境日志噪音）
    this.db = new Database(dbPath, {
      verbose: process.env.NODE_ENV === 'development' ? console.log : undefined
    })

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

  // 转换 SQLite 风格的 ? 占位符为 PostgreSQL 风格的 $1, $2...
  private convertPlaceholders(sql: string): string {
    let index = 1
    return sql.replace(/\?/g, () => `$${index++}`)
  }

  // 转换 SQLite 特有语法为 PostgreSQL 兼容语法
  private convertSqliteSyntax(sql: string): string {
    let result = sql

    // 1. 转换 date('now', '-N days') 为 PostgreSQL 兼容语法
    // 由于 date 字段在数据库中是 TEXT 类型（存储 'YYYY-MM-DD' 格式），
    // 需要将结果转换为同样的 TEXT 格式以便比较
    // 匹配: date('now', '-30 days') -> to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')
    result = result.replace(/date\s*\(\s*'now'\s*,\s*'(-?\d+)\s+days?'\s*\)/gi, (_, days) => {
      const absdays = Math.abs(parseInt(days))
      return `to_char(CURRENT_DATE - INTERVAL '${absdays} days', 'YYYY-MM-DD')`
    })

    // 2. 转换 DATE(column) 为 PostgreSQL 的 (column::date)
    // PostgreSQL 的 DATE() 函数需要 timestamp 类型，而 TEXT 类型需要先转换
    // 匹配: DATE(created_at) -> (created_at::date)
    result = result.replace(/\bDATE\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gi, (_, column) => {
      return `(${column}::date)`
    })

    // 3. 转换 datetime('now') 为 PostgreSQL 的 CURRENT_TIMESTAMP
    // 转换 datetime('now', '-N hours') 或 datetime('now', '-N minutes') 等
    // 支持单引号和双引号
    result = result.replace(/datetime\s*\(\s*["']now["']\s*,\s*["']?(-?\d+)\s+(hours?|minutes?)["']?\s*\)/gi, (_, value, unit) => {
      const numValue = parseInt(value)
      if (unit.startsWith('hour')) {
        return `CURRENT_TIMESTAMP - INTERVAL '${Math.abs(numValue)} hours'`
      } else {
        return `CURRENT_TIMESTAMP - INTERVAL '${Math.abs(numValue)} minutes'`
      }
    })
    // 简单的 datetime('now') 转换（支持单引号和双引号）
    result = result.replace(/datetime\s*\(\s*["']now["']\s*\)/gi, 'CURRENT_TIMESTAMP')

    // 4. 转换 strftime 为 PostgreSQL 的 to_char
    // 匹配: strftime('%Y-%m-%d', column) -> to_char(column, 'YYYY-MM-DD')
    result = result.replace(/strftime\s*\(\s*'%Y-%m-%d'\s*,\s*([^)]+)\)/gi, (_, column) => {
      return `to_char(${column.trim()}::timestamp, 'YYYY-MM-DD')`
    })
    result = result.replace(/strftime\s*\(\s*'%Y-%m'\s*,\s*([^)]+)\)/gi, (_, column) => {
      return `to_char(${column.trim()}::timestamp, 'YYYY-MM')`
    })

    // 5. 转换布尔字段的整数比较为布尔比较（PostgreSQL 使用 BOOLEAN，SQLite 使用 INTEGER）
    // 只对在 PostgreSQL 中是 BOOLEAN 类型的字段进行转换
    const booleanFieldsPostgres: Record<string, string[]> = {
      // 表名: [字段名列表]
      'users': ['is_active', 'must_change_password'],
      'offers': ['is_active', 'is_deleted', 'is_manager_account'],
      'ad_creatives': ['is_selected'],
      'campaigns': ['is_deleted'],
      'click_farm_tasks': ['is_deleted'],
      'google_ads_accounts': ['is_active'],
      'google_ads_api_usage': ['is_success'],
      'google_ads_credentials': ['is_active'],
      'google_ads_service_accounts': ['is_active'],
      'prompt_versions': ['is_active'],
    }

    // 转换 field = 1 -> field = true（仅对指定表的指定字段）
    for (const [tableName, fields] of Object.entries(booleanFieldsPostgres)) {
      for (const field of fields) {
        // 只转换 table.field = 1 的形式（必须有表名前缀）
        const pattern1 = new RegExp(`${tableName}\\.${field}\\s*=\\s*1\\b`, 'gi')
        result = result.replace(pattern1, `${tableName}.${field} = true`)

        // 只转换 table.field = 0 的形式（必须有表名前缀）
        const pattern0 = new RegExp(`${tableName}\\.${field}\\s*=\\s*0\\b`, 'gi')
        result = result.replace(pattern0, `${tableName}.${field} = false`)

        // 转换 CASE WHEN table.field = 1
        const patternWhen1 = new RegExp(`(WHEN\\s+${tableName}\\.${field}\\s*=\\s*)1\\b`, 'gi')
        result = result.replace(patternWhen1, `$1true`)

        // 转换 CASE WHEN table.field = 0
        const patternWhen0 = new RegExp(`(WHEN\\s+${tableName}\\.${field}\\s*=\\s*)0\\b`, 'gi')
        result = result.replace(patternWhen0, `$1false`)

        // 转换 SET table.field = 1
        const patternSet1 = new RegExp(`(SET\\s+${tableName}\\.${field}\\s*=\\s*)1\\b`, 'gi')
        result = result.replace(patternSet1, `$1true`)

        // 转换 SET table.field = 0
        const patternSet0 = new RegExp(`(SET\\s+${tableName}\\.${field}\\s*=\\s*)0\\b`, 'gi')
        result = result.replace(patternSet0, `$1false`)
      }
    }

    return result
  }

  // 转换参数中的布尔值：SQLite 使用 0/1，PostgreSQL 使用 true/false
  // 只对已知是 BOOLEAN 类型的字段进行转换
  private convertParams(params: any[], sql: string): any[] {
    // 已知的布尔字段列表（PostgreSQL 中是 BOOLEAN 类型）
    const booleanFields = new Set([
      'is_active', 'is_selected', 'is_success', 'must_change_password',
      'is_default', 'is_manager', 'is_manager_account', 'is_idle',
      'enabled', 'is_deleted', 'is_sensitive', 'is_required', 'is_active'
    ])

    // INTEGER 类型的布尔字段（不需要转换参数值）
    const integerBooleanFields = new Set([
      'is_current', 'is_suspicious', 'is_resolved',
      'success'  // login_attempts.success
    ])

    // 提取SQL中所有 field = ? 的字段名和位置
    const fieldPositions: { field: string; paramIndex: number }[] = []
    let paramIndex = 0

    // 查找SET子句中的所有 field = ? （UPDATE语句）
    const sqlUpper = sql.toUpperCase()
    const setIndex = sqlUpper.indexOf('SET')
    if (setIndex !== -1) {
      const whereIndex = sqlUpper.indexOf('WHERE', setIndex)
      const endIndex = whereIndex !== -1 ? whereIndex : sql.length
      const setClause = sql.substring(setIndex + 3, endIndex)

      const fieldMatches = setClause.matchAll(/(\w+)\s*=\s*\?/g)
      for (const match of fieldMatches) {
        const field = match[1]
        fieldPositions.push({ field, paramIndex: paramIndex++ })
      }
    }

    // 查找WHERE子句中的所有 field = ? 或 field IN (?)
    // 🔧 修复：不要只查找 WHERE 子句中的 field = ?，而是查找所有 field (=|IN) ?
    const whereMatches = sql.matchAll(/WHERE[^;]*/gi)
    for (const whereMatch of whereMatches) {
      const whereClause = whereMatch[0]
      // 匹配 field = ? 或 field IN (?)
      const fieldMatches = whereClause.matchAll(/(\w+)\s*(?:=|IN\s*\()\s*\?/gi)
      for (const match of fieldMatches) {
        const field = match[1]
        fieldPositions.push({ field, paramIndex: paramIndex++ })
      }
    }

    // 转换参数：根据字段名判断是否需要转换
    return params.map((p, index) => {
      if (p === undefined) return null

      // 查找这个参数位置对应的字段
      const fieldPosition = fieldPositions.find(fp => fp.paramIndex === index)
      const field = fieldPosition?.field

      // 如果是布尔字段且参数是 0 或 1，转换为布尔值
      // 但如果是 INTEGER 类型的布尔字段，则保持 0/1 不变
      if (field &&
          booleanFields.has(field.toLowerCase()) &&
          !integerBooleanFields.has(field.toLowerCase()) &&
          (p === 0 || p === 1)) {
        return p === 1 ? true : false
      }

      return p
    })
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    // 先转换 SQLite 特有语法，再转换占位符
    const convertedSql = this.convertSqliteSyntax(sql)
    const pgSql = this.convertPlaceholders(convertedSql)
    const cleanParams = this.convertParams(params, sql)

    // 🔥 调试日志：记录SQL转换和参数（仅在开发环境）
    if (process.env.NODE_ENV === 'development') {
      const placeholderCount = (pgSql.match(/\$[0-9]+/g) || []).length
      console.log('🔍 SQL执行:', {
        原始SQL: sql.substring(0, 150),
        转换后SQL: pgSql.substring(0, 150),
        参数数量: params.length,
        转换后参数: cleanParams,
        期望占位符: placeholderCount
      })
    }

    const result = await this.sql.unsafe(pgSql, cleanParams)
    return result as unknown as T[]
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    // 先转换 SQLite 特有语法，再转换占位符
    const convertedSql = this.convertSqliteSyntax(sql)
    const pgSql = this.convertPlaceholders(convertedSql)
    const cleanParams = this.convertParams(params, sql)

    // 🔥 调试日志：记录SQL转换和参数（仅在开发环境）
    if (process.env.NODE_ENV === 'development') {
      const placeholderCount = (pgSql.match(/\$[0-9]+/g) || []).length
      if (placeholderCount !== cleanParams.length) {
        console.error('❌ 参数数量不匹配!', {
          SQL: pgSql.substring(0, 200),
          占位符数量: placeholderCount,
          参数数量: cleanParams.length,
          参数: cleanParams
        })
      }
    }

    const result = await this.sql.unsafe(pgSql, cleanParams)
    return result[0] as T | undefined
  }

  async exec(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number }> {
    // 先转换 SQLite 特有语法，再转换占位符
    const convertedSql = this.convertSqliteSyntax(sql)
    let pgSql = this.convertPlaceholders(convertedSql)
    const cleanParams = this.convertParams(params, sql)

    // 🔥 详细调试日志
    console.log('🔍 [PostgreSQL exec] ==================')
    console.log('原始SQL:', sql)
    console.log('转换后SQL:', pgSql)
    console.log('原始参数:', params)
    console.log('清理后参数:', cleanParams)
    console.log('占位符数量:', (pgSql.match(/\$\d+/g) || []).length)
    console.log('参数数量:', cleanParams.length)

    // 🔥 PostgreSQL INSERT 语句需要 RETURNING id 才能获取插入的ID
    // 检测是否是 INSERT 语句，如果是且没有 RETURNING，自动添加
    const isInsert = /^\s*INSERT\s+INTO\s+/i.test(pgSql)
    const hasReturning = /\bRETURNING\b/i.test(pgSql)

    if (isInsert && !hasReturning) {
      // 移除末尾的分号（如果有），添加 RETURNING id
      pgSql = pgSql.replace(/;\s*$/, '') + ' RETURNING id'
      console.log('添加RETURNING后:', pgSql)
    }

    let pgResult: any
    try {
      pgResult = await this.sql.unsafe(pgSql, cleanParams)
      console.log('🔍 [PostgreSQL exec] 执行成功')
      console.log('返回结果类型:', typeof pgResult)
      console.log('是否数组:', Array.isArray(pgResult))
      console.log('返回结果:', JSON.stringify(pgResult))
    } catch (error: any) {
      console.error('❌ [PostgreSQL exec] 执行失败:', error.message)
      console.error('错误详情:', error)
      throw error
    }

    // PostgreSQL返回值处理
    // 🔧 修复(2025-12-30): postgres.js的Result对象同时继承Array和Object
    // 优先检查count属性（UPDATE/DELETE），再检查数组（INSERT RETURNING）
    let lastInsertRowid: number | undefined
    let changes = 0

    // 1. UPDATE/DELETE返回Result对象（有count属性）
    if (pgResult && typeof pgResult === 'object' && 'count' in pgResult) {
      changes = typeof pgResult.count === 'number' ? pgResult.count : 0
      lastInsertRowid = pgResult.id ?? pgResult.lastInsertRowid
    }
    // 2. INSERT ... RETURNING返回数组
    else if (Array.isArray(pgResult) && pgResult.length > 0) {
      changes = pgResult.length
      lastInsertRowid = pgResult[0]?.id
    }
    // 3. 其他情况（兜底）
    else if (pgResult && typeof pgResult === 'object') {
      changes = 1
      lastInsertRowid = pgResult.id ?? pgResult.lastInsertRowid
    }

    console.log('最终返回:', { changes, lastInsertRowid })
    console.log('🔍 [PostgreSQL exec] ==================\n')

    return { changes, lastInsertRowid: lastInsertRowid ?? undefined }
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
  const db = await getDatabase()
  return await db.transaction(fn)
}
