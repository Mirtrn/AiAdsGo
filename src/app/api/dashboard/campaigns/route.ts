import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/database'

/**
 * Campaign性能数据
 */
interface CampaignPerformance {
  campaignId: number
  campaignName: string
  status: string
  offerBrand: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  conversionRate: number
  createdAt: string
}

/**
 * GET /api/dashboard/campaigns
 * 获取Campaign列表及其性能数据
 * Query参数：
 * - days: 统计天数（默认7）
 * - sortBy: 排序字段（cost/clicks/conversions，默认cost）
 * - sortOrder: 排序方向（asc/desc，默认desc）
 * - page: 页码（默认1）
 * - pageSize: 每页数量（默认10）
 * - status: 筛选状态（可选）
 * - search: 搜索关键词（可选）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.id

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)
    const sortBy = searchParams.get('sortBy') || 'cost'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '10', 10)
    const statusFilter = searchParams.get('status')
    const searchQuery = searchParams.get('search')

    // 验证排序字段
    const validSortFields = ['cost', 'clicks', 'conversions', 'impressions', 'ctr', 'cpc']
    if (!validSortFields.includes(sortBy)) {
      return NextResponse.json(
        { error: `无效的排序字段: ${sortBy}` },
        { status: 400 }
      )
    }

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const db = getDatabase()

    // 构建查询条件
    const conditions: string[] = ['c.user_id = ?']
    const params: any[] = [userId]

    if (statusFilter) {
      conditions.push('c.status = ?')
      params.push(statusFilter)
    }

    if (searchQuery) {
      conditions.push('(c.campaign_name LIKE ? OR o.brand LIKE ?)')
      params.push(`%${searchQuery}%`, `%${searchQuery}%`)
    }

    const whereClause = conditions.join(' AND ')

    // 查询Campaign及其聚合性能数据
    const query = `
      SELECT
        c.id as campaignId,
        c.campaign_name as campaignName,
        c.status,
        o.brand as offerBrand,
        c.created_at as createdAt,
        COALESCE(SUM(cp.impressions), 0) as impressions,
        COALESCE(SUM(cp.clicks), 0) as clicks,
        COALESCE(SUM(cp.cost), 0) as cost,
        COALESCE(SUM(cp.conversions), 0) as conversions
      FROM campaigns c
      LEFT JOIN offers o ON c.offer_id = o.id
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND cp.date >= ?
        AND cp.date <= ?
      WHERE ${whereClause}
      GROUP BY c.id, c.campaign_name, c.status, o.brand, c.created_at
    `

    params.unshift(formatDate(startDate), formatDate(endDate))

    const rawData = db.prepare(query).all(...params) as Array<{
      campaignId: number
      campaignName: string
      status: string
      offerBrand: string
      createdAt: string
      impressions: number
      clicks: number
      cost: number
      conversions: number
    }>

    // 计算派生指标
    const campaigns: CampaignPerformance[] = rawData.map((row) => {
      const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0
      const cpc = row.clicks > 0 ? row.cost / row.clicks : 0
      const conversionRate =
        row.clicks > 0 ? (row.conversions / row.clicks) * 100 : 0

      return {
        ...row,
        ctr: parseFloat(ctr.toFixed(2)),
        cpc: parseFloat(cpc.toFixed(2)),
        conversionRate: parseFloat(conversionRate.toFixed(2)),
      }
    })

    // 排序
    campaigns.sort((a, b) => {
      const aVal = a[sortBy as keyof CampaignPerformance] as number
      const bVal = b[sortBy as keyof CampaignPerformance] as number

      if (sortOrder === 'asc') {
        return aVal - bVal
      } else {
        return bVal - aVal
      }
    })

    // 分页
    const total = campaigns.length
    const totalPages = Math.ceil(total / pageSize)
    const offset = (page - 1) * pageSize
    const paginatedCampaigns = campaigns.slice(offset, offset + pageSize)

    // 计算汇总统计
    const summary = {
      totalCampaigns: total,
      activeCampaigns: campaigns.filter((c) => c.status === 'ENABLED').length,
      pausedCampaigns: campaigns.filter((c) => c.status === 'PAUSED').length,
      totalImpressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
      totalClicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
      totalCost: campaigns.reduce((sum, c) => sum + c.cost, 0),
      totalConversions: campaigns.reduce((sum, c) => sum + c.conversions, 0),
    }

    return NextResponse.json({
      success: true,
      data: {
        campaigns: paginatedCampaigns,
        summary,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        filters: {
          days,
          sortBy,
          sortOrder,
          status: statusFilter,
          search: searchQuery,
        },
      },
    })
  } catch (error) {
    console.error('获取Campaign列表失败:', error)
    return NextResponse.json(
      {
        error: '获取Campaign列表失败',
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
