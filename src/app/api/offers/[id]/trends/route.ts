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
    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 3. 获取查询参数
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')

    const db = await getDatabase()

    // 4. 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 5. 查询每日趋势数据（使用 campaign_performance via campaigns）
    const trends = await db.query(
      `
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
        END as conversionRate
      FROM campaigns c
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.offer_id = ?
        AND c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
      GROUP BY cp.date
      ORDER BY cp.date ASC
    `,
      [offerId, userId, startDateStr, endDateStr]
    ) as any[]

    // 6. 格式化数据
    const formattedTrends = trends.map((row) => {
      const cost = row.cost || 0
      const clicks = row.clicks || 0
      const avgCpcUsd = clicks > 0 ? cost / clicks : 0

      return {
        date: row.date,
        impressions: row.impressions || 0,
        clicks: clicks,
        conversions: row.conversions || 0,
        costUsd: Math.round(cost * 100) / 100,
        ctr: Math.round((row.ctr || 0) * 100) / 100,
        conversionRate: Math.round((row.conversionRate || 0) * 100) / 100,
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
