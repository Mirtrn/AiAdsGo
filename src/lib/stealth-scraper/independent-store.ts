/**
 * Independent Store Scraper
 *
 * Scrapes independent e-commerce sites (Shopify, WooCommerce, BigCommerce, etc.)
 * Extracts brand info and product listings for AI creative generation
 *
 * 🔥 增强版（2025-12-08）：
 * - 支持深度抓取热门商品详情（与Amazon Store一致）
 * - 支持评论抓取和评分提取
 * - 支持hotInsights计算
 */

import { Page } from 'playwright'
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
import type { IndependentStoreData, IndependentProductData } from './types'

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
      let page: Page | null = null

      try {
        page = await browserResult.context.newPage()
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

        // Parse store data from HTML
        const storeData = await parseIndependentStoreHtml(html, finalUrl)

        console.log(`✅ 独立站抓取成功: ${storeData.storeName}`)
        console.log(`📊 发现 ${storeData.products.length} 个产品`)

        return storeData
      } finally {
        // 🔥 2025-12-12 内存优化：确保Page在finally中关闭，防止内存泄漏
        if (page) {
          await page.close().catch((e) => {
            console.warn(`⚠️ [独立站] Page关闭失败: ${e.message}`)
          })
        }
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
 * 🔥 新增：独立站店铺深度抓取 - 对热销商品进入详情页获取评价和竞品数据
 * 与Amazon Store的scrapeAmazonStoreDeep保持一致
 */
export async function scrapeIndependentStoreDeep(
  storeUrl: string,
  topN: number = 5,
  customProxyUrl?: string,
  targetCountry?: string,
  maxConcurrency: number = 3
): Promise<IndependentStoreData> {
  console.log(`🔍 独立站店铺深度抓取开始: ${storeUrl}, 目标抓取 ${topN} 个热销商品`)

  // 1. 首先抓取店铺基本信息和产品列表
  const storeData = await scrapeIndependentStore(storeUrl, customProxyUrl, targetCountry)

  console.log(`📊 scrapeIndependentStore返回产品数: ${storeData.products.length}`)

  if (storeData.products.length === 0) {
    console.warn(`⚠️ scrapeIndependentStore未返回任何产品`)
    return storeData
  }

  // 2. 筛选有URL的产品进行深度抓取
  const productsWithUrl = storeData.products.filter(p => p.productUrl)
  const hotProducts = productsWithUrl.slice(0, topN)

  console.log(`📊 筛选出 ${hotProducts.length} 个热销商品准备深度抓取`)

  if (hotProducts.length === 0) {
    console.warn('⚠️ 未找到可抓取的产品URL，跳过深度抓取')
    return storeData
  }

  // 3. 深度抓取每个热销商品
  const deepResults: NonNullable<IndependentStoreData['deepScrapeResults']> = {
    topProducts: [],
    totalScraped: hotProducts.length,
    successCount: 0,
    failedCount: 0
  }

  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  // 批量处理，控制并发
  for (let i = 0; i < hotProducts.length; i += maxConcurrency) {
    const batch = hotProducts.slice(i, i + maxConcurrency)
    console.log(`🔄 处理批次 ${Math.floor(i / maxConcurrency) + 1}: ${batch.length} 个商品`)

    const batchResults = await Promise.allSettled(
      batch.map(async (product) => {
        const productUrl = product.productUrl!
        console.log(`  🛒 抓取商品详情: ${product.name?.substring(0, 50)}...`)

        try {
          const productData = await scrapeIndependentProduct(
            productUrl,
            effectiveProxyUrl,
            targetCountry,
            2
          )

          return {
            productUrl: productUrl,
            productData: productData,
            reviews: productData.reviews || [],
            competitorUrls: [] as string[],
            scrapeStatus: 'success' as const
          }
        } catch (error: any) {
          console.error(`  ❌ 商品详情抓取失败 (${productUrl}): ${error.message}`)
          return {
            productUrl: productUrl,
            productData: null,
            reviews: [],
            competitorUrls: [],
            scrapeStatus: 'failed' as const,
            error: error.message
          }
        }
      })
    )

    // 处理批次结果
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        deepResults.topProducts.push(result.value)
        if (result.value.scrapeStatus === 'success') {
          deepResults.successCount++
          console.log(`  ✅ 成功: ${result.value.productUrl.substring(0, 60)}..., 评价数: ${result.value.reviews.length}`)
        } else {
          deepResults.failedCount++
        }
      } else {
        deepResults.failedCount++
        console.error(`  ❌ Promise失败: ${result.reason}`)
      }
    }
  }

  console.log(`📊 深度抓取完成: 成功 ${deepResults.successCount}/${deepResults.totalScraped}`)

  // 4. 更新产品列表，添加从深度抓取获取的rating和reviewCount
  const enhancedProducts = storeData.products.map((product, index) => {
    const deepProduct = deepResults.topProducts.find(dp => dp.productUrl === product.productUrl)
    if (deepProduct?.productData) {
      return {
        ...product,
        rating: deepProduct.productData.rating || product.rating,
        reviewCount: deepProduct.productData.reviewCount || product.reviewCount,
      }
    }
    return product
  })

  // 5. 计算热销分数和洞察
  const productsWithScores = calculateIndependentHotScores(enhancedProducts)

  // 6. 计算hotInsights
  const productsWithRatings = productsWithScores.filter(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0
    return rating > 0 && reviewCount > 0
  })

  const hotInsights = productsWithRatings.length > 0 ? {
    avgRating: productsWithRatings.reduce((sum, p) => sum + parseFloat(p.rating || '0'), 0) / productsWithRatings.length,
    avgReviews: Math.round(productsWithRatings.reduce((sum, p) => sum + parseInt((p.reviewCount || '0').replace(/,/g, '')), 0) / productsWithRatings.length),
    topProductsCount: productsWithScores.length
  } : undefined

  console.log(`📊 热销商品筛选: ${storeData.products.length} → ${productsWithScores.length}`)
  if (hotInsights) {
    console.log(`💡 热销洞察: 平均评分 ${hotInsights.avgRating.toFixed(1)}⭐, 平均评论 ${hotInsights.avgReviews} 条`)
  }

  return {
    ...storeData,
    products: productsWithScores,
    hotInsights,
    deepScrapeResults: deepResults
  }
}

/**
 * 🔥 新增：抓取独立站单个产品详情页
 */
export async function scrapeIndependentProduct(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2
): Promise<IndependentProductData> {
  console.log(`📦 抓取独立站产品: ${url}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 独立站产品抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)
      let page: Page | null = null

      try {
        page = await browserResult.context.newPage()
        await configureStealthPage(page, targetCountry)

        await randomDelay(500, 1500)

        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: getDynamicTimeout(url),
        })

        if (!response) throw new Error('No response received')

        // Wait for content
        await smartWaitForLoad(page, url, { maxWaitTime: 12000 }).catch(() => {})
        await randomDelay(1000, 2000)

        // Scroll to trigger lazy loading (including reviews section)
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight))
          await randomDelay(400, 600)
        }

        // 🔥 等待评论组件加载（独立站评论通常由第三方插件动态加载）
        const reviewSelectors = [
          // Judge.me
          '.jdgm-rev__body', '.jdgm-review', '[class*="jdgm"]',
          // Stamped.io
          '.stamped-review', '[class*="stamped"]',
          // Loox
          '.loox-review', '[class*="loox"]',
          // Yotpo
          '.yotpo-review', '[class*="yotpo"]',
          // Okendo
          '.okendo-review', '[class*="okendo"]',
          // Rivyo
          '.rivyo-review', '[class*="rivyo"]',
          // Ali Reviews
          '.ali-review', '[class*="ali-review"]',
          // Generic review selectors
          '[class*="review-content"]', '[class*="review-text"]', '[class*="review-body"]',
          '[itemprop="reviewBody"]', '.review-item', '.customer-review',
        ]

        // 尝试等待任一评论选择器出现
        let reviewsLoaded = false
        for (const selector of reviewSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 3000 })
            console.log(`  ✅ 检测到评论组件: ${selector}`)
            reviewsLoaded = true
            // 额外等待确保评论内容完全加载
            await randomDelay(1500, 2500)
            break
          } catch {
            // 继续尝试下一个选择器
          }
        }

        if (!reviewsLoaded) {
          // 尝试点击"显示评论"按钮触发加载
          const showReviewButtons = [
            '[class*="show-review"]', '[class*="load-review"]', '[class*="view-review"]',
            'button:has-text("Reviews")', 'a:has-text("Reviews")',
            '[data-action="show-reviews"]', '#reviews-tab', '[href="#reviews"]',
          ]
          for (const btnSelector of showReviewButtons) {
            try {
              const btn = await page.$(btnSelector)
              if (btn) {
                await btn.click()
                console.log(`  🔘 点击评论按钮: ${btnSelector}`)
                await randomDelay(2000, 3000)
                break
              }
            } catch {
              // 继续
            }
          }
        }

        // 再次滚动确保所有评论加载
        await page.evaluate(() => window.scrollBy(0, 500))
        await randomDelay(500, 1000)

        const html = await page.content()

        // Parse product data
        const productData = await parseIndependentProductHtml(html, url)

        return productData
      } finally {
        // 🔥 2025-12-12 内存优化：确保Page在finally中关闭，防止内存泄漏
        if (page) {
          await page.close().catch((e) => {
            console.warn(`⚠️ [独立站产品] Page关闭失败: ${e.message}`)
          })
        }
        await releaseBrowser(browserResult)
      }

    } catch (error: any) {
      lastError = error
      console.error(`❌ 独立站产品抓取尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        continue
      }
      throw error
    }
  }

  throw lastError || new Error('独立站产品抓取失败')
}

/**
 * Parse independent product page HTML
 */
async function parseIndependentProductHtml(html: string, url: string): Promise<IndependentProductData> {
  const { load } = await import('cheerio')
  const $ = load(html)

  // Detect platform for platform-specific extraction
  const platform = detectPlatform($)

  // Extract product name
  const productName = $('meta[property="og:title"]').attr('content') ||
                      $('h1').first().text().trim() ||
                      $('[class*="product-title"], [class*="ProductTitle"]').first().text().trim() ||
                      null

  // Extract product description
  const productDescription = $('meta[property="og:description"]').attr('content') ||
                             $('meta[name="description"]').attr('content') ||
                             $('[class*="product-description"], [class*="ProductDescription"]').first().text().trim() ||
                             null

  // Extract price
  const productPrice = extractPrice($)

  // Extract original price (for discount calculation)
  const originalPrice = $('[class*="compare-price"], [class*="was-price"], [class*="original-price"], del')
                        .first().text().trim() || null

  // Calculate discount
  const discount = calculateDiscount(productPrice, originalPrice)

  // Extract brand name
  const brandName = $('meta[property="og:site_name"]').attr('content') ||
                    $('[class*="brand"], [class*="vendor"]').first().text().trim() ||
                    null

  // Extract features
  const features = extractFeatures($)

  // Extract images
  const imageUrls = extractImages($, url)

  // Extract rating and review count (platform-specific)
  const { rating, reviewCount } = extractRatingAndReviews($, platform)

  // Extract availability
  const availability = $('[class*="availability"], [class*="stock"]').first().text().trim() ||
                       ($('[class*="add-to-cart"], button[type="submit"]').length > 0 ? 'In Stock' : null)

  // Extract reviews
  const reviews = extractProductReviews($)

  // Extract category
  const category = $('[class*="breadcrumb"] a').last().text().trim() ||
                   $('meta[property="product:category"]').attr('content') ||
                   null

  return {
    productName,
    productDescription,
    productPrice,
    originalPrice,
    discount,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    features,
    imageUrls,
    rating,
    reviewCount,
    availability,
    reviews,
    category,
  }
}

/**
 * Extract price from product page
 */
function extractPrice($: ReturnType<typeof import('cheerio').load>): string | null {
  const priceSelectors = [
    '[class*="product-price"]:not([class*="compare"]):not([class*="was"])',
    '[class*="ProductPrice"]:not([class*="compare"])',
    '[class*="sale-price"]',
    '[class*="current-price"]',
    '.price:not(.was-price)',
    '[data-product-price]',
    '.money:first',
  ]

  for (const selector of priceSelectors) {
    const priceText = $(selector).first().text().trim()
    if (priceText && /[\d.,]+/.test(priceText)) {
      return priceText
    }
  }

  return null
}

/**
 * Calculate discount percentage
 */
function calculateDiscount(currentPrice: string | null, originalPrice: string | null): string | null {
  if (!currentPrice || !originalPrice) return null

  const current = parseFloat(currentPrice.replace(/[^0-9.]/g, ''))
  const original = parseFloat(originalPrice.replace(/[^0-9.]/g, ''))

  if (current && original && original > current) {
    const discount = Math.round((1 - current / original) * 100)
    return `${discount}% off`
  }

  return null
}

/**
 * Extract product features
 */
function extractFeatures($: ReturnType<typeof import('cheerio').load>): string[] {
  const features: string[] = []

  // Try different feature selectors
  const featureSelectors = [
    '[class*="product-feature"] li',
    '[class*="features"] li',
    '[class*="specification"] li',
    '[class*="detail"] li',
    '.product-description ul li',
  ]

  for (const selector of featureSelectors) {
    $(selector).each((i, el) => {
      const text = $(el).text().trim()
      if (text && text.length > 5 && text.length < 500 && !features.includes(text)) {
        features.push(text)
      }
    })
    if (features.length >= 10) break
  }

  return features.slice(0, 10)
}

/**
 * Extract product images
 */
function extractImages($: ReturnType<typeof import('cheerio').load>, baseUrl: string): string[] {
  const images: string[] = []

  // Try different image selectors
  const imageSelectors = [
    '[class*="product-image"] img',
    '[class*="ProductImage"] img',
    '[class*="gallery"] img',
    '.product img',
    '[data-product-image]',
  ]

  for (const selector of imageSelectors) {
    $(selector).each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src')
      if (src && !images.includes(src)) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, baseUrl).href
        images.push(fullUrl)
      }
    })
    if (images.length >= 5) break
  }

  return images.slice(0, 5)
}

/**
 * Extract rating and review count (platform-specific)
 */
function extractRatingAndReviews($: ReturnType<typeof import('cheerio').load>, platform: string | null): { rating: string | null, reviewCount: string | null } {
  let rating: string | null = null
  let reviewCount: string | null = null

  // Shopify-specific (using common review apps like Judge.me, Stamped, Loox)
  if (platform === 'shopify') {
    // Judge.me
    rating = $('[class*="jdgm-prev-badge"]').attr('data-average-rating') ||
             $('[class*="jdgm"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null

    reviewCount = $('[class*="jdgm-prev-badge"]').attr('data-number-of-reviews') ||
                  $('[class*="jdgm"] [class*="count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null

    // Stamped
    if (!rating) {
      rating = $('[class*="stamped-badge"]').attr('data-rating') ||
               $('[class*="stamped"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null
    }
    if (!reviewCount) {
      reviewCount = $('[class*="stamped-badge"]').attr('data-count') ||
                    $('[class*="stamped"] [class*="count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
    }

    // Loox
    if (!rating) {
      rating = $('[class*="loox"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null
    }
    if (!reviewCount) {
      reviewCount = $('[class*="loox"] [class*="count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
    }
  }

  // WooCommerce
  if (platform === 'woocommerce') {
    rating = $('.woocommerce-product-rating .rating').first().text().match(/[\d.]+/)?.[0] ||
             $('[class*="star-rating"]').attr('title')?.match(/[\d.]+/)?.[0] || null

    reviewCount = $('.woocommerce-review-link').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  // Generic selectors
  if (!rating) {
    rating = $('[class*="rating-value"], [class*="average-rating"]').first().text().match(/[\d.]+/)?.[0] ||
             $('[itemprop="ratingValue"]').attr('content') ||
             $('[class*="star"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null
  }

  if (!reviewCount) {
    reviewCount = $('[class*="review-count"], [class*="reviews-count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') ||
                  $('[itemprop="reviewCount"]').attr('content') ||
                  $('a[href*="review"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  return { rating, reviewCount }
}

/**
 * Extract product reviews - 🔥 增强版：支持主流评论插件
 */
function extractProductReviews($: ReturnType<typeof import('cheerio').load>): string[] {
  const reviews: string[] = []

  // 🔥 增强：支持主流Shopify评论插件
  const reviewSelectors = [
    // Judge.me (最流行的Shopify评论插件)
    '.jdgm-rev__body',
    '.jdgm-rev-widg__body',
    '[class*="jdgm"] .jdgm-rev__body',
    // Stamped.io
    '.stamped-review-content',
    '.stamped-review-body',
    '[class*="stamped"] .review-content',
    // Loox
    '.loox-review-content',
    '.loox__review-content',
    '[class*="loox"] .review-text',
    // Yotpo
    '.yotpo-review-content',
    '.content-review',
    '[class*="yotpo"] .review-content',
    // Okendo
    '.okendo-review-content',
    '[class*="okendo"] .review-text',
    // Rivyo
    '.rivyo-review-content',
    // Ali Reviews
    '.ali-review-content',
    // Shopify Product Reviews (官方)
    '.spr-review-content',
    '.spr-review-content-body',
    // WooCommerce
    '.woocommerce-review__content',
    '.comment-text p',
    // Generic selectors
    '[class*="review-content"]',
    '[class*="review-text"]',
    '[class*="review-body"]',
    '[class*="ReviewContent"]',
    '[class*="customer-review"] p',
    '.review p',
    '[itemprop="reviewBody"]',
    '[data-review-content]',
    '.review-message',
    '.review-description',
  ]

  for (const selector of reviewSelectors) {
    $(selector).each((i, el) => {
      const text = $(el).text().trim()
      // 过滤太短或太长的文本，以及重复内容
      if (text && text.length > 20 && text.length < 3000 && !reviews.includes(text)) {
        // 过滤掉明显不是评论的内容
        const lowerText = text.toLowerCase()
        if (!lowerText.includes('write a review') &&
            !lowerText.includes('be the first') &&
            !lowerText.includes('no reviews yet') &&
            !lowerText.includes('loading')) {
          reviews.push(text)
        }
      }
    })
    if (reviews.length >= 15) break
  }

  return reviews.slice(0, 15)
}

/**
 * 🔥 新增：计算独立站产品热销分数
 */
function calculateIndependentHotScores(products: IndependentStoreData['products']): IndependentStoreData['products'] {
  const productsWithScores = products.map(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0

    // 热销分数计算：评分 * log(评论数+1)
    // 对于独立站，如果没有评论数据，给一个基础分数
    const hotScore = rating > 0 && reviewCount > 0
      ? rating * Math.log10(reviewCount + 1)
      : (rating > 0 ? rating * 0.5 : 0)

    return { ...p, hotScore, ratingNum: rating, reviewCountNum: reviewCount }
  })

  // 按热销分数排序
  productsWithScores.sort((a, b) => b.hotScore - a.hotScore)

  // 取前15个热销商品
  const topCount = Math.min(15, productsWithScores.length)
  const topProducts = productsWithScores.slice(0, topCount)

  return topProducts.map((p, index) => ({
    name: p.name,
    price: p.price,
    productUrl: p.productUrl,
    rating: p.rating,
    reviewCount: p.reviewCount,
    imageUrl: p.imageUrl,
    hotScore: p.hotScore,
    rank: index + 1,
    isHot: index < 5,
    hotLabel: index < 5 ? '🔥 热销商品' : '✅ 畅销商品'
  }))
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

  // Extract products with enhanced data
  const products = extractProducts($, finalUrl, platform)

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
 * Extract products from store page HTML (增强版)
 */
function extractProducts(
  $: ReturnType<typeof import('cheerio').load>,
  finalUrl: string,
  platform: string | null
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
      const priceText = $el.find('[class*="price"]:not([class*="compare"]):not([class*="was"]), .money, [data-price]').first().text().trim()
      const price = priceText || null

      // Extract product link
      const productUrl = $el.find('a').first().attr('href') ||
                        $el.attr('href') ||
                        null

      // 🔥 新增：提取图片URL
      const imageUrl = $el.find('img').first().attr('src') ||
                       $el.find('img').first().attr('data-src') ||
                       null

      // 🔥 新增：尝试提取评分和评论数（平台特定）
      const { rating, reviewCount } = extractProductCardRating($el, platform)

      // Add product if we have a valid name
      if (name && name.length > 3 && name.length < 200 && !products.some(p => p.name === name)) {
        products.push({
          name,
          price,
          productUrl: productUrl ? (productUrl.startsWith('http') ? productUrl : new URL(productUrl, finalUrl).href) : null,
          imageUrl: imageUrl ? (imageUrl.startsWith('http') ? imageUrl : new URL(imageUrl, finalUrl).href) : null,
          rating,
          reviewCount,
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
 * 🔥 新增：从产品卡片提取评分信息
 */
function extractProductCardRating(
  $el: ReturnType<ReturnType<typeof import('cheerio').load>>,
  platform: string | null
): { rating: string | null, reviewCount: string | null } {
  let rating: string | null = null
  let reviewCount: string | null = null

  // Shopify review apps (Judge.me, Stamped, Loox)
  if (platform === 'shopify') {
    rating = $el.find('[class*="jdgm"]').attr('data-average-rating') ||
             $el.find('[class*="stamped"]').attr('data-rating') ||
             $el.find('[class*="loox"] [class*="rating"]').text().match(/[\d.]+/)?.[0] || null

    reviewCount = $el.find('[class*="jdgm"]').attr('data-number-of-reviews') ||
                  $el.find('[class*="stamped"]').attr('data-count') ||
                  $el.find('[class*="review-count"]').text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  // WooCommerce
  if (platform === 'woocommerce') {
    rating = $el.find('[class*="star-rating"]').attr('title')?.match(/[\d.]+/)?.[0] || null
    reviewCount = $el.find('[class*="review-count"]').text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  // Generic fallback
  if (!rating) {
    rating = $el.find('[class*="rating"]').text().match(/[\d.]+/)?.[0] || null
  }
  if (!reviewCount) {
    reviewCount = $el.find('[class*="review"]').text().match(/\((\d+)\)/)?.[1] || null
  }

  return { rating, reviewCount }
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
        imageUrl: src.startsWith('http') ? src : new URL(src, finalUrl).href,
      })
    }
  })
}
