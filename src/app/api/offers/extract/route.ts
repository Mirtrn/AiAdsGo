/**
 * POST /api/offers/extract
 * 自动提取Offer信息（Final URL、品牌名称等）
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveAffiliateLink, getProxyPool } from '@/lib/url-resolver-enhanced'
import { getAllProxyUrls } from '@/lib/settings'
import { extractProductInfo } from '@/lib/scraper'
import { scrapeAmazonStore, scrapeIndependentStore } from '@/lib/scraper-stealth'
import { createError, ErrorCode, AppError } from '@/lib/errors'

export const maxDuration = 60 // 最长60秒

export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()
    const { affiliate_link, target_country, skipCache = false } = body

    // 验证必填参数
    if (!affiliate_link || !target_country) {
      const missing = []
      if (!affiliate_link) missing.push('affiliate_link')
      if (!target_country) missing.push('target_country')

      const error = createError.requiredField(missing.join(', '))
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    console.log(`🔍 开始自动提取: ${affiliate_link} (国家: ${target_country})`)

    // ========== 步骤1: 加载代理池配置 ==========
    const proxySettings = getAllProxyUrls(userIdNum)

    if (!proxySettings || proxySettings.length === 0) {
      const error = createError.proxyNotConfigured({
        suggestion: '请先在设置页面配置代理URL'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 加载代理到代理池
    const proxyPool = getProxyPool()
    const proxiesWithDefault = proxySettings.map((p) => ({
      url: p.url,
      country: p.country,
      is_default: false // 不设置emergency proxy，所有proxy平等参与国家匹配
    }))
    await proxyPool.loadProxies(proxiesWithDefault)

    // 🔥 检测是否为Amazon Store页面（在URL解析之前检测）
    const isAmazonStoreByUrl = (affiliate_link.includes('/stores/') || affiliate_link.includes('/store/')) &&
                                affiliate_link.includes('amazon.com')

    // ========== 步骤2: 解析推广链接（含缓存、重试、降级） ==========
    let resolvedData

    // 如果是Amazon Store页面，跳过URL解析，直接使用原始链接
    if (isAmazonStoreByUrl) {
      console.log('🏪 检测到Amazon Store页面，跳过URL解析...')
      resolvedData = {
        finalUrl: affiliate_link,
        finalUrlSuffix: '',
        redirectCount: 0,
        redirectChain: [affiliate_link],
        pageTitle: null,
        resolveMethod: 'direct',
        proxyUsed: null,
      }
    } else {
      try {
        resolvedData = await resolveAffiliateLink(affiliate_link, {
          targetCountry: target_country,
          skipCache: skipCache, // 从请求body读取
        })
      } catch (error: any) {
        console.error('URL解析失败:', error)

        // 如果是AppError，直接返回
        if (error instanceof AppError) {
          return NextResponse.json(error.toJSON(), { status: error.httpStatus })
        }

        const appError = createError.urlResolveFailed({
          url: affiliate_link,
          originalError: error.message,
          suggestion: '请检查推广链接是否有效，或稍后重试'
        })
        return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
      }
    }

    // 🔥 URL解析后，再次检测是否为Amazon Store（处理重定向的情况）
    const isAmazonStoreByFinalUrl = (resolvedData.finalUrl.includes('/stores/') || resolvedData.finalUrl.includes('/store/')) &&
                                     resolvedData.finalUrl.includes('amazon.com')

    const isAmazonStore = isAmazonStoreByUrl || isAmazonStoreByFinalUrl

    // 🔍 调试日志
    console.log('🔍 Amazon Store检测:')
    console.log('  - finalUrl:', resolvedData.finalUrl)
    console.log('  - 包含/stores/:', resolvedData.finalUrl.includes('/stores/'))
    console.log('  - 包含amazon.com:', resolvedData.finalUrl.includes('amazon.com'))
    console.log('  - isAmazonStoreByUrl:', isAmazonStoreByUrl)
    console.log('  - isAmazonStoreByFinalUrl:', isAmazonStoreByFinalUrl)
    console.log('  - 最终isAmazonStore:', isAmazonStore)

    // ========== 步骤3: 抓取网页数据识别品牌 ==========
    let brandName = null
    let productDescription = null
    let scrapedData = null
    let storeData = null
    let independentStoreData = null
    let productCount = 0

    try {
      // 🔥 检测是否为独立站店铺首页
      const isIndependentStore = !isAmazonStore && (() => {
        const url = resolvedData.finalUrl.toLowerCase()
        const urlObj = new URL(resolvedData.finalUrl)
        const pathname = urlObj.pathname

        // 排除明确的单品页面路径
        const isSingleProductPage =
          pathname.includes('/products/') ||
          pathname.includes('/product/') ||
          pathname.includes('/p/') ||
          pathname.includes('/dp/') ||
          pathname.includes('/item/')

        // 店铺首页特征：根路径、collections、shop等
        const isStorePage =
          pathname === '/' ||
          pathname.match(/^\/(collections|shop|store|category|catalogue)(\/.+)?$/i) ||
          pathname.split('/').filter(Boolean).length <= 1

        return !isSingleProductPage && isStorePage
      })()

      if (isAmazonStore) {
        console.log('🏪 检测到Amazon Store页面，使用浏览器抓取...')

        // 使用Playwright浏览器抓取Amazon Store
        const defaultProxy = proxySettings[0]?.url
        storeData = await scrapeAmazonStore(resolvedData.finalUrl, defaultProxy)

        // 从Store数据中提取品牌信息
        brandName = storeData.brandName || storeData.storeName
        productDescription = storeData.storeDescription
        productCount = storeData.totalProducts

        console.log(`✅ Amazon Store识别成功: ${brandName}, 产品数: ${productCount}`)
      } else if (isIndependentStore) {
        console.log('🏬 检测到独立站首页，使用浏览器抓取产品列表...')

        // 使用Playwright浏览器抓取独立站产品
        const defaultProxy = proxySettings[0]?.url
        independentStoreData = await scrapeIndependentStore(resolvedData.finalUrl, defaultProxy)

        // 从独立站数据中提取品牌信息
        brandName = independentStoreData.storeName
        productDescription = independentStoreData.storeDescription
        productCount = independentStoreData.totalProducts

        console.log(`✅ 独立站识别成功: ${brandName}, 产品数: ${productCount}, 平台: ${independentStoreData.platform}`)
      } else {
        // 使用普通scraper抓取单个产品页面
        scrapedData = await extractProductInfo(resolvedData.finalUrl, target_country)

        // 从抓取数据中提取品牌名称
        if (scrapedData.brand) {
          brandName = scrapedData.brand
        }

        if (scrapedData.description) {
          productDescription = scrapedData.description
        }

        console.log(`✅ 品牌识别成功: ${brandName}`)
      }
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

        // 🔥 P1优化：单品页也返回价格和图片数据
        ...(scrapedData && {
          productName: scrapedData.productName,
          price: scrapedData.price,
          imageUrls: scrapedData.imageUrls,
        }),

        // 🔥 Amazon Store专属数据
        ...(storeData && {
          productCount,
          products: storeData.products,
          storeName: storeData.storeName,
          hotInsights: storeData.hotInsights,
        }),

        // 🔥 独立站专属数据
        ...(independentStoreData && {
          productCount,
          products: independentStoreData.products,
          storeName: independentStoreData.storeName,
          logoUrl: independentStoreData.logoUrl,
          platform: independentStoreData.platform,
        }),

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
          isAmazonStore: !!storeData,
          isIndependentStore: !!independentStoreData,
          productsExtracted: productCount,
        },
      },
    })
  } catch (error: any) {
    console.error('自动提取失败:', error)

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 通用系统错误
    const appError = createError.internalError({
      operation: 'offer_extraction',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
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
