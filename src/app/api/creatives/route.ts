import { NextRequest, NextResponse } from 'next/server'
import { findAdCreativesByOfferId, findAdCreativesByUserId } from '@/lib/ad-creative'

/**
 * 🔧 修复(2025-12-11): 转换数据库字段名为 camelCase
 * 规范: API响应使用 camelCase，数据库字段使用 snake_case
 */
function transformCreativeToApiResponse(creative: any) {
  return {
    id: creative.id,
    offerId: creative.offer_id,
    userId: creative.user_id,
    headlines: creative.headlines,
    descriptions: creative.descriptions,
    keywords: creative.keywords,
    keywordsWithVolume: creative.keywordsWithVolume,
    negativeKeywords: creative.negativeKeywords,
    callouts: creative.callouts,
    sitelinks: creative.sitelinks,
    finalUrl: creative.final_url,
    finalUrlSuffix: creative.final_url_suffix,
    path1: creative.path_1,
    path2: creative.path_2,
    score: creative.score,
    scoreBreakdown: creative.score_breakdown,
    scoreExplanation: creative.score_explanation,
    version: creative.version,
    generationRound: creative.generation_round,
    generationPrompt: creative.generation_prompt,
    theme: creative.theme,
    creationStatus: creative.creation_status,
    creationError: creative.creation_error,
    // 兼容前端使用的 adId 字段名
    adId: creative.google_ad_id,
    googleAdId: creative.google_ad_id,
    googleAdGroupId: creative.google_ad_group_id,
    lastSyncAt: creative.last_sync_at,
    createdAt: creative.created_at,
    updatedAt: creative.updated_at,
    adStrength: creative.adStrength,
  }
}

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

      creatives = await findAdCreativesByOfferId(offerId, parseInt(userId, 10))
    } else {
      // 获取用户的所有创意
      const limit = limitParam ? parseInt(limitParam, 10) : undefined
      creatives = await findAdCreativesByUserId(parseInt(userId, 10), limit)
    }

    // 🔧 修复(2025-12-11): 转换为 camelCase 响应
    const transformedCreatives = creatives.map(transformCreativeToApiResponse)

    return NextResponse.json({
      success: true,
      creatives: transformedCreatives,
      count: transformedCreatives.length,
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
