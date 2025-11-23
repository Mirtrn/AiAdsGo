import { NextRequest, NextResponse } from 'next/server'
import { findAdGroupById } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'
import { findOfferById } from '@/lib/offers'
import { generateKeywords, generateNegativeKeywords } from '@/lib/keyword-generator'
import { createKeywordsBatch, CreateKeywordInput } from '@/lib/keywords'

/**
 * POST /api/ad-groups/:id/generate-keywords
 * 使用AI为Ad Group生成关键词
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { includeNegativeKeywords = false } = body

    // 查找Ad Group
    const adGroup = findAdGroupById(parseInt(id, 10), parseInt(userId, 10))
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 查找Campaign
    const campaign = findCampaignById(adGroup.campaignId, parseInt(userId, 10))
    if (!campaign) {
      return NextResponse.json(
        {
          error: 'Campaign不存在',
        },
        { status: 404 }
      )
    }

    // 查找Offer
    const offer = findOfferById(campaign.offerId, parseInt(userId, 10))
    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在',
        },
        { status: 404 }
      )
    }

    // 检查Offer是否已完成抓取
    if (offer.scrape_status !== 'completed') {
      return NextResponse.json(
        {
          error: '请先完成产品信息抓取后再生成关键词',
        },
        { status: 400 }
      )
    }

    // 生成关键词（使用用户级AI配置）
    const userIdNum = parseInt(userId, 10)
    const generationResult = await generateKeywords(offer, userIdNum)

    // 生成否定关键词（如果需要）
    let negativeKeywords: string[] = []
    if (includeNegativeKeywords) {
      negativeKeywords = await generateNegativeKeywords(offer, userIdNum)
    }

    // 将生成的关键词保存到数据库
    const keywordsToCreate: CreateKeywordInput[] = generationResult.keywords.map(kw => ({
      userId: parseInt(userId, 10),
      adGroupId: adGroup.id,
      keywordText: kw.keyword,
      matchType: kw.matchType,
      status: 'PAUSED', // 默认暂停状态
      aiGenerated: true,
      generationSource: 'gemini-pro',
    }))

    // 如果有否定关键词，也添加到列表
    if (negativeKeywords.length > 0) {
      negativeKeywords.forEach(negKw => {
        keywordsToCreate.push({
          userId: parseInt(userId, 10),
          adGroupId: adGroup.id,
          keywordText: negKw,
          matchType: 'EXACT', // 否定关键词通常使用完全匹配
          status: 'PAUSED',
          isNegative: true,
          aiGenerated: true,
          generationSource: 'gemini-pro-negative',
        })
      })
    }

    // 批量创建关键词
    const createdKeywords = createKeywordsBatch(keywordsToCreate)

    return NextResponse.json({
      success: true,
      keywords: createdKeywords,
      count: createdKeywords.length,
      positiveCount: generationResult.keywords.length,
      negativeCount: negativeKeywords.length,
      categories: generationResult.categories,
      estimatedBudget: generationResult.estimatedBudget,
      recommendations: generationResult.recommendations,
    })
  } catch (error: any) {
    console.error('生成关键词失败:', error)

    return NextResponse.json(
      {
        error: error.message || '生成关键词失败',
      },
      { status: 500 }
    )
  }
}
