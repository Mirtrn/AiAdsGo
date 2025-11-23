/**
 * Google Ads Performance Sync Service
 * 自动同步广告创意效果数据用于加分计算
 */

import { getDatabase } from './db'
import { saveCreativePerformance, PerformanceData } from './bonus-score-calculator'
import { GoogleAdsApi, GoogleAdsRow } from 'google-ads-api'

interface SyncResult {
  success: boolean
  syncedCount: number
  errors: string[]
  syncDate: string
}

/**
 * 同步单个广告创意的效果数据
 */
export async function syncCreativePerformance(
  adCreativeId: number,
  userId: string,
  googleAdsClient: GoogleAdsApi,
  customerID: string
): Promise<boolean> {
  try {
    const db = getDatabase()

    // 获取广告创意和关联的campaign/ad_group信息
    const creative = db.prepare(`
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
    `).get(adCreativeId) as any

    if (!creative || !creative.google_campaign_id) {
      console.warn(`Creative ${adCreativeId} has no active campaign`)
      return false
    }

    // 从Google Ads API获取效果数据
    const customer = googleAdsClient.Customer({
      customer_id: customerID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN
    })

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
 * 批量同步所有活跃广告创意的效果数据
 */
export async function syncAllCreativesPerformance(
  userId: string,
  googleAdsClient: GoogleAdsApi,
  customerID: string
): Promise<SyncResult> {
  const db = getDb()
  const syncDate = new Date().toISOString().split('T')[0]
  const errors: string[] = []
  let syncedCount = 0

  try {
    // 获取所有有活跃campaign的ad creatives
    const creatives = db.prepare(`
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
    `).all(userId) as any[]

    for (const creative of creatives) {
      const success = await syncCreativePerformance(
        creative.id,
        userId,
        googleAdsClient,
        customerID
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
 */
export async function syncUserPerformanceData(userId: string): Promise<SyncResult> {
  try {
    // Initialize Google Ads client
    const googleAdsClient = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!
    })

    const db = getDatabase()

    // Get user's Google Ads account
    const account = db.prepare(`
      SELECT customer_id
      FROM google_ads_accounts
      WHERE user_id = ? AND is_active = 1
      LIMIT 1
    `).get(userId) as any

    if (!account) {
      throw new Error('No active Google Ads account found')
    }

    return await syncAllCreativesPerformance(userId, googleAdsClient, account.customer_id)
  } catch (error) {
    return {
      success: false,
      syncedCount: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      syncDate: new Date().toISOString().split('T')[0]
    }
  }
}
