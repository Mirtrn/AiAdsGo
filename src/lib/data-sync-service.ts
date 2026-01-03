import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB, enums } from './google-ads-api'
import { getServiceAccountConfig } from './google-ads-service-account'
import { getDatabase } from './db'
import { getUserAuthType, getGoogleAdsCredentials } from './google-ads-oauth'
import { executeGAQLQueryPython } from './python-ads-client'
import { getInsertedId } from './db-helpers'
import { createRiskAlert } from './risk-alerts'

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
 * 🔧 修复(2025-12-11): 统一使用 camelCase 字段名
 */
export interface SyncLog {
  id: number
  userId: number
  googleAdsAccountId: number
  syncType: 'manual' | 'auto'
  status: 'success' | 'failed' | 'running'
  recordCount: number
  durationMs: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

/**
 * GAQL查询参数
 * 🔧 修复(2025-12-12): 独立账号模式 - 添加凭证参数
 * 🔧 修复(2025-12-24): 服务账号模式支持
 */
export interface GAQLQueryParams {
  customerId: string
  refreshToken?: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  accountId: number
  userId: number
  credentials?: {
    client_id: string
    client_secret: string
    developer_token: string
    login_customer_id?: string
  }
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
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
   * 获取指定Campaign在过去N天内已同步的日期列表
   */
  async getSyncedDates(
    userId: number,
    campaignId: number,
    days: number = 7
  ): Promise<string[]> {
    const db = await getDatabase()

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const rows = await db.query(
      `
      SELECT DISTINCT date
      FROM campaign_performance
      WHERE user_id = ? AND campaign_id = ? AND date >= ?
      ORDER BY date
    `,
      [userId, campaignId, this.formatDate(cutoffDate)]
    ) as Array<{ date: string }>

    return rows.map(r => r.date)
  }

  /**
   * 获取过去N天所有日期列表
   */
  private getDateRange(days: number): string[] {
    const dates: string[] = []
    const today = new Date()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date()
      date.setDate(today.getDate() - i)
      dates.push(this.formatDate(date))
    }

    return dates
  }

  /**
   * 检测缺失的日期
   * @returns 缺失的日期列表
   */
  async getMissingDates(
    userId: number,
    campaignId: number,
    days: number = 7
  ): Promise<string[]> {
    const syncedDates = await this.getSyncedDates(userId, campaignId, days)
    const syncedSet = new Set(syncedDates)
    const allDates = this.getDateRange(days)

    return allDates.filter(date => !syncedSet.has(date))
  }

  /**
   * 执行数据同步（手动触发或定时任务）
   * 🔧 修复(2025-12-12): 独立账号模式 - 使用用户凭证
   * 🔧 修复(2025-12-28): 添加僵尸任务清理机制
   * 🔧 修复(2025-12-28): 智能补齐过去7天缺失数据
   */
  async syncPerformanceData(
    userId: number,
    syncType: 'manual' | 'auto' = 'manual',
    options?: {
      startDate?: string
      endDate?: string
      forceFullSync?: boolean  // 强制全量同步（过去7天）
      smartFillMissing?: boolean  // 智能补齐缺失数据（默认true）
    }
  ): Promise<SyncLog> {
    const db = await getDatabase()
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    // 🔧 修复(2025-12-28): 清理僵尸任务（超过2小时仍为running状态的任务）
    const zombieThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    await db.exec(`
      UPDATE sync_logs
      SET status = 'failed',
          error_message = '任务超时被系统取消（僵尸任务清理）',
          completed_at = ?
      WHERE user_id = ?
        AND status = 'running'
        AND started_at < ?
    `, [startedAt, userId, zombieThreshold])
    console.log(`🧹 已清理用户 ${userId} 的僵尸同步任务`)

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
      // 🔧 修复(2025-12-29): 支持两种认证方式 (OAuth + 服务账号)
      // 先判断用户使用哪种认证方式
      const auth = await getUserAuthType(userId)

      // 对于OAuth模式，需要检查system_settings中的凭证
      // 对于服务账号模式，凭证在google_ads_service_accounts表中，此处无需检查
      if (auth.authType === 'oauth') {
        const credentials = await getGoogleAdsCredentialsFromDB(userId)
        if (!credentials) {
          throw new Error('Google Ads 凭证未配置，请在设置页面完成配置')
        }
        if (!credentials.client_id || !credentials.client_secret || !credentials.developer_token) {
          throw new Error('Google Ads 凭证配置不完整，请在设置页面完成配置')
        }
      } else {
        // 服务账号模式：验证服务账号配置是否存在
        const serviceAccount = await getServiceAccountConfig(userId, auth.serviceAccountId)
        if (!serviceAccount) {
          throw new Error('未找到服务账号配置，请上传服务账号JSON文件')
        }
        if (!serviceAccount.mccCustomerId || !serviceAccount.developerToken || !serviceAccount.serviceAccountEmail || !serviceAccount.privateKey) {
          throw new Error('服务账号配置不完整，请检查服务账号参数')
        }
      }

      // 获取凭证（仅OAuth模式需要）
      const credentials = auth.authType === 'oauth'
        ? await getGoogleAdsCredentialsFromDB(userId)
        : null

      const userCredentials = credentials ? {
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        developer_token: credentials.developer_token,
        login_customer_id: credentials.login_customer_id || undefined
      } : undefined

      // 🔧 PostgreSQL兼容性修复: is_active在PostgreSQL中是BOOLEAN类型
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

      // 1. 获取用户的所有Google Ads账户
      // 🔧 修复(2025-12-30): 添加currency字段以支持多货币账户
      const accounts = await db.query(
        `
        SELECT id, customer_id, refresh_token, user_id, service_account_id, currency
        FROM google_ads_accounts
        WHERE user_id = ? AND ${isActiveCondition}
      `,
        [userId]
      ) as Array<{
        id: number
        customer_id: string
        refresh_token: string
        user_id: number
        service_account_id: string | null
        currency: string | null
      }>

      if (accounts.length === 0) {
        throw new Error('未找到活跃的Google Ads账户')
      }

      // 2. 为每个账户同步数据
      for (const account of accounts) {
        let accountSyncLogId: number | undefined
        try {
          // 创建同步日志记录
          const logResult = await db.exec(
            `
            INSERT INTO sync_logs (
              user_id, google_ads_account_id, sync_type, status,
              record_count, duration_ms, started_at
            ) VALUES (?, ?, ?, 'running', 0, 0, ?)
          `,
            [userId, account.id, syncType, startedAt]
          )

          accountSyncLogId = getInsertedId(logResult, db.type)
          syncLogId = accountSyncLogId  // 保留最后一个syncLogId用于整体同步日志

          // 查询该账户下的所有Campaigns
          const campaigns = await db.query(
            `
            SELECT c.id, c.google_campaign_id, c.campaign_name
            FROM campaigns c
            WHERE c.user_id = ? AND c.google_ads_account_id = ?
              AND c.google_campaign_id IS NOT NULL
          `,
            [userId, account.id]
          ) as Array<{
            id: number
            google_campaign_id: string
            campaign_name: string
          }>

          if (campaigns.length === 0) {
            console.log(`账户 ${account.customer_id} 没有已同步的Campaigns，跳过`)
            // 🔧 修复(2025-12-28): 清理没有campaigns的账户的sync_log（标记为success，但record_count=0）
            await db.exec(
              `
              UPDATE sync_logs
              SET status = 'success', record_count = 0, duration_ms = ?, completed_at = ?
              WHERE id = ?
              `,
              [Date.now() - startTime, new Date().toISOString(), accountSyncLogId]
            )
            continue
          }

          // 3. 使用GAQL查询性能数据（最近7天）
          const endDate = new Date()
          const startDate = new Date()
          startDate.setDate(startDate.getDate() - 7)

          const auth = await getUserAuthType(userId)

          // 🔧 修复(2025-12-28): OAuth模式下需要从google_ads_credentials获取refresh_token
          let refreshToken = account.refresh_token || undefined
          if (auth.authType === 'oauth' && !refreshToken) {
            // 从google_ads_credentials表获取refresh_token
            const oauthCredentials = await getGoogleAdsCredentials(userId)
            refreshToken = oauthCredentials?.refresh_token || undefined

            if (!refreshToken) {
              console.warn(`⚠️ 用户 ${userId} OAuth模式下缺少refresh_token，跳过账户 ${account.customer_id}`)
              // 🔧 修复(2025-12-28): 清理因凭证缺失而无法同步的sync_log
              await db.exec(
                `
                UPDATE sync_logs
                SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = ?
                WHERE id = ?
                `,
                [
                  `OAuth模式下缺少refresh_token，无法同步`,
                  Date.now() - startTime,
                  new Date().toISOString(),
                  accountSyncLogId
                ]
              )
              continue
            }
          }

          const performanceData = await this.queryPerformanceData({
            customerId: account.customer_id,
            refreshToken,
            startDate: this.formatDate(startDate),
            endDate: this.formatDate(endDate),
            accountId: account.id,
            userId: userId,
            credentials: userCredentials,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId,
          })

          // 4. 批量写入数据库（使用upsert处理重复）
          // Note: 使用事务确保数据一致性
          let accountRecordCount = 0
          await db.transaction(async () => {
            for (const record of performanceData) {
              // 查找本地campaign_id
              const campaign = campaigns.find(
                (c) => c.google_campaign_id === record.campaign_id
              )
              if (!campaign) {
                console.warn(`未找到Campaign: ${record.campaign_id}，跳过`)
                continue
              }

              const cpa =
                record.conversions > 0 ? record.cost / record.conversions : 0

              // 🔧 修复(2025-12-30): 支持多货币账户
              // Google Ads API返回的cost_micros是账户货币的微单位，需要保存原始货币信息
              const accountCurrency = account.currency || 'USD'

              await db.exec(
                `
                INSERT INTO campaign_performance (
                  user_id, campaign_id, date,
                  impressions, clicks, conversions, cost,
                  ctr, cpc, cpa, conversion_rate, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(campaign_id, date) DO UPDATE SET
                  impressions = excluded.impressions,
                  clicks = excluded.clicks,
                  conversions = excluded.conversions,
                  cost = excluded.cost,
                  ctr = excluded.ctr,
                  cpc = excluded.cpc,
                  cpa = excluded.cpa,
                  conversion_rate = excluded.conversion_rate,
                  currency = excluded.currency
              `,
                [
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
                  record.conversion_rate,
                  accountCurrency,
                ]
              )
              accountRecordCount++
              recordCount++
            }
          })

          // 更新账户的last_sync_at
          await db.exec(
            `UPDATE google_ads_accounts SET last_sync_at = ? WHERE id = ?`,
            [new Date().toISOString(), account.id]
          )

          // 🔧 修复(2025-12-28): 更新该账户的sync_log为success
          await db.exec(
            `
            UPDATE sync_logs
            SET status = 'success', record_count = ?, duration_ms = ?, completed_at = ?
            WHERE id = ?
            `,
            [accountRecordCount, Date.now() - startTime, new Date().toISOString(), accountSyncLogId]
          )
        } catch (accountError) {
          // 🔧 修复(2025-12-28): 为该账户的sync_log记录错误
          const errorMessage = accountError instanceof Error ? accountError.message : String(accountError)

          if (accountSyncLogId) {
            await db.exec(
              `
              UPDATE sync_logs
              SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = ?
              WHERE id = ?
              `,
              [errorMessage, Date.now() - startTime, new Date().toISOString(), accountSyncLogId]
            )
          }

          console.error(`❌ 账户 ${account.customer_id} 同步失败:`, accountError)

          // 🆕 修复(2026-01-02): 检测OAuth token过期错误并创建风险警报
          const isTokenExpiredError =
            errorMessage.includes('invalid_grant') ||
            errorMessage.includes('Token has been expired') ||
            errorMessage.includes('Token has been revoked')

          if (isTokenExpiredError) {
            console.warn(`⚠️ 检测到OAuth token过期，创建风险警报...`)
            try {
              await createRiskAlert(
                userId,
                'oauth_token_expired',
                'critical',
                'Google Ads授权已过期',
                `您的Google Ads授权已过期或被撤销，无法同步账户数据。请前往设置页面重新授权以恢复数据同步。`,
                {
                  details: {
                    accountId: account.id,
                    customerId: account.customer_id,
                    accountName: account.account_name || `账户 ${account.customer_id}`,
                    errorType: 'invalid_grant',
                    errorMessage: errorMessage.substring(0, 200), // 截取前200字符
                    actionRequired: '重新授权Google Ads',
                    actionUrl: '/settings'
                  }
                }
              )
              console.log(`✅ 已创建OAuth token过期风险警报`)
            } catch (alertError) {
              console.error(`❌ 创建风险警报失败:`, alertError)
              // 不影响主流程
            }
          }

          // 继续处理下一个账户，不中断整体同步流程
        }
      }

      // 5. 同步成功，更新日志
      const duration = Date.now() - startTime
      const completedAt = new Date().toISOString()

      await db.exec(
        `
        UPDATE sync_logs
        SET status = 'success', record_count = ?, duration_ms = ?, completed_at = ?
        WHERE id = ?
      `,
        [recordCount, duration, completedAt, syncLogId]
      )

      // 更新同步状态
      this.syncStatus.set(userId, {
        isRunning: false,
        lastSyncAt: completedAt,
        nextSyncAt: this.calculateNextSyncTime(),
        lastSyncDuration: duration,
        lastSyncRecordCount: recordCount,
        lastSyncError: null,
      })

      // 🔧 修复(2025-12-11): 返回 camelCase 字段名
      return {
        id: syncLogId!,
        userId: userId,
        googleAdsAccountId: accounts[0].id,
        syncType: syncType,
        status: 'success',
        recordCount: recordCount,
        durationMs: duration,
        errorMessage: null,
        startedAt: startedAt,
        completedAt: completedAt,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const completedAt = new Date().toISOString()
      const errorMessage = error instanceof Error ? error.message : String(error)

      // 更新日志为失败
      if (syncLogId) {
        await db.exec(
          `
          UPDATE sync_logs
          SET status = 'failed', error_message = ?, duration_ms = ?, completed_at = ?
          WHERE id = ?
        `,
          [errorMessage, duration, completedAt, syncLogId]
        )
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
   * 🔧 修复(2025-12-12): 独立账号模式 - 传递用户凭证
   * 🔧 修复(2025-12-24): 服务账号模式支持
   */
  private async queryPerformanceData(
    params: GAQLQueryParams
  ): Promise<CampaignPerformanceData[]> {
    const { customerId, refreshToken, startDate, endDate, accountId, userId, credentials, authType, serviceAccountId } = params

    try {
      let customer: any

      if (authType === 'service_account' && serviceAccountId) {
        // 服务账号模式
        const config = await getServiceAccountConfig(userId, serviceAccountId)
        if (!config) {
          throw new Error('未找到服务账号配置')
        }

        customer = await getCustomerWithCredentials({
          customerId,
          accountId,
          userId,
          loginCustomerId: credentials?.login_customer_id || '',
          authType: 'service_account',
          serviceAccountId,
        })
      } else {
        // OAuth模式
        if (!refreshToken) {
          throw new Error('Google Ads账号缺少refresh token')
        }

        customer = await getCustomerWithCredentials({
          customerId,
          refreshToken,
          loginCustomerId: credentials?.login_customer_id || '',
          credentials: credentials ? {
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
            developer_token: credentials.developer_token,
          } : undefined,
          accountId,
          userId,
        })
      }

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

      // 🔧 修复(2025-12-26): 服务账号模式使用 Python 服务，而不是错误地使用 customer.search()
      const isServiceAccountMode = authType === 'service_account' && serviceAccountId
      const results = isServiceAccountMode
        ? (await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })).results || []
        : await (customer as any).query(query)

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
    const db = await getDatabase()

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 90)

    const result = await db.exec(
      `
      DELETE FROM campaign_performance
      WHERE date < ?
    `,
      [this.formatDate(cutoffDate)]
    )

    return result.changes
  }

  /**
   * 获取同步日志
   * 🔧 修复(2025-12-11): 使用 AS 别名返回 camelCase 字段
   */
  async getSyncLogs(userId: number, limit: number = 20): Promise<SyncLog[]> {
    const db = await getDatabase()

    return await db.query(
      `
      SELECT
        id,
        user_id AS userId,
        google_ads_account_id AS googleAdsAccountId,
        sync_type AS syncType,
        status,
        record_count AS recordCount,
        duration_ms AS durationMs,
        error_message AS errorMessage,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM sync_logs
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `,
      [userId, limit]
    ) as SyncLog[]
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]
  }

  /**
   * 计算下次同步时间（6小时后）
   */
  private calculateNextSyncTime(): string {
    const nextSync = new Date()
    nextSync.setHours(nextSync.getHours() + 6)
    return nextSync.toISOString()
  }
}

/**
 * 导出单例实例
 */
export const dataSyncService = DataSyncService.getInstance()
