import { NextRequest, NextResponse } from 'next/server'
import { evaluateAdStrength } from '@/lib/ad-strength-evaluator'
import type { HeadlineAsset, DescriptionAsset } from '@/lib/ad-creative'

/**
 * POST /api/ad-strength/batch-evaluate
 * 批量评估多个广告创意的Ad Strength
 *
 * 用途：
 * 1. A/B测试：一次评估多个创意变体
 * 2. 批量筛选：从大量创意中筛选最优
 * 3. 历史回测：评估历史创意质量
 */
export async function POST(request: NextRequest) {
  try {
    // 从请求头获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { creatives, returnBestOnly = false } = body

    // 验证输入
    if (!creatives || !Array.isArray(creatives) || creatives.length === 0) {
      return NextResponse.json(
        { error: 'creatives必须是非空数组' },
        { status: 400 }
      )
    }

    if (creatives.length > 50) {
      return NextResponse.json(
        { error: '单次最多评估50个创意' },
        { status: 400 }
      )
    }

    console.log(`📊 开始批量评估 ${creatives.length} 个创意...`)

    // 批量评估
    const evaluations = await Promise.all(
      creatives.map(async (creative, index) => {
        try {
          // 验证创意格式
          if (!creative.headlines || !creative.descriptions || !creative.keywords) {
            throw new Error(`创意 ${index + 1} 缺少必要字段`)
          }

          // 转换为标准格式
          const headlines: HeadlineAsset[] = creative.headlinesWithMetadata ||
            creative.headlines.map((text: string) => ({ text, length: text.length }))

          const descriptions: DescriptionAsset[] = creative.descriptionsWithMetadata ||
            creative.descriptions.map((text: string) => ({ text, length: text.length }))

          // 评估
          const evaluation = await evaluateAdStrength(
            headlines,
            descriptions,
            creative.keywords
          )

          return {
            id: creative.id || `creative_${index + 1}`,
            index: index + 1,
            creative: {
              headlines: creative.headlines,
              descriptions: creative.descriptions
            },
            evaluation: {
              rating: evaluation.rating,
              score: evaluation.overallScore,
              isExcellent: evaluation.rating === 'EXCELLENT',
              dimensions: evaluation.dimensions,
              suggestions: evaluation.suggestions
            },
            success: true
          }
        } catch (error: any) {
          console.error(`评估创意 ${index + 1} 失败:`, error)
          return {
            id: creative.id || `creative_${index + 1}`,
            index: index + 1,
            success: false,
            error: error.message
          }
        }
      })
    )

    // 统计结果
    const successCount = evaluations.filter(e => e.success).length
    const failCount = evaluations.filter(e => !e.success).length

    // 统计评级分布
    const ratingDistribution = {
      EXCELLENT: 0,
      GOOD: 0,
      AVERAGE: 0,
      POOR: 0,
      PENDING: 0
    }

    evaluations.forEach(e => {
      if (e.success && e.evaluation) {
        ratingDistribution[e.evaluation.rating as keyof typeof ratingDistribution]++
      }
    })

    // 找到最佳创意
    const bestCreative = evaluations
      .filter(e => e.success && e.evaluation)
      .sort((a, b) => (b.evaluation?.score || 0) - (a.evaluation?.score || 0))[0]

    console.log(`✅ 批量评估完成: ${successCount}成功, ${failCount}失败`)
    console.log(`🏆 最佳创意: ${bestCreative?.id} (${bestCreative?.evaluation?.score}分)`)

    // 返回结果
    if (returnBestOnly) {
      // 仅返回最佳创意
      return NextResponse.json({
        success: true,
        bestCreative,
        summary: {
          totalCount: creatives.length,
          successCount,
          failCount,
          ratingDistribution,
          averageScore: evaluations
            .filter(e => e.success && e.evaluation)
            .reduce((sum, e) => sum + (e.evaluation?.score || 0), 0) / successCount
        }
      })
    } else {
      // 返回所有评估结果
      return NextResponse.json({
        success: true,
        evaluations,
        bestCreative,
        summary: {
          totalCount: creatives.length,
          successCount,
          failCount,
          ratingDistribution,
          averageScore: evaluations
            .filter(e => e.success && e.evaluation)
            .reduce((sum, e) => sum + (e.evaluation?.score || 0), 0) / successCount
        }
      })
    }
  } catch (error: any) {
    console.error('批量评估失败:', error)
    return NextResponse.json(
      { error: error.message || '批量评估失败' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/ad-strength/batch-evaluate
 * 获取批量评估使用说明
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/ad-strength/batch-evaluate',
    method: 'POST',
    description: '批量评估多个广告创意的Ad Strength',
    requestBody: {
      creatives: [
        {
          id: 'optional_creative_id',
          headlines: ['string[]', '15 headlines'],
          descriptions: ['string[]', '4 descriptions'],
          keywords: ['string[]'],
          headlinesWithMetadata: 'optional HeadlineAsset[]',
          descriptionsWithMetadata: 'optional DescriptionAsset[]'
        }
      ],
      returnBestOnly: 'boolean (default: false) - 仅返回最佳创意'
    },
    limits: {
      maxCreatives: 50,
      rateLimit: '100 requests/hour'
    },
    responseFormat: {
      success: true,
      evaluations: [
        {
          id: 'creative_id',
          index: 1,
          creative: { headlines: [], descriptions: [] },
          evaluation: {
            rating: 'EXCELLENT | GOOD | AVERAGE | POOR',
            score: 92,
            isExcellent: true,
            dimensions: {},
            suggestions: []
          },
          success: true
        }
      ],
      bestCreative: {},
      summary: {
        totalCount: 10,
        successCount: 10,
        failCount: 0,
        ratingDistribution: {
          EXCELLENT: 5,
          GOOD: 3,
          AVERAGE: 2,
          POOR: 0
        },
        averageScore: 85.5
      }
    }
  })
}
