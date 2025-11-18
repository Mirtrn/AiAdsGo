import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { createCreatives } from '@/lib/creatives'
import { generateAdCreatives } from '@/lib/ai'

/**
 * POST /api/offers/:id/generate-creatives
 * 为指定Offer生成AI创意
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

    const body = await request.json()
    const { count = 3 } = body // 默认生成3组创意

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 验证Offer已完成抓取
    if (offer.scrape_status !== 'completed') {
      return NextResponse.json(
        {
          error: '请先完成产品信息抓取后再生成创意',
        },
        { status: 400 }
      )
    }

    // 验证必要字段存在
    if (!offer.brand_description || !offer.unique_selling_points) {
      return NextResponse.json(
        {
          error: '产品信息不完整，请重新抓取或手动补充',
        },
        { status: 400 }
      )
    }

    // 使用AI生成创意（包含历史创意学习）
    const aiResponse = await generateAdCreatives(
      {
        brand: offer.brand,
        brandDescription: offer.brand_description,
        uniqueSellingPoints: offer.unique_selling_points,
        productHighlights: offer.product_highlights || '',
        targetAudience: offer.target_audience || '',
        targetCountry: offer.target_country,
      },
      parseInt(userId, 10) // 传入userId以启用学习系统
    )

    // 构建创意数据（根据AI返回的数量创建）
    const creativeInputs = []
    const numCreatives = Math.min(
      count,
      Math.min(aiResponse.headlines.length, aiResponse.descriptions.length)
    )

    for (let i = 0; i < numCreatives; i++) {
      creativeInputs.push({
        userId: parseInt(userId, 10),
        offerId: offer.id,
        headline1: aiResponse.headlines[i] || '',
        headline2: aiResponse.headlines[i + 1] || undefined,
        headline3: aiResponse.headlines[i + 2] || undefined,
        description1: aiResponse.descriptions[i] || '',
        description2: aiResponse.descriptions[i + 1] || undefined,
        finalUrl: offer.affiliate_link || offer.url,
        aiModel: process.env.PRIMARY_AI_MODEL || 'gemini',
        generationPrompt: JSON.stringify({
          brand: offer.brand,
          targetCountry: offer.target_country,
          brandDescription: offer.brand_description,
          uniqueSellingPoints: offer.unique_selling_points,
        }),
      })
    }

    // 批量保存创意到数据库
    const creatives = createCreatives(creativeInputs)

    return NextResponse.json({
      success: true,
      creatives,
      count: creatives.length,
      usedLearning: aiResponse.usedLearning,
      learningMessage: aiResponse.usedLearning
        ? '已根据您的历史高表现创意优化生成'
        : '使用基础模板生成（暂无足够历史数据）'
    })
  } catch (error: any) {
    console.error('生成创意失败:', error)

    return NextResponse.json(
      {
        error: error.message || '生成创意失败',
      },
      { status: 500 }
    )
  }
}
