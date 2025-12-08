/**
 * Independent Store Scraper
 *
 * Scrapes independent e-commerce sites (Shopify, WooCommerce, BigCommerce, etc.)
 * Extracts brand info and product listings for AI creative generation
 */

import { getPlaywrightPool } from '../playwright-pool'
import { normalizeBrandName } from '../offer-utils'
import { smartWaitForLoad, recordWaitOptimization } from '../smart-wait-strategy'
import {
  createStealthBrowser,
  releaseBrowser,
  configureStealthPage,
  randomDelay,
  getDynamicTimeout,
} from './browser-stealth'
import { isProxyConnectionError } from './proxy-utils'
import type { IndependentStoreData } from './types'

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * Scrape independent e-commerce store page
 * Extracts brand info and product listings for AI creative generation
 * P0优化: 使用连接池减少启动时间
 * P1优化: 代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeIndependentStore(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2
): Promise<IndependentStoreData> {
  console.log(`🏪 抓取独立站店铺: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 独立站抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 🔥 清理代理IP缓存，强制获取新IP
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        console.log(`🧹 已清理代理IP缓存: ${effectiveProxyUrl}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)

      try {
        const page = await browserResult.context.newPage()
        await configureStealthPage(page, targetCountry)

        console.log(`🌐 访问URL: ${url}`)
        await randomDelay(500, 1500)

        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: getDynamicTimeout(url),
        })

        if (!response) throw new Error('No response received')
        console.log(`📊 HTTP状态: ${response.status()}`)

        // Wait for content to load with smart wait strategy
        const waitResult = await smartWaitForLoad(page, url, { maxWaitTime: 15000 }).catch(() => ({
          waited: 15000,
          loadComplete: false,
          signals: [] as string[],
        }))

        console.log(`⏱️ 独立站页面等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
        recordWaitOptimization(15000, waitResult.waited)

        // Scroll down to trigger lazy loading of products
        console.log('🔄 滚动页面加载更多产品...')
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight))
          await randomDelay(600, 1000)
        }

        // Scroll back to top
        await page.evaluate(() => window.scrollTo(0, 0))
        await randomDelay(500, 800)

        const finalUrl = page.url()
        console.log(`✅ 最终URL: ${finalUrl}`)

        const html = await page.content()
        await page.close().catch(() => {})

        // Parse store data from HTML
        const storeData = await parseIndependentStoreHtml(html, finalUrl)

        console.log(`✅ 独立站抓取成功: ${storeData.storeName}`)
        console.log(`📊 发现 ${storeData.products.length} 个产品`)

        return storeData
      } finally {
        await releaseBrowser(browserResult)
      }

    } catch (error: any) {
      lastError = error
      console.error(`❌ 独立站抓取尝试 ${proxyAttempt + 1}/${maxProxyRetries + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error)) {
        if (proxyAttempt < maxProxyRetries) {
          console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        } else {
          console.error(`❌ 已用尽所有代理重试次数 (${maxProxyRetries + 1}次)`)
        }
      } else {
        // 🔥 非代理错误：立即失败，不继续重试
        console.error(`❌ 非代理错误，停止重试: ${error.message?.substring(0, 100)}`)
        throw error
      }
    }
  }

  // 所有代理重试都失败
  throw lastError || new Error('独立站抓取失败：已用尽所有代理重试')
}

/**
 * Parse independent store HTML to extract store data
 */
async function parseIndependentStoreHtml(html: string, finalUrl: string): Promise<IndependentStoreData> {
  const { load } = await import('cheerio')
  const $ = load(html)

  // Detect platform
  const platform = detectPlatform($)
  console.log(`🔍 检测到平台: ${platform || 'generic'}`)

  // Extract store name
  const storeName = $('meta[property="og:site_name"]').attr('content') ||
                    $('meta[name="application-name"]').attr('content') ||
                    $('title').text().split(/[|\-–]/).pop()?.trim() ||
                    $('h1').first().text().trim() ||
                    null

  // Extract store description
  const storeDescription = $('meta[property="og:description"]').attr('content') ||
                           $('meta[name="description"]').attr('content') ||
                           null

  // Extract logo
  const logoUrl = $('meta[property="og:image"]').attr('content') ||
                  $('link[rel="icon"]').attr('href') ||
                  $('img[class*="logo"], img[alt*="logo" i], header img').first().attr('src') ||
                  null

  // Extract products
  const products = extractProducts($, finalUrl)

  return {
    storeName: storeName ? normalizeBrandName(storeName) : null,
    storeDescription,
    logoUrl,
    products,
    totalProducts: products.length,
    storeUrl: finalUrl,
    platform,
  }
}

/**
 * Detect e-commerce platform from HTML
 */
function detectPlatform($: ReturnType<typeof import('cheerio').load>): string | null {
  if ($('script[src*="cdn.shopify.com"]').length > 0 || $('[data-shopify]').length > 0) {
    return 'shopify'
  }
  if ($('script[src*="woocommerce"]').length > 0 || $('body.woocommerce').length > 0) {
    return 'woocommerce'
  }
  if ($('[class*="bigcommerce"]').length > 0) {
    return 'bigcommerce'
  }
  return null
}

/**
 * Extract products from store page HTML
 */
function extractProducts(
  $: ReturnType<typeof import('cheerio').load>,
  finalUrl: string
): IndependentStoreData['products'] {
  const products: IndependentStoreData['products'] = []

  // Common product container selectors
  const productSelectors = [
    // Shopify
    '.product-card',
    '.product-item',
    '[class*="ProductItem"]',
    '[class*="product-grid"] > *',
    '.collection-product',
    // WooCommerce
    '.product',
    '.woocommerce-LoopProduct-link',
    // Generic
    '[class*="product"]',
    '[data-product-id]',
    '[data-product]',
    '.item',
    '.card',
    // Grid items
    '.grid-item',
    '[class*="grid"] > div',
    '[class*="collection"] > div',
  ]

  for (const selector of productSelectors) {
    if (products.length >= 5) break

    $(selector).each((i, el) => {
      if (products.length >= 30) return false

      const $el = $(el)

      // Extract product name
      const name = $el.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim() ||
                   $el.find('a').first().text().trim() ||
                   $el.find('img').first().attr('alt') ||
                   ''

      // Extract price
      const priceText = $el.find('[class*="price"], .money, [data-price]').first().text().trim()
      const price = priceText || null

      // Extract product link
      const productUrl = $el.find('a').first().attr('href') ||
                        $el.attr('href') ||
                        null

      // Add product if we have a valid name
      if (name && name.length > 3 && name.length < 200 && !products.some(p => p.name === name)) {
        products.push({
          name,
          price,
          productUrl: productUrl ? (productUrl.startsWith('http') ? productUrl : new URL(productUrl, finalUrl).href) : null,
        })
      }
    })
  }

  // Fallback: Extract from images with product-like alt text
  if (products.length < 5) {
    console.log('🔍 尝试从图片提取产品...')
    extractProductsFromImages($, finalUrl, products)
  }

  return products
}

/**
 * Extract products from image alt text (fallback method)
 */
function extractProductsFromImages(
  $: ReturnType<typeof import('cheerio').load>,
  finalUrl: string,
  products: IndependentStoreData['products']
): void {
  $('img[alt]').each((i, el) => {
    if (products.length >= 30) return false

    const alt = $(el).attr('alt')?.trim() || ''
    const src = $(el).attr('src') || $(el).attr('data-src') || ''

    // Filter for likely product images
    if (alt && alt.length > 5 && alt.length < 150 &&
        !alt.toLowerCase().includes('logo') &&
        !alt.toLowerCase().includes('banner') &&
        !alt.toLowerCase().includes('icon') &&
        src &&
        !products.some(p => p.name === alt)) {

      // Try to find price near image
      const $parent = $(el).closest('div, li, article').first()
      const nearbyPrice = $parent.find('[class*="price"], .money').first().text().trim() || null
      const nearbyLink = $parent.find('a[href*="/product"], a[href*="/collections"]').first().attr('href') || null

      products.push({
        name: alt,
        price: nearbyPrice,
        productUrl: nearbyLink ? (nearbyLink.startsWith('http') ? nearbyLink : new URL(nearbyLink, finalUrl).href) : null,
      })
    }
  })
}
