/**
 * Creative合规性检查API
 * POST /api/creatives/:id/check-compliance
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findCreativeById } from '@/lib/creatives'
import { findOfferById } from '@/lib/offers'
import { checkCompliance, type CreativeContent } from '@/lib/compliance-checker'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const creativeId = parseInt(params.id)
    if (isNaN(creativeId)) {
      return NextResponse.json(
        { error: 'Invalid creative ID' },
        { status: 400 }
      )
    }

    // 获取Creative信息
    const creative = findCreativeById(creativeId, auth.user!.userId)
    if (!creative) {
      return NextResponse.json(
        { error: 'Creative not found' },
        { status: 404 }
      )
    }

    // 获取Offer信息（用于品牌名）
    const offer = findOfferById(creative.offerId, auth.user!.userId)
    if (!offer) {
      return NextResponse.json(
        { error: 'Associated offer not found' },
        { status: 404 }
      )
    }

    // 构建检查内容
    const content: CreativeContent = {
      headlines: [
        creative.headline1,
        creative.headline2,
        creative.headline3
      ].filter((h): h is string => h !== null && h !== undefined),
      descriptions: [
        creative.description1,
        creative.description2
      ].filter((d): d is string => d !== null && d !== undefined),
      finalUrl: creative.finalUrl,
      brandName: offer.brand
    }

    // 执行合规性检查
    const result = checkCompliance(content)

    return NextResponse.json(result)

  } catch (error) {
    console.error('Compliance check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
