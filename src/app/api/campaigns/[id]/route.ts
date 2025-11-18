import { NextRequest, NextResponse } from 'next/server'
import { findCampaignById, updateCampaign, deleteCampaign } from '@/lib/campaigns'

/**
 * GET /api/campaigns/:id
 * 获取广告系列详情
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const campaign = findCampaignById(parseInt(id, 10), parseInt(userId, 10))

    if (!campaign) {
      return NextResponse.json(
        {
          error: '广告系列不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      campaign,
    })
  } catch (error: any) {
    console.error('获取广告系列详情失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告系列详情失败',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/campaigns/:id
 * 更新广告系列
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const {
      campaignName,
      budgetAmount,
      budgetType,
      targetCpa,
      maxCpc,
      status,
      startDate,
      endDate,
    } = body

    const updates: any = {}
    if (campaignName !== undefined) updates.campaignName = campaignName
    if (budgetAmount !== undefined) updates.budgetAmount = budgetAmount
    if (budgetType !== undefined) updates.budgetType = budgetType
    if (targetCpa !== undefined) updates.targetCpa = targetCpa
    if (maxCpc !== undefined) updates.maxCpc = maxCpc
    if (status !== undefined) updates.status = status
    if (startDate !== undefined) updates.startDate = startDate
    if (endDate !== undefined) updates.endDate = endDate

    const campaign = updateCampaign(parseInt(id, 10), parseInt(userId, 10), updates)

    if (!campaign) {
      return NextResponse.json(
        {
          error: '广告系列不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      campaign,
    })
  } catch (error: any) {
    console.error('更新广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新广告系列失败',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/campaigns/:id
 * 删除广告系列
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const success = deleteCampaign(parseInt(id, 10), parseInt(userId, 10))

    if (!success) {
      return NextResponse.json(
        {
          error: '广告系列不存在或无权访问',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: '广告系列已删除',
    })
  } catch (error: any) {
    console.error('删除广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '删除广告系列失败',
      },
      { status: 500 }
    )
  }
}
