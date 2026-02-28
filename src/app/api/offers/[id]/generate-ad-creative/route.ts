import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findOfferById, markBucketGenerated } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
import { applyKeywordSupplementationOnce, generateAdCreative, generateAdCreativesBatch } from '@/lib/ad-creative-gen'
import { createAdCreative, listAdCreativesByOffer } from '@/lib/ad-creative'
import { createError, ErrorCode, AppError } from '@/lib/errors'
import { getSearchTermFeedbackHints } from '@/lib/search-term-feedback-hints'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  selectCreativeKeywords,
} from '@/lib/creative-keyword-selection'
import {
  evaluateCreativeAdStrength,
  type ComprehensiveAdStrengthResult
} from '@/lib/scoring'
import { evaluateRsaQualityGate } from '@/lib/rsa-quality-gate'
// 🆕 v4.16: 导入智能创意选择函数
import { getNextCreativeType, getThemeByBucket, BucketType } from '@/lib/ad-creative-generator'

/**
 * 🔧 转换 AdCreative 为 API 响应格式 (camelCase)
 */
function transformCreativeToApiResponse(creative: any) {
  return {
    ...creative,
    offerId: creative.offer_id,
    userId: creative.user_id,
    finalUrl: creative.final_url,
    finalUrlSuffix: creative.final_url_suffix,
    path1: creative.path_1,
    path2: creative.path_2,
    scoreBreakdown: creative.score_breakdown,
    scoreExplanation: creative.score_explanation,
    generationRound: creative.generation_round,
    generationPrompt: creative.generation_prompt,
    creationStatus: creative.creation_status,
    creationError: creative.creation_error,
    googleAdId: creative.google_ad_id,
    googleAdGroupId: creative.google_ad_group_id,
    lastSyncAt: creative.last_sync_at,
    createdAt: creative.created_at,
    updatedAt: creative.updated_at,
    // 🔧 修复：确保 adStrength 数据被正确传递（用于雷达图显示）
    adStrength: creative.adStrength,
    // 🆕 v4.10: 关键词分桶字段
    keywordBucket: creative.keyword_bucket,
    bucketIntent: creative.bucket_intent,
    keywordPoolId: creative.keyword_pool_id,
  }
}

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
    const offer = await findOfferById(offerId, authResult.user.userId)
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

    // ⚠️ 品牌验证：如果品牌为Unknown，拒绝生成创意
    if (!offer.brand || offer.brand === 'Unknown' || offer.brand.trim() === '') {
      const error = createError.requiredField('brand (有效品牌名称)')
      return NextResponse.json({
        ...error.toJSON(),
        message: '品牌名称缺失或无效。品牌词对于生成高质量关键词和广告创意至关重要。请重新抓取Offer或手动设置品牌名称。'
      }, { status: error.httpStatus })
    }

    // 解析请求参数
    const body = await request.json()
    const {
      theme,
      generation_round = 1,
      reference_performance,
      count = 1,  // 新增：批量生成数量，默认1个
      batch = false,  // 新增：是否批量生成模式
      // 🆕 v4.16: 支持手动指定bucket（用于补生成或重生成）
      bucket: explicitBucket
    } = body
    const forcePublishRequested = body?.forcePublish === true || body?.force_publish === true

    // 🆕 v4.16: 使用智能选择机制确定bucket
    // 如果用户指定了bucket，则使用指定的bucket；否则自动选择
    const linkType = offer.page_type || 'product'
    let bucket: BucketType
    let bucketIntent: string

    // ✅ KISS-3类型：仅生成A / B(含C) / D(含S)
    const normalizeBucket = (b: any): BucketType | null => {
      const upper = String(b || '').toUpperCase()
      if (upper === 'A') return 'A'
      if (upper === 'B' || upper === 'C') return 'B'
      if (upper === 'D' || upper === 'S') return 'D'
      return null
    }

    if (explicitBucket) {
      const normalized = normalizeBucket(explicitBucket)
      if (!normalized) {
        const error = createError.invalidParameter({ field: 'bucket', value: explicitBucket })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
      // 用户指定了bucket（兼容旧桶：C->B，S->D）
      bucket = normalized
      bucketIntent = getThemeByBucket(bucket, linkType as 'product' | 'store')
      console.log(`   🆕 Bucket: ${bucket} (用户指定/已归一化)`)
    } else {
      // 自动选择下一个需要生成的bucket
      bucket = getNextCreativeType({
        page_type: linkType as 'product' | 'store',
        generated_buckets: offer.generated_buckets
      })
      bucketIntent = getThemeByBucket(bucket, linkType as 'product' | 'store')
      console.log(`   🆕 Bucket: ${bucket} (智能选择)`)
    }

    // ✅ KISS-3类型：同一Offer最多生成3个类型（A/B/D），且每个类型最多1条创意（避免用户看到太多）
    const db = await getDatabase()
    const isDeletedCheck = db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'
    const usedBuckets = await db.query<{ keyword_bucket: string }>(
      `SELECT DISTINCT keyword_bucket FROM ad_creatives
       WHERE offer_id = ? AND user_id = ? AND keyword_bucket IS NOT NULL AND ${isDeletedCheck}`,
      [offerId, authResult.user.userId]
    )

    const usedTypes = new Set(
      usedBuckets
        .map(r => normalizeBucket(r.keyword_bucket))
        .filter((b: BucketType | null): b is BucketType => !!b)
    )

    if (usedTypes.has(bucket)) {
      const error = createError.creativeQuotaExceeded({
        round: generation_round,
        current: usedTypes.size,
        limit: 3
      })
      return NextResponse.json({
        ...error.toJSON(),
        message: `该Offer已生成桶${bucket}类型创意。为保持仅3个类型创意，请先删除该类型后再生成。`
      }, { status: error.httpStatus })
    }

    if (usedTypes.size >= 3) {
      const error = createError.creativeQuotaExceeded({
        round: generation_round,
        current: usedTypes.size,
        limit: 3
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const remainingQuota = 3 - usedTypes.size
    const actualCount = batch ? Math.min(count, remainingQuota) : 1

    console.log(`🎨 开始为Offer #${offerId} 生成广告创意...`)
    console.log(`   品牌: ${offer.brand}`)
    console.log(`   国家: ${offer.target_country}`)
    console.log(`   链接类型: ${linkType}`)
    console.log(`   轮次: ${generation_round}`)
    console.log(`   生成数量: ${actualCount}`)
    console.log(`   主题: ${bucketIntent}`)
    if (theme) {
      console.log(`   自定义主题: ${theme}`)
    }
    console.log(`   生成接口 forcePublish 参数: ${forcePublishRequested ? '已传入（本接口忽略）' : '未传入'}`)
    if (forcePublishRequested) {
      console.warn('⚠️ generate-ad-creative 接口已忽略 forcePublish 参数；最终阻断仅在发布阶段执行')
    }

    // 批量生成或单个生成
    const userId = authResult.user!.userId  // Already verified above
    const MINIMUM_SCORE = 70
    let searchTermFeedbackHints: {
      hardNegativeTerms?: string[]
      softSuppressTerms?: string[]
    } | undefined

    try {
      const hints = await getSearchTermFeedbackHints({
        offerId,
        userId
      })
      searchTermFeedbackHints = {
        hardNegativeTerms: hints.hardNegativeTerms,
        softSuppressTerms: hints.softSuppressTerms
      }
      console.log(
        `🔁 搜索词反馈已加载: hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
      )
    } catch (hintError: any) {
      console.warn(`⚠️ 搜索词反馈读取失败，继续默认生成: ${hintError?.message || 'unknown error'}`)
    }

    if (batch && actualCount > 1) {
      // 批量并行生成（传入userId以获取用户特定配置）
      const generatedDataList = await generateAdCreativesBatch(offerId, userId, actualCount, {
        theme,
        referencePerformance: reference_performance,
        skipCache: true,  // 🔧 修复：每次生成都跳过缓存，避免重复创意
        searchTermFeedbackHints
      })

      // 批量评估Ad Strength并保存到数据库（门禁未通过仅告警，不阻断）
      const batchResults = await Promise.all(generatedDataList.map(async (generatedData, index) => {
        const prioritizedKeywords = selectCreativeKeywords({
          keywords: generatedData.keywords,
          keywordsWithVolume: generatedData.keywordsWithVolume as any,
          brandName: offer.brand || '',
          bucket,
          maxKeywords: CREATIVE_KEYWORD_MAX_COUNT,
          brandReserve: CREATIVE_BRAND_KEYWORD_RESERVE,
        })
        generatedData.keywords = prioritizedKeywords.keywords
        generatedData.keywordsWithVolume = prioritizedKeywords.keywordsWithVolume as any

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
        const gateDecision = evaluateRsaQualityGate(evaluation, MINIMUM_SCORE)

        console.log(
          `📊 批量创意评估#${index + 1}: ${evaluation.finalRating} (${evaluation.finalScore}分), gatePassed=${gateDecision.passed}`
        )

        if (!gateDecision.passed) {
          console.warn(
            `⚠️ 批量创意#${index + 1} 未通过RSA门禁，按新策略仅告警保存: failureType=${gateDecision.failureType || 'unknown'}`
          )
        }

        // 保存到数据库（传入Ad Strength评分）
        const saved = await createAdCreative(userId, offerId, {
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
            brandSearchVolume: evaluation.localEvaluation.dimensions.brandSearchVolume.score,
            competitivePositioning: evaluation.localEvaluation.dimensions.competitivePositioning.score
          }
        })
        return {
          saved,
          qualityWarning: !gateDecision.passed ? {
            index: index + 1,
            score: evaluation.finalScore,
            rating: evaluation.finalRating,
            failureType: gateDecision.failureType,
            gateReasons: gateDecision.reasons,
            rsaQualityGate: evaluation.rsaQualityGate,
          } : null
        }
      }))
      const savedCreatives = batchResults.map(item => item.saved)
      const qualityWarnings = batchResults.flatMap(item => item.qualityWarning ? [item.qualityWarning] : [])
      const keywordSupplementations = generatedDataList.map(item => item.keywordSupplementation || null)

      console.log(
        `✅ ${savedCreatives.length} 个广告创意已保存（质量告警 ${qualityWarnings.length} 个）`
      )

      return NextResponse.json({
        success: true,
        forcePublish: false,
        forcedPublish: false,
        qualityGateBypassed: false,
        forcePublishIgnored: forcePublishRequested,
        finalPublishDecision: {
          status: 'PENDING_LAUNCH_SCORE_CHECK',
          stage: 'campaign_publish',
          hardBlockSource: 'launch_score'
        },
        creatives: savedCreatives,  // 前端期望 creatives 字段
        keywordSupplementations,
        count: savedCreatives.length,
        qualityWarningCount: qualityWarnings.length,
        qualityWarnings,
        message: `成功生成 ${savedCreatives.length} 个广告创意`
      })
    } else {
      // 单个生成（传入userId以获取用户特定配置）
      const generatedData = await generateAdCreative(offerId, userId, {
        theme: bucketIntent,  // 🆕 v4.16: 使用bucket主题
        referencePerformance: reference_performance,
        skipCache: true,  // 🔧 修复：每次生成都跳过缓存，避免重复创意
        searchTermFeedbackHints,
        deferKeywordSupplementation: bucket === 'D',
        // 🆕 v4.16: 传递bucket信息
        bucket: bucket,
        bucketIntent: bucketIntent,
        bucketIntentEn: getThemeByBucket(bucket, linkType as 'product' | 'store').split(' - ')[1] || bucketIntent
      })

      // ✅ D桶关键词优先：先同步桶关键词，再由统一优先级规则裁剪到全局上限
      if (bucket === 'D') {
        let poolCandidates: string[] = []
        try {
          const { getKeywordsByLinkTypeAndBucket } = await import('@/lib/offer-keyword-pool')
          const bucketResult = await getKeywordsByLinkTypeAndBucket(
            offerId,
            linkType as 'product' | 'store',
            'D'
          )
          const keywordStrings = bucketResult.keywords.map(kw => kw.keyword)
          poolCandidates = keywordStrings

          if (keywordStrings.length > 0) {
            generatedData.keywords = keywordStrings
            generatedData.keywordsWithVolume = bucketResult.keywords.map(kw => ({
              keyword: kw.keyword,
              searchVolume: kw.searchVolume || 0,
              competition: kw.competition,
              competitionIndex: kw.competitionIndex,
              lowTopPageBid: kw.lowTopPageBid,
              highTopPageBid: kw.highTopPageBid,
              matchType: kw.matchType || 'PHRASE',
              source: 'KEYWORD_POOL'
            }))
          }
        } catch (error: any) {
          console.warn(`⚠️ D桶全量关键词同步失败: ${error.message}`)
        }

        try {
          const baseKeywordsWithVolume = Array.isArray(generatedData.keywordsWithVolume)
            ? generatedData.keywordsWithVolume
            : generatedData.keywords.map(keyword => ({
                keyword,
                searchVolume: 0,
                matchType: 'PHRASE' as const,
                source: 'AI_GENERATED' as const
              }))

          const supplemented = await applyKeywordSupplementationOnce({
            offer,
            userId,
            brandName: offer.brand || 'Unknown',
            targetLanguage: offer.target_language || 'English',
            keywordsWithVolume: baseKeywordsWithVolume,
            poolCandidates,
          })

          generatedData.keywords = supplemented.keywords
          generatedData.keywordsWithVolume = supplemented.keywordsWithVolume
          generatedData.keywordSupplementation = supplemented.keywordSupplementation
        } catch (error: any) {
          console.warn(`⚠️ D桶补词失败: ${error?.message || error}`)
        }
      }

      const prioritizedKeywords = selectCreativeKeywords({
        keywords: generatedData.keywords,
        keywordsWithVolume: generatedData.keywordsWithVolume as any,
        brandName: offer.brand || '',
        bucket,
        maxKeywords: CREATIVE_KEYWORD_MAX_COUNT,
        brandReserve: CREATIVE_BRAND_KEYWORD_RESERVE,
      })
      generatedData.keywords = prioritizedKeywords.keywords
      generatedData.keywordsWithVolume = prioritizedKeywords.keywordsWithVolume as any

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
      const gateDecision = evaluateRsaQualityGate(evaluation, MINIMUM_SCORE)

      console.log(
        `📊 创意评估: ${evaluation.finalRating} (${evaluation.finalScore}分), gatePassed=${gateDecision.passed}`
      )

      if (!gateDecision.passed) {
        console.warn(
          `⚠️ 创意未通过RSA门禁，按新策略仅告警保存: rating=${evaluation.finalRating}, score=${evaluation.finalScore}, failureType=${gateDecision.failureType}`
        )
      }

      // 保存到数据库（传入Ad Strength评分）
      const adCreative = await createAdCreative(userId, offerId, {
        ...generatedData,
        final_url: offer.final_url || offer.url,
        final_url_suffix: offer.final_url_suffix || undefined,
        generation_round,
        // 🆕 v4.16: 保存bucket信息
        keyword_bucket: bucket,
        bucket_intent: bucketIntent,
        // 传入Ad Strength评估结果
        score: evaluation.finalScore,
        score_breakdown: {
          relevance: evaluation.localEvaluation.dimensions.relevance.score,
          quality: evaluation.localEvaluation.dimensions.quality.score,
          engagement: evaluation.localEvaluation.dimensions.completeness.score,
          diversity: evaluation.localEvaluation.dimensions.diversity.score,
          clarity: evaluation.localEvaluation.dimensions.compliance.score,
          brandSearchVolume: evaluation.localEvaluation.dimensions.brandSearchVolume.score,
          competitivePositioning: evaluation.localEvaluation.dimensions.competitivePositioning.score
        }
      })

      console.log(`✅ 广告创意已保存 (ID: ${adCreative.id}, Bucket: ${bucket}, 评分: ${adCreative.score}, 评级: ${evaluation.finalRating})`)

      // 🆕 v4.16: 持久化保存 bucket 到数据库
      await markBucketGenerated(offerId, bucket)

      // 🆕 v4.16: 获取更新后的 generated_buckets 列表
      const updatedGeneratedBuckets = updateGeneratedBuckets(offer.generated_buckets, bucket)

      // 🆕 v4.16: 返回bucket信息给前端
      return NextResponse.json({
        success: true,
        forcePublish: false,
        forcedPublish: false,
        qualityGateBypassed: false,
        forcePublishIgnored: forcePublishRequested,
        finalPublishDecision: {
          status: 'PENDING_LAUNCH_SCORE_CHECK',
          stage: 'campaign_publish',
          hardBlockSource: 'launch_score'
        },
        creative: adCreative,  // 前端期望 creative 字段（单数）
        qualityGate: {
          passed: gateDecision.passed,
          warning: !gateDecision.passed,
          reasons: gateDecision.reasons,
          failureType: gateDecision.failureType,
          rsaQualityGate: evaluation.rsaQualityGate,
        },
        keywordSupplementation: generatedData.keywordSupplementation || null,
        bucket: bucket,  // 🆕 当前生成的bucket类型
        bucketIntent: bucketIntent,  // 🆕 bucket主题描述
        generatedBuckets: updatedGeneratedBuckets,  // 🆕 更新后的已生成列表
        message: `广告创意生成成功 (${bucket} - ${bucketIntent})`
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
        suggestion: '请前往设置页面配置Gemini API',
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
    const offer = await findOfferById(offerId, authResult.user.userId)
    if (!offer) {
      const error = createError.offerNotFound({ offerId, userId: authResult.user.userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const generationRound = searchParams.get('generation_round')
    const isSelected = searchParams.get('is_selected')

    const creatives = await listAdCreativesByOffer(offerId, authResult.user.userId, {
      generation_round: generationRound ? parseInt(generationRound) : undefined,
      is_selected: isSelected === 'true' ? true : isSelected === 'false' ? false : undefined
    })

    // 🔧 修复(2025-12-24): 从创意列表实时聚合generatedBuckets，避免依赖可能过时的数据库字段
    const transformedCreatives = creatives.map(transformCreativeToApiResponse)
    const generatedBuckets = Array.from(
      new Set(
        transformedCreatives
          .map(c => c.keywordBucket)
          .filter((b): b is string => !!b)
          .map(b => {
            const upper = String(b).toUpperCase()
            if (upper === 'A') return 'A'
            if (upper === 'B' || upper === 'C') return 'B'
            if (upper === 'D' || upper === 'S') return 'D'
            return upper
          })
      )
    )

    return NextResponse.json({
      success: true,
      // 🔧 修复(2025-12-11): 完整转换为 camelCase
      creatives: transformedCreatives,
      // 🔧 修复(2025-12-24): 从创意列表实时聚合，而不是读取数据库字段
      generatedBuckets: generatedBuckets,
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

/**
 * 🆕 v4.16: 更新generated_buckets列表
 * 将新生成的bucket添加到列表中
 */
function updateGeneratedBuckets(currentBuckets: string | null | undefined, newBucket: string): string[] {
  const normalize = (b: string): string | null => {
    const upper = String(b || '').toUpperCase()
    if (upper === 'A') return 'A'
    if (upper === 'B' || upper === 'C') return 'B'
    if (upper === 'D' || upper === 'S') return 'D'
    return null
  }

  let buckets: string[] = []
  if (currentBuckets) {
    try {
      const raw = JSON.parse(currentBuckets) as string[]
      buckets = raw.map(normalize).filter((b: string | null): b is string => !!b)
    } catch {
      buckets = []
    }
  }

  const normalizedNew = normalize(newBucket)
  if (normalizedNew && !buckets.includes(normalizedNew)) {
    buckets.push(normalizedNew)
  }
  buckets = Array.from(new Set(buckets)).filter(b => ['A', 'B', 'D'].includes(b))
  return buckets
}
