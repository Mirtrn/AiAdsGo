import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativesByOfferId } from '@/lib/ad-creative'
import { findOfferById } from '@/lib/offers'

/**
 * GET /api/offers/:id/creatives
 * 获取指定Offer的所有创意
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

    const offerId = parseInt(id, 10)

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(offerId, parseInt(userId, 10))
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取所有创意
    const creatives = findAdCreativesByOfferId(offerId, parseInt(userId, 10))

    return NextResponse.json({
      success: true,
      data: {
        offerId,
        total: creatives.length,
        creatives: creatives.map(c => ({
          id: c.id,
          version: c.version,
          headlines: c.headlines,
          descriptions: c.descriptions,
          keywords: c.keywords,
          final_url: c.final_url,
          score: c.score,
          is_approved: c.is_approved,
          created_at: c.created_at,
        })),
      },
    })
  } catch (error: any) {
    console.error('获取Creatives失败:', error)
    return NextResponse.json(
      { error: error.message || '获取Creatives失败' },
      { status: 500 }
    )
  }
}
