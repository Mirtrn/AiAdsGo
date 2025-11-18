import { NextRequest, NextResponse } from 'next/server'
import { findCreativesByOfferId, findCreativesByUserId } from '@/lib/creatives'

/**
 * GET /api/creatives?offerId=:id
 * 获取创意列表（可选按offerId过滤）
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const offerIdParam = searchParams.get('offerId')
    const limitParam = searchParams.get('limit')

    let creatives

    if (offerIdParam) {
      // 按Offer ID过滤
      const offerId = parseInt(offerIdParam, 10)
      if (isNaN(offerId)) {
        return NextResponse.json(
          { error: 'offerId必须是数字' },
          { status: 400 }
        )
      }

      creatives = findCreativesByOfferId(offerId, parseInt(userId, 10))
    } else {
      // 获取用户的所有创意
      const limit = limitParam ? parseInt(limitParam, 10) : undefined
      creatives = findCreativesByUserId(parseInt(userId, 10), limit)
    }

    return NextResponse.json({
      success: true,
      creatives,
      count: creatives.length,
    })
  } catch (error: any) {
    console.error('获取创意列表失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取创意列表失败',
      },
      { status: 500 }
    )
  }
}
