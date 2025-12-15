import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { getDatabase } from '@/lib/db'
import { generateAdCreative } from '@/lib/ad-creative-generator'
import { createAdCreative, type GeneratedAdCreativeData } from '@/lib/ad-creative'
import {
  evaluateCreativeAdStrength,
  type ComprehensiveAdStrengthResult
} from '@/lib/scoring'
import {
  getOrCreateKeywordPool,
  getKeywordPoolByOfferId,
  getBucketInfo,
  getAvailableBuckets,
  getUsedBuckets,
  isCreativeLimitReached,
  calculateKeywordOverlapRate,
  determineClusteringStrategy,
  type BucketType,
  type OfferKeywordPool
} from '@/lib/offer-keyword-pool'

/**
 * POST /api/offers/:id/creatives/generate-differentiated
 * 生成 3 个差异化创意（基于关键词桶）
 *
 * Request Body:
 * - buckets?: BucketType[] - 指定要生成的桶（默认所有可用桶）
 * - maxRetries?: number - 每个创意最大重试次数（默认 2）
 * - forceRegeneratePool?: boolean - 是否强制重新生成关键词池
 *
 * Response:
 * - 成功生成的创意列表
 * - 各创意的关键词桶信息
 * - 创意间的关键词重叠率统计
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

    const offerId = parseInt(id, 10)
    const userIdNum = parseInt(userId, 10)

    // 验证 Offer 存在且属于当前用户
    const offer = await findOfferById(offerId, userIdNum)
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer 不存在或无权访问' },
        { status: 404 }
      )
    }

    // 验证 Offer 已完成抓取
    if (offer.scrape_status === 'failed') {
      return NextResponse.json(
        { error: 'Offer 信息抓取失败，请重新抓取' },
        { status: 400 }
      )
    }

    // 解析请求体
    const body = await request.json().catch(() => ({}))
    const {
      buckets: requestedBuckets,
      maxRetries = 2,
      forceRegeneratePool = false
    } = body

    console.log(`\n🎨 POST /api/offers/${offerId}/creatives/generate-differentiated`)
    console.log(`   requestedBuckets: ${requestedBuckets ? requestedBuckets.join(', ') : '自动选择'}`)
    console.log(`   maxRetries: ${maxRetries}`)
    console.log(`   forceRegeneratePool: ${forceRegeneratePool}`)

    // 1. 获取或创建关键词池
    console.log('\n📦 Step 1: 获取关键词池')
    const pool = await getOrCreateKeywordPool(offerId, userIdNum, forceRegeneratePool)

    // 2. 确定聚类策略
    const strategy = determineClusteringStrategy(pool.totalKeywords)
    console.log(`📊 聚类策略: ${strategy.strategy} (${strategy.message})`)

    // 3. 获取可用桶
    const availableBuckets = await getAvailableBuckets(offerId)
    console.log(`🎯 可用桶: ${availableBuckets.join(', ') || '(无)'}`)

    if (availableBuckets.length === 0) {
      return NextResponse.json({
        success: false,
        error: '所有关键词桶已被占用，每个 Offer 最多支持 3 个差异化创意',
        data: {
          usedBuckets: await getUsedBuckets(offerId),
          maxCreatives: 3,
          suggestion: '请删除现有创意后再生成新的'
        }
      }, { status: 400 })
    }

    // 4. 确定要生成的桶
    let bucketsToGenerate: BucketType[]
    if (requestedBuckets && Array.isArray(requestedBuckets)) {
      // 验证请求的桶是否可用
      const invalidBuckets = requestedBuckets.filter((b: string) => !availableBuckets.includes(b as BucketType))
      if (invalidBuckets.length > 0) {
        return NextResponse.json({
          success: false,
          error: `以下桶不可用: ${invalidBuckets.join(', ')}`,
          data: { availableBuckets }
        }, { status: 400 })
      }
      bucketsToGenerate = requestedBuckets as BucketType[]
    } else {
      // 根据策略决定生成多少个
      bucketsToGenerate = availableBuckets.slice(0, strategy.bucketCount)
    }

    console.log(`🚀 将生成 ${bucketsToGenerate.length} 个创意: ${bucketsToGenerate.join(', ')}`)

    // 5. 为每个桶生成创意
    const results: Array<{
      bucket: BucketType
      creative: any
      evaluation: ComprehensiveAdStrengthResult | null
      success: boolean
      error?: string
    }> = []

    for (const bucket of bucketsToGenerate) {
      console.log(`\n📝 生成桶 ${bucket} 的创意...`)

      try {
        const bucketInfo = getBucketInfo(pool, bucket)

        // 生成创意（使用桶的关键词）
        const creativeResult = await generateCreativeWithBucket(
          offerId,
          userIdNum,
          offer,
          pool,
          bucket,
          bucketInfo,
          maxRetries
        )

        results.push({
          bucket,
          creative: creativeResult.creative,
          evaluation: creativeResult.evaluation,
          success: true
        })

        console.log(`✅ 桶 ${bucket} 创意生成成功`)
      } catch (error: any) {
        console.error(`❌ 桶 ${bucket} 创意生成失败:`, error.message)
        results.push({
          bucket,
          creative: null,
          evaluation: null,
          success: false,
          error: error.message
        })
      }
    }

    // 6. 计算创意间的关键词重叠率
    const successfulCreatives = results.filter(r => r.success && r.creative)
    let overlapStats = null

    if (successfulCreatives.length >= 2) {
      overlapStats = calculateOverlapStats(successfulCreatives, pool)
    }

    // 7. 返回结果
    const successCount = successfulCreatives.length
    const failCount = results.length - successCount

    return NextResponse.json({
      success: failCount === 0,
      message: failCount === 0
        ? `成功生成 ${successCount} 个差异化创意`
        : `生成 ${successCount} 个成功, ${failCount} 个失败`,
      data: {
        offerId,
        totalGenerated: successCount,
        totalFailed: failCount,

        // 关键词池信息
        keywordPool: {
          id: pool.id,
          totalKeywords: pool.totalKeywords,
          brandKeywordsCount: pool.brandKeywords.length,
          balanceScore: pool.balanceScore
        },

        // 创意列表
        creatives: results.map(r => ({
          bucket: r.bucket,
          success: r.success,
          creative: r.creative ? {
            id: r.creative.id,
            headlines: r.creative.headlines?.length || 0,
            descriptions: r.creative.descriptions?.length || 0,
            keywords: r.creative.keywords?.length || 0,
            theme: r.creative.theme,
            score: r.creative.score,
            bucketIntent: getBucketInfo(pool, r.bucket).intent
          } : null,
          evaluation: r.evaluation ? {
            rating: r.evaluation.finalRating,
            score: r.evaluation.finalScore,
            isExcellent: r.evaluation.finalRating === 'EXCELLENT'
          } : null,
          error: r.error
        })),

        // 重叠统计（关键指标：应该接近 3%，仅品牌词重叠）
        overlapStats,

        // 策略信息
        strategy: {
          bucketCount: strategy.bucketCount,
          strategyType: strategy.strategy,
          message: strategy.message
        }
      }
    })
  } catch (error: any) {
    console.error('生成差异化创意失败:', error)
    return NextResponse.json(
      { error: error.message || '生成差异化创意失败' },
      { status: 500 }
    )
  }
}

/**
 * 为指定桶生成创意
 */
async function generateCreativeWithBucket(
  offerId: number,
  userId: number,
  offer: any,
  pool: OfferKeywordPool,
  bucket: BucketType,
  bucketInfo: { keywords: string[]; intent: string; intentEn: string },
  maxRetries: number
): Promise<{
  creative: any
  evaluation: ComprehensiveAdStrengthResult | null
}> {
  const db = await getDatabase()

  let bestCreative: GeneratedAdCreativeData | null = null
  let bestEvaluation: ComprehensiveAdStrengthResult | null = null
  let attempts = 0

  while (attempts < maxRetries) {
    attempts++
    console.log(`   📝 第 ${attempts} 次尝试 (桶 ${bucket})...`)

    try {
      // 生成创意
      // 注意：当前 generateAdCreative 不支持 bucket_info，
      // 我们通过 theme 参数传递桶意图，并在保存时关联桶信息
      const creative = await generateAdCreative(offerId, userId, {
        theme: `${bucketInfo.intent} - ${bucketInfo.intentEn}`,
        skipCache: attempts > 1
      })

      // 用桶的关键词替换创意关键词
      creative.keywords = bucketInfo.keywords.slice(0, 30) // 最多 30 个关键词

      // 评估 Ad Strength
      const headlinesWithMetadata = creative.headlinesWithMetadata || creative.headlines.map(text => ({
        text,
        length: text.length
      }))
      const descriptionsWithMetadata = creative.descriptionsWithMetadata || creative.descriptions.map(text => ({
        text,
        length: text.length
      }))

      const evaluation = await evaluateCreativeAdStrength(
        headlinesWithMetadata,
        descriptionsWithMetadata,
        creative.keywords,
        { brandName: offer.brand }
      )

      // 保存创意
      const savedCreative = await createAdCreative(
        userId,
        offerId,
        {
          ...creative,
          final_url: offer.final_url || offer.url,
          final_url_suffix: offer.final_url_suffix,
          ai_model: creative.ai_model,
          generation_round: 1,
          score: evaluation.finalScore,
          score_breakdown: evaluation.localEvaluation.dimensions as any,
          adStrength: {
            rating: evaluation.finalRating,
            score: evaluation.finalScore,
            isExcellent: evaluation.finalRating === 'EXCELLENT',
            dimensions: evaluation.localEvaluation.dimensions,
            suggestions: evaluation.combinedSuggestions
          }
        }
      )

      // 更新创意的桶信息
      await db.exec(
        `UPDATE ad_creatives SET
          keyword_bucket = ?,
          keyword_pool_id = ?,
          bucket_intent = ?
        WHERE id = ?`,
        [bucket, pool.id, bucketInfo.intent, savedCreative.id]
      )

      // 检查是否达到 EXCELLENT
      if (evaluation.finalRating === 'EXCELLENT' || attempts >= maxRetries) {
        bestCreative = creative
        bestEvaluation = evaluation

        return {
          creative: {
            ...savedCreative,
            keyword_bucket: bucket,
            bucket_intent: bucketInfo.intent
          },
          evaluation
        }
      }

      // 如果未达到 EXCELLENT，继续重试
      bestCreative = creative
      bestEvaluation = evaluation
    } catch (error: any) {
      console.error(`   ❌ 第 ${attempts} 次尝试失败:`, error.message)
      if (attempts >= maxRetries) {
        throw error
      }
    }
  }

  // 返回最佳结果
  if (!bestCreative) {
    throw new Error('创意生成失败')
  }

  return {
    creative: bestCreative,
    evaluation: bestEvaluation
  }
}

/**
 * 计算创意间的关键词重叠统计
 */
function calculateOverlapStats(
  creatives: Array<{ bucket: BucketType; creative: any }>,
  pool: OfferKeywordPool
): {
  averageOverlapRate: number
  pairwiseOverlaps: Array<{
    bucket1: BucketType
    bucket2: BucketType
    overlapRate: number
    overlapCount: number
  }>
  brandKeywordsShared: number
  targetOverlapRate: string
  isOptimal: boolean
} {
  const pairwiseOverlaps: Array<{
    bucket1: BucketType
    bucket2: BucketType
    overlapRate: number
    overlapCount: number
  }> = []

  // 计算每对创意之间的重叠
  for (let i = 0; i < creatives.length; i++) {
    for (let j = i + 1; j < creatives.length; j++) {
      const keywords1 = creatives[i].creative?.keywords || []
      const keywords2 = creatives[j].creative?.keywords || []

      const set1 = new Set(keywords1.map((k: string) => k.toLowerCase()))
      const set2 = new Set(keywords2.map((k: string) => k.toLowerCase()))

      let overlapCount = 0
      for (const kw of set1) {
        if (set2.has(kw)) overlapCount++
      }

      const overlapRate = Math.max(set1.size, set2.size) > 0
        ? overlapCount / Math.max(set1.size, set2.size)
        : 0

      pairwiseOverlaps.push({
        bucket1: creatives[i].bucket,
        bucket2: creatives[j].bucket,
        overlapRate: Math.round(overlapRate * 100) / 100,
        overlapCount
      })
    }
  }

  // 计算平均重叠率
  const averageOverlapRate = pairwiseOverlaps.length > 0
    ? pairwiseOverlaps.reduce((sum, p) => sum + p.overlapRate, 0) / pairwiseOverlaps.length
    : 0

  // 共享的品牌词数量
  const brandKeywordsShared = pool.brandKeywords.length

  // 目标重叠率：~3%（仅品牌词重叠）
  const targetOverlapRate = '~3%'

  // 是否达到最优（重叠率 < 10%）
  const isOptimal = averageOverlapRate < 0.10

  return {
    averageOverlapRate: Math.round(averageOverlapRate * 100) / 100,
    pairwiseOverlaps,
    brandKeywordsShared,
    targetOverlapRate,
    isOptimal
  }
}
