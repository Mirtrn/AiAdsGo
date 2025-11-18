import { getCustomer } from './google-ads-api'
import { getDatabase } from './database'
import { enums } from 'google-ads-api'

/**
 * 同步状态
 */
export interface SyncStatus {
  isRunning: boolean
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncDuration: number | null
  lastSyncRecordCount: number
  lastSyncError: string | null
}

/**
 * 同步日志
 */
export interface SyncLog {
  id: number
  user_id: number
  google_ads_account_id: number
  sync_type: 'manual' | 'auto'
  status: 'success' | 'failed' | 'running'
  record_count: number
  duration_ms: number
  error_message: string | null
  started_at: string
  completed_at: string | null
}

/**
 * GAQL查询参数
 */
export interface GAQLQueryParams {
  customerId: string
  refreshToken: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}

/**
 * Campaign性能数据
 */
export interface CampaignPerformanceData {
  campaign_id: string
  campaign_name: string
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost: number
  ctr: number
  cpc: number
  conversion_rate: number
}

/**
 * DataSyncService - 数据同步服务
 * 负责从Google Ads API拉取性能数据并存储到SQLite
 */
export class DataSyncService {
  private static instance: DataSyncService
  private syncStatus: Map<number, SyncStatus> = new Map()

  private constructor() {}

  static getInstance(): DataSyncService {
    if (!DataSyncService.instance) {
      DataSyncService.instance = new DataSyncService()
    }
    return DataSyncService.instance
  }

  /**
   * 获取同步状态
   */
  getSyncStatus(userId: number): SyncStatus {
    return this.syncStatus.get(userId) || {
      isRunning: false,
      lastSyncAt: null,
      nextSyncAt: null,
      lastSyncDuration: null,
      lastSyncRecordCount: 0,
      lastSyncError: null,
    }
  }

  /**
   * 执行数据同步（手动触发或定时任务）
   */
  async syncPerformanceData(
    userId: number,
    syncType: 'manual' | 'auto' = 'manual'
  ): Promise<SyncLog> {
    const db = getDatabase()
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    // 更新同步状态为运行中
    this.syncStatus.set(userId, {
      isRunning: true,
      lastSyncAt: null,
      nextSyncAt: null,
      lastSyncDuration: null,
      lastSyncRecordCount: 0,
      lastSyncError: null,
    })

    let recordCount = 0
    let syncLogId: number | undefined

    try {
      // 1. 获取用户的所有Google Ads账户
      const accounts = db
        .prepare(
          `
        SELECT id, customer_id, refresh_token, user_id
        FROM google_ads_accounts
        WHERE user_id = ? AND is_active = 1
      `
        )
        .all(userId) as Array<{
        id: number
        customer_id: string
        refresh_token: string
        user_id: number
      }>

      if (accounts.length === 0) {
        throw new Error('未找到活跃的Google Ads账户')
      }

      // 2. 为每个账户同步数据
      for (const account of accounts) {
        // 创建同步日志记录
        const logResult = db
          .prepare(
            `
          INSERT INTO sync_logs (
            user_id, google_ads_account_id, sync_type, status,
            record_count, duration_ms, started_at
          ) VALUES (?, ?, ?, 'running', 0, 0, ?)
        `
          )
          .run(userId, account.id, syncType, startedAt)

        syncLogId = logResult.lastInsertRowid as number

        // 查询该账户下的所有Campaigns
        const campaigns = db
          .prepare(
            `
          SELECT c.id, c.campaign_id, c.campaign_name
          FROM campaigns c
          WHERE c.user_id = ? AND c.google_ads_account_id = ?
            AND c.campaign_id IS NOT NULL
        `
          )
          .all(userId, account.id) as Array<{
          id: number
          campaign_id: string
          campaign_name: string
        }>

        if (campaigns.length === 0) {
          console.log(`账户 ${account.customer_id} 没有已同步的Campaigns，跳过`)
          continue
        }

        // 3. 使用GAQL查询性能数据（最近7天）
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - 7)

        const performanceData = await this.queryPerformanceData({
          customerId: account.customer_id,
          refreshToken: account.refresh_token,
          startDate: this.formatDate(startDate),
          endDate: this.formatDate(endDate),
        })

        // 4. 批量写入数据库（使用upsert处理重复）
        const insertStmt = db.prepare(`
          INSERT INTO campaign_performance (
            user_id, campaign_id, date,
            impressions, clicks, conversions, cost,
            ctr, cpc, cpa, conversion_rate
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(campaign_id, date) DO UPDATE SET
            impressions = excluded.impressions,
            clicks = excluded.clicks,
            conversions = excluded.conversions,
            cost = excluded.cost,
            ctr = excluded.ctr,
            cpc = excluded.cpc,
            cpa = excluded.cpa,
            conversion_rate = excluded.conversion_rate
        `)

        const transaction = db.transaction((records: CampaignPerformanceData[]) => {
          for (const record of records) {
            // 查找本地campaign_id
            const campaign = campaigns.find(
              (c) => c.campaign_id === record.campaign_id
            )
            if (!campaign) {
              console.warn(`未找到Campaign: ${record.campaign_id}，跳过`)
              continue
            }

            const cpa =
              record.conversions > 0 ? record.cost / record.conversions : 0

            insertStmt.run(
              userId,
              campaign.id,
              record.date,
              record.impressions,
              record.clicks,
              record.conversions,
              record.cost,
              record.ctr,
              record.cpc,
              cpa,
              record.conversion_rate
            )
            recordCount++
          }
        })

        transaction(performanceData)

        // 更新账户的last_sync_at
        db.prepare(
          `UPDATE google_ads_accounts SET last_sync_at = ? WHERE id = ?`
        ).run(new Date().toISOString(), account.id)
      }

      // 5. 同步成功，更新日志
      const duration = Date.now() - startTime
      const completedAt = new Date().toISOString()

      db.prepare(
        `
        UPDATE sync_logs
        SET status = 'success', record_count = ?, duration_ms = ?, completed_at = ?
        WHERE id = ?
      `
      ).run(recordCount, duration, completedAt, syncLogId)

      // 更新同步状态
      this.syncStatus.set(userId, {
        isRunning: false,
        lastSyncAt: completedAt,
        nextSyncAt: this.calculateNextSyncTime(),
        lastSyncDuration: duration,
        lastSyncRecordCount: recordCount,
        lastSyncError: null,
      })

      return {
        id: syncLogId!,
        user_id: userId,
        google_ads_account_id: accounts[0].id,
        sync_type: syncType,
        status: 'success',
        record_count: recordCount,
        duration_ms: duration,
        error_message: null,
        started_at: startedAt,
        completed_at: completedAt,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const completedAt = new Date().toISOString()
      const errorMessage = error instanceof Error ? error.message : String(error)

      // 更新日志为失败
      if (syncLogId) {
        db.prepare(
          `
          UPDATE sync_logs
          SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = ?
          WHERE id = ?
        `
        ).run(errorMessage, duration, completedAt, syncLogId)
      }

      // 更新同步状态
      this.syncStatus.set(userId, {
        isRunning: false,
        lastSyncAt: completedAt,
        nextSyncAt: null,
        lastSyncDuration: duration,
        lastSyncRecordCount: 0,
        lastSyncError: errorMessage,
      })

      throw error
    }
  }

  /**
   * 使用GAQL查询性能数据
   */
  private async queryPerformanceData(
    params: GAQLQueryParams
  ): Promise<CampaignPerformanceData[]> {
    const { customerId, refreshToken, startDate, endDate } = params

    try {
      // 获取Google Ads Customer实例
      const customer = await getCustomer(customerId, refreshToken)

      // GAQL查询语句
      const query = `
        SELECT
          campaign.id,
          campaign.name,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.cost_micros
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
        ORDER BY segments.date DESC
      `

      // 执行查询
      const results = await customer.query(query)

      // 转换为标准格式
      const performanceData: CampaignPerformanceData[] = results.map(
        (row: any) => {
          const impressions = row.metrics?.impressions || 0
          const clicks = row.metrics?.clicks || 0
          const conversions = row.metrics?.conversions || 0
          const costMicros = row.metrics?.cost_micros || 0

          // 计算指标
          const cost = costMicros / 1_000_000 // 转换为标准货币单位
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
          const cpc = clicks > 0 ? cost / clicks : 0
          const conversion_rate =
            clicks > 0 ? (conversions / clicks) * 100 : 0

          return {
            campaign_id: row.campaign?.id?.toString() || '',
            campaign_name: row.campaign?.name || '',
            date: row.segments?.date || '',
            impressions,
            clicks,
            conversions,
            cost,
            ctr,
            cpc,
            conversion_rate,
          }
        }
      )

      return performanceData
    } catch (error) {
      console.error('GAQL查询失败:', error)
      throw new Error(
        `Google Ads API查询失败: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * 清理90天之前的数据
   */
  async cleanupOldData(): Promise<number> {
    const db = getDatabase()

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 90)

    const result = db
      .prepare(
        `
      DELETE FROM campaign_performance
      WHERE date < ?
    `
      )
      .run(this.formatDate(cutoffDate))

    return result.changes
  }

  /**
   * 获取同步日志
   */
  getSyncLogs(userId: number, limit: number = 20): SyncLog[] {
    const db = getDatabase()

    return db
      .prepare(
        `
      SELECT *
      FROM sync_logs
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `
      )
      .all(userId, limit) as SyncLog[]
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]
  }

  /**
   * 计算下次同步时间（5分钟后）
   */
  private calculateNextSyncTime(): string {
    const nextSync = new Date()
    nextSync.setMinutes(nextSync.getMinutes() + 5)
    return nextSync.toISOString()
  }
}

/**
 * 导出单例实例
 */
export const dataSyncService = DataSyncService.getInstance()
