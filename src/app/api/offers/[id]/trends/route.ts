import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { findOfferById } from '@/lib/offers'

/**
 * GET /api/offers/:id/trends
 *
 * 获取Offer的趋势数据（按日期聚合）
 *
 * Query Parameters:
 * - daysBack: number (可选，默认30天)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const offerId = parseInt(params.id)

    // 2. 验证Offer存在且属于当前用户
    const offer = findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 3. 获取查询参数
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')

    const db = getDatabase()

    // 4. 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 5. 查询每日趋势数据
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
        AVG(conversion_rate) as conversionRate
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

    // 6. 格式化数据
    const formattedTrends = trends.map((row) => {
      const costUsd = row.cost_micros ? row.cost_micros / 1000000 : 0
      const avgCpcUsd = row.clicks > 0 ? costUsd / row.clicks : 0

      return {
        date: row.date,
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        conversions: row.conversions || 0,
        costUsd: Math.round(costUsd * 100) / 100,
        ctr: Math.round((row.ctr || 0) * 10000) / 100, // 转换为百分比
        conversionRate: Math.round((row.conversionRate || 0) * 10000) / 100, // 转换为百分比
        avgCpcUsd: Math.round(avgCpcUsd * 100) / 100,
      }
    })

    // 7. 返回结果
    return NextResponse.json({
      success: true,
      trends: formattedTrends,
      offer: {
        id: offer.id,
        brand: offer.brand,
        category: offer.category,
      },
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: daysBack,
      },
    })
  } catch (error: any) {
    console.error('Get offer trends error:', error)
    return NextResponse.json(
      { error: error.message || '获取趋势数据失败' },
      { status: 500 }
    )
  }
}
