import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB, enums } from './google-ads-api'
import { getServiceAccountConfig } from './google-ads-service-account'
import { getDatabase } from './db'
import { getUserAuthType, getGoogleAdsCredentials } from './google-ads-oauth'
import { executeGAQLQueryPython } from './python-ads-client'
import { getInsertedId, nowFunc } from './db-helpers'
import { createRiskAlert } from './risk-alerts'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { normalizeCountryCode, normalizeLanguageCode } from './language-country-codes'
import { normalizeBrandKey, refreshBrandCoreKeywordCache } from './brand-core-keywords'
import { isInvalidKeyword } from './keyword-invalid-filter'

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
  currency_code?: string
  time_zone?: string
}

/**
 * 搜索词报告数据
 */
export interface SearchTermPerformanceData {
  campaign_id: string
  search_term: string
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost: number
}

/**
 * 关键词表现数据
 */
export interface KeywordPerformanceData {
  campaign_id: string
  keyword_text: string
  date: string
  impressions: number
  clicks: number
}

/**
 * DataSyncService - 数据同步服务
 * 负责从Google Ads API拉取性能数据并存储到SQLite
 */
export class DataSyncService {
  private static instance: DataSyncService
  private syncStatus: Map<number, SyncStatus> = new Map()

  private normalizeCurrency(value: unknown): string {
    const normalized = String(value ?? '').trim().toUpperCase()
    return normalized || 'USD'
  }

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
      // 🔧 修复(2026-01-03): 添加account_name字段用于风险警报显示
      const accounts = await db.query(
        `
        SELECT id, customer_id, account_name, refresh_token, user_id, service_account_id, currency
        FROM google_ads_accounts
        WHERE user_id = ? AND ${isActiveCondition}
      `,
        [userId]
      ) as Array<{
        id: number
        customer_id: string
        account_name: string | null
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
            SELECT
              c.id,
              c.google_campaign_id,
              c.campaign_name,
              c.is_test_variant,
              c.offer_id,
              o.brand,
              o.target_country,
              o.target_language
            FROM campaigns c
            JOIN offers o ON o.id = c.offer_id
            WHERE c.user_id = ? AND c.google_ads_account_id = ?
              AND c.google_campaign_id IS NOT NULL
          `,
            [userId, account.id]
          ) as Array<{
            id: number
            google_campaign_id: string
            campaign_name: string
            is_test_variant: boolean | number
            offer_id: number
            brand: string
            target_country: string
            target_language: string | null
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

          const campaignMap = new Map<string, (typeof campaigns)[number]>()
          for (const campaign of campaigns) {
            if (campaign.google_campaign_id) {
              campaignMap.set(campaign.google_campaign_id, campaign)
            }
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

          const startDateStr = this.formatDate(startDate)
          const endDateStr = this.formatDate(endDate)

          const performanceData = await this.queryPerformanceData({
            customerId: account.customer_id,
            refreshToken,
            startDate: startDateStr,
            endDate: endDateStr,
            accountId: account.id,
            userId: userId,
            credentials: userCredentials,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId,
          })

          // 🔧 修复(2026-01-15): 从 Google Ads API 获取账户真实币种/时区并回写到google_ads_accounts
          // 避免账号初次创建时默认USD导致全站显示"$"
          const derivedCurrency = this.normalizeCurrency(performanceData[0]?.currency_code || account.currency)
          const derivedTimeZone = String(performanceData[0]?.time_zone || '').trim() || null

          try {
            const currentCurrency = this.normalizeCurrency(account.currency)
            const shouldUpdateCurrency = derivedCurrency && derivedCurrency !== currentCurrency
            const shouldUpdateTimezone = Boolean(derivedTimeZone)

            if (shouldUpdateCurrency || shouldUpdateTimezone) {
              await db.exec(
                `
                UPDATE google_ads_accounts
                SET currency = COALESCE(?, currency),
                    timezone = COALESCE(?, timezone),
                    updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
                WHERE id = ?
              `,
                [shouldUpdateCurrency ? derivedCurrency : null, derivedTimeZone, account.id]
              )
            }
          } catch (e) {
            console.warn(`⚠️ 回写账号币种/时区失败（账号 ${account.customer_id}）:`, e)
          }

          // 4. 批量写入数据库（使用upsert处理重复）
          // Note: 使用事务确保数据一致性
          let accountRecordCount = 0
          await db.transaction(async () => {
            for (const record of performanceData) {
              // 查找本地campaign_id
              const campaign = campaignMap.get(record.campaign_id)
              if (!campaign) {
                console.warn(`未找到Campaign: ${record.campaign_id}，跳过`)
                continue
              }

              const cpa =
                record.conversions > 0 ? record.cost / record.conversions : 0

              // 🔧 修复(2025-12-30): 支持多货币账户
              // Google Ads API返回的cost_micros是账户货币的微单位，需要保存原始货币信息
              const accountCurrency = derivedCurrency

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

          // 4. 同步搜索词/关键词表现并更新品牌全局核心关键词池
          try {
            await this.syncBrandCoreKeywordsForAccount({
              userId,
              customerId: account.customer_id,
              refreshToken,
              startDate: startDateStr,
              endDate: endDateStr,
              accountId: account.id,
              credentials: userCredentials,
              authType: auth.authType,
              serviceAccountId: auth.serviceAccountId,
              campaigns,
              campaignMap,
            })
          } catch (error) {
            console.warn(`⚠️ 品牌全局核心关键词同步失败（不影响主流程）:`, error)
          }

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
          customer.currency_code,
          customer.time_zone,
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
            currency_code: row.customer?.currency_code || undefined,
            time_zone: row.customer?.time_zone || undefined,
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
   * 使用GAQL查询搜索词报告数据
   */
  private async querySearchTermData(
    params: GAQLQueryParams
  ): Promise<SearchTermPerformanceData[]> {
    const { customerId, refreshToken, startDate, endDate, accountId, userId, credentials, authType, serviceAccountId } = params

    try {
      let customer: any

      if (authType === 'service_account' && serviceAccountId) {
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

      const query = `
        SELECT
          campaign.id,
          segments.date,
          search_term_view.search_term,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.cost_micros
        FROM search_term_view
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
          AND metrics.impressions > 0
          AND metrics.clicks > 0
        ORDER BY segments.date DESC
      `

      const isServiceAccountMode = authType === 'service_account' && serviceAccountId
      const results = isServiceAccountMode
        ? (await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })).results || []
        : await (customer as any).query(query)

      return results.map((row: any) => {
        const impressions = row.metrics?.impressions || 0
        const clicks = row.metrics?.clicks || 0
        const conversions = row.metrics?.conversions || 0
        const costMicros = row.metrics?.cost_micros || 0
        return {
          campaign_id: row.campaign?.id?.toString() || '',
          search_term: row.search_term_view?.search_term || '',
          date: row.segments?.date || '',
          impressions,
          clicks,
          conversions,
          cost: costMicros / 1_000_000,
        }
      })
    } catch (error) {
      console.error('GAQL查询搜索词报告失败:', error)
      throw new Error(
        `Google Ads API查询失败(搜索词报告): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * 使用GAQL查询关键词表现数据
   */
  private async queryKeywordPerformanceData(
    params: GAQLQueryParams
  ): Promise<KeywordPerformanceData[]> {
    const { customerId, refreshToken, startDate, endDate, accountId, userId, credentials, authType, serviceAccountId } = params

    try {
      let customer: any

      if (authType === 'service_account' && serviceAccountId) {
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

      const query = `
        SELECT
          campaign.id,
          segments.date,
          ad_group_criterion.keyword.text,
          metrics.impressions,
          metrics.clicks
        FROM keyword_view
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
          AND ad_group_criterion.status != 'REMOVED'
          AND metrics.impressions > 0
          AND metrics.clicks > 0
        ORDER BY segments.date DESC
      `

      const isServiceAccountMode = authType === 'service_account' && serviceAccountId
      const results = isServiceAccountMode
        ? (await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })).results || []
        : await (customer as any).query(query)

      return results.map((row: any) => {
        const impressions = row.metrics?.impressions || 0
        const clicks = row.metrics?.clicks || 0
        const keywordText =
          row.ad_group_criterion?.keyword?.text ||
          row.keyword_view?.keyword?.text ||
          ''

        return {
          campaign_id: row.campaign?.id?.toString() || '',
          keyword_text: keywordText,
          date: row.segments?.date || '',
          impressions,
          clicks,
        }
      })
    } catch (error) {
      console.error('GAQL查询关键词表现失败:', error)
      throw new Error(
        `Google Ads API查询失败(关键词表现): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * 同步搜索词/关键词表现并更新品牌全局核心关键词池
   */
  private async syncBrandCoreKeywordsForAccount(params: {
    userId: number
    customerId: string
    refreshToken?: string
    startDate: string
    endDate: string
    accountId: number
    credentials?: {
      client_id: string
      client_secret: string
      developer_token: string
      login_customer_id?: string
    }
    authType?: 'oauth' | 'service_account'
    serviceAccountId?: string
    campaigns: Array<{
      id: number
      google_campaign_id: string
      is_test_variant: boolean | number
      offer_id: number
      brand: string
      target_country: string
      target_language: string | null
    }>
    campaignMap: Map<string, {
      id: number
      google_campaign_id: string
      is_test_variant: boolean | number
      offer_id: number
      brand: string
      target_country: string
      target_language: string | null
    }>
  }): Promise<void> {
    const {
      userId,
      customerId,
      refreshToken,
      startDate,
      endDate,
      accountId,
      credentials,
      authType,
      serviceAccountId,
      campaigns,
      campaignMap,
    } = params

    const [searchTermData, keywordPerfData] = await Promise.all([
      this.querySearchTermData({
        customerId,
        refreshToken,
        startDate,
        endDate,
        accountId,
        userId,
        credentials,
        authType,
        serviceAccountId,
      }),
      this.queryKeywordPerformanceData({
        customerId,
        refreshToken,
        startDate,
        endDate,
        accountId,
        userId,
        credentials,
        authType,
        serviceAccountId,
      }),
    ])

    const db = await getDatabase()
    const nowSql = nowFunc(db.type)

    const campaignIds = campaigns.map(c => c.id)
    if (campaignIds.length > 0) {
      const placeholders = campaignIds.map(() => '?').join(',')
      await db.exec(
        `
        DELETE FROM search_term_reports
        WHERE campaign_id IN (${placeholders})
          AND date BETWEEN ? AND ?
      `,
        [...campaignIds, startDate, endDate]
      )
    }

    type DailyAggregate = {
      brandKey: string
      country: string
      language: string
      keywordNorm: string
      date: string
      searchTermImpressions: number
      searchTermClicks: number
      keywordPerfImpressions: number
      keywordPerfClicks: number
      hasSearchTerm: boolean
      hasKeywordPerf: boolean
    }

    const dailyMap = new Map<string, DailyAggregate>()
    const keywordDisplayMap = new Map<string, string>()
    const brandDisplayMap = new Map<string, string>()
    const affectedScopes = new Map<string, { brandKey: string; country: string; language: string }>()

    for (const campaign of campaigns) {
      const isTestVariant = campaign.is_test_variant === true || campaign.is_test_variant === 1
      if (isTestVariant) continue
      const brandKey = normalizeBrandKey(campaign.brand)
      if (!brandKey) continue
      const country = normalizeCountryCode(campaign.target_country || 'US')
      const language = normalizeLanguageCode(campaign.target_language || 'en')
      const scopeKey = `${brandKey}||${country}||${language}`
      if (!affectedScopes.has(scopeKey)) {
        affectedScopes.set(scopeKey, { brandKey, country, language })
      }
      if (!brandDisplayMap.has(scopeKey)) {
        brandDisplayMap.set(scopeKey, campaign.brand)
      }
    }

    const addToDaily = (
      source: 'search_term' | 'keyword_perf',
      campaign: {
        brand: string
        target_country: string
        target_language: string | null
      },
      keywordText: string,
      date: string,
      impressions: number,
      clicks: number
    ) => {
      if (impressions <= 0 || clicks <= 0) return
      const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
      if (!keywordNorm || isInvalidKeyword(keywordNorm)) return

      const brandKey = normalizeBrandKey(campaign.brand)
      if (!brandKey) return

      const country = normalizeCountryCode(campaign.target_country || 'US')
      const language = normalizeLanguageCode(campaign.target_language || 'en')
      const scopeKey = `${brandKey}||${country}||${language}`
      const dailyKey = `${scopeKey}||${keywordNorm}||${date}`

      if (!brandDisplayMap.has(scopeKey)) {
        brandDisplayMap.set(scopeKey, campaign.brand)
      }

      const displayKey = `${scopeKey}||${keywordNorm}`
      if (!keywordDisplayMap.has(displayKey)) {
        const trimmed = keywordText?.trim()
        if (trimmed) keywordDisplayMap.set(displayKey, trimmed)
      }

      if (!affectedScopes.has(scopeKey)) {
        affectedScopes.set(scopeKey, { brandKey, country, language })
      }

      const existing = dailyMap.get(dailyKey)
      if (!existing) {
        dailyMap.set(dailyKey, {
          brandKey,
          country,
          language,
          keywordNorm,
          date,
          searchTermImpressions: source === 'search_term' ? impressions : 0,
          searchTermClicks: source === 'search_term' ? clicks : 0,
          keywordPerfImpressions: source === 'keyword_perf' ? impressions : 0,
          keywordPerfClicks: source === 'keyword_perf' ? clicks : 0,
          hasSearchTerm: source === 'search_term',
          hasKeywordPerf: source === 'keyword_perf',
        })
        return
      }

      if (source === 'search_term') {
        existing.searchTermImpressions += impressions
        existing.searchTermClicks += clicks
        existing.hasSearchTerm = true
      } else {
        existing.keywordPerfImpressions += impressions
        existing.keywordPerfClicks += clicks
        existing.hasKeywordPerf = true
      }
    }

    const searchTermRows: Array<{
      campaign_id: number
      search_term: string
      match_type: string
      impressions: number
      clicks: number
      conversions: number
      cost: number
      date: string
    }> = []

    for (const row of searchTermData) {
      if (!row.search_term) continue
      const campaign = campaignMap.get(row.campaign_id)
      if (!campaign) continue
      const isTestVariant = campaign.is_test_variant === true || campaign.is_test_variant === 1
      if (isTestVariant) continue

      const keywordText = row.search_term.trim()
      if (!keywordText) continue

      addToDaily('search_term', campaign, keywordText, row.date, row.impressions, row.clicks)

      const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
      if (!keywordNorm || isInvalidKeyword(keywordNorm)) continue

      searchTermRows.push({
        campaign_id: campaign.id,
        search_term: keywordText,
        match_type: 'UNKNOWN',
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: row.conversions,
        cost: row.cost,
        date: row.date,
      })
    }

    for (const row of keywordPerfData) {
      if (!row.keyword_text) continue
      const campaign = campaignMap.get(row.campaign_id)
      if (!campaign) continue
      const isTestVariant = campaign.is_test_variant === true || campaign.is_test_variant === 1
      if (isTestVariant) continue

      const keywordText = row.keyword_text.trim()
      if (!keywordText) continue

      addToDaily('keyword_perf', campaign, keywordText, row.date, row.impressions, row.clicks)
    }

    if (searchTermRows.length > 0) {
      await db.transaction(async () => {
        for (const row of searchTermRows) {
          await db.exec(
            `
            INSERT INTO search_term_reports (
              user_id, campaign_id, search_term, match_type,
              impressions, clicks, conversions, cost, date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              userId,
              row.campaign_id,
              row.search_term,
              row.match_type,
              row.impressions,
              row.clicks,
              row.conversions,
              row.cost,
              row.date,
            ]
          )
        }
      })
    }

    if (dailyMap.size > 0) {
      const buildSourceMask = (hasSearchTerm: boolean, hasKeywordPerf: boolean): string => {
        if (hasSearchTerm && hasKeywordPerf) return 'search_term|keyword_perf'
        if (hasKeywordPerf) return 'keyword_perf'
        return 'search_term'
      }

      await db.transaction(async () => {
        for (const entry of dailyMap.values()) {
          const impressions = entry.hasKeywordPerf ? entry.keywordPerfImpressions : entry.searchTermImpressions
          const clicks = entry.hasKeywordPerf ? entry.keywordPerfClicks : entry.searchTermClicks
          const sourceMask = buildSourceMask(entry.hasSearchTerm, entry.hasKeywordPerf)

          await db.exec(
            `
            INSERT INTO brand_core_keyword_daily (
              brand_key, target_country, target_language,
              keyword_norm, date, impressions, clicks, source_mask
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(brand_key, target_country, target_language, keyword_norm, date)
            DO UPDATE SET
              impressions = excluded.impressions,
              clicks = excluded.clicks,
              source_mask = excluded.source_mask
          `,
            [
              entry.brandKey,
              entry.country,
              entry.language,
              entry.keywordNorm,
              entry.date,
              impressions,
              clicks,
              sourceMask,
            ]
          )
        }
      })
    }

    const cutoffDate = this.formatDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))

    for (const scope of affectedScopes.values()) {
      const aggregated = await db.query(
        `
        SELECT
          keyword_norm,
          SUM(impressions) AS impressions_total,
          SUM(clicks) AS clicks_total,
          MAX(date) AS last_seen_at,
          MAX(CASE WHEN source_mask LIKE '%search_term%' THEN 1 ELSE 0 END) AS has_search_term,
          MAX(CASE WHEN source_mask LIKE '%keyword_perf%' THEN 1 ELSE 0 END) AS has_keyword_perf
        FROM brand_core_keyword_daily
        WHERE brand_key = ? AND target_country = ? AND target_language = ? AND date >= ?
        GROUP BY keyword_norm
      `,
        [scope.brandKey, scope.country, scope.language, cutoffDate]
      ) as Array<{
        keyword_norm: string
        impressions_total: number
        clicks_total: number
        last_seen_at: string | null
        has_search_term: number
        has_keyword_perf: number
      }>

      await db.transaction(async () => {
        for (const row of aggregated) {
          const hasSearchTerm = Number(row.has_search_term || 0) > 0
          const hasKeywordPerf = Number(row.has_keyword_perf || 0) > 0
          const sourceMask = hasSearchTerm && hasKeywordPerf
            ? 'search_term|keyword_perf'
            : (hasKeywordPerf ? 'keyword_perf' : 'search_term')

          const scopeKey = `${scope.brandKey}||${scope.country}||${scope.language}`
          const displayKey = `${scopeKey}||${row.keyword_norm}`
          const brandDisplay = brandDisplayMap.get(scopeKey) || null
          const keywordDisplay = keywordDisplayMap.get(displayKey) || null

          await db.exec(
            `
            INSERT INTO brand_core_keywords (
              brand_key, brand_display, target_country, target_language,
              keyword_norm, keyword_display, source_mask,
              impressions_total, clicks_total, last_seen_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql}, ${nowSql})
            ON CONFLICT(brand_key, target_country, target_language, keyword_norm)
            DO UPDATE SET
              impressions_total = excluded.impressions_total,
              clicks_total = excluded.clicks_total,
              last_seen_at = excluded.last_seen_at,
              source_mask = excluded.source_mask,
              brand_display = COALESCE(brand_core_keywords.brand_display, excluded.brand_display),
              keyword_display = COALESCE(brand_core_keywords.keyword_display, excluded.keyword_display),
              updated_at = ${nowSql}
          `,
            [
              scope.brandKey,
              brandDisplay,
              scope.country,
              scope.language,
              row.keyword_norm,
              keywordDisplay,
              sourceMask,
              row.impressions_total || 0,
              row.clicks_total || 0,
              row.last_seen_at,
            ]
          )
        }
      })

      await db.exec(
        `
        DELETE FROM brand_core_keywords
        WHERE brand_key = ? AND target_country = ? AND target_language = ? AND last_seen_at < ?
      `,
        [scope.brandKey, scope.country, scope.language, cutoffDate]
      )

      await refreshBrandCoreKeywordCache(scope.brandKey, scope.country, scope.language)
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
