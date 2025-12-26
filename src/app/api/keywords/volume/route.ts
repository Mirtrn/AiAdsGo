/**
 * Keyword Search Volume API
 * GET /api/keywords/volume?keywords=kw1,kw2&country=US&language=en
 */
import { NextRequest, NextResponse } from 'next/server'
import { getKeywordSearchVolumes } from '@/lib/keyword-planner'

export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const keywordsParam = searchParams.get('keywords')
    const country = searchParams.get('country') || 'US'
    const language = searchParams.get('language') || 'en'

    if (!keywordsParam) {
      return NextResponse.json({ error: 'keywords parameter required' }, { status: 400 })
    }

    const keywords = keywordsParam.split(',').map(k => k.trim()).filter(Boolean)
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'No valid keywords provided' }, { status: 400 })
    }

    if (keywords.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 keywords per request' }, { status: 400 })
    }

    const volumes = await getKeywordSearchVolumes(keywords, country, language, parseInt(userId, 10))

    return NextResponse.json({
      success: true,
      country,
      language,
      keywords: volumes.map(v => ({
        keyword: v.keyword,
        searchVolume: v.avgMonthlySearches,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowBid: v.lowTopPageBid,
        highBid: v.highTopPageBid,
      })),
    })
  } catch (error: any) {
    console.error('[KeywordsVolume] Error:', error)

    // 检查是否为 Keyword Planner 权限错误
    if (error.message?.startsWith('KEYWORD_PLANNER_REQUIRES_OAUTH|')) {
      const message = error.message.split('|')[1] || 'Keyword Planner API 需要 OAuth 授权模式'
      return NextResponse.json({
        error: message,
        errorCode: 'KEYWORD_PLANNER_REQUIRES_OAUTH',
        requiresOAuth: true
      }, { status: 403 })
    }

    return NextResponse.json({ error: 'Failed to fetch keyword volumes' }, { status: 500 })
  }
}
