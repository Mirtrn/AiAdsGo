/**
 * Crawlee抓取结果数据库持久化服务
 *
 * 支持SQLite和PostgreSQL
 */

import { getDatabase, type DatabaseAdapter } from './db';

/**
 * 抓取结果数据库记录接口
 */
export interface CrawleeScrapResultDB {
  id?: number;
  url: string;
  store_name: string | null;
  brand_name: string | null;
  product_count: number;
  products_json: string; // JSON字符串
  status: 'success' | 'error';
  error_type?: string | null;
  error_message?: string | null;
  crawl_duration_ms: number | null;
  user_id: number | null;
  created_at?: string;
}

/**
 * Crawlee数据库持久化类
 */
export class CrawleeDatabasePersistence {
  private db: DatabaseAdapter;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * 初始化数据库表（如果不存在）
   */
  async initializeTables(): Promise<void> {
    console.log('📦 初始化Crawlee抓取结果表...');

    if (this.db.type === 'sqlite') {
      await this.initializeSQLiteTables();
    } else {
      await this.initializePostgresTables();
    }

    console.log('✅ Crawlee抓取结果表已就绪');
  }

  /**
   * 初始化SQLite表
   */
  private async initializeSQLiteTables(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS crawlee_scrape_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        store_name TEXT,
        brand_name TEXT,
        product_count INTEGER DEFAULT 0,
        products_json TEXT,
        status TEXT NOT NULL CHECK(status IN ('success', 'error')),
        error_type TEXT,
        error_message TEXT,
        crawl_duration_ms INTEGER,
        user_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;

    await this.db.exec(createTableSQL);

    // 创建索引
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_url ON crawlee_scrape_results(url)'
    );
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_status ON crawlee_scrape_results(status)'
    );
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_user_id ON crawlee_scrape_results(user_id)'
    );
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_created_at ON crawlee_scrape_results(created_at)'
    );
  }

  /**
   * 初始化PostgreSQL表
   */
  private async initializePostgresTables(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS crawlee_scrape_results (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL,
        store_name TEXT,
        brand_name TEXT,
        product_count INTEGER DEFAULT 0,
        products_json JSONB,
        status TEXT NOT NULL CHECK(status IN ('success', 'error')),
        error_type TEXT,
        error_message TEXT,
        crawl_duration_ms INTEGER,
        user_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;

    await this.db.exec(createTableSQL);

    // 创建索引
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_url ON crawlee_scrape_results(url)'
    );
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_status ON crawlee_scrape_results(status)'
    );
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_user_id ON crawlee_scrape_results(user_id)'
    );
    await this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_crawlee_results_created_at ON crawlee_scrape_results(created_at)'
    );
  }

  /**
   * 保存抓取成功结果到数据库
   */
  async saveSuccessResult(data: {
    url: string;
    storeName: string | null;
    brandName: string | null;
    products: any[];
    crawlDurationMs?: number;
    userId?: number;
  }): Promise<number> {
    const record: CrawleeScrapResultDB = {
      url: data.url,
      store_name: data.storeName,
      brand_name: data.brandName,
      product_count: data.products.length,
      products_json: JSON.stringify(data.products),
      status: 'success',
      crawl_duration_ms: data.crawlDurationMs || null,
      user_id: data.userId || null,
    };

    if (this.db.type === 'sqlite') {
      const result = await this.db.exec(
        `INSERT INTO crawlee_scrape_results
         (url, store_name, brand_name, product_count, products_json, status, crawl_duration_ms, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.url,
          record.store_name,
          record.brand_name,
          record.product_count,
          record.products_json,
          record.status,
          record.crawl_duration_ms,
          record.user_id,
        ]
      );
      return result.lastInsertRowid!;
    } else {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO crawlee_scrape_results
         (url, store_name, brand_name, product_count, products_json, status, crawl_duration_ms, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          record.url,
          record.store_name,
          record.brand_name,
          record.product_count,
          record.products_json,
          record.status,
          record.crawl_duration_ms,
          record.user_id,
        ]
      );
      return result[0].id;
    }
  }

  /**
   * 保存抓取失败结果到数据库
   */
  async saveErrorResult(data: {
    url: string;
    errorType: string;
    errorMessage: string;
    crawlDurationMs?: number;
    userId?: number;
  }): Promise<number> {
    const record: CrawleeScrapResultDB = {
      url: data.url,
      store_name: null,
      brand_name: null,
      product_count: 0,
      products_json: '[]',
      status: 'error',
      error_type: data.errorType,
      error_message: data.errorMessage,
      crawl_duration_ms: data.crawlDurationMs || null,
      user_id: data.userId || null,
    };

    if (this.db.type === 'sqlite') {
      const result = await this.db.exec(
        `INSERT INTO crawlee_scrape_results
         (url, status, error_type, error_message, crawl_duration_ms, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          record.url,
          record.status,
          record.error_type,
          record.error_message,
          record.crawl_duration_ms,
          record.user_id,
        ]
      );
      return result.lastInsertRowid!;
    } else {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO crawlee_scrape_results
         (url, status, error_type, error_message, crawl_duration_ms, user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          record.url,
          record.status,
          record.error_type,
          record.error_message,
          record.crawl_duration_ms,
          record.user_id,
        ]
      );
      return result[0].id;
    }
  }

  /**
   * 获取抓取历史记录
   */
  async getHistory(options?: {
    userId?: number;
    status?: 'success' | 'error';
    limit?: number;
    offset?: number;
  }): Promise<CrawleeScrapResultDB[]> {
    const { userId, status, limit = 100, offset = 0 } = options || {};

    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    if (userId !== undefined) {
      whereConditions.push(`user_id = ${this.db.type === 'sqlite' ? '?' : '$' + paramIndex++}`);
      params.push(userId);
    }

    if (status) {
      whereConditions.push(`status = ${this.db.type === 'sqlite' ? '?' : '$' + paramIndex++}`);
      params.push(status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const sql = `
      SELECT * FROM crawlee_scrape_results
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${this.db.type === 'sqlite' ? '?' : '$' + paramIndex++}
      OFFSET ${this.db.type === 'sqlite' ? '?' : '$' + paramIndex++}
    `;

    params.push(limit, offset);

    return this.db.query<CrawleeScrapResultDB>(sql, params);
  }

  /**
   * 获取统计信息
   */
  async getStatistics(userId?: number): Promise<{
    totalScrapes: number;
    successfulScrapes: number;
    failedScrapes: number;
    totalProducts: number;
    successRate: number;
  }> {
    let whereClause = '';
    let params: any[] = [];

    if (userId !== undefined) {
      whereClause = `WHERE user_id = ${this.db.type === 'sqlite' ? '?' : '$1'}`;
      params.push(userId);
    }

    const sql = `
      SELECT
        COUNT(*) as total_scrapes,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_scrapes,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed_scrapes,
        SUM(CASE WHEN status = 'success' THEN product_count ELSE 0 END) as total_products
      FROM crawlee_scrape_results
      ${whereClause}
    `;

    const result = await this.db.queryOne<{
      total_scrapes: number;
      successful_scrapes: number;
      failed_scrapes: number;
      total_products: number;
    }>(sql, params);

    const totalScrapes = Number(result?.total_scrapes || 0);
    const successfulScrapes = Number(result?.successful_scrapes || 0);
    const totalProducts = Number(result?.total_products || 0);

    return {
      totalScrapes,
      successfulScrapes,
      failedScrapes: totalScrapes - successfulScrapes,
      totalProducts,
      successRate: totalScrapes > 0 ? (successfulScrapes / totalScrapes) * 100 : 0,
    };
  }

  /**
   * 清理旧数据（保留最近N天）
   */
  async cleanOldData(daysToKeep: number = 30): Promise<number> {
    if (this.db.type === 'sqlite') {
      const result = await this.db.exec(
        `DELETE FROM crawlee_scrape_results
         WHERE created_at < datetime('now', '-' || ? || ' days')`,
        [daysToKeep]
      );
      return result.changes;
    } else {
      const result = await this.db.query<{ count: number }>(
        `WITH deleted AS (
           DELETE FROM crawlee_scrape_results
           WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * $1
           RETURNING *
         )
         SELECT COUNT(*) as count FROM deleted`,
        [daysToKeep]
      );
      return result[0].count;
    }
  }
}

/**
 * 快捷函数：获取持久化服务实例
 */
let persistenceInstance: CrawleeDatabasePersistence | null = null;

export function getCrawleePersistence(): CrawleeDatabasePersistence {
  if (!persistenceInstance) {
    persistenceInstance = new CrawleeDatabasePersistence();
  }
  return persistenceInstance;
}
