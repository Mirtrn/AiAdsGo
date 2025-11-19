import { NextRequest, NextResponse } from 'next/server'
import { resolveAffiliateLink } from '@/lib/url-resolver'
import { findOfferById } from '@/lib/offers'
import { getProxyUrlForCountry, isProxyEnabled } from '@/lib/settings'

/**
 * POST /api/offers/:id/resolve-url
 * 解析Offer的推广链接，获取Final URL和Final URL suffix
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

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取用户的代理配置 - 根据Offer的推广国家获取对应的代理URL
    const userIdNum = parseInt(userId, 10)
    const useProxy = isProxyEnabled(userIdNum)

    // 从Offer获取推广国家，用于选择合适的代理
    const targetCountry = offer.target_country || 'US'
    const proxyUrl = useProxy ? getProxyUrlForCountry(targetCountry, userIdNum) : undefined

    if (!offer.affiliate_link) {
      return NextResponse.json(
        { error: 'Offer没有配置推广链接' },
        { status: 400 }
      )
    }

    console.log(`解析推广链接: ${offer.affiliate_link}`)
    console.log(`使用代理: ${useProxy ? '是' : '否'}`)

    // 尝试使用基础HTTP方式解析
    let resolved: any
    let method = 'http'

    try {
      resolved = await resolveAffiliateLink(offer.affiliate_link, proxyUrl || undefined)

      // 如果没有检测到重定向，尝试使用Playwright
      if (resolved.redirectCount === 0 && offer.affiliate_link !== resolved.finalUrl) {
        console.log('未检测到重定向，尝试使用Playwright...')
        const { resolveAffiliateLinkWithPlaywright } = await import('@/lib/url-resolver-playwright')

        resolved = await resolveAffiliateLinkWithPlaywright(
          offer.affiliate_link,
          proxyUrl || undefined,
          3000
        )
        method = 'playwright'
      }
    } catch (httpError: any) {
      // HTTP方式失败，尝试Playwright
      console.warn(`HTTP解析失败: ${httpError.message}，尝试使用Playwright...`)

      try {
        const { resolveAffiliateLinkWithPlaywright } = await import('@/lib/url-resolver-playwright')

        resolved = await resolveAffiliateLinkWithPlaywright(
          offer.affiliate_link,
          proxyUrl || undefined,
          3000
        )
        method = 'playwright'
      } catch (playwrightError: any) {
        throw new Error(`所有解析方法都失败了:\n- HTTP: ${httpError.message}\n- Playwright: ${playwrightError.message}`)
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        offerId: offer.id,
        offerName: offer.offer_name,
        affiliateLink: offer.affiliate_link,
        finalUrl: resolved.finalUrl,
        finalUrlSuffix: resolved.finalUrlSuffix,
        redirectCount: resolved.redirectCount,
        redirectChain: resolved.redirectChain,
        proxyUsed: useProxy,
        method, // 'http' or 'playwright'
        pageTitle: resolved.pageTitle || null,
      },
    })
  } catch (error: any) {
    console.error('解析URL失败:', error)

    return NextResponse.json(
      {
        error: error.message || '解析URL失败',
        details: error.stack || '',
      },
      { status: 500 }
    )
  }
}
