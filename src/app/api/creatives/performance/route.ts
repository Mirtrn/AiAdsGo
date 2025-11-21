import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/creatives/performance
 *
 * 获取所有Creative的性能数据汇总和对比
 *
 * Query Parameters:
 * - daysBack: number (可选，默认30天)
 * - sortBy: 'score' | 'performance' | 'recent' (可选，默认score)
 * - limit: number (可选，限制返回数量)
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')
    const sortBy = searchParams.get('sortBy') || 'score'
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined

    const db = getDatabase()

    // 2. 获取所有Ad Creatives及其基本信息
    let creativesQuery = `
      SELECT
        ac.id,
        ac.offer_id,
        ac.headlines,
        ac.descriptions,
        ac.keywords,
        ac.final_url,
        ac.score,
        ac.score_breakdown,
        ac.generation_round,
        ac.theme,
        ac.is_selected,
        ac.created_at,
        o.brand as offer_brand,
        o.category as offer_category,
        o.url as offer_url
      FROM ad_creatives ac
      JOIN offers o ON ac.offer_id = o.id
      WHERE ac.user_id = ?
    `

    // 3. 排序逻辑
    let orderBy = 'ORDER BY ac.score DESC, ac.created_at DESC'
    if (sortBy === 'recent') {
      orderBy = 'ORDER BY ac.created_at DESC'
    } else if (sortBy === 'performance') {
      // 按performance排序需要在获取性能数据后处理
      orderBy = ''
    }

    creativesQuery += ` ${orderBy}`

    if (limit) {
      creativesQuery += ` LIMIT ${limit}`
    }

    const creatives = db.prepare(creativesQuery).all(userId) as any[]

    // 4. 为每个Creative获取关联Campaign的性能数据
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0]

    const creativesWithPerformance = creatives.map((creative) => {
      // 获取该Offer下所有Campaign的性能数据
      const performanceData = db.prepare(`
        SELECT
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
      `).get(creative.offer_id, userId, cutoffDateStr) as any

      // 计算平均CPC
      const avgCpc = performanceData?.clicks > 0
        ? (performanceData.cost_micros / performanceData.clicks)
        : 0

      return {
        id: creative.id,
        offerId: creative.offer_id,
        offerBrand: creative.offer_brand,
        offerCategory: creative.offer_category,
        offerUrl: creative.offer_url,
        headlines: JSON.parse(creative.headlines),
        descriptions: JSON.parse(creative.descriptions),
        keywords: creative.keywords ? JSON.parse(creative.keywords) : [],
        finalUrl: creative.final_url,
        score: creative.score,
        scoreBreakdown: creative.score_breakdown ? JSON.parse(creative.score_breakdown) : null,
        generationRound: creative.generation_round,
        theme: creative.theme,
        isSelected: creative.is_selected === 1,
        createdAt: creative.created_at,
        performance: {
          impressions: performanceData?.impressions || 0,
          clicks: performanceData?.clicks || 0,
          conversions: performanceData?.conversions || 0,
          costUsd: performanceData?.cost_micros
            ? Math.round((performanceData.cost_micros / 1000000) * 100) / 100
            : 0,
          ctr: performanceData?.ctr || 0,
          avgCpcUsd: avgCpc ? Math.round((avgCpc / 1000000) * 100) / 100 : 0,
          conversionRate: performanceData?.conversion_rate || 0,
        }
      }
    })

    // 5. 如果按performance排序，现在进行排序
    if (sortBy === 'performance') {
      creativesWithPerformance.sort((a, b) => {
        // 综合性能评分：转化数 * 10 + 点击数 * 0.1
        const scoreA = a.performance.conversions * 10 + a.performance.clicks * 0.1
        const scoreB = b.performance.conversions * 10 + b.performance.clicks * 0.1
        return scoreB - scoreA
      })
    }

    // 6. 计算统计数据和推荐
    const totalCreatives = creativesWithPerformance.length
    const selectedCreatives = creativesWithPerformance.filter(c => c.isSelected).length

    // 性能总计
    const totalPerformance = creativesWithPerformance.reduce((acc, c) => ({
      impressions: acc.impressions + c.performance.impressions,
      clicks: acc.clicks + c.performance.clicks,
      conversions: acc.conversions + c.performance.conversions,
      cost: acc.cost + c.performance.costUsd,
    }), { impressions: 0, clicks: 0, conversions: 0, cost: 0 })

    // 找出最佳Creative（按不同维度）
    const bestByScore = creativesWithPerformance.length > 0
      ? creativesWithPerformance.reduce((best, current) =>
        current.score > best.score ? current : best
      )
      : null

    const bestByConversions = creativesWithPerformance.length > 0
      ? creativesWithPerformance.reduce((best, current) =>
        current.performance.conversions > best.performance.conversions ? current : best
      )
      : null

    const bestByCtr = creativesWithPerformance.length > 0
      ? creativesWithPerformance.reduce((best, current) =>
        current.performance.ctr > best.performance.ctr ? current : best
      )
      : null

    // 生成推荐
    const recommendations = []

    if (bestByScore && bestByScore.score > 0) {
      recommendations.push({
        type: 'best_score',
        creativeId: bestByScore.id,
        reason: `综合得分最高（${bestByScore.score}分），文案质量优秀`,
        metric: bestByScore.score
      })
    }

    if (bestByConversions && bestByConversions.performance.conversions > 0) {
      recommendations.push({
        type: 'best_conversion',
        creativeId: bestByConversions.id,
        reason: `转化效果最佳（${bestByConversions.performance.conversions}次转化）`,
        metric: bestByConversions.performance.conversions
      })
    }

    if (bestByCtr && bestByCtr.performance.ctr > 0) {
      recommendations.push({
        type: 'best_engagement',
        creativeId: bestByCtr.id,
        reason: `点击率最高（${(bestByCtr.performance.ctr * 100).toFixed(2)}%）`,
        metric: bestByCtr.performance.ctr
      })
    }

    // 7. 返回结果
    return NextResponse.json({
      success: true,
      creatives: creativesWithPerformance,
      summary: {
        totalCreatives,
        selectedCreatives,
        totalPerformance,
        dateRange: {
          start: cutoffDateStr,
          end: new Date().toISOString().split('T')[0],
          days: daysBack
        }
      },
      recommendations,
      sortBy
    })

  } catch (error: any) {
    console.error('Get creative performance error:', error)
    return NextResponse.json(
      { error: error.message || '获取Creative性能数据失败' },
      { status: 500 }
    )
  }
}
