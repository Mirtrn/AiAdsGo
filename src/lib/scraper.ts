import axios from 'axios'
import { load } from 'cheerio'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getProxyIp, ProxyCredentials } from './proxy/fetch-proxy-ip'
import { normalizeBrandName } from './offer-utils'
import { getAcceptLanguageHeader, getLanguageCodeForCountry } from './language-country-codes'

const PROXY_ENABLED = process.env.PROXY_ENABLED === 'true'
const PROXY_URL = process.env.PROXY_URL || ''

/**
 * 获取代理配置（使用新的代理模块）
 */
async function getProxyAgent(customProxyUrl?: string): Promise<HttpsProxyAgent<string> | undefined> {
  const proxyUrl = customProxyUrl || PROXY_URL

  // 检查是否启用代理
  if (!PROXY_ENABLED && !customProxyUrl) {
    return undefined
  }

  if (!proxyUrl) {
    console.warn('代理URL未配置，使用直连')
    return undefined
  }

  try {
    // 使用新的代理模块获取代理IP
    const proxy: ProxyCredentials = await getProxyIp(proxyUrl)

    console.log(`使用代理: ${proxy.fullAddress}`)

    // 创建代理Agent (格式: http://username:password@host:port)
    // 添加keepAlive配置以确保稳定的HTTPS隧道连接
    return new HttpsProxyAgent(
      `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`,
      {
        keepAlive: true,
        keepAliveMsecs: 1000,
        timeout: 60000,
        scheduling: 'lifo',
      }
    )
  } catch (error: any) {
    console.error('获取代理失败:', error.message)
    // 不降级为直连，抛出错误
    throw new Error(`代理服务不可用: ${error.message}`)
  }
}

// 使用全局统一的Accept-Language映射（支持27种语言）
// 通过 getAcceptLanguageHeader() 函数获取

/**
 * 抓取网页内容
 * @param url - 要抓取的URL
 * @param customProxyUrl - 自定义代理URL
 * @param language - 目标语言代码（支持27种语言，如 en, zh, ja, ko, de, fr, es, it, pt, sv, no, da 等）
 */
export async function scrapeUrl(url: string, customProxyUrl?: string, language?: string): Promise<{
  html: string
  title: string
  description: string
  text: string
}> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl)
    const acceptLanguage = getAcceptLanguageHeader(language || 'en')

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': acceptLanguage,
      },
      ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
    })

    const html = response.data
    const $ = load(html)

    // 提取页面标题
    const title = $('title').text() || $('h1').first().text() || ''

    // 提取meta描述
    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') || ''

    // 移除script和style标签
    $('script, style, noscript').remove()

    // 提取纯文本内容（用于AI分析）
    const text = $('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 10000) // 限制文本长度

    return {
      html,
      title,
      description,
      text,
    }
  } catch (error: any) {
    console.error('抓取URL失败:', error)
    throw new Error(`抓取失败: ${error.message}`)
  }
}

/**
 * 验证URL是否可访问
 */
export async function validateUrl(url: string, customProxyUrl?: string): Promise<{
  isAccessible: boolean
  statusCode?: number
  error?: string
}> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl)

    const response = await axios.head(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
      validateStatus: () => true, // 不抛出错误
    })

    return {
      isAccessible: response.status >= 200 && response.status < 400,
      statusCode: response.status,
    }
  } catch (error: any) {
    return {
      isAccessible: false,
      error: error.message,
    }
  }
}

/**
 * Requirement 4.1: 真实详情页数据获取
 * Structured product data extraction
 */
export interface ScrapedProductData {
  productName: string | null
  productDescription: string | null
  productPrice: string | null
  productCategory: string | null
  productFeatures: string[]
  brandName: string | null
  imageUrls: string[]
  metaTitle: string | null
  metaDescription: string | null
}

/**
 * 🌍 检测是否为Amazon域名（支持全球16个站点）
 */
export function isAmazonDomain(url: string): boolean {
  const amazonDomains = [
    'amazon.com',     // 美国
    'amazon.co.uk',   // 英国
    'amazon.de',      // 德国
    'amazon.fr',      // 法国
    'amazon.it',      // 意大利
    'amazon.es',      // 西班牙
    'amazon.co.jp',   // 日本
    'amazon.ca',      // 加拿大
    'amazon.com.au',  // 澳大利亚
    'amazon.in',      // 印度
    'amazon.com.mx',  // 墨西哥
    'amazon.nl',      // 荷兰
    'amazon.pl',      // 波兰
    'amazon.se',      // 瑞典
    'amazon.sg',      // 新加坡
    'amazon.com.br',  // 巴西
    'amazon.ae',      // 阿联酋
    'amazon.sa',      // 沙特
    'amazon.com.tr',  // 土耳其
    'amazon.eg',      // 埃及
  ]
  return amazonDomains.some(domain => url.includes(domain))
}

/**
 * Extract structured product data from a landing page
 * Supports Amazon, Shopify, and generic e-commerce sites
 * @param url - 产品页面URL
 * @param customProxyUrl - 自定义代理URL
 * @param targetCountry - 目标国家（用于动态Accept-Language配置）
 */
export async function scrapeProductData(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string
): Promise<ScrapedProductData> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl)

    // 🌍 根据目标国家动态生成Accept-Language
    let acceptLanguage = 'en-US,en;q=0.5'  // 默认英语
    if (targetCountry) {
      const langCode = getLanguageCodeForCountry(targetCountry)
      acceptLanguage = getAcceptLanguageHeader(langCode)
    }

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': acceptLanguage,  // 🌍 动态语言支持
      },
      ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
    })

    const html = response.data
    const $ = load(html)

    // 🌍 Detect site type - 支持全球Amazon站点
    const isAmazon = isAmazonDomain(url)
    const isShopify = $('[data-shopify]').length > 0

    // Extract data based on site type
    if (isAmazon) {
      return extractAmazonData($, url)
    } else if (isShopify) {
      return extractShopifyData($, url)
    } else {
      return extractGenericData($, url)
    }
  } catch (error: any) {
    console.error('Product scraping error:', error)
    throw new Error(`Product scraping failed: ${error.message}`)
  }
}

/**
 * Extract product data from Amazon pages
 */
function extractAmazonData($: any, url: string): ScrapedProductData {
  // 🔍 调试：检查页面状态
  const pageTitle = $('title').text().trim()
  const isBlocked = pageTitle.includes('Robot Check') || pageTitle.includes('Sorry!')
  console.log(`🔍 [extractAmazonData] 页面标题: "${pageTitle.slice(0, 60)}"`)
  console.log(`🔍 [extractAmazonData] 是否被拦截: ${isBlocked}`)

  if (isBlocked) {
    console.warn('⚠️ [extractAmazonData] 页面被Amazon拦截，无法提取数据')
    return {
      productName: null,
      productDescription: null,
      productPrice: null,
      productCategory: null,
      productFeatures: [],
      brandName: null,
      imageUrls: [],
      metaTitle: pageTitle,
      metaDescription: null,
    }
  }

  const features: string[] = []
  $('#feature-bullets li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text && text.length > 10) {
      features.push(text)
    }
  })

  // 🔥 P1优化：增强图片提取逻辑，优先获取高质量主图
  const images: string[] = []

  // 1. 尝试获取主图（高分辨率）
  const mainImage = $('#landingImage').attr('src') ||
                    $('#imgTagWrapperId img').attr('src') ||
                    $('meta[property="og:image"]').attr('content') ||
                    null

  if (mainImage && !mainImage.includes('data:image')) {
    // 移除尺寸限制以获取原始高分辨率图片
    const highResImage = mainImage.replace(/\._.*_\./, '.')
    images.push(highResImage)
  }

  // 2. 获取备用图片（缩略图）
  $('#altImages img').each((i: number, el: any) => {
    const src = $(el).attr('src')
    if (src && !src.includes('data:image') && !images.includes(src)) {
      // 同样移除尺寸限制
      const highResSrc = src.replace(/\._.*_\./, '.')
      if (!images.includes(highResSrc)) {
        images.push(highResSrc)
      }
    }
  })

  // 3. 如果仍然没有图片，尝试其他选择器
  if (images.length === 0) {
    const fallbackImage = $('.imgTagWrapper img').attr('src') ||
                          $('[data-old-hires]').attr('data-old-hires') ||
                          null
    if (fallbackImage && !fallbackImage.includes('data:image')) {
      images.push(fallbackImage.replace(/\._.*_\./, '.'))
    }
  }

  // 🔥 P1优化：增强价格提取逻辑，支持更多Amazon价格选择器
  let productPrice: string | null = null

  // 尝试多种价格选择器（按优先级排序）
  productPrice = $('.a-price .a-offscreen').first().text().trim() || // 最常见的价格位置
                 $('#priceblock_ourprice').text().trim() ||           // 传统价格位置
                 $('#priceblock_dealprice').text().trim() ||          // Deal价格
                 $('.a-price-whole').first().text().trim() ||         // 整数部分
                 $('#price_inside_buybox').text().trim() ||           // Buy box价格
                 $('[data-a-color="price"]').text().trim() ||         // 数据属性价格
                 $('.priceToPay .a-offscreen').text().trim() ||       // 支付价格
                 null

  // 🔥 增强品牌提取逻辑 - 支持Amazon Store页面和所有主要市场语言
  let bylineInfo = $('#bylineInfo').text().trim()
  const dataBrand = $('[data-brand]').attr('data-brand')
  const poBrand = $('.po-brand .a-size-base').text().trim()

  console.log(`🔍 [extractAmazonData] #bylineInfo: "${bylineInfo}"`)
  console.log(`🔍 [extractAmazonData] [data-brand]: "${dataBrand || '(空)'}"`)
  console.log(`🔍 [extractAmazonData] .po-brand: "${poBrand}"`)

  // 🌍 多语言品牌店铺文本清理 - 支持所有Amazon主要市场

  // English (US, CA, AU, GB, IN, SG): "Visit the Brand Store"
  bylineInfo = bylineInfo.replace(/^Visit\s+the\s+/i, '').replace(/\s+Store$/i, '')

  // Italian (IT): "Visita lo Store di Brand", "Visita il/la/le/i/gli Brand"
  bylineInfo = bylineInfo.replace(/^Visita\s+(lo|il|la|le|i|gli)\s+/i, '')
  bylineInfo = bylineInfo.replace(/^(Store|Negozio)\s+(di\s+)?/i, '')

  // French (FR, BE, CA-FR): "Visitez la boutique de Brand", "Visitez la Boutique de Brand"
  bylineInfo = bylineInfo.replace(/^Visitez\s+(la|le|les)\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Boutique\s+(de\s+)?/i, '')

  // German (DE, AT, CH): "Besuchen Sie den Brand-Shop"
  bylineInfo = bylineInfo.replace(/^Besuchen\s+Sie\s+(den|die|das)\s+/i, '').replace(/-Shop$/i, '')

  // Spanish (ES, MX, AR, CL, CO, PE): "Visita la tienda de Brand", "Visita la Tienda de Brand"
  bylineInfo = bylineInfo.replace(/^Visita\s+(la|el)\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Tienda\s+(de\s+)?/i, '')

  // Portuguese (BR, PT): "Visite a loja da Brand", "Visite a Loja da Brand"
  bylineInfo = bylineInfo.replace(/^Visite\s+a\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Loja\s+(da\s+)?/i, '')

  // Japanese (JP): "ブランド 出品者のストアにアクセス"
  bylineInfo = bylineInfo.replace(/\s*出品者のストアにアクセス$/i, '')
  bylineInfo = bylineInfo.replace(/のストアを表示$/i, '') // Alternative: "Show Brand's store"

  // Dutch (NL, BE-NL): "Bezoek de Brand-winkel"
  bylineInfo = bylineInfo.replace(/^Bezoek\s+de\s+/i, '').replace(/-winkel$/i, '')

  // Polish (PL): "Odwiedź sklep Brand", "Odwiedź Sklep Brand"
  bylineInfo = bylineInfo.replace(/^Odwiedź\s+/i, '')
  bylineInfo = bylineInfo.replace(/^Sklep\s+/i, '')

  // Turkish (TR): "Brand Mağazasını ziyaret edin"
  bylineInfo = bylineInfo.replace(/\s+Mağazasını\s+ziyaret\s+edin$/i, '')

  // Swedish (SE): "Besök Brand-butiken"
  bylineInfo = bylineInfo.replace(/^Besök\s+/i, '').replace(/-butiken$/i, '')

  // Arabic (AE, SA, EG): RTL text patterns
  bylineInfo = bylineInfo.replace(/زيارة\s+متجر\s+/i, '') // "Visit Brand store"
  bylineInfo = bylineInfo.replace(/\s+متجر$/i, '') // "Brand store"

  // Chinese (CN): "访问 Brand 店铺"
  bylineInfo = bylineInfo.replace(/^访问\s+/i, '').replace(/\s+店铺$/i, '')
  bylineInfo = bylineInfo.replace(/^查看\s+/i, '').replace(/\s+品牌店$/i, '')

  // Korean (KR): "Brand 스토어 방문하기"
  bylineInfo = bylineInfo.replace(/\s+스토어\s+방문하기$/i, '')

  // Hindi (IN): "Brand स्टोर पर जाएं"
  bylineInfo = bylineInfo.replace(/\s+स्टोर\s+पर\s+जाएं$/i, '')

  // General cleanup for "Brand:" labels in multiple languages
  bylineInfo = bylineInfo.replace(/^Brand:\s*/i, '')
    .replace(/^品牌:\s*/i, '')      // Chinese
    .replace(/^Marca:\s*/i, '')      // Spanish/Italian/Portuguese
    .replace(/^Marque:\s*/i, '')     // French
    .replace(/^Marke:\s*/i, '')      // German
    .replace(/^Merk:\s*/i, '')       // Dutch
    .replace(/^Marka:\s*/i, '')      // Polish/Turkish
    .replace(/^Märke:\s*/i, '')      // Swedish
    .replace(/^ブランド:\s*/i, '')   // Japanese
    .replace(/^브랜드:\s*/i, '')      // Korean
    .replace(/^العلامة التجارية:\s*/i, '') // Arabic

  let brandName = bylineInfo ||
                  dataBrand ||
                  poBrand.replace(/^Brand/, '') || // 备用选择器
                  null

  // 如果是Amazon stores URL且没有从页面提取到品牌，从URL中提取（支持全球站点）
  if (!brandName && isAmazonDomain(url) && url.includes('/stores/')) {
    const urlMatch = url.match(/\/stores\/([^\/]+)\//)
    if (urlMatch && urlMatch[1]) {
      brandName = decodeURIComponent(urlMatch[1])
      console.log(`✅ [Amazon Store] 从URL提取品牌: ${brandName}`)
    }
  }

  // 🔥 后备方案：从商品标题提取品牌名
  // Amazon商品标题通常以品牌名开头，格式如: "REOLINK 12MP PoE Security Camera..."
  const productTitle = $('#productTitle').text().trim()
  if (!brandName && productTitle) {
    // 方法1: 提取标题开头的全大写单词（常见品牌格式）
    const upperCaseMatch = productTitle.match(/^([A-Z][A-Z0-9]+)(?:\s|$)/)
    if (upperCaseMatch) {
      brandName = upperCaseMatch[1]
      console.log(`✅ [Amazon] 从商品标题提取品牌(大写): ${brandName}`)
    } else {
      // 方法2: 提取标题第一个单词（首字母大写）
      const firstWordMatch = productTitle.match(/^([A-Z][a-z]+)(?:\s|$)/)
      if (firstWordMatch) {
        brandName = firstWordMatch[1]
        console.log(`✅ [Amazon] 从商品标题提取品牌(首词): ${brandName}`)
      }
    }
  }

  return {
    productName: productTitle || null,
    productDescription: $('#feature-bullets').text().trim() || $('#productDescription').text().trim() || null,
    productPrice,
    productCategory: $('#wayfinding-breadcrumbs_feature_div').text().trim() || null,
    productFeatures: features,
    brandName,
    imageUrls: images,
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product data from Shopify stores
 */
function extractShopifyData($: any, url: string): ScrapedProductData {
  const features: string[] = []
  $('[class*="feature"] li, [class*="spec"] li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text && text.length > 10) {
      features.push(text)
    }
  })

  const images: string[] = []
  const ogImage = $('meta[property="og:image"]').attr('content')
  if (ogImage) images.push(ogImage)

  $('[class*="product"] img, [class*="gallery"] img').each((i: number, el: any) => {
    const src = $(el).attr('src')
    if (src && !src.includes('data:image') && !images.includes(src)) {
      images.push(src)
    }
  })

  // 🔥 增强Shopify品牌提取逻辑
  let brandName = $('.product-vendor').text().trim() ||
                  $('[class*="vendor"]').text().trim() ||
                  $('meta[property="og:site_name"]').attr('content') || null

  // 如果仍然没有品牌，尝试从页面标题提取
  if (!brandName) {
    const pageTitle = $('title').text().trim()
    console.log(`🔍 [Shopify] 尝试从页面标题提取品牌: ${pageTitle}`)
    if (pageTitle) {
      // 从标题中提取第一个单词或品牌名（通常在 | 或 - 之前）
      const titleParts = pageTitle.split(/[\|\-]/)
      if (titleParts.length > 0) {
        const firstPart = titleParts[0].trim()
        // 移除常见的后缀词
        brandName = firstPart.replace(/\s+(Store|Shop|Official|Site|Online|Outdoor Life)$/i, '').trim()
        console.log(`✅ [Shopify] 提取的品牌: ${brandName}`)
      }
    }
  }

  return {
    productName: $('.product-title').text().trim() || $('h1').text().trim() || null,
    productDescription: $('.product-description').text().trim() || $('[class*="description"]').text().trim() || null,
    productPrice: $('.product-price').text().trim() || $('[class*="price"]').text().trim() || null,
    productCategory: $('.breadcrumbs').text().trim() || null,
    productFeatures: features.slice(0, 10),
    brandName: brandName ? normalizeBrandName(brandName) : null,
    imageUrls: images.slice(0, 5),
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product data from generic e-commerce sites
 */
function extractGenericData($: any, url: string): ScrapedProductData {
  const features: string[] = []
  $('ul li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text && text.length > 10 && text.length < 200) {
      features.push(text)
    }
  })

  const images: string[] = []
  const ogImage = $('meta[property="og:image"]').attr('content')
  if (ogImage) images.push(ogImage)

  $('img').each((i: number, el: any) => {
    const src = $(el).attr('src')
    if (src && !src.includes('data:image') && !images.includes(src)) {
      images.push(src)
    }
  })

  // 🔥 增强品牌提取逻辑
  let brandName = $('[class*="brand"]').text().trim() ||
                  $('meta[property="og:brand"]').attr('content') ||
                  $('meta[property="og:site_name"]').attr('content') || null

  // 优先从Amazon stores URL中提取品牌名（支持全球站点）
  if (!brandName && isAmazonDomain(url) && url.includes('/stores/')) {
    const urlMatch = url.match(/\/stores\/([^\/]+)\//)
    if (urlMatch && urlMatch[1]) {
      brandName = decodeURIComponent(urlMatch[1])
      console.log(`✅ 从Amazon stores URL提取品牌: ${brandName}`)
    }
  }

  // 如果仍然没有品牌，尝试从页面标题提取
  if (!brandName) {
    const pageTitle = $('title').text().trim()
    console.log(`🔍 尝试从页面标题提取品牌: ${pageTitle}`)
    if (pageTitle) {
      // 从标题中提取第一个单词或品牌名（通常在 | 或 - 之前）
      const titleParts = pageTitle.split(/[\|\-]/)
      console.log(`📝 标题分割结果:`, titleParts)
      if (titleParts.length > 0) {
        const firstPart = titleParts[0].trim()
        console.log(`📝 第一部分: ${firstPart}`)
        // 移除常见的后缀词和末尾数字
        brandName = firstPart.replace(/\s+(Store|Shop|Official|Site|Online)$/i, '').replace(/\d+$/, '').trim()
        console.log(`✅ 提取的品牌: ${brandName}`)
      }
    }
  } else if (!url.includes('amazon.com/stores/')) {
    console.log(`✅ 从meta标签提取品牌: ${brandName}`)
  }

  return {
    productName: $('h1').text().trim() || $('[class*="product"][class*="title"]').text().trim() || null,
    productDescription: $('[class*="description"]').text().trim() || $('meta[name="description"]').attr('content') || null,
    productPrice: $('[class*="price"]').text().trim() || $('[data-price]').attr('data-price') || null,
    productCategory: $('.breadcrumb').text().trim() || $('[class*="breadcrumb"]').text().trim() || null,
    productFeatures: features.slice(0, 10),
    brandName: brandName ? normalizeBrandName(brandName) : null,
    imageUrls: images.slice(0, 5),
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product info (simplified interface for legacy compatibility)
 * This function wraps scrapeProductData and returns a simplified format
 * @param url - 产品页面URL
 * @param targetCountry - 目标国家（用于动态语言配置）
 */
export async function extractProductInfo(
  url: string,
  targetCountry?: string
): Promise<{
  brand: string | null
  description: string | null
  productName: string | null
  price: string | null
  imageUrls: string[]  // 🔥 P1优化：添加图片URL数组
}> {
  try {
    // 🌍 传入targetCountry到scrapeProductData
    const productData = await scrapeProductData(url, undefined, targetCountry)

    return {
      brand: productData.brandName,
      description: productData.productDescription || productData.metaDescription,
      productName: productData.productName,
      price: productData.productPrice,
      imageUrls: productData.imageUrls || [],  // 🔥 P1优化：返回图片URL数组
    }
  } catch (error) {
    console.error('extractProductInfo error:', error)
    throw error
  }
}
