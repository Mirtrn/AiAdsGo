/**
 * Offer信息提取触发器
 * 异步提取推广链接的Final URL和品牌名称
 *
 * 用于批量导入时的后台处理，与手动创建的extract流程保持一致
 */

import { updateOffer, updateOfferScrapeStatus } from './offers'
import { resolveAffiliateLink, getProxyPool } from './url-resolver-enhanced'
import { getAllProxyUrls } from './settings'
import { extractProductInfo } from './scraper'
import { scrapeAmazonStore, scrapeIndependentStore } from './scraper-stealth'
import { triggerOfferScraping } from './offer-scraping'
import { normalizeBrandName } from './offer-utils'

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

/**
 * 触发Offer信息提取（异步，不阻塞）
 *
 * 流程：
 * 1. 解析推广链接获取Final URL
 * 2. 抓取网页识别品牌名称
 * 3. 更新Offer记录
 * 4. 触发后续的数据抓取（scraping）
 *
 * @param offerId Offer ID
 * @param userId User ID
 * @param affiliateLink 推广链接
 * @param targetCountry 目标国家代码
 */
export async function triggerOfferExtraction(
  offerId: number,
  userId: number,
  affiliateLink: string,
  targetCountry: string
): Promise<void> {
  console.log(`[OfferExtraction] 开始异步提取 Offer #${offerId}`)

  try {
    // 更新状态为 in_progress
    updateOfferScrapeStatus(offerId, userId, 'in_progress')

    // ========== 步骤1: 加载代理池配置 ==========
    const proxySettings = getAllProxyUrls(userId)

    if (!proxySettings || proxySettings.length === 0) {
      throw new Error('未配置代理URL，请先在设置页面配置')
    }

    // 加载代理到代理池
    const proxyPool = getProxyPool()
    const proxiesWithDefault = proxySettings.map((p) => ({
      url: p.url,
      country: p.country,
      is_default: false
    }))
    await proxyPool.loadProxies(proxiesWithDefault)

    // 🔥 检测是否为Amazon Store页面
    const isAmazonStoreByUrl = (affiliateLink.includes('/stores/') || affiliateLink.includes('/store/')) &&
                               affiliateLink.includes('amazon.com')

    // ========== 步骤2: 解析推广链接 ==========
    let resolvedData

    if (isAmazonStoreByUrl) {
      console.log(`[OfferExtraction] #${offerId} 检测到Amazon Store页面，跳过URL解析`)
      resolvedData = {
        finalUrl: affiliateLink,
        finalUrlSuffix: '',
        redirectCount: 0,
        resolveMethod: 'direct',
      }
    } else {
      resolvedData = await resolveAffiliateLink(affiliateLink, {
        targetCountry: targetCountry,
        skipCache: false,
      })
    }

    console.log(`[OfferExtraction] #${offerId} URL解析完成: ${resolvedData.finalUrl}`)

    // 🔥 URL解析后，再次检测是否为Amazon Store
    const isAmazonStoreByFinalUrl = (resolvedData.finalUrl.includes('/stores/') || resolvedData.finalUrl.includes('/store/')) &&
                                     resolvedData.finalUrl.includes('amazon.com')
    const isAmazonStore = isAmazonStoreByUrl || isAmazonStoreByFinalUrl

    // ========== 步骤3: 抓取网页数据识别品牌 ==========
    let brandName: string | null = null
    let productDescription: string | null = null

    try {
      // 检测是否为独立站店铺首页
      const isIndependentStore = !isAmazonStore && (() => {
        const urlObj = new URL(resolvedData.finalUrl)
        const pathname = urlObj.pathname
        const isSingleProductPage =
          pathname.includes('/products/') ||
          pathname.includes('/product/') ||
          pathname.includes('/p/') ||
          pathname.includes('/dp/') ||
          pathname.includes('/item/')
        const isStorePage =
          pathname === '/' ||
          pathname.match(/^\/(collections|shop|store|category|catalogue)(\/.+)?$/i) ||
          pathname.split('/').filter(Boolean).length <= 1
        return !isSingleProductPage && isStorePage
      })()

      if (isAmazonStore) {
        console.log(`[OfferExtraction] #${offerId} 使用浏览器抓取Amazon Store`)
        const defaultProxy = proxySettings[0]?.url
        const storeData = await scrapeAmazonStore(resolvedData.finalUrl, defaultProxy)
        brandName = storeData.brandName || storeData.storeName
        productDescription = storeData.storeDescription
      } else if (isIndependentStore) {
        console.log(`[OfferExtraction] #${offerId} 使用浏览器抓取独立站`)
        const defaultProxy = proxySettings[0]?.url
        const independentStoreData = await scrapeIndependentStore(resolvedData.finalUrl, defaultProxy)
        brandName = independentStoreData.storeName
        productDescription = independentStoreData.storeDescription
      } else {
        console.log(`[OfferExtraction] #${offerId} 抓取单品页面`)
        const scrapedData = await extractProductInfo(resolvedData.finalUrl, targetCountry)
        brandName = scrapedData.brand || null
        productDescription = scrapedData.description || null
      }

      console.log(`[OfferExtraction] #${offerId} 品牌识别: ${brandName || '未识别'}`)
    } catch (error: any) {
      console.error(`[OfferExtraction] #${offerId} 品牌识别失败:`, error.message)
      // 品牌识别失败不中断流程
    }

    // ========== 步骤4: 更新Offer记录 ==========
    const targetLanguage = getLanguageByCountry(targetCountry)

    // 规范化品牌名称（首字母大写）
    const normalizedBrandName = brandName ? normalizeBrandName(brandName) : `Offer_${offerId}`

    updateOffer(offerId, userId, {
      url: resolvedData.finalUrl,
      brand: normalizedBrandName,
      final_url: resolvedData.finalUrl,
      final_url_suffix: resolvedData.finalUrlSuffix || '',
      brand_description: productDescription || undefined,
    })

    console.log(`[OfferExtraction] #${offerId} Offer记录已更新，品牌名: ${normalizedBrandName}`)

    // ========== 步骤5: 触发后续的数据抓取 ==========
    // 更新状态为 pending，让 scraping 流程继续
    updateOfferScrapeStatus(offerId, userId, 'pending')

    // 触发详细数据抓取
    triggerOfferScraping(
      offerId,
      userId,
      resolvedData.finalUrl,
      normalizedBrandName
    )

    console.log(`[OfferExtraction] #${offerId} 已触发后续数据抓取`)

  } catch (error: any) {
    console.error(`[OfferExtraction] #${offerId} 提取失败:`, error)

    // 更新状态为失败
    updateOfferScrapeStatus(offerId, userId, 'failed', error.message)

    // 即使提取失败，也尝试更新品牌名称为可识别的值
    try {
      updateOffer(offerId, userId, {
        brand: `提取失败_${offerId}`,
      })
    } catch (updateError) {
      console.error(`[OfferExtraction] #${offerId} 更新失败状态时出错:`, updateError)
    }
  }
}
