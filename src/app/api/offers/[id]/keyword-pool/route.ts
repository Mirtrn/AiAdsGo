import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import {
  getKeywordPoolByOfferId,
  generateOfferKeywordPool,
  deleteKeywordPool,
  getAvailableBuckets,
  getUsedBuckets,
  getBucketInfo,
  determineClusteringStrategy,
  type OfferKeywordPool,
  type BucketType
} from '@/lib/offer-keyword-pool'
import { POST as rebuildOfferPost } from '@/app/api/offers/[id]/rebuild/route'

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

/**
 * GET /api/offers/:id/keyword-pool
 * 获取 Offer 的关键词池
 *
 * Query Parameters:
 * - includeBucketDetails: boolean - 是否包含各桶详情
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
    const userIdNum = parseInt(userId, 10)

    // 验证 Offer 存在且属于当前用户
    const offer = await findOfferById(offerId, userIdNum)
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer 不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取关键词池
    const pool = await getKeywordPoolByOfferId(offerId)

    if (!pool) {
      return NextResponse.json({
        success: true,
        data: {
          offerId,
          exists: false,
          message: '关键词池尚未创建，请调用 POST 方法生成'
        }
      })
    }

    // 获取桶使用情况
    const usedBuckets = await getUsedBuckets(offerId)
    const availableBuckets = await getAvailableBuckets(offerId)

    // 解析 query 参数
    const { searchParams } = new URL(request.url)
    const includeBucketDetails = searchParams.get('includeBucketDetails') === 'true'

    // 构建响应
    const response: any = {
      success: true,
      data: {
        id: pool.id,
        offerId: pool.offerId,
        exists: true,

        // 统计信息
        totalKeywords: pool.totalKeywords,
        brandKeywordsCount: pool.brandKeywords.length,
        bucketACount: pool.bucketAKeywords.length,
        bucketBCount: pool.bucketBKeywords.length,
        bucketCCount: pool.bucketCKeywords.length,

        // 桶使用情况
        usedBuckets,
        availableBuckets,
        creativesCount: usedBuckets.length,
        maxCreatives: 3,

        // 质量指标
        balanceScore: pool.balanceScore,
        clusteringModel: pool.clusteringModel,
        clusteringPromptVersion: pool.clusteringPromptVersion,

        // 时间戳
        createdAt: pool.createdAt,
        updatedAt: pool.updatedAt
      }
    }

    // 如果请求包含桶详情
    if (includeBucketDetails) {
      response.data.buckets = {
        brand: {
          keywords: pool.brandKeywords,
          count: pool.brandKeywords.length,
          description: '纯品牌词（所有创意共享）'
        },
        A: {
          intent: pool.bucketAIntent,
          intentEn: 'Brand-Oriented',
          keywords: pool.bucketAKeywords,
          count: pool.bucketAKeywords.length,
          isUsed: usedBuckets.includes('A'),
          description: '用户知道要买什么品牌'
        },
        B: {
          intent: pool.bucketBIntent,
          intentEn: 'Scenario-Oriented',
          keywords: pool.bucketBKeywords,
          count: pool.bucketBKeywords.length,
          isUsed: usedBuckets.includes('B'),
          description: '用户知道要解决什么问题'
        },
        C: {
          intent: pool.bucketCIntent,
          intentEn: 'Feature-Oriented',
          keywords: pool.bucketCKeywords,
          count: pool.bucketCKeywords.length,
          isUsed: usedBuckets.includes('C'),
          description: '用户关注技术规格/功能特性'
        }
      }
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('获取关键词池失败:', error)
    return NextResponse.json(
      { error: error.message || '获取关键词池失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/offers/:id/keyword-pool
 * 生成 Offer 的关键词池
 *
 * Request Body:
 * - forceRegenerate: boolean - 是否触发重建Offer（替代关键词池重建）
 * - keywords: string[] - 可选，指定关键词列表（否则自动提取）
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

    // 解析请求体
    const body = await request.json().catch(() => ({}))
    const forceRegenerate = parseBooleanFlag(body.forceRegenerate)
    const keywords = Array.isArray(body.keywords) ? body.keywords : undefined

    console.log(`📦 POST /api/offers/${offerId}/keyword-pool`)
    console.log(`   forceRegenerate: ${forceRegenerate}`)
    console.log(`   keywords: ${keywords ? `${keywords.length} 个` : '自动提取'}`)

    if (forceRegenerate) {
      console.log(`🔁 forceRegenerate=true，改为触发 /api/offers/${offerId}/rebuild`)
      return rebuildOfferPost(request, { params })
    }

    // 检查是否需要生成
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      return NextResponse.json({
        success: true,
        message: '关键词池已存在，跳过生成。如需重建，请调用 /api/offers/:id/rebuild',
        data: {
          id: existing.id,
          offerId: existing.offerId,
          totalKeywords: existing.totalKeywords,
          isNew: false
        }
      })
    }

    // 生成关键词池
    const pool = await generateOfferKeywordPool(offerId, userIdNum, keywords)

    // 确定聚类策略
    const strategy = determineClusteringStrategy(pool.totalKeywords)

    // 获取可用桶
    const availableBuckets = await getAvailableBuckets(offerId)

    return NextResponse.json({
      success: true,
      message: '关键词池创建成功',
      data: {
        id: pool.id,
        offerId: pool.offerId,
        totalKeywords: pool.totalKeywords,
        isNew: true,

        // 统计信息
        brandKeywordsCount: pool.brandKeywords.length,
        bucketACount: pool.bucketAKeywords.length,
        bucketBCount: pool.bucketBKeywords.length,
        bucketCCount: pool.bucketCKeywords.length,

        // 质量指标
        balanceScore: pool.balanceScore,
        clusteringModel: pool.clusteringModel,

        // 策略建议
        strategy: {
          bucketCount: strategy.bucketCount,
          strategyType: strategy.strategy,
          message: strategy.message
        },

        // 可用桶
        availableBuckets
      }
    })
  } catch (error: any) {
    console.error('生成关键词池失败:', error)
    return NextResponse.json(
      { error: error.message || '生成关键词池失败' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/offers/:id/keyword-pool
 * 删除 Offer 的关键词池
 */
export async function DELETE(
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

    // 检查是否存在
    const existing = await getKeywordPoolByOfferId(offerId)
    if (!existing) {
      return NextResponse.json(
        { error: '关键词池不存在' },
        { status: 404 }
      )
    }

    // 删除
    await deleteKeywordPool(offerId)

    return NextResponse.json({
      success: true,
      message: '关键词池已删除'
    })
  } catch (error: any) {
    console.error('删除关键词池失败:', error)
    return NextResponse.json(
      { error: error.message || '删除关键词池失败' },
      { status: 500 }
    )
  }
}
