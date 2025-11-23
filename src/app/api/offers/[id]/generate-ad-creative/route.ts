import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findOfferById } from '@/lib/offers'
import { generateAdCreative, generateAdCreativesBatch } from '@/lib/ad-creative-generator'
import { createAdCreative, listAdCreativesByOffer } from '@/lib/ad-creative'
import { createError, ErrorCode, AppError } from '@/lib/errors'
import {
  evaluateCreativeAdStrength,
  type ComprehensiveAdStrengthResult
} from '@/lib/scoring'

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
      // 批量并行生成（传入userId以获取用户特定配置）
      const generatedDataList = await generateAdCreativesBatch(offerId, userId, actualCount, {
        theme,
        referencePerformance: reference_performance
      })

      // 批量评估Ad Strength并保存到数据库
      const savedCreatives = await Promise.all(generatedDataList.map(async (generatedData) => {
        // 确保有metadata，否则构造基础格式
        const headlinesWithMetadata = generatedData.headlinesWithMetadata || generatedData.headlines.map(text => ({
          text,
          length: text.length
        }))
        const descriptionsWithMetadata = generatedData.descriptionsWithMetadata || generatedData.descriptions.map(text => ({
          text,
          length: text.length
        }))

        // Ad Strength评估（传入品牌信息）
        const evaluation = await evaluateCreativeAdStrength(
          headlinesWithMetadata,
          descriptionsWithMetadata,
          generatedData.keywords,
          {
            brandName: offer.brand,
            targetCountry: offer.target_country || 'US',
            targetLanguage: offer.target_language || 'en',
            userId
          }
        )

        console.log(`📊 批量创意评估: ${evaluation.finalRating} (${evaluation.finalScore}分)`)

        // 保存到数据库（传入Ad Strength评分）
        return createAdCreative(userId, offerId, {
          ...generatedData,
          final_url: offer.final_url || offer.url,
          final_url_suffix: offer.final_url_suffix || undefined,
          generation_round,
          // 传入Ad Strength评估结果
          score: evaluation.finalScore,
          score_breakdown: {
            relevance: evaluation.localEvaluation.dimensions.relevance.score,
            quality: evaluation.localEvaluation.dimensions.quality.score,
            engagement: evaluation.localEvaluation.dimensions.completeness.score,
            diversity: evaluation.localEvaluation.dimensions.diversity.score,
            clarity: evaluation.localEvaluation.dimensions.compliance.score,
            brandSearchVolume: evaluation.localEvaluation.dimensions.brandSearchVolume.score
          }
        })
      }))

      console.log(`✅ ${savedCreatives.length} 个广告创意已保存（使用Ad Strength评估）`)

      return NextResponse.json({
        success: true,
        creatives: savedCreatives,  // 前端期望 creatives 字段
        count: savedCreatives.length,
        message: `成功生成 ${savedCreatives.length} 个广告创意`
      })
    } else {
      // 单个生成（传入userId以获取用户特定配置）
      const generatedData = await generateAdCreative(offerId, userId, {
        theme,
        referencePerformance: reference_performance
      })

      // 确保有metadata，否则构造基础格式
      const headlinesWithMetadata = generatedData.headlinesWithMetadata || generatedData.headlines.map(text => ({
        text,
        length: text.length
      }))
      const descriptionsWithMetadata = generatedData.descriptionsWithMetadata || generatedData.descriptions.map(text => ({
        text,
        length: text.length
      }))

      // Ad Strength评估（传入品牌信息用于品牌搜索量维度）
      const evaluation = await evaluateCreativeAdStrength(
        headlinesWithMetadata,
        descriptionsWithMetadata,
        generatedData.keywords,
        {
          brandName: offer.brand,
          targetCountry: offer.target_country || 'US',
          targetLanguage: offer.target_language || 'en',
          userId
        }
      )

      console.log(`📊 创意评估: ${evaluation.finalRating} (${evaluation.finalScore}分)`)

      // 保存到数据库（传入Ad Strength评分）
      const adCreative = createAdCreative(userId, offerId, {
        ...generatedData,
        final_url: offer.final_url || offer.url,
        final_url_suffix: offer.final_url_suffix || undefined,
        generation_round,
        // 传入Ad Strength评估结果
        score: evaluation.finalScore,
        score_breakdown: {
          relevance: evaluation.localEvaluation.dimensions.relevance.score,
          quality: evaluation.localEvaluation.dimensions.quality.score,
          engagement: evaluation.localEvaluation.dimensions.completeness.score,
          diversity: evaluation.localEvaluation.dimensions.diversity.score,
          clarity: evaluation.localEvaluation.dimensions.compliance.score,
          brandSearchVolume: evaluation.localEvaluation.dimensions.brandSearchVolume.score
        }
      })

      console.log(`✅ 广告创意已保存 (ID: ${adCreative.id}, 评分: ${adCreative.score}, 评级: ${evaluation.finalRating})`)

      return NextResponse.json({
        success: true,
        creative: adCreative,  // 前端期望 creative 字段（单数）
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
      creatives: creatives,  // 前端期望 creatives 字段
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
