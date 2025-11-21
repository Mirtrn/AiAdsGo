import { getDatabase } from './db'

/**
 * Offer Performance Analytics
 *
 * 提供Offer级别的性能数据分析功能
 */

export interface OfferPerformanceSummary {
  offer_id: number
  campaign_count: number
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  avg_cpc_micros: number
  conversion_rate: number
  date_range: {
    start: string
    end: string
  }
}

export interface OfferPerformanceTrend {
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  conversion_rate: number
}

export interface CampaignPerformanceComparison {
  campaign_id: number
  campaign_name: string
  google_campaign_id: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}

export interface OfferROI {
  total_cost_usd: number
  total_revenue_usd: number
  roi_percentage: number
  profit_usd: number
  conversions: number
}

/**
 * 获取Offer级别的性能汇总数据
 *
 * @param offerId - Offer ID
 * @param userId - User ID for data isolation
 * @param daysBack - Number of days to look back (default: 30)
 * @returns OfferPerformanceSummary
 */
export function getOfferPerformanceSummary(
  offerId: number,
  userId: number,
  daysBack: number = 30
): OfferPerformanceSummary {
  const db = getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get aggregated performance data
  const summary = db
    .prepare(
      `
    SELECT
      COUNT(DISTINCT campaign_id) as campaign_count,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks,
      SUM(conversions) as conversions,
      SUM(cost_micros) as cost_micros,
      AVG(ctr) as ctr,
      AVG(cpc_micros) as avg_cpc_micros,
      AVG(conversion_rate) as conversion_rate
    FROM ad_performance
    WHERE offer_id = ?
      AND user_id = ?
      AND date >= ?
      AND date <= ?
  `
    )
    .get(offerId, userId, startDateStr, endDateStr) as any

  return {
    offer_id: offerId,
    campaign_count: summary?.campaign_count || 0,
    impressions: summary?.impressions || 0,
    clicks: summary?.clicks || 0,
    conversions: summary?.conversions || 0,
    cost_micros: summary?.cost_micros || 0,
    ctr: summary?.ctr || 0,
    avg_cpc_micros: summary?.avg_cpc_micros || 0,
    conversion_rate: summary?.conversion_rate || 0,
    date_range: {
      start: startDateStr,
      end: endDateStr,
    },
  }
}

/**
 * 获取Offer的趋势数据（按日期聚合）
 *
 * @param offerId - Offer ID
 * @param userId - User ID for data isolation
 * @param daysBack - Number of days to look back (default: 30)
 * @returns Array of OfferPerformanceTrend
 */
export function getOfferPerformanceTrend(
  offerId: number,
  userId: number,
  daysBack: number = 30
): OfferPerformanceTrend[] {
  const db = getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get daily trend data
  const trends = db
    .prepare(
      `
    SELECT
      DATE(date) as date,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks,
      SUM(conversions) as conversions,
      SUM(cost_micros) as cost_micros,
      AVG(ctr) as ctr,
      AVG(conversion_rate) as conversion_rate
    FROM ad_performance
    WHERE offer_id = ?
      AND user_id = ?
      AND date >= ?
      AND date <= ?
    GROUP BY DATE(date)
    ORDER BY date ASC
  `
    )
    .all(offerId, userId, startDateStr, endDateStr) as any[]

  return trends.map((row) => ({
    date: row.date,
    impressions: row.impressions || 0,
    clicks: row.clicks || 0,
    conversions: row.conversions || 0,
    cost_micros: row.cost_micros || 0,
    ctr: row.ctr || 0,
    conversion_rate: row.conversion_rate || 0,
  }))
}

/**
 * 获取Offer下所有Campaign的性能对比数据
 *
 * @param offerId - Offer ID
 * @param userId - User ID for data isolation
 * @param daysBack - Number of days to look back (default: 30)
 * @returns Array of CampaignPerformanceComparison
 */
export function getCampaignPerformanceComparison(
  offerId: number,
  userId: number,
  daysBack: number = 30
): CampaignPerformanceComparison[] {
  const db = getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get per-campaign aggregated data
  const campaigns = db
    .prepare(
      `
    SELECT
      ap.campaign_id,
      c.campaign_name,
      c.google_campaign_id,
      SUM(ap.impressions) as impressions,
      SUM(ap.clicks) as clicks,
      SUM(ap.conversions) as conversions,
      SUM(ap.cost_micros) as cost_micros,
      AVG(ap.ctr) as ctr,
      AVG(ap.cpc_micros) as cpc_micros,
      AVG(ap.conversion_rate) as conversion_rate
    FROM ad_performance ap
    JOIN campaigns c ON ap.campaign_id = c.id
    WHERE ap.offer_id = ?
      AND ap.user_id = ?
      AND ap.date >= ?
      AND ap.date <= ?
    GROUP BY ap.campaign_id, c.campaign_name, c.google_campaign_id
    ORDER BY SUM(ap.conversions) DESC, SUM(ap.clicks) DESC
  `
    )
    .all(offerId, userId, startDateStr, endDateStr) as any[]

  return campaigns.map((row) => ({
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    google_campaign_id: row.google_campaign_id,
    impressions: row.impressions || 0,
    clicks: row.clicks || 0,
    conversions: row.conversions || 0,
    cost_micros: row.cost_micros || 0,
    ctr: row.ctr || 0,
    cpc_micros: row.cpc_micros || 0,
    conversion_rate: row.conversion_rate || 0,
  }))
}

/**
 * 计算Offer的ROI（投资回报率）
 *
 * @param offerId - Offer ID
 * @param userId - User ID for data isolation
 * @param avgOrderValue - Average order value in USD for revenue calculation
 * @param daysBack - Number of days to look back (default: 30)
 * @returns OfferROI
 */
export function calculateOfferROI(
  offerId: number,
  userId: number,
  avgOrderValue: number,
  daysBack: number = 30
): OfferROI {
  const db = getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get total cost and conversions
  const data = db
    .prepare(
      `
    SELECT
      SUM(cost_micros) as total_cost_micros,
      SUM(conversions) as total_conversions
    FROM ad_performance
    WHERE offer_id = ?
      AND user_id = ?
      AND date >= ?
      AND date <= ?
  `
    )
    .get(offerId, userId, startDateStr, endDateStr) as any

  const totalCostUsd = (data?.total_cost_micros || 0) / 1000000
  const totalConversions = data?.total_conversions || 0
  const totalRevenueUsd = totalConversions * avgOrderValue
  const profitUsd = totalRevenueUsd - totalCostUsd
  const roiPercentage =
    totalCostUsd > 0 ? (profitUsd / totalCostUsd) * 100 : 0

  return {
    total_cost_usd: Math.round(totalCostUsd * 100) / 100,
    total_revenue_usd: Math.round(totalRevenueUsd * 100) / 100,
    roi_percentage: Math.round(roiPercentage * 100) / 100,
    profit_usd: Math.round(profitUsd * 100) / 100,
    conversions: totalConversions,
  }
}
