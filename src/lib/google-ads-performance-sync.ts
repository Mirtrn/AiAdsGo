/**
 * Google Ads Performance Sync Service
 * 自动同步广告创意效果数据用于加分计算
 *
 * 支持两种认证方式：
 * 1. OAuth 2.0 (传统方式)
 * 2. 服务账号认证 (Service Account)
 */

import { getDatabase } from './db'
import { saveCreativePerformance, PerformanceData } from './bonus-score-calculator'
import { GoogleAdsApi } from 'google-ads-api'
import { refreshAccessToken, getGoogleAdsCredentials } from './google-ads-oauth'
import { getServiceAccountConfig, getUnifiedGoogleAdsClient } from './google-ads-service-account'

interface SyncResult {
  success: boolean
  syncedCount: number
  errors: string[]
  syncDate: string
}

/**
 * 同步单个广告创意的效果数据
 * 🔧 修复(2025-12-12): 独立账号模式 - 添加 refreshToken 参数
 * 🔧 修复(2025-12-23): 支持服务账号认证，refreshToken 变为可选参数
 */
export async function syncCreativePerformance(
  adCreativeId: number,
  userId: string,
  googleAdsClient: GoogleAdsApi,
  customerID: string,
  refreshToken?: string
): Promise<boolean> {
  try {
    const db = await getDatabase()

    // 获取广告创意和关联的campaign/ad_group信息
    const creative = await db.queryOne<any>(`
      SELECT
        ac.id,
        ac.offer_id,
        c.google_campaign_id,
        c.id as campaign_id,
        o.industry_code
      FROM ad_creatives ac
      LEFT JOIN campaigns c ON ac.offer_id = c.offer_id AND c.status = 'ACTIVE'
      LEFT JOIN offers o ON ac.offer_id = o.id
      WHERE ac.id = ?
    `, [adCreativeId])

    if (!creative || !creative.google_campaign_id) {
      console.warn(`Creative ${adCreativeId} has no active campaign`)
      return false
    }

    // 🔧 修复: 使用传入的 refreshToken 而不是环境变量
    // 服务账号模式下，googleAdsClient 已经处理了认证，无需 refresh_token
    const customerConfig: any = {
      customer_id: customerID,
    }
    if (refreshToken) {
      customerConfig.refresh_token = refreshToken
    }
    const customer = googleAdsClient.Customer(customerConfig)

    // 查询最近30天的效果数据
    const query = `
      SELECT
        campaign.id,
        ad_group.id,
        ad_group_ad.ad.id,
        metrics.clicks,
        metrics.impressions,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value
      FROM ad_group_ad
      WHERE
        campaign.id = '${creative.google_campaign_id}'
        AND segments.date DURING LAST_30_DAYS
        AND ad_group_ad.status = 'ENABLED'
    `

    const results = await customer.query(query)

    if (results.length === 0) {
      console.warn(`No performance data found for campaign ${creative.google_campaign_id}`)
      return false
    }

    // 聚合所有结果
    let totalClicks = 0
    let totalImpressions = 0
    let totalCost = 0
    let totalConversions = 0

    for (const row of results) {
      totalClicks += row.metrics?.clicks || 0
      totalImpressions += row.metrics?.impressions || 0
      totalCost += (row.metrics?.cost_micros || 0) / 1000000 // Convert micros to dollars
      totalConversions += row.metrics?.conversions || 0
    }

    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    const cpc = totalClicks > 0 ? totalCost / totalClicks : 0
    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0

    const performanceData: PerformanceData = {
      clicks: totalClicks,
      ctr,
      cpc,
      conversions: totalConversions,
      conversionRate
    }

    // 保存到数据库并计算加分
    const industryCode = creative.industry_code || 'ecom_fashion'
    const syncDate = new Date().toISOString().split('T')[0]

    await saveCreativePerformance(
      adCreativeId,
      creative.offer_id,
      userId,
      performanceData,
      industryCode,
      syncDate
    )

    return true
  } catch (error) {
    console.error(`Error syncing creative ${adCreativeId}:`, error)
    return false
  }
}

/**
 * 同步用户所有广告创意的效果数据
 * 🔧 修复(2025-12-12): 独立账号模式 - 添加 refreshToken 参数
 * 🔧 修复(2025-12-23): 支持服务账号认证，refreshToken 变为可选参数
 */
export async function syncAllCreativesPerformance(
  userId: string,
  googleAdsClient: GoogleAdsApi,
  customerID: string,
  refreshToken?: string
): Promise<SyncResult> {
  const db = await getDatabase()
  const syncDate = new Date().toISOString().split('T')[0]
  const errors: string[] = []
  let syncedCount = 0

  try {
    // 获取所有有活跃campaign的ad creatives
    const creatives = await db.query<any>(`
      SELECT DISTINCT
        ac.id,
        ac.offer_id,
        o.user_id
      FROM ad_creatives ac
      JOIN offers o ON ac.offer_id = o.id
      JOIN campaigns c ON ac.offer_id = c.offer_id
      WHERE c.status = 'ACTIVE'
        AND o.user_id = ?
        AND c.google_campaign_id IS NOT NULL
    `, [userId])

    for (const creative of creatives) {
      const success = await syncCreativePerformance(
        creative.id,
        userId,
        googleAdsClient,
        customerID,
        refreshToken
      )

      if (success) {
        syncedCount++
      } else {
        errors.push(`Failed to sync creative ${creative.id}`)
      }
    }

    return {
      success: true,
      syncedCount,
      errors,
      syncDate
    }
  } catch (error) {
    errors.push(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return {
      success: false,
      syncedCount,
      errors,
      syncDate
    }
  }
}

/**
 * API endpoint helper - Sync performance for a specific user
 * 支持 OAuth 和服务账号两种认证方式
 */
export async function syncUserPerformanceData(userId: string): Promise<SyncResult> {
  try {
    const userIdNum = parseInt(userId)
    if (!userIdNum) {
      throw new Error('Invalid userId')
    }

    const db = await getDatabase()

    // 检查是否配置了服务账号
    const serviceAccount = await getServiceAccountConfig(userIdNum)
    const isServiceAccount = !!serviceAccount

    let googleAdsClient: GoogleAdsApi
    let refreshToken: string | undefined

    if (isServiceAccount) {
      // 服务账号认证模式
      console.log('[PerformanceSync] Using service account authentication')

      // 获取用户基础凭证
      const credentials = await getGoogleAdsCredentials(userIdNum)
      if (!credentials) {
        throw new Error('Google Ads credentials not configured. Please complete API configuration in Settings.')
      }

      if (!credentials.client_id || !credentials.client_secret || !credentials.developer_token) {
        throw new Error('Incomplete Google Ads credentials. Please complete API configuration in Settings.')
      }

      // 创建统一认证的 Google Ads client
      googleAdsClient = await getUnifiedGoogleAdsClient({
        customerId: serviceAccount.mccCustomerId, // 使用MCC ID作为默认客户ID
        credentials: {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          developer_token: credentials.developer_token,
        },
        authConfig: {
          authType: 'service_account',
          userId: userIdNum,
          serviceAccountId: serviceAccount.id.toString(),
        },
      })

      // 服务账号模式不需要 refresh_token
      refreshToken = undefined
    } else {
      // OAuth 认证模式
      console.log('[PerformanceSync] Using OAuth authentication')

      const credentials = await getGoogleAdsCredentials(userIdNum)
      if (!credentials) {
        throw new Error('Google Ads credentials not configured. Please complete API configuration in Settings.')
      }

      if (!credentials.client_id || !credentials.client_secret || !credentials.developer_token) {
        throw new Error('Incomplete Google Ads credentials. Please complete API configuration in Settings.')
      }

      if (!credentials.refresh_token) {
        throw new Error('OAuth not completed. Please complete OAuth authorization in Settings.')
      }

      // 刷新 access token 以确保有效
      console.log('[PerformanceSync] Refreshing access token...')
      try {
        await refreshAccessToken(userIdNum)
        console.log('[PerformanceSync] Access token refreshed successfully')
      } catch (refreshError: any) {
        console.warn('[PerformanceSync] Token refresh warning:', refreshError.message)
        // 继续执行，google-ads-api 库会使用 refresh_token 自动刷新
      }

      // 使用用户自己的凭证创建 Google Ads client
      googleAdsClient = new GoogleAdsApi({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        developer_token: credentials.developer_token
      })

      refreshToken = credentials.refresh_token
    }

    // 🔧 PostgreSQL兼容性修复: is_active在PostgreSQL中是BOOLEAN类型
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

    // Get user's Google Ads account
    const account = await db.queryOne<any>(`
      SELECT customer_id
      FROM google_ads_accounts
      WHERE user_id = ? AND ${isActiveCondition}
      LIMIT 1
    `, [userId])

    if (!account) {
      throw new Error('No active Google Ads account found')
    }

    return await syncAllCreativesPerformance(userId, googleAdsClient, account.customer_id, refreshToken)
  } catch (error) {
    return {
      success: false,
      syncedCount: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      syncDate: new Date().toISOString().split('T')[0]
    }
  }
}
