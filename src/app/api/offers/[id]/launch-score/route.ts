import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { findCreativeById } from '@/lib/creatives'
import { createLaunchScore, findLatestLaunchScore } from '@/lib/launch-scores'
import { calculateLaunchScore } from '@/lib/scoring'

/**
 * POST /api/offers/:id/launch-score
 * 计算指定Offer和Creative的Launch Score
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { creativeId } = body

    if (!creativeId) {
      return NextResponse.json(
        {
          error: '请指定要评分的创意ID',
        },
        { status: 400 }
      )
    }

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 验证Offer已完成抓取
    if (offer.scrape_status !== 'completed') {
      return NextResponse.json(
        {
          error: '请先完成产品信息抓取后再计算Launch Score',
        },
        { status: 400 }
      )
    }

    // 验证Creative存在且属于当前Offer
    const creative = findCreativeById(creativeId, parseInt(userId, 10))

    if (!creative) {
      return NextResponse.json(
        {
          error: '创意不存在或无权访问',
        },
        { status: 404 }
      )
    }

    if (creative.offerId !== offer.id) {
      return NextResponse.json(
        {
          error: '该创意不属于此Offer',
        },
        { status: 400 }
      )
    }

    // 使用AI计算Launch Score
    const analysis = await calculateLaunchScore(offer, creative)

    // 保存到数据库
    const launchScore = createLaunchScore(parseInt(userId, 10), offer.id, analysis)

    return NextResponse.json({
      success: true,
      launchScore,
      analysis,
    })
  } catch (error: any) {
    console.error('计算Launch Score失败:', error)

    return NextResponse.json(
      {
        error: error.message || '计算Launch Score失败',
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/offers/:id/launch-score
 * 获取Offer的最新Launch Score
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 获取最新的Launch Score
    const launchScore = findLatestLaunchScore(offer.id, parseInt(userId, 10))

    if (!launchScore) {
      return NextResponse.json(
        {
          success: true,
          launchScore: null,
          message: '暂无Launch Score，请先计算',
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      launchScore,
    })
  } catch (error: any) {
    console.error('获取Launch Score失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Launch Score失败',
      },
      { status: 500 }
    )
  }
}
