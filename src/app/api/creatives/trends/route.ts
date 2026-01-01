import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/creatives/trends
 *
 * 获取创意维度的统计趋势数据（按日期聚合）
 * - 每日新增创意数量
 * - 创意质量评分分布
 * - 创意状态分布
 * - Ad Strength分布
 *
 * Query Parameters:
 * - daysBack: number (可选，默认7天)
 * - offerId: number (可选，筛选特定Offer的创意)
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '7')
    const offerId = searchParams.get('offerId')

    const db = await getDatabase()

    // 2. 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // PostgreSQL/SQLite 兼容性条件
    const isSelectedTrue = db.type === 'postgres' ? 'is_selected = true' : 'is_selected = 1'
    const isSelectedFalse = db.type === 'postgres' ? 'is_selected = false' : 'is_selected = 0'

    // DATE() 函数兼容性：PostgreSQL的created_at是TEXT类型，需要转换
    const dateFunc = db.type === 'postgres' ? 'created_at::date' : 'DATE(created_at)'

    // 🔧 修复(2025-12-31): PostgreSQL日期比较需要显式类型转换
    // 占位符参数会被当作TEXT，需要在SQL中转换为DATE类型
    const dateCastFunc = db.type === 'postgres' ? '?::date' : '?'

    // 3. 查询每日新增创意数量趋势
    let dailyCreativesQuery = `
      SELECT
        ${dateFunc} as date,
        COUNT(*) as newCreatives,
        AVG(COALESCE(score, 0)) as avgScore,
        SUM(CASE WHEN score >= 80 THEN 1 ELSE 0 END) as highQuality,
        SUM(CASE WHEN score >= 60 AND score < 80 THEN 1 ELSE 0 END) as mediumQuality,
        SUM(CASE WHEN score < 60 OR score IS NULL THEN 1 ELSE 0 END) as lowQuality
      FROM ad_creatives
      WHERE user_id = ?
        AND ${dateFunc} >= ${dateCastFunc}
        AND ${dateFunc} <= ${dateCastFunc}
    `
    const params: any[] = [userId, startDateStr, endDateStr]

    if (offerId) {
      dailyCreativesQuery += ` AND offer_id = ?`
      params.push(parseInt(offerId))
    }

    dailyCreativesQuery += `
      GROUP BY ${dateFunc}
      ORDER BY date ASC
    `

    const dailyTrends = await db.query(dailyCreativesQuery, params) as any[]

    // 4. 查询创意是否被选中的分布（使用is_selected字段）
    let statusQuery = `
      SELECT
        CASE
          WHEN ${isSelectedTrue} THEN 'selected'
          ELSE 'draft'
        END as status,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ?
    `
    const statusParams: any[] = [userId]

    if (offerId) {
      statusQuery += ` AND offer_id = ?`
      statusParams.push(parseInt(offerId))
    }

    statusQuery += ` GROUP BY status`

    const statusDistribution = await db.query(statusQuery, statusParams) as any[]

    // 5. 查询Ad Strength分布（当前总量）
    let adStrengthQuery = `
      SELECT
        COALESCE(ad_strength_data, 'UNKNOWN') as ad_strength,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ?
    `
    const adStrengthParams: any[] = [userId]

    if (offerId) {
      adStrengthQuery += ` AND offer_id = ?`
      adStrengthParams.push(parseInt(offerId))
    }

    adStrengthQuery += ` GROUP BY ad_strength_data`

    const adStrengthDistribution = await db.query(adStrengthQuery, adStrengthParams) as any[]

    // 6. 查询质量评分分布（当前总量）
    let qualityQuery = `
      SELECT
        CASE
          WHEN score >= 90 THEN 'excellent'
          WHEN score >= 75 THEN 'good'
          WHEN score >= 60 THEN 'average'
          ELSE 'poor'
        END as quality_level,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ?
    `
    const qualityParams: any[] = [userId]

    if (offerId) {
      qualityQuery += ` AND offer_id = ?`
      qualityParams.push(parseInt(offerId))
    }

    qualityQuery += ` GROUP BY quality_level`

    const qualityDistribution = await db.query(qualityQuery, qualityParams) as any[]

    // 7. 查询主题分布
    let themeQuery = `
      SELECT
        COALESCE(theme, 'unknown') as theme,
        COUNT(*) as count
      FROM ad_creatives
      WHERE user_id = ?
    `
    const themeParams: any[] = [userId]

    if (offerId) {
      themeQuery += ` AND offer_id = ?`
      themeParams.push(parseInt(offerId))
    }

    themeQuery += ` GROUP BY theme`

    const themeDistribution = await db.query(themeQuery, themeParams) as any[]

    // 8. 查询创意使用情况
    let usageQuery = `
      SELECT
        SUM(CASE WHEN ${isSelectedTrue} THEN 1 ELSE 0 END) as selected,
        SUM(CASE WHEN ${isSelectedFalse} OR is_selected IS NULL THEN 1 ELSE 0 END) as notSelected,
        COUNT(*) as total
      FROM ad_creatives
      WHERE user_id = ?
    `
    const usageParams: any[] = [userId]

    if (offerId) {
      usageQuery += ` AND offer_id = ?`
      usageParams.push(parseInt(offerId))
    }

    const usageStats = await db.queryOne(usageQuery, usageParams) as any

    // 9. 格式化趋势数据
    const formattedTrends = dailyTrends.map((row) => ({
      date: row.date,
      newCreatives: row.newCreatives || 0,
      avgQualityScore: Math.round((row.avgScore || 0) * 10) / 10,
      highQuality: row.highQuality || 0,
      mediumQuality: row.mediumQuality || 0,
      lowQuality: row.lowQuality || 0,
    }))

    // 10. 返回结果
    return NextResponse.json({
      success: true,
      // 每日趋势数据
      trends: formattedTrends,
      // 分布统计
      distributions: {
        // 状态分布
        status: statusDistribution.reduce((acc, item) => {
          acc[item.status || 'unknown'] = item.count
          return acc
        }, {} as Record<string, number>),
        // Ad Strength分布
        adStrength: adStrengthDistribution.reduce((acc, item) => {
          acc[item.ad_strength] = item.count
          return acc
        }, {} as Record<string, number>),
        // 质量评分分布
        quality: qualityDistribution.reduce((acc, item) => {
          acc[item.quality_level] = item.count
          return acc
        }, {} as Record<string, number>),
        // 主题分布
        theme: themeDistribution.reduce((acc, item) => {
          acc[item.theme] = item.count
          return acc
        }, {} as Record<string, number>),
      },
      // 使用统计
      usage: {
        selected: usageStats?.selected || 0,
        notSelected: usageStats?.notSelected || 0,
        total: usageStats?.total || 0,
        usageRate: usageStats?.total > 0
          ? Math.round((usageStats.selected / usageStats.total) * 100)
          : 0,
      },
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: daysBack,
      },
    })
  } catch (error: any) {
    console.error('Get creatives trends error:', error)
    return NextResponse.json(
      { error: error.message || '获取趋势数据失败' },
      { status: 500 }
    )
  }
}
