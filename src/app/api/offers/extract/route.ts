/**
 * POST /api/offers/extract
 * 自动提取Offer信息（Final URL、品牌名称等）
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveAffiliateLink, getProxyPool } from '@/lib/url-resolver-enhanced'
import { getAllProxyUrls } from '@/lib/settings'
import { extractProductInfo } from '@/lib/scraper'

export const maxDuration = 60 // 最长60秒

export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()
    const { affiliate_link, target_country } = body

    // 验证必填参数
    if (!affiliate_link || !target_country) {
      return NextResponse.json(
        { error: '缺少必填参数：affiliate_link 和 target_country' },
        { status: 400 }
      )
    }

    console.log(`🔍 开始自动提取: ${affiliate_link} (国家: ${target_country})`)

    // ========== 步骤1: 加载代理池配置 ==========
    const proxySettings = getAllProxyUrls(userIdNum)

    if (!proxySettings || proxySettings.length === 0) {
      return NextResponse.json(
        { error: '未配置代理URL，请先在设置页面配置代理' },
        { status: 400 }
      )
    }

    // 加载代理到代理池
    const proxyPool = getProxyPool()
    await proxyPool.loadProxies(proxySettings)

    // ========== 步骤2: 解析推广链接（含缓存、重试、降级） ==========
    let resolvedData
    try {
      resolvedData = await resolveAffiliateLink(affiliate_link, {
        targetCountry: target_country,
        skipCache: false, // 使用缓存
      })
    } catch (error: any) {
      console.error('URL解析失败:', error)
      return NextResponse.json(
        {
          error: 'URL解析失败',
          details: error.message,
          suggestion: '请检查推广链接是否有效，或稍后重试',
        },
        { status: 500 }
      )
    }

    // ========== 步骤3: 抓取网页数据识别品牌 ==========
    let brandName = null
    let productDescription = null
    let scrapedData = null

    try {
      // 使用scraper抓取网页数据
      scrapedData = await extractProductInfo(resolvedData.finalUrl, target_country)

      // 从抓取数据中提取品牌名称
      if (scrapedData.brand) {
        brandName = scrapedData.brand
      }

      if (scrapedData.description) {
        productDescription = scrapedData.description
      }

      console.log(`✅ 品牌识别成功: ${brandName}`)
    } catch (error: any) {
      console.error('品牌识别失败:', error)
      // 品牌识别失败不中断流程，用户可以手动填写
    }

    // ========== 步骤4: 确定推广语言 ==========
    const targetLanguage = getLanguageByCountry(target_country)

    // ========== 步骤5: 返回自动提取的数据 ==========
    return NextResponse.json({
      success: true,
      data: {
        // 自动提取的数据
        finalUrl: resolvedData.finalUrl,
        finalUrlSuffix: resolvedData.finalUrlSuffix,
        brand: brandName,
        productDescription,
        targetLanguage,

        // 元数据
        redirectCount: resolvedData.redirectCount,
        redirectChain: resolvedData.redirectChain,
        pageTitle: resolvedData.pageTitle,
        resolveMethod: resolvedData.resolveMethod,
        proxyUsed: resolvedData.proxyUsed,

        // 调试信息
        debug: {
          scrapedDataAvailable: !!scrapedData,
          brandAutoDetected: !!brandName,
        },
      },
    })
  } catch (error: any) {
    console.error('自动提取失败:', error)
    return NextResponse.json(
      {
        error: '自动提取失败',
        details: error.message,
      },
      { status: 500 }
    )
  }
}

/**
 * 根据国家代码确定语言
 */
function getLanguageByCountry(countryCode: string): string {
  const languageMap: Record<string, string> = {
    US: 'English',
    GB: 'English',
    CA: 'English',
    AU: 'English',
    DE: 'German',
    FR: 'French',
    ES: 'Spanish',
    IT: 'Italian',
    NL: 'Dutch',
    SE: 'Swedish',
    NO: 'Norwegian',
    DK: 'Danish',
    FI: 'Finnish',
    PL: 'Polish',
    JP: 'Japanese',
    CN: 'Chinese',
    KR: 'Korean',
    IN: 'English',
    TH: 'Thai',
    VN: 'Vietnamese',
    MX: 'Spanish',
    BR: 'Portuguese',
  }

  return languageMap[countryCode] || 'English'
}
