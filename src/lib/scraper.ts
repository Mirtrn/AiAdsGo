import axios from 'axios'
import { load } from 'cheerio'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getProxyIp, ProxyCredentials } from './proxy/fetch-proxy-ip'

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

// 语言代码到Accept-Language的映射
const LANGUAGE_TO_ACCEPT: Record<string, string> = {
  en: 'en-US,en;q=0.9',
  zh: 'zh-CN,zh;q=0.9,en;q=0.8',
  ja: 'ja-JP,ja;q=0.9,en;q=0.8',
  ko: 'ko-KR,ko;q=0.9,en;q=0.8',
  de: 'de-DE,de;q=0.9,en;q=0.8',
  fr: 'fr-FR,fr;q=0.9,en;q=0.8',
  es: 'es-ES,es;q=0.9,en;q=0.8',
  it: 'it-IT,it;q=0.9,en;q=0.8',
  pt: 'pt-BR,pt;q=0.9,en;q=0.8',
}

/**
 * 抓取网页内容
 * @param url - 要抓取的URL
 * @param customProxyUrl - 自定义代理URL
 * @param language - 目标语言代码 (en, zh, ja, ko, de, fr, es, it, pt)
 */
export async function scrapeUrl(url: string, customProxyUrl?: string, language?: string): Promise<{
  html: string
  title: string
  description: string
  text: string
}> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl)
    const acceptLanguage = LANGUAGE_TO_ACCEPT[language || 'en'] || 'en-US,en;q=0.9'

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
 * Extract structured product data from a landing page
 * Supports Amazon, Shopify, and generic e-commerce sites
 */
export async function scrapeProductData(url: string, customProxyUrl?: string): Promise<ScrapedProductData> {
  try {
    const proxyAgent = await getProxyAgent(customProxyUrl)

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent as any }),
    })

    const html = response.data
    const $ = load(html)

    // Detect site type
    const isAmazon = url.includes('amazon.com')
    const isShopify = $('[data-shopify]').length > 0

    // Extract data based on site type
    if (isAmazon) {
      return extractAmazonData($)
    } else if (isShopify) {
      return extractShopifyData($)
    } else {
      return extractGenericData($)
    }
  } catch (error: any) {
    console.error('Product scraping error:', error)
    throw new Error(`Product scraping failed: ${error.message}`)
  }
}

/**
 * Extract product data from Amazon pages
 */
function extractAmazonData($: any): ScrapedProductData {
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

  return {
    productName: $('#productTitle').text().trim() || null,
    productDescription: $('#feature-bullets').text().trim() || $('#productDescription').text().trim() || null,
    productPrice,
    productCategory: $('#wayfinding-breadcrumbs_feature_div').text().trim() || null,
    productFeatures: features,
    brandName: $('#bylineInfo').text().trim().replace('Visit the ', '').replace(' Store', '') || $('[data-brand]').attr('data-brand') || null,
    imageUrls: images,
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product data from Shopify stores
 */
function extractShopifyData($: any): ScrapedProductData {
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
    brandName,
    imageUrls: images.slice(0, 5),
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product data from generic e-commerce sites
 */
function extractGenericData($: any): ScrapedProductData {
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
        // 移除常见的后缀词
        brandName = firstPart.replace(/\s+(Store|Shop|Official|Site|Online)$/i, '').trim()
        console.log(`✅ 提取的品牌: ${brandName}`)
      }
    }
  } else {
    console.log(`✅ 从meta标签提取品牌: ${brandName}`)
  }

  return {
    productName: $('h1').text().trim() || $('[class*="product"][class*="title"]').text().trim() || null,
    productDescription: $('[class*="description"]').text().trim() || $('meta[name="description"]').attr('content') || null,
    productPrice: $('[class*="price"]').text().trim() || $('[data-price]').attr('data-price') || null,
    productCategory: $('.breadcrumb').text().trim() || $('[class*="breadcrumb"]').text().trim() || null,
    productFeatures: features.slice(0, 10),
    brandName,
    imageUrls: images.slice(0, 5),
    metaTitle: $('title').text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content') || null,
  }
}

/**
 * Extract product info (simplified interface for legacy compatibility)
 * This function wraps scrapeProductData and returns a simplified format
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
    const productData = await scrapeProductData(url)

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
