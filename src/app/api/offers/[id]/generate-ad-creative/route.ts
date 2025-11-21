import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findOfferById } from '@/lib/offers'
import { generateAdCreative, generateAdCreativesBatch } from '@/lib/ad-creative-generator'
import { createAdCreative, listAdCreativesByOffer } from '@/lib/ad-creative'
import { createError, ErrorCode, AppError } from '@/lib/errors'

/**
 * POST /api/offers/[id]/generate-ad-creative
 * 为指定Offer生成广告创意
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const offerId = parseInt(params.id)
    if (isNaN(offerId)) {
      const error = createError.invalidParameter({ field: 'id', value: params.id })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(offerId, authResult.user.userId)
    if (!offer) {
      const error = createError.offerNotFound({ offerId, userId: authResult.user.userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 检查Offer是否已抓取数据
    if (offer.scrape_status !== 'completed') {
      const error = createError.offerNotReady({
        offerId,
        currentStatus: offer.scrape_status,
        requiredStatus: 'completed'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 解析请求参数
    const body = await request.json()
    const {
      theme,
      generation_round = 1,
      reference_performance,
      count = 1,  // 新增：批量生成数量，默认1个
      batch = false  // 新增：是否批量生成模式
    } = body

    // 检查是否已达到生成次数上限（最多3次）
    const existingCreatives = listAdCreativesByOffer(offerId, authResult.user.userId, {
      generation_round
    })

    // 计算还能生成多少个
    const remainingQuota = 3 - existingCreatives.length
    const actualCount = batch ? Math.min(count, remainingQuota) : 1

    if (remainingQuota <= 0) {
      const error = createError.creativeQuotaExceeded({
        round: generation_round,
        current: existingCreatives.length,
        limit: 3
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    console.log(`🎨 开始为Offer #${offerId} 生成广告创意...`)
    console.log(`   品牌: ${offer.brand}`)
    console.log(`   国家: ${offer.target_country}`)
    console.log(`   轮次: ${generation_round}`)
    console.log(`   生成数量: ${actualCount}`)
    if (theme) {
      console.log(`   主题: ${theme}`)
    }

    // 批量生成或单个生成
    const userId = authResult.user!.userId  // Already verified above

    if (batch && actualCount > 1) {
      // 批量并行生成
      const generatedDataList = await generateAdCreativesBatch(offerId, actualCount, {
        theme,
        referencePerformance: reference_performance
      })

      // 批量保存到数据库
      const savedCreatives = generatedDataList.map(generatedData =>
        createAdCreative(userId, offerId, {
          ...generatedData,
          final_url: offer.url,
          final_url_suffix: offer.affiliate_link ? `?ref=${userId}` : undefined,
          generation_round
        })
      )

      console.log(`✅ ${savedCreatives.length} 个广告创意已保存`)

      return NextResponse.json({
        success: true,
        data: savedCreatives,
        count: savedCreatives.length,
        message: `成功生成 ${savedCreatives.length} 个广告创意`
      })
    } else {
      // 单个生成
      const generatedData = await generateAdCreative(offerId, {
        theme,
        referencePerformance: reference_performance
      })

      // 保存到数据库
      const adCreative = createAdCreative(userId, offerId, {
        ...generatedData,
        final_url: offer.url,
        final_url_suffix: offer.affiliate_link ? `?ref=${userId}` : undefined,
        generation_round
      })

      console.log(`✅ 广告创意已保存 (ID: ${adCreative.id}, 评分: ${adCreative.score})`)

      return NextResponse.json({
        success: true,
        data: adCreative,
        message: '广告创意生成成功'
      })
    }

  } catch (error: any) {
    console.error('生成广告创意失败:', error)

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 特殊处理AI配置错误
    if (error.message?.includes('AI配置未设置')) {
      const appError = createError.aiConfigNotSet({
        suggestion: '请前往设置页面配置Vertex AI或Gemini API',
        redirect: '/settings'
      })
      return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
    }

    // 通用创意生成错误
    const appError = createError.creativeGenerationFailed({
      originalError: error.message || '未知错误',
      offerId: parseInt((error as any).offerId) || undefined
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}

/**
 * GET /api/offers/[id]/generate-ad-creative
 * 获取指定Offer的所有广告创意
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const offerId = parseInt(params.id)
    if (isNaN(offerId)) {
      const error = createError.invalidParameter({ field: 'id', value: params.id })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(offerId, authResult.user.userId)
    if (!offer) {
      const error = createError.offerNotFound({ offerId, userId: authResult.user.userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const generationRound = searchParams.get('generation_round')
    const isSelected = searchParams.get('is_selected')

    // 查询广告创意
    const creatives = listAdCreativesByOffer(offerId, authResult.user.userId, {
      generation_round: generationRound ? parseInt(generationRound) : undefined,
      is_selected: isSelected === 'true' ? true : isSelected === 'false' ? false : undefined
    })

    return NextResponse.json({
      success: true,
      data: creatives,
      total: creatives.length
    })

  } catch (error: any) {
    console.error('获取广告创意列表失败:', error)

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 通用系统错误
    const appError = createError.internalError({
      operation: 'list_ad_creatives',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}
