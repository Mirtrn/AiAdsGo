import { getDatabase } from './db'

/**
 * Offer Performance Analytics
 *
 * 提供Offer级别的性能数据分析功能
 * 使用 campaign_performance 表（已同步数据）
 */

export interface OfferPerformanceSummary {
  offer_id: number
  campaign_count: number
  impressions: number
  clicks: number
  conversions: number
  cost: number  // USD (not micros)
  ctr: number
  avg_cpc: number  // USD (not micros)
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
  cost: number  // USD
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
  cost: number  // USD
  ctr: number
  cpc: number  // USD
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
export async function getOfferPerformanceSummary(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<OfferPerformanceSummary> {
  const db = await getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get aggregated performance data from campaign_performance (via campaigns)
  const summary = await db.queryOne(`
    SELECT
      COUNT(DISTINCT cp.campaign_id) as campaign_count,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.conversions) as conversions,
      SUM(cp.cost) as cost,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.cost) / SUM(cp.clicks)
        ELSE 0
      END as avg_cpc,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.conversions) * 100.0 / SUM(cp.clicks)
        ELSE 0
      END as conversion_rate
    FROM campaigns c
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
  `, [offerId, userId, startDateStr, endDateStr]) as any

  return {
    offer_id: offerId,
    campaign_count: summary?.campaign_count || 0,
    impressions: summary?.impressions || 0,
    clicks: summary?.clicks || 0,
    conversions: summary?.conversions || 0,
    cost: summary?.cost || 0,
    ctr: summary?.ctr || 0,
    avg_cpc: summary?.avg_cpc || 0,
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
export async function getOfferPerformanceTrend(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<OfferPerformanceTrend[]> {
  const db = await getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get daily trend data from campaign_performance (via campaigns)
  const trends = await db.query(`
    SELECT
      cp.date as date,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.conversions) as conversions,
      SUM(cp.cost) as cost,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.conversions) * 100.0 / SUM(cp.clicks)
        ELSE 0
      END as conversion_rate
    FROM campaigns c
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
    GROUP BY cp.date
    ORDER BY cp.date ASC
  `, [offerId, userId, startDateStr, endDateStr]) as any[]

  return trends.map((row) => ({
    date: row.date,
    impressions: row.impressions || 0,
    clicks: row.clicks || 0,
    conversions: row.conversions || 0,
    cost: row.cost || 0,
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
export async function getCampaignPerformanceComparison(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<CampaignPerformanceComparison[]> {
  const db = await getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get per-campaign aggregated data from campaign_performance
  const campaigns = await db.query(`
    SELECT
      cp.campaign_id,
      c.campaign_name,
      c.google_campaign_id,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.conversions) as conversions,
      SUM(cp.cost) as cost,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.cost) / SUM(cp.clicks)
        ELSE 0
      END as cpc,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.conversions) * 100.0 / SUM(cp.clicks)
        ELSE 0
      END as conversion_rate
    FROM campaigns c
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
    GROUP BY cp.campaign_id, c.campaign_name, c.google_campaign_id
    ORDER BY SUM(cp.conversions) DESC, SUM(cp.clicks) DESC
  `, [offerId, userId, startDateStr, endDateStr]) as any[]

  return campaigns.map((row) => ({
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    google_campaign_id: row.google_campaign_id,
    impressions: row.impressions || 0,
    clicks: row.clicks || 0,
    conversions: row.conversions || 0,
    cost: row.cost || 0,
    ctr: row.ctr || 0,
    cpc: row.cpc || 0,
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
export async function calculateOfferROI(
  offerId: number,
  userId: number,
  avgOrderValue: number,
  daysBack: number = 30
): Promise<OfferROI> {
  const db = await getDatabase()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]

  // Get total cost and conversions from campaign_performance (via campaigns)
  const data = await db.queryOne(`
    SELECT
      SUM(cp.cost) as total_cost,
      SUM(cp.conversions) as total_conversions
    FROM campaigns c
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
  `, [offerId, userId, startDateStr, endDateStr]) as any

  const totalCostUsd = data?.total_cost || 0
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
