/**
 * Amazon Store Scraping
 *
 * Amazon store page scraping with product listing extraction
 */

import { load } from 'cheerio'
import { Page } from 'playwright'
import { normalizeBrandName } from '../offer-utils'
import { getPlaywrightPool } from '../playwright-pool'
import { smartWaitForLoad, recordWaitOptimization } from '../smart-wait-strategy'
import { isProxyConnectionError } from './proxy-utils'
import {
  createStealthBrowser,
  releaseBrowser,
  configureStealthPage,
  randomDelay,
  getDynamicTimeout
} from './browser-stealth'
import { scrapeAmazonProduct } from './amazon-product'
import type { AmazonStoreData, AmazonProductData } from './types'

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * Scrape Amazon Store page with multiple products
 * Extracts store info and product listings for AI creative generation
 * P0优化: 使用连接池减少启动时间
 * P1优化: 代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeAmazonStore(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2
): Promise<AmazonStoreData> {
  console.log(`📦 抓取Amazon Store: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 Amazon Store抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        console.log(`🧹 已清理代理IP缓存: ${effectiveProxyUrl}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)

      try {
        const page = await browserResult.context.newPage()
        await configureStealthPage(page, targetCountry)

        // Navigate and scrape
        const storeData = await scrapeStorePageContent(page, url, effectiveProxyUrl, targetCountry)

        await page.close().catch(() => {})
        return storeData

      } finally {
        await releaseBrowser(browserResult)
      }

    } catch (error: any) {
      lastError = error
      console.error(`❌ Amazon Store抓取尝试 ${proxyAttempt + 1}/${maxProxyRetries + 1} 失败: ${error.message?.substring(0, 100)}`)

      if (isProxyConnectionError(error)) {
        if (proxyAttempt < maxProxyRetries) {
          console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        } else {
          console.error(`❌ 已用尽所有代理重试次数 (${maxProxyRetries + 1}次)`)
        }
      } else {
        console.error(`❌ 非代理错误，停止重试: ${error.message?.substring(0, 100)}`)
        throw error
      }
    }
  }

  throw lastError || new Error('Amazon Store抓取失败：已用尽所有代理重试')
}

/**
 * Main store page content scraping logic
 */
async function scrapeStorePageContent(
  page: Page,
  url: string,
  effectiveProxyUrl: string,
  targetCountry?: string
): Promise<AmazonStoreData> {
  // 🔥 策略A优化：监听网络请求，提取Amazon Store API数据
  const apiProducts: Array<{
    asin: string
    name: string
    price: string | null
    rating: string | null
    reviewCount: string | null
  }> = []

  let apiRequestCount = 0
  page.on('response', async (response) => {
    try {
      const responseUrl = response.url()
      const contentType = response.headers()['content-type'] || ''

      if (contentType.includes('application/json') && response.status() === 200) {
        apiRequestCount++

        if (!responseUrl.includes('uedata') &&
            !responseUrl.includes('csm.js') &&
            !responseUrl.includes('/events/') &&
            !responseUrl.includes('rum-http-intake') &&
            !responseUrl.includes('metrics')) {
          try {
            const json = await response.json()
            const jsonStr = JSON.stringify(json)

            if (jsonStr.includes('"asin"') ||
                jsonStr.includes('"ASIN"') ||
                jsonStr.includes('"product') ||
                jsonStr.includes('"item') ||
                jsonStr.includes('"dp/')) {
              console.log(`📡 发现可能的产品API: ${responseUrl.substring(0, 100)}`)
            }
          } catch (e) {
            // JSON解析失败，跳过
          }
        }
      }
    } catch (error) {
      // 忽略响应处理错误
    }
  })

  let finalUrlWithParams = url
  page.on('response', (response) => {
    const responseUrl = response.url()
    if (responseUrl.includes('amazon.com') && responseUrl.includes('?')) {
      finalUrlWithParams = responseUrl
    }
  })

  console.log(`🌐 访问URL: ${url}`)
  await randomDelay(500, 1500)

  // Navigate with retry
  const MAX_RETRIES = 3
  let response = null
  let navigateError = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`🔄 尝试访问 (${attempt + 1}/${MAX_RETRIES})...`)

      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(url),
      })

      if (!response) throw new Error('No response received')
      console.log(`📊 HTTP状态: ${response.status()}`)

      const pageTitle = await page.title().catch(() => '')
      if (pageTitle.includes('Page Not Found') || response.status() === 404) {
        console.warn(`⚠️ 检测到404页面，尝试使用完整参数URL`)

        if (finalUrlWithParams !== url && finalUrlWithParams.includes('?')) {
          console.log(`🔄 重新访问带完整参数的URL...`)
          response = await page.goto(finalUrlWithParams, {
            waitUntil: 'domcontentloaded',
            timeout: getDynamicTimeout(finalUrlWithParams),
          })
        }
      }

      navigateError = null
      break
    } catch (error: any) {
      navigateError = error
      console.error(`❌ 访问失败 (尝试 ${attempt + 1}/${MAX_RETRIES}): ${error.message}`)

      if (attempt < MAX_RETRIES - 1) {
        const waitTime = 2000 * (attempt + 1)
        console.log(`⏳ 等待 ${waitTime}ms 后重试...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
  }

  if (navigateError) {
    throw new Error(`Amazon Store访问失败（${MAX_RETRIES}次重试后）: ${navigateError.message}`)
  }

  // Wait for content to load
  const waitResult = await smartWaitForLoad(page, url, { maxWaitTime: 15000 }).catch(() => ({
    waited: 15000,
    loadComplete: false,
    signals: []
  }))

  console.log(`⏱️ Store页面等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
  recordWaitOptimization(15000, waitResult.waited)

  // Scroll to trigger lazy loading
  console.log('⏳ 等待产品内容渲染（优化版）...')
  console.log('🔄 滚动页面触发懒加载...')

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    await randomDelay(800, 1200)
  }

  await page.evaluate(() => window.scrollTo(0, 0))
  await randomDelay(1000, 1500)

  console.log('🔄 二次滚动...')
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    await randomDelay(800, 1200)
  }

  // Check for lazy-loaded product grid
  console.log('🔍 检测懒加载productgrid widget...')
  const hasLazyProductGrid = await page.evaluate(() => {
    const lazyWidgets = document.querySelectorAll('.stores-widget-btf[id*=""], div[class*="productgrid"]')
    return lazyWidgets.length > 0
  })

  if (hasLazyProductGrid) {
    console.log('✅ 发现懒加载widget，滚动到widget位置并等待加载...')

    await page.evaluate(() => {
      const widget = document.querySelector('.stores-widget-btf, div[class*="productgrid"]')
      if (widget) {
        widget.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return true
      }
      return false
    })

    await randomDelay(3000, 5000)

    const productSelectors = [
      'div[data-asin]:not([data-asin=""])',
      'a[href*="/dp/"][class*="product"]',
      'div[class*="ProductCard"]',
      'div[class*="product-card"]',
    ]

    for (const selector of productSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 8000 })
        console.log(`✅ 产品DOM已渲染: ${selector}`)
        break
      } catch (e) {
        console.log(`⏳ 选择器 ${selector} 未找到，尝试下一个...`)
      }
    }

    await randomDelay(2000, 3000)
  }

  // Wait for product images
  console.log('⏳ 等待产品图片渲染...')
  await page.waitForSelector('img[src*="images-amazon"]', { timeout: 8000 }).catch(() => {
    console.warn('⚠️ 产品图片加载超时，继续处理')
  })

  console.log('⏳ 等待JavaScript完成...')
  await randomDelay(1500, 2500)

  await page.evaluate(() => window.scrollTo(0, 0))
  await randomDelay(300, 500)

  const finalUrl = page.url()
  console.log(`✅ 最终URL: ${finalUrl}`)

  const html = await page.content()

  // Save debug files
  try {
    const fs = await import('fs')
    const path = await import('path')
    const storageDir = path.join(process.cwd(), 'storage')
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true })
    }

    const timestamp = Date.now()
    const htmlFile = path.join(storageDir, `debug-store-${timestamp}.html`)
    const screenshotFile = path.join(storageDir, `debug-store-${timestamp}.png`)

    fs.writeFileSync(htmlFile, html)
    await page.screenshot({
      path: screenshotFile,
      fullPage: true,
      timeout: 30000,
      animations: 'disabled'
    })

    console.log(`📁 调试文件已保存: HTML: ${htmlFile}`)
  } catch (error: any) {
    console.warn(`⚠️ 保存调试文件失败: ${error.message}`)
  }

  // Parse HTML
  const $ = load(html)

  // Extract store metadata
  let storeName: string | null = null
  const pageTitle = $('title').text().trim()
  if (pageTitle && !pageTitle.includes('results for')) {
    storeName = pageTitle.replace(' - Amazon.com', '').replace('.com', '').trim()
  }

  if (!storeName) {
    storeName = $('[data-testid="store-name"]').text().trim() ||
                $('.stores-heading-desktop h1').text().trim() ||
                $('meta[property="og:title"]').attr('content')?.replace(' - Amazon.com', '').trim() ||
                null
  }

  const storeDescription = $('meta[name="description"]').attr('content') ||
                           $('meta[property="og:description"]').attr('content') ||
                           $('.stores-brand-description').text().trim() ||
                           null

  // Extract brand name
  let brandName: string | null = null
  if (storeName) {
    brandName = storeName
      .replace(/^Amazon\.com:\s*/i, '')
      .replace(/^Amazon:\s*/i, '')
      .replace(/\s+Store$/i, '')
      .replace(/\s+Official Store$/i, '')
      .trim()
  }

  if (!brandName) {
    const urlMatch = url.match(/\/stores\/([^\/]+)/)
    if (urlMatch && urlMatch[1] && urlMatch[1].toLowerCase() !== 'page') {
      brandName = decodeURIComponent(urlMatch[1]).replace(/-/g, ' ').trim()
    }
  }

  // Extract products
  const products: AmazonStoreData['products'] = []
  const productAsins: Set<string> = new Set()

  // Strategy A0: Extract from embedded JavaScript JSON
  console.log('📍 策略A0: 从嵌入的JavaScript JSON中提取产品数据...')
  extractProductsFromJson(html, products, productAsins)

  // Strategy A1: Extract from HTML links
  console.log('📍 策略A1: 从Store页面HTML提取产品ASIN...')
  $('a[href*="/dp/"]').each((i, el) => {
    const href = $(el).attr('href') || ''
    const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
    if (asinMatch && asinMatch[1]) {
      const asin = asinMatch[1]
      const text = $(el).text().toLowerCase()
      const isAmazonProduct = text.includes('amazon') && (text.includes('card') || text.includes('credit'))

      if (!isAmazonProduct) {
        productAsins.add(asin)
      }
    }
  })

  console.log(`📊 策略A1结果: 找到 ${productAsins.size} 个产品ASIN`)

  // Phase 2: Batch scrape product details if needed
  const needPhase2 = products.length === 0 && productAsins.size > 0

  console.log(`🔍 Phase 2检查: products.length: ${products.length}, productAsins.size: ${productAsins.size}, needPhase2: ${needPhase2}`)

  if (needPhase2) {
    console.log(`📦 阶段2: 批量抓取产品详情页`)
    await batchScrapeProductDetails(page, products, productAsins, effectiveProxyUrl)
  }

  // Phase 3: If still no products, try scraping from categories
  const needPhase3 = products.length === 0 && productAsins.size === 0
  console.log(`🔍 Phase 3检查: products.length: ${products.length}, needPhase3: ${needPhase3}`)

  if (needPhase3) {
    console.log(`📂 策略B: 从产品分类页抓取ASIN...`)

    // Try to scrape categories first if not already done
    let categoriesToScrape: Array<{ name: string; url?: string }> = []

    try {
      const productCategories = await scrapeStoreCategories(page)
      if (productCategories.totalCategories > 0) {
        categoriesToScrape = productCategories.primaryCategories.filter(c => c.url)
        console.log(`✅ 找到 ${categoriesToScrape.length} 个可访问的分类`)
      }
    } catch (error: any) {
      console.warn(`⚠️ 分类抓取失败: ${error.message}`)
    }

    if (categoriesToScrape.length > 0) {
      // Scrape products from top 3 categories
      const maxCategories = Math.min(3, categoriesToScrape.length)
      console.log(`📂 准备从前 ${maxCategories} 个分类抓取产品...`)

      await scrapeCategoryProducts(page, categoriesToScrape.slice(0, maxCategories), productAsins, effectiveProxyUrl)

      console.log(`📊 策略B结果: 从分类页找到 ${productAsins.size} 个产品ASIN`)

      if (productAsins.size > 0) {
        console.log(`📦 阶段3: 批量抓取产品详情页`)
        await batchScrapeProductDetails(page, products, productAsins, effectiveProxyUrl)
      }
    }
  }

  // Filter and enhance products
  console.log(`📊 原始产品数量: ${products.length}`)
  const validProducts = products.filter(p => {
    const isPlaceholder = /^Product [A-Z0-9]{10}$/.test(p.name)
    const hasPrice = p.price && p.price !== 'null'
    if (isPlaceholder && !hasPrice) {
      return false
    }
    return true
  })
  console.log(`📊 过滤后产品数量: ${validProducts.length}`)

  // Calculate hot scores
  const enhancedProducts = calculateHotScores(validProducts)

  // Calculate insights
  const productsWithRatings = enhancedProducts.filter(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0
    return rating > 0 && reviewCount > 0
  })

  const hotInsights = productsWithRatings.length > 0 ? {
    avgRating: productsWithRatings.reduce((sum, p) => sum + parseFloat(p.rating || '0'), 0) / productsWithRatings.length,
    avgReviews: Math.round(productsWithRatings.reduce((sum, p) => sum + parseInt((p.reviewCount || '0').replace(/,/g, '')), 0) / productsWithRatings.length),
    topProductsCount: enhancedProducts.length
  } : undefined

  const storeData: AmazonStoreData = {
    storeName,
    storeDescription,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    products: enhancedProducts,
    totalProducts: enhancedProducts.length,
    storeUrl: finalUrl,
    hotInsights,
  }

  // Try to scrape categories
  try {
    const productCategories = await scrapeStoreCategories(page)
    if (productCategories.totalCategories > 0) {
      storeData.productCategories = productCategories
      console.log(`✅ 成功抓取 ${productCategories.totalCategories} 个产品分类`)
    }
  } catch (error: any) {
    console.warn(`⚠️ 类别抓取失败（非致命错误）: ${error.message}`)
  }

  console.log(`✅ Store抓取成功: ${storeName}`)
  console.log(`📊 热销商品筛选: ${products.length} → ${enhancedProducts.length}`)
  if (hotInsights) {
    console.log(`💡 热销洞察: 平均评分 ${hotInsights.avgRating.toFixed(1)}⭐, 平均评论 ${hotInsights.avgReviews} 条`)
  }

  return storeData
}

/**
 * Extract products from embedded JavaScript JSON
 */
function extractProductsFromJson(
  html: string,
  products: AmazonStoreData['products'],
  productAsins: Set<string>
): void {
  try {
    const jsonMatch = html.match(/liveFlagshipStates\["amazonlive-react-shopping-carousel-data"\]\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/)

    if (jsonMatch && jsonMatch[1]) {
      const jsonStr = JSON.parse(jsonMatch[1])
      const carouselData = jsonStr

      console.log(`📊 找到嵌入的产品数据对象`)

      const preloadProducts = carouselData.preloadProducts || {}

      for (const [asin, productData] of Object.entries(preloadProducts) as [string, any][]) {
        products.push({
          name: productData.title || '',
          price: productData.formattedPriceV2 || null,
          rating: productData.ratingValue ? String(productData.ratingValue) : null,
          reviewCount: productData.totalReviewCount ? String(productData.totalReviewCount) : null,
          asin: asin,
          promotion: productData.dealBadge?.messageText || null,
          badge: productData.dealBadge?.labelText || null,
          isPrime: productData.eligibleForPrimeShipping || false
        })

        productAsins.add(asin)
      }

      console.log(`📊 策略A0成功: 从preloadProducts提取 ${products.length} 个产品`)

      // Extract from segments
      const segments = carouselData.segments || []
      let segmentAsinCount = 0
      for (const segment of segments) {
        const segmentItems = segment.segmentItems || []
        for (const item of segmentItems) {
          if (item.type === 'PRODUCT' && item.asin) {
            const asin = item.asin
            if (!productAsins.has(asin)) {
              const productData = preloadProducts[asin]
              if (productData) {
                products.push({
                  name: productData.title || '',
                  price: productData.formattedPriceV2 || null,
                  rating: productData.ratingValue ? String(productData.ratingValue) : null,
                  reviewCount: productData.totalReviewCount ? String(productData.totalReviewCount) : null,
                  asin: asin,
                  promotion: productData.dealBadge?.messageText || null,
                  badge: productData.dealBadge?.labelText || null,
                  isPrime: productData.eligibleForPrimeShipping || false
                })
                productAsins.add(asin)
                segmentAsinCount++
              }
            }
          }
        }
      }

      if (segmentAsinCount > 0) {
        console.log(`📊 A0c成功: 从segments补充 ${segmentAsinCount} 个产品`)
      }
    } else {
      console.log('⚠️ 未找到嵌入的JavaScript产品数据')
    }
  } catch (error: any) {
    console.error(`❌ 解析JavaScript JSON失败: ${error.message}`)
  }
}

/**
 * Batch scrape product details
 */
/**
 * Scrape products from category pages
 */
async function scrapeCategoryProducts(
  page: Page,
  categories: Array<{ name: string; url?: string }>,
  productAsins: Set<string>,
  effectiveProxyUrl: string
): Promise<void> {
  for (const category of categories) {
    if (!category.url) continue

    try {
      console.log(`📂 访问分类: ${category.name}`)

      // Build full category URL
      const categoryUrl = category.url.startsWith('http')
        ? category.url
        : `https://www.amazon.com${category.url}`

      await page.goto(categoryUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(categoryUrl),
      })

      await randomDelay(2000, 3000)

      // Wait for product grid to load
      await page.waitForSelector('[data-asin]:not([data-asin=""]), .s-result-item[data-asin]', {
        timeout: 10000
      }).catch(() => {
        console.log('  ⚠️ 未找到产品网格，尝试其他选择器...')
      })

      await randomDelay(1000, 2000)

      const html = await page.content()
      const $ = load(html)

      // Extract ASINs from category page
      const foundAsins = new Set<string>()

      // Strategy 1: data-asin attributes
      $('[data-asin]').each((i, el) => {
        const asin = $(el).attr('data-asin')
        if (asin && asin.length === 10 && /^[A-Z0-9]{10}$/.test(asin)) {
          foundAsins.add(asin)
        }
      })

      // Strategy 2: /dp/ links
      $('a[href*="/dp/"]').each((i, el) => {
        const href = $(el).attr('href') || ''
        const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
        if (asinMatch && asinMatch[1]) {
          foundAsins.add(asinMatch[1])
        }
      })

      console.log(`  ✅ 从 "${category.name}" 提取到 ${foundAsins.size} 个ASIN`)

      // Add to main ASIN set (limit to first 20 per category)
      let count = 0
      for (const asin of foundAsins) {
        if (count >= 20) break
        productAsins.add(asin)
        count++
      }

      await randomDelay(2000, 3000)

    } catch (error: any) {
      console.error(`  ❌ 分类 "${category.name}" 抓取失败: ${error.message}`)
      continue
    }
  }
}

async function batchScrapeProductDetails(
  page: Page,
  products: AmazonStoreData['products'],
  productAsins: Set<string>,
  effectiveProxyUrl: string
): Promise<void> {
  for (const asin of Array.from(productAsins).slice(0, 10)) {
    try {
      const productUrl = `https://www.amazon.com/dp/${asin}`
      console.log(`🛒 抓取产品 ${products.length + 1}/${Math.min(productAsins.size, 10)}: ${asin}`)

      await page.goto(productUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(productUrl),
      })

      const productWaitResult = await smartWaitForLoad(page, productUrl, { maxWaitTime: 10000 }).catch(() => ({
        waited: 10000,
        loadComplete: false,
        signals: []
      }))

      await randomDelay(1000, 2000)

      const productHtml = await page.content()
      const $product = load(productHtml)

      const name = $product('#productTitle').text().trim() ||
                   $product('h1[id*="title"]').text().trim()

      const price = $product('.a-price .a-offscreen').first().text().trim() ||
                    $product('#priceblock_ourprice').text().trim() ||
                    null

      const ratingText = $product('#acrPopover').attr('title') ||
                         $product('span[data-hook="rating-out-of-text"]').text().trim()
      const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

      const reviewCountText = $product('#acrCustomerReviewText').text().trim()
      const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

      const primeEligible = $product('#primeEligibilityMessage').length > 0 ||
                            $product('.a-icon-prime').length > 0

      const promotion = $product('.a-badge-label').first().text().trim() || null
      const badge = $product('[aria-label*="Amazon\'s Choice"]').attr('aria-label') ||
                    $product('[aria-label*="Best Seller"]').attr('aria-label') ||
                    null

      if (name && name.length > 5) {
        products.push({
          name,
          price,
          rating,
          reviewCount,
          asin,
          promotion,
          badge,
          isPrime: primeEligible,
        })
        console.log(`  ✅ ${name.substring(0, 60)}... (${rating || 'N/A'}⭐, ${reviewCount || '0'} 评论)`)
      }

      await randomDelay(2000, 3000)

    } catch (error: any) {
      console.error(`  ❌ 抓取失败: ${error.message}`)
      continue
    }
  }
}

/**
 * Calculate hot scores for products
 */
function calculateHotScores(products: AmazonStoreData['products']): AmazonStoreData['products'] {
  const productsWithScores = products.map(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0
    const hotScore = rating > 0 && reviewCount > 0
      ? rating * Math.log10(reviewCount + 1)
      : 0

    return { ...p, hotScore, ratingNum: rating, reviewCountNum: reviewCount }
  })

  productsWithScores.sort((a, b) => b.hotScore - a.hotScore)

  const topCount = Math.min(15, productsWithScores.length)
  const topProducts = productsWithScores.slice(0, topCount)

  return topProducts.map((p, index) => ({
    name: p.name,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    asin: p.asin,
    hotScore: p.hotScore,
    rank: index + 1,
    isHot: index < 5,
    promotion: p.promotion,
    badge: p.badge,
    isPrime: p.isPrime,
    hotLabel: index < 5 ? '🔥 热销商品' : '✅ 畅销商品'
  }))
}

/**
 * Scrape store categories
 */
async function scrapeStoreCategories(
  page: Page
): Promise<NonNullable<AmazonStoreData['productCategories']>> {
  console.log('🔍 开始抓取店铺产品分类...')

  const categories: Array<{ name: string; count: number; url?: string }> = []

  const categorySelectors = [
    'nav[aria-label*="categor"] a, nav[aria-label*="Categor"] a',
    '#nav-subnav a[href*="/s?"]',
    '.store-nav-category a, .store-categories a',
    '[class*="StoreNav"] a, [class*="store-nav"] a',
    '[data-component-type="category-link"]',
    'a[href*="node="], a[href*="rh="]'
  ]

  for (const selector of categorySelectors) {
    try {
      const elements = await page.$$(selector)

      if (elements.length === 0) continue

      console.log(`  ✓ 选择器 "${selector}" 匹配到 ${elements.length} 个元素`)

      for (const el of elements) {
        try {
          const name = await el.textContent()
          const href = await el.getAttribute('href')

          if (!name || name.trim().length === 0) continue
          const trimmedName = name.trim()

          const skipKeywords = ['all products', 'shop now', 'view all', 'see more', 'home', 'back']
          if (skipKeywords.some(keyword => trimmedName.toLowerCase().includes(keyword))) {
            continue
          }

          if (categories.some(c => c.name.toLowerCase() === trimmedName.toLowerCase())) {
            continue
          }

          categories.push({
            name: trimmedName,
            count: 0,
            url: href || undefined
          })
        } catch (err) {
          continue
        }
      }

      if (categories.length > 0) {
        console.log(`✅ 成功抓取 ${categories.length} 个产品类别`)
        break
      }
    } catch (error: any) {
      continue
    }
  }

  if (categories.length === 0) {
    console.warn('⚠️ 未能识别到店铺产品分类')
  }

  return {
    primaryCategories: categories,
    totalCategories: categories.length
  }
}

/**
 * 🔥 新增：店铺深度抓取 - 对热销商品进入详情页获取评价和竞品数据
 */
export async function scrapeAmazonStoreDeep(
  storeUrl: string,
  topN: number = 5,
  customProxyUrl?: string,
  targetCountry?: string,
  maxConcurrency: number = 3
): Promise<AmazonStoreData> {
  console.log(`🔍 店铺深度抓取开始: ${storeUrl}, 目标抓取 ${topN} 个热销商品`)

  const storeData = await scrapeAmazonStore(storeUrl, customProxyUrl, targetCountry)

  console.log(`📊 scrapeAmazonStore返回产品数: ${storeData.products.length}`)

  // If no products found, the Phase 3 in scrapeAmazonStore should have executed
  // But let's verify and provide clear feedback
  if (storeData.products.length === 0) {
    console.warn(`⚠️ scrapeAmazonStore未返回任何产品`)
    console.warn(`⚠️ Phase 3应该已在scrapeAmazonStore中执行，但未找到产品`)
    console.warn(`⚠️ 可能原因：1) 分类页也无产品 2) Phase 3执行失败 3) 页面结构特殊`)
    return storeData
  }

  const hotProducts = storeData.products
    .filter(p => p.asin)
    .filter(p => p.isHot || (p.rank && p.rank <= topN))
    .slice(0, topN)

  console.log(`📊 筛选出 ${hotProducts.length} 个热销商品准备深度抓取`)

  if (hotProducts.length === 0) {
    console.warn('⚠️ 未找到热销商品，跳过深度抓取')
    return storeData
  }

  const deepResults: NonNullable<AmazonStoreData['deepScrapeResults']> = {
    topProducts: [],
    totalScraped: hotProducts.length,
    successCount: 0,
    failedCount: 0
  }

  for (let i = 0; i < hotProducts.length; i += maxConcurrency) {
    const batch = hotProducts.slice(i, i + maxConcurrency)
    console.log(`🔄 处理批次 ${Math.floor(i / maxConcurrency) + 1}: ${batch.length} 个商品`)

    const batchResults = await Promise.allSettled(
      batch.map(async (product) => {
        const asin = product.asin!
        const productUrl = `https://www.amazon.com/dp/${asin}`

        console.log(`  🛒 抓取商品详情: ${product.name?.substring(0, 50)}... (${asin})`)

        try {
          const productData = await scrapeAmazonProduct(
            productUrl,
            customProxyUrl,
            targetCountry,
            2
          )

          return {
            asin: asin,
            productData: productData,
            reviews: productData.topReviews || [],
            competitorAsins: [] as string[],
            scrapeStatus: 'success' as const
          }
        } catch (error: any) {
          console.error(`  ❌ 商品详情抓取失败 (${asin}): ${error.message}`)
          return {
            asin: asin,
            productData: null,
            reviews: [],
            competitorAsins: [],
            scrapeStatus: 'failed' as const,
            error: error.message
          }
        }
      })
    )

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        deepResults.topProducts.push(result.value)
        if (result.value.scrapeStatus === 'success') {
          deepResults.successCount++
          console.log(`  ✅ 成功: ${result.value.asin}, 评价数: ${result.value.reviews.length}`)
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

  return {
    ...storeData,
    deepScrapeResults: deepResults
  }
}
