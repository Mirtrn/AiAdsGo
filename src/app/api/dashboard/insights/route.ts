import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * 智能洞察
 */
interface Insight {
  id: string
  type: 'warning' | 'success' | 'info' | 'error'
  priority: 'high' | 'medium' | 'low'
  title: string
  message: string
  recommendation: string
  relatedCampaign?: {
    id: number
    name: string
  }
  relatedOffer?: {
    id: number
    name: string
    url: string
  }
  metrics?: {
    current: number
    benchmark: number
    change: number
  }
  createdAt: string
}

/**
 * GET /api/dashboard/insights
 * 基于规则引擎生成智能洞察
 * Query参数：
 * - days: 分析天数（默认7）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    console.log(`[Insights API] days=${days}, startDate=${formatDate(startDate)}, endDate=${formatDate(endDate)}`)

    const db = await getDatabase()

    const insights: Insight[] = []

    // 规则1: 检查CTR异常低的Campaign
    const lowCtrQuery = `
      SELECT
        c.id,
        c.campaign_name,
        SUM(cp.impressions) as impressions,
        SUM(cp.clicks) as clicks,
        ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) as ctr
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
      GROUP BY c.id, c.campaign_name
      HAVING SUM(cp.impressions) > 100 AND ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) < 1.0
      ORDER BY ctr ASC
      LIMIT 3
    `

    const lowCtrCampaigns = await db.query(
      lowCtrQuery,
      [userId, formatDate(startDate), formatDate(endDate)]
    ) as Array<{
      id: number
      campaign_name: string
      impressions: number
      clicks: number
      ctr: number
    }>

    lowCtrCampaigns.forEach((campaign) => {
      insights.push({
        id: `ctr-low-${campaign.id}`,
        type: 'warning',
        priority: 'high',
        title: 'CTR过低需要优化',
        message: `Campaign "${campaign.campaign_name}" 的CTR仅为 ${campaign.ctr}%，低于行业均值（1-2%）`,
        recommendation:
          '建议：1) 优化广告创意文案，2) 调整关键词匹配类型，3) 提升广告质量评分',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.ctr,
          benchmark: 1.5,
          change: campaign.ctr - 1.5,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则2: 检查花费超标的Campaign
    const highCostQuery = `
      SELECT
        c.id,
        c.campaign_name,
        c.budget_amount,
        SUM(cp.cost) as total_cost,
        ROUND(SUM(cp.cost) / NULLIF(c.budget_amount, 0) / ? * 100, 2) as spend_rate
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
        AND c.budget_amount > 0
      GROUP BY c.id, c.campaign_name, c.budget_amount
      HAVING ROUND(SUM(cp.cost) / NULLIF(c.budget_amount, 0) / ? * 100, 2) > 120
      ORDER BY spend_rate DESC
      LIMIT 3
    `

    const highCostCampaigns = await db.query(
      highCostQuery,
      [days, userId, formatDate(startDate), formatDate(endDate), days]
    ) as Array<{
      id: number
      campaign_name: string
      budget_amount: number
      total_cost: number
      spend_rate: number
    }>

    highCostCampaigns.forEach((campaign) => {
      insights.push({
        id: `cost-high-${campaign.id}`,
        type: 'error',
        priority: 'high',
        title: '花费超出预算',
        message: `Campaign "${campaign.campaign_name}" 实际花费已达预算的 ${campaign.spend_rate}%`,
        recommendation:
          '建议：1) 检查预算设置，2) 暂停低效关键词，3) 调整出价策略',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.total_cost,
          benchmark: campaign.budget_amount,
          change: ((campaign.spend_rate - 100) / 100) * campaign.budget_amount,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则3: 检查转化率低的Campaign
    const lowConversionQuery = `
      SELECT
        c.id,
        c.campaign_name,
        SUM(cp.clicks) as clicks,
        SUM(cp.conversions) as conversions,
        ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) as conversion_rate
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
      GROUP BY c.id, c.campaign_name
      HAVING SUM(cp.clicks) > 50 AND ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) < 2.0
      ORDER BY conversion_rate ASC
      LIMIT 3
    `

    const lowConversionCampaigns = await db.query(
      lowConversionQuery,
      [userId, formatDate(startDate), formatDate(endDate)]
    ) as Array<{
      id: number
      campaign_name: string
      clicks: number
      conversions: number
      conversion_rate: number
    }>

    lowConversionCampaigns.forEach((campaign) => {
      insights.push({
        id: `conversion-low-${campaign.id}`,
        type: 'warning',
        priority: 'medium',
        title: '转化率偏低',
        message: `Campaign "${campaign.campaign_name}" 的转化率为 ${campaign.conversion_rate}%，低于行业基准（2-5%）`,
        recommendation:
          '建议：1) 优化着陆页体验，2) 检查转化追踪设置，3) 调整目标受众定位',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.conversion_rate,
          benchmark: 3.0,
          change: campaign.conversion_rate - 3.0,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则4: 检查表现优异的Campaign
    const topPerformingQuery = `
      SELECT
        c.id,
        c.campaign_name,
        SUM(cp.impressions) as impressions,
        SUM(cp.clicks) as clicks,
        SUM(cp.conversions) as conversions,
        ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) as ctr,
        ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) as conversion_rate
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
      GROUP BY c.id, c.campaign_name
      HAVING SUM(cp.impressions) > 100
        AND ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) > 3.0
        AND ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) > 5.0
      ORDER BY (ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) + ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2)) DESC
      LIMIT 2
    `

    const topCampaigns = await db.query(
      topPerformingQuery,
      [userId, formatDate(startDate), formatDate(endDate)]
    ) as Array<{
      id: number
      campaign_name: string
      impressions: number
      clicks: number
      conversions: number
      ctr: number
      conversion_rate: number
    }>

    topCampaigns.forEach((campaign) => {
      insights.push({
        id: `performance-top-${campaign.id}`,
        type: 'success',
        priority: 'low',
        title: '表现优异',
        message: `Campaign "${campaign.campaign_name}" 表现出色！CTR ${campaign.ctr}%，转化率 ${campaign.conversion_rate}%`,
        recommendation:
          '建议：1) 增加该Campaign预算，2) 分析成功要素并复用到其他Campaign，3) 持续优化保持优势',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.ctr + campaign.conversion_rate,
          benchmark: 5.0,
          change: campaign.ctr + campaign.conversion_rate - 5.0,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则5: 检查长期未更新的Campaign
    // 使用数据库兼容的日期计算方式
    const staleQuery = db.type === 'postgres'
      ? `
        SELECT
          c.id,
          c.campaign_name,
          c.updated_at,
          EXTRACT(DAY FROM (CURRENT_TIMESTAMP - c.updated_at::timestamp)) as days_since_update
        FROM campaigns c
        WHERE c.user_id = ?
          AND c.status IN ('ENABLED', 'ACTIVE')
          AND EXTRACT(DAY FROM (CURRENT_TIMESTAMP - c.updated_at::timestamp)) > 30
        ORDER BY days_since_update DESC
        LIMIT 2
      `
      : `
        SELECT
          c.id,
          c.campaign_name,
          c.updated_at,
          julianday('now') - julianday(c.updated_at) as days_since_update
        FROM campaigns c
        WHERE c.user_id = ?
          AND c.status IN ('ENABLED', 'ACTIVE')
          AND days_since_update > 30
        ORDER BY days_since_update DESC
        LIMIT 2
      `

    const staleCampaigns = await db.query(staleQuery, [userId]) as Array<{
      id: number
      campaign_name: string
      updated_at: string
      days_since_update: number
    }>

    staleCampaigns.forEach((campaign) => {
      insights.push({
        id: `stale-${campaign.id}`,
        type: 'info',
        priority: 'low',
        title: '建议定期优化',
        message: `Campaign "${campaign.campaign_name}" 已 ${Math.floor(campaign.days_since_update)} 天未更新`,
        recommendation:
          '建议：1) 检查性能数据，2) 测试新的广告创意，3) 调整关键词和出价',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则6: 检查每日链接检查结果
    // 获取最近24小时内的链接检查结果，只显示有问题的链接
    const linkCheckQuery = db.type === 'postgres'
      ? `
        SELECT
          lch.id,
          lch.offer_id,
          o.name as offer_name,
          o.product_url,
          lch.is_accessible,
          lch.http_status_code,
          lch.brand_found,
          lch.content_valid,
          lch.validation_message,
          lch.error_message,
          lch.checked_at
        FROM link_check_history lch
        INNER JOIN offers o ON lch.offer_id = o.id
        WHERE o.user_id = ?
          AND lch.checked_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
          AND (
            lch.is_accessible = 0
            OR lch.brand_found = 0
            OR lch.content_valid = 0
          )
        ORDER BY lch.checked_at DESC
        LIMIT 5
      `
      : `
        SELECT
          lch.id,
          lch.offer_id,
          o.name as offer_name,
          o.product_url,
          lch.is_accessible,
          lch.http_status_code,
          lch.brand_found,
          lch.content_valid,
          lch.validation_message,
          lch.error_message,
          lch.checked_at
        FROM link_check_history lch
        INNER JOIN offers o ON lch.offer_id = o.id
        WHERE o.user_id = ?
          AND lch.checked_at >= datetime('now', '-24 hours')
          AND (
            lch.is_accessible = 0
            OR lch.brand_found = 0
            OR lch.content_valid = 0
          )
        ORDER BY lch.checked_at DESC
        LIMIT 5
      `

    const linkCheckResults = await db.query(linkCheckQuery, [userId]) as Array<{
      id: number
      offer_id: number
      offer_name: string
      product_url: string
      is_accessible: number
      http_status_code: number | null
      brand_found: number | null
      content_valid: number | null
      validation_message: string | null
      error_message: string | null
      checked_at: string
    }>

    linkCheckResults.forEach((result) => {
      // 确定问题类型和优先级
      let type: 'error' | 'warning' = 'warning'
      let priority: 'high' | 'medium' | 'low' = 'medium'
      let title = ''
      let message = ''
      let recommendation = ''

      if (result.is_accessible === 0) {
        type = 'error'
        priority = 'high'
        title = '链接无法访问'
        message = `链接 "${result.offer_name}" 无法访问（HTTP ${result.http_status_code || 'N/A'}）`
        recommendation = '建议：1) 检查链接是否有效，2) 确认产品页面可访问，3) 检查是否有地区限制'
      } else if (result.brand_found === 0) {
        title = '品牌信息未找到'
        message = `链接 "${result.offer_name}" 中未检测到品牌信息`
        recommendation = '建议：1) 确认产品页面包含品牌名称，2) 检查页面是否正确加载'
      } else if (result.content_valid === 0) {
        title = '页面内容无效'
        message = `链接 "${result.offer_name}" 页面内容校验失败`
        recommendation = '建议：1) 检查页面是否被重定向，2) 确认页面内容完整，3) 查看具体错误信息'

        // 如果有具体的错误消息，添加到message中
        if (result.validation_message) {
          message += `：${result.validation_message}`
        }
      }

      insights.push({
        id: `link-check-${result.id}`,
        type,
        priority,
        title,
        message,
        recommendation,
        relatedOffer: {
          id: result.offer_id,
          name: result.offer_name,
          url: result.product_url,
        },
        createdAt: result.checked_at,
      })
    })

    // 按优先级排序
    const priorityOrder = { high: 1, medium: 2, low: 3 }
    insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    console.log(`[Insights API] Generated ${insights.length} insights for days=${days}`)

    return NextResponse.json({
      success: true,
      data: {
        insights,
        total: insights.length,
        summary: {
          high: insights.filter((i) => i.priority === 'high').length,
          medium: insights.filter((i) => i.priority === 'medium').length,
          low: insights.filter((i) => i.priority === 'low').length,
        },
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('获取智能洞察失败:', error)
    return NextResponse.json(
      {
        error: '获取智能洞察失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
