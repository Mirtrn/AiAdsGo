import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { findActiveGoogleAdsAccounts } from '@/lib/google-ads-accounts'
import {
  getKeywordIdeas,
  filterHighQualityKeywords,
  rankKeywordsByRelevance,
  groupKeywordsByTheme,
  formatCpcMicros,
  formatSearchVolume,
} from '@/lib/google-ads-keyword-planner'

/**
 * POST /api/offers/:id/keyword-ideas
 * 获取关键词建议
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
    const {
      seedKeywords = [],
      useUrl = true,
      filterOptions = {},
    } = body

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取用户的激活Google Ads账号
    const googleAdsAccounts = findActiveGoogleAdsAccounts(parseInt(userId, 10))

    if (googleAdsAccounts.length === 0) {
      return NextResponse.json(
        {
          error: '未找到已连接的Google Ads账号，请先连接您的Google Ads账号',
          needsConnection: true,
        },
        { status: 400 }
      )
    }

    const googleAdsAccount = googleAdsAccounts[0]

    if (!googleAdsAccount.refreshToken) {
      return NextResponse.json(
        {
          error: 'Google Ads账号授权已过期，请重新连接',
          needsReauth: true,
        },
        { status: 400 }
      )
    }

    // 准备种子关键词
    let finalSeedKeywords = [...seedKeywords]

    // 如果没有提供种子关键词，使用品牌名称
    if (finalSeedKeywords.length === 0) {
      finalSeedKeywords = [
        offer.brand,
        `${offer.brand} official`,
        `${offer.brand} store`,
      ]
    }

    console.log(`获取关键词建议: seeds=${finalSeedKeywords.join(', ')}, url=${useUrl ? offer.url : 'none'}`)

    // 调用Keyword Planner API
    const keywordIdeas = await getKeywordIdeas({
      customerId: googleAdsAccount.customerId,
      refreshToken: googleAdsAccount.refreshToken,
      seedKeywords: finalSeedKeywords,
      pageUrl: useUrl ? offer.url : undefined,
      targetCountry: offer.target_country,
      targetLanguage: offer.target_language || 'English',
      accountId: googleAdsAccount.id,
      userId: parseInt(userId, 10),
    })

    console.log(`获取到${keywordIdeas.length}个关键词建议`)

    // 过滤高质量关键词
    const filteredKeywords = filterHighQualityKeywords(keywordIdeas, {
      minMonthlySearches: filterOptions.minMonthlySearches || 100,
      maxCompetitionIndex: filterOptions.maxCompetitionIndex || 80,
      maxCpcMicros: filterOptions.maxCpcMicros,
      excludeCompetition: filterOptions.excludeCompetition || [],
    })

    console.log(`过滤后剩余${filteredKeywords.length}个高质量关键词`)

    // 按相关性排序
    const rankedKeywords = rankKeywordsByRelevance(filteredKeywords)

    // 按主题分组
    const groupedKeywords = groupKeywordsByTheme(rankedKeywords)

    // 格式化返回数据
    const currency = offer.target_country === 'CN' ? 'CNY' : 'USD'

    const formattedKeywords = rankedKeywords.slice(0, 50).map(kw => ({
      text: kw.text,
      avgMonthlySearches: kw.avgMonthlySearches,
      avgMonthlySearchesFormatted: formatSearchVolume(kw.avgMonthlySearches),
      competition: kw.competition,
      competitionIndex: kw.competitionIndex,
      lowTopOfPageBid: formatCpcMicros(kw.lowTopOfPageBidMicros, currency),
      highTopOfPageBid: formatCpcMicros(kw.highTopOfPageBidMicros, currency),
      avgTopOfPageBid: formatCpcMicros(
        (kw.lowTopOfPageBidMicros + kw.highTopOfPageBidMicros) / 2,
        currency
      ),
      lowTopOfPageBidMicros: kw.lowTopOfPageBidMicros,
      highTopOfPageBidMicros: kw.highTopOfPageBidMicros,
    }))

    // 分组统计
    const groupStats = Object.entries(groupedKeywords).map(([theme, keywords]) => ({
      theme,
      count: keywords.length,
      topKeywords: keywords.slice(0, 3).map(kw => kw.text),
    }))

    return NextResponse.json({
      success: true,
      keywords: formattedKeywords,
      total: rankedKeywords.length,
      filtered: filteredKeywords.length,
      original: keywordIdeas.length,
      groupStats,
      offer: {
        id: offer.id,
        brand: offer.brand,
        targetCountry: offer.target_country,
        targetLanguage: offer.target_language,
      },
      filterOptions: {
        minMonthlySearches: filterOptions.minMonthlySearches || 100,
        maxCompetitionIndex: filterOptions.maxCompetitionIndex || 80,
      },
    })
  } catch (error: any) {
    console.error('获取关键词建议失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取关键词建议失败',
        details: error.stack || '',
      },
      { status: 500 }
    )
  }
}
