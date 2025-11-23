/**
 * Enhanced Playwright-based scraper with stealth mode
 * Bypasses anti-bot detection for Amazon and other protected sites
 */
import { chromium, Browser, Page } from 'playwright'
import { getProxyIp, ProxyCredentials } from './proxy/fetch-proxy-ip'
import { normalizeBrandName } from './offer-utils'

const PROXY_ENABLED = process.env.PROXY_ENABLED === 'true'
const PROXY_URL = process.env.PROXY_URL || ''

/**
 * User-Agent rotation pool (2024 browsers)
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
]

/**
 * Get random User-Agent
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * Random delay between min and max milliseconds (human-like behavior)
 */
function randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * Exponential backoff retry logic
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error

      // Don't retry on certain errors
      if (error.message.includes('404') || error.message.includes('403')) {
        throw error
      }

      // Calculate exponential backoff delay
      const delay = baseDelay * Math.pow(2, attempt)
      const jitter = Math.random() * 1000 // Add jitter

      console.log(`Retry attempt ${attempt + 1}/${maxRetries}, waiting ${delay + jitter}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay + jitter))
    }
  }

  throw lastError || new Error('Max retries exceeded')
}

/**
 * Create stealth browser context
 */
async function createStealthBrowser(proxyUrl?: string): Promise<{ browser: Browser; proxy?: ProxyCredentials }> {
  let proxy: ProxyCredentials | undefined

  // Get proxy if enabled
  if ((PROXY_ENABLED || proxyUrl) && (proxyUrl || PROXY_URL)) {
    try {
      proxy = await getProxyIp(proxyUrl || PROXY_URL)
      console.log(`🔒 使用代理: ${proxy.host}:${proxy.port}`)
    } catch (error: any) {
      console.warn('⚠️ 代理获取失败，继续使用直连:', error.message)
    }
  }

  // Launch browser with stealth settings
  const browser = await chromium.launch({
    headless: true, // Use headless for production
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ],
    ...(proxy && {
      proxy: {
        server: `http://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password,
      },
    }),
  })

  return { browser, proxy }
}

/**
 * Configure page with stealth settings
 */
async function configureStealthPage(page: Page): Promise<void> {
  const userAgent = getRandomUserAgent()

  // Set user agent
  await page.setExtraHTTPHeaders({
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  })

  // Override navigator.webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    })

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    })

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    })

    // Override permissions
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters)
  })

  // Set viewport to common desktop resolution
  await page.setViewportSize({ width: 1920, height: 1080 })
}

/**
 * Scrape URL with JavaScript rendering and stealth mode
 */
export async function scrapeUrlWithBrowser(
  url: string,
  customProxyUrl?: string,
  options: {
    waitForSelector?: string
    waitForTimeout?: number
    followRedirects?: boolean
  } = {}
): Promise<{
  html: string
  title: string
  finalUrl: string
  redirectChain: string[]
  screenshot?: Buffer
}> {
  const { browser, proxy } = await createStealthBrowser(customProxyUrl)

  try {
    return await retryWithBackoff(async () => {
      const context = await browser.newContext({
        userAgent: getRandomUserAgent(),
      })

      const page = await context.newPage()
      await configureStealthPage(page)

      // Track redirects
      const redirectChain: string[] = [url]
      page.on('response', response => {
        const status = response.status()
        if (status >= 300 && status < 400) {
          const location = response.headers()['location']
          if (location) {
            redirectChain.push(location)
          }
        }
      })

      console.log(`🌐 访问URL: ${url}`)

      // Add random delay before navigation (human-like)
      await randomDelay(500, 1500)

      // Navigate with timeout
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options.waitForTimeout || 30000,
      })

      if (!response) {
        throw new Error('No response received')
      }

      const status = response.status()
      console.log(`📊 HTTP状态: ${status}`)

      if (status === 429) {
        throw new Error('429 Too Many Requests - 触发限流，将重试')
      }

      if (status >= 400) {
        throw new Error(`HTTP ${status} error`)
      }

      // Wait for specific selector if provided
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {
          console.warn(`⚠️ 选择器未找到: ${options.waitForSelector}`)
        })
      } else {
        // Wait for page to be fully loaded
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
          console.warn('⚠️ 网络未完全空闲，继续处理')
        })
      }

      // Additional random delay (simulate reading)
      await randomDelay(1000, 2000)

      // Simulate human scrolling
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 500)
      })

      await randomDelay(500, 1000)

      // Get final URL after all redirects
      const finalUrl = page.url()
      if (finalUrl !== url) {
        redirectChain.push(finalUrl)
      }

      console.log(`✅ 最终URL: ${finalUrl}`)
      console.log(`🔄 重定向次数: ${redirectChain.length - 1}`)

      // Extract data
      const html = await page.content()
      const title = await page.title()

      // Take screenshot for debugging (optional)
      let screenshot: Buffer | undefined
      try {
        screenshot = await page.screenshot({ fullPage: false })
      } catch (error) {
        console.warn('⚠️ 截图失败:', error)
      }

      await context.close()

      return {
        html,
        title,
        finalUrl,
        redirectChain: Array.from(new Set(redirectChain)), // Remove duplicates
        screenshot,
      }
    })
  } finally {
    await browser.close()
  }
}

/**
 * Resolve affiliate link redirects
 */
export async function resolveAffiliateLink(
  affiliateLink: string,
  customProxyUrl?: string
): Promise<{
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
}> {
  console.log(`🔗 解析推广链接: ${affiliateLink}`)

  const { browser, proxy } = await createStealthBrowser(customProxyUrl)

  try {
    return await retryWithBackoff(async () => {
      const context = await browser.newContext({
        userAgent: getRandomUserAgent(),
      })

      const page = await context.newPage()
      await configureStealthPage(page)

      const redirectChain: string[] = [affiliateLink]

      // Track all redirects
      page.on('response', response => {
        const url = response.url()
        if (!redirectChain.includes(url)) {
          redirectChain.push(url)
        }
      })

      // Navigate and wait for final URL
      await randomDelay(500, 1500)

      await page.goto(affiliateLink, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })

      // Wait for any JavaScript redirects
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
        console.warn('⚠️ 网络未完全空闲')
      })

      await randomDelay(1000, 2000)

      const finalUrl = page.url()

      // Parse final URL and suffix
      const urlObj = new URL(finalUrl)
      const basePath = `${urlObj.origin}${urlObj.pathname}`
      const suffix = urlObj.search.substring(1) // Remove leading '?'

      console.log(`✅ 最终URL: ${basePath}`)
      console.log(`🔧 URL Suffix: ${suffix.substring(0, 100)}${suffix.length > 100 ? '...' : ''}`)

      await context.close()

      return {
        finalUrl: basePath,
        finalUrlSuffix: suffix,
        redirectChain: Array.from(new Set(redirectChain)),
        redirectCount: redirectChain.length - 1,
      }
    })
  } finally {
    await browser.close()
  }
}

/**
 * Enhanced Amazon product data structure
 */
export interface AmazonProductData {
  productName: string | null
  productDescription: string | null
  productPrice: string | null
  originalPrice: string | null
  discount: string | null
  brandName: string | null
  features: string[]
  imageUrls: string[]
  // New fields for AI creative generation
  rating: string | null
  reviewCount: string | null
  salesRank: string | null
  availability: string | null
  primeEligible: boolean
  reviewHighlights: string[]
  topReviews: string[]
  technicalDetails: Record<string, string>
  asin: string | null
  category: string | null
}

/**
 * Scrape Amazon product page with enhanced anti-bot bypass
 * Extracts comprehensive data for AI creative generation
 */
export async function scrapeAmazonProduct(
  url: string,
  customProxyUrl?: string
): Promise<AmazonProductData> {
  console.log(`🛒 抓取Amazon产品: ${url}`)

  const result = await scrapeUrlWithBrowser(url, customProxyUrl, {
    waitForSelector: '#productTitle',
    waitForTimeout: 40000,
  })

  // Parse HTML with cheerio
  const { load } = await import('cheerio')
  const $ = load(result.html)

  // 🎯 核心优化：限定选择器范围到核心产品区域，避免抓取推荐商品
  // 推荐商品区域关键词
  const recommendationKeywords = [
    'also bought', 'also viewed', 'frequently bought together',
    'customers who bought', 'related products', 'similar items',
    'sponsored products', 'customers also shopped for', 'compare with similar',
    'recommended for you', 'more items to explore'
  ]

  // 检查元素是否在推荐区域
  const isInRecommendationArea = (el: any): boolean => {
    const $el = $(el)
    const parents = $el.parents().toArray()

    for (const parent of parents) {
      const $parent = $(parent)
      const text = $parent.text().toLowerCase()
      const id = ($parent.attr('id') || '').toLowerCase()
      const className = ($parent.attr('class') || '').toLowerCase()

      // 检查文本内容
      if (recommendationKeywords.some(keyword => text.includes(keyword))) {
        return true
      }

      // 检查ID和类名
      if (id.includes('sims') || id.includes('related') || id.includes('sponsored') ||
          className.includes('sims') || className.includes('related') || className.includes('sponsored')) {
        return true
      }
    }
    return false
  }

  // Extract product features - 限定在核心产品区域
  const features: string[] = []
  const featureSelectors = [
    '#ppd #feature-bullets li',
    '#centerCol #feature-bullets li',
    '#dp-container #feature-bullets li',
    '#feature-bullets li:not([id*="sims"]):not([class*="sims"])',  // 排除sims相关
    '#featurebullets_feature_div li'
  ]

  for (const selector of featureSelectors) {
    if (features.length >= 10) break  // 限制最多10个特点

    $(selector).each((i, el) => {
      if (features.length >= 10) return false
      if (isInRecommendationArea(el)) return  // 跳过推荐区域

      const text = $(el).text().trim()
      if (text && text.length > 10 && !features.includes(text)) {
        features.push(text)
      }
    })
  }

  // Extract image URLs - 限定在核心产品区域
  const imageUrls: string[] = []
  const imageSelectors = [
    '#ppd #altImages img',
    '#centerCol #altImages img',
    '#dp-container #altImages img',
    '#altImages img',
    '#main-image',
    '#landingImage'
  ]

  for (const selector of imageSelectors) {
    if (imageUrls.length >= 5) break  // 限制最多5张图片

    $(selector).each((i, el) => {
      if (imageUrls.length >= 5) return false
      if (isInRecommendationArea(el)) return  // 跳过推荐区域

      const src = $(el).attr('src') || $(el).attr('data-old-hires')
      if (src && !src.includes('data:image') && !imageUrls.includes(src)) {
        imageUrls.push(src)
      }
    })
  }

  // Extract rating and review count
  const ratingText = $('#acrPopover').attr('title') ||
                     $('span[data-hook="rating-out-of-text"]').text().trim() ||
                     $('.a-icon-star span').first().text().trim()
  const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

  const reviewCountText = $('#acrCustomerReviewText').text().trim() ||
                          $('span[data-hook="total-review-count"]').text().trim()
  const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

  // Extract sales rank
  const salesRankText = $('#productDetails_detailBullets_sections1 tr:contains("Best Sellers Rank")').text().trim() ||
                        $('#SalesRank').text().trim() ||
                        $('th:contains("Best Sellers Rank")').next().text().trim()
  const salesRank = salesRankText ? salesRankText.match(/#[\d,]+/)?.[0] || null : null

  // Extract availability
  const availability = $('#availability span').text().trim() ||
                       $('#outOfStock span').text().trim() ||
                       null

  // Check Prime eligibility
  const primeEligible = $('#primeEligibilityMessage').length > 0 ||
                        $('.a-icon-prime').length > 0 ||
                        $('[data-feature-name="primeEligible"]').length > 0

  // Extract review highlights
  const reviewHighlights: string[] = []
  $('[data-hook="lighthut-term"]').each((i, el) => {
    const text = $(el).text().trim()
    if (text) reviewHighlights.push(text)
  })
  // Also try to get from review summary
  $('p[data-hook="review-collapsed"], span[data-hook="review-body"]').slice(0, 3).each((i, el) => {
    const text = $(el).text().trim().substring(0, 200)
    if (text && text.length > 20) reviewHighlights.push(text)
  })

  // Extract top reviews
  const topReviews: string[] = []
  $('[data-hook="review"]').slice(0, 5).each((i, el) => {
    const reviewText = $(el).find('[data-hook="review-body"]').text().trim().substring(0, 300)
    const reviewTitle = $(el).find('[data-hook="review-title"]').text().trim()
    const reviewRating = $(el).find('.a-icon-star').text().trim()
    if (reviewText) {
      topReviews.push(`${reviewRating} - ${reviewTitle}: ${reviewText}`)
    }
  })

  // Extract technical details
  const technicalDetails: Record<string, string> = {}
  $('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr').each((i, el) => {
    const key = $(el).find('th').text().trim()
    const value = $(el).find('td').text().trim()
    if (key && value && key !== 'Customer Reviews' && key !== 'Best Sellers Rank') {
      technicalDetails[key] = value
    }
  })
  // Also try detail bullets format
  $('#detailBullets_feature_div li').each((i, el) => {
    const text = $(el).text().trim()
    const match = text.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      technicalDetails[match[1].trim()] = match[2].trim()
    }
  })

  // Extract ASIN
  const asin = url.match(/\/dp\/([A-Z0-9]+)/)?.[1] ||
               $('input[name="ASIN"]').val()?.toString() ||
               $('th:contains("ASIN")').next().text().trim() ||
               null

  // Extract category/breadcrumb
  const categoryParts: string[] = []
  $('#wayfinding-breadcrumbs_feature_div li a').each((i, el) => {
    const text = $(el).text().trim()
    if (text) categoryParts.push(text)
  })
  const category = categoryParts.join(' > ') || null

  // Extract prices
  const currentPrice = $('.a-price .a-offscreen').first().text().trim() ||
                       $('#priceblock_ourprice').text().trim() ||
                       $('#price_inside_buybox').text().trim() ||
                       null

  const originalPrice = $('.a-price[data-a-strike="true"] .a-offscreen').text().trim() ||
                        $('.priceBlockStrikePriceString').text().trim() ||
                        null

  const discount = $('.savingsPercentage').text().trim() ||
                   $('[data-hook="price-above-strike"] span').text().trim() ||
                   null

  // 🎯 优化产品名称提取 - 按优先级尝试核心产品区域
  const titleSelectors = [
    '#ppd #productTitle',
    '#centerCol #productTitle',
    '#dp-container #productTitle',
    '#productTitle'
  ]
  let productName: string | null = null
  for (const selector of titleSelectors) {
    const title = $(selector).text().trim()
    if (title && title.length > 5) {
      productName = title
      break
    }
  }

  // 🎯 优化产品描述提取 - 限定在核心产品区域
  const descriptionSelectors = [
    '#ppd #feature-bullets',
    '#centerCol #feature-bullets',
    '#dp-container #feature-bullets',
    '#feature-bullets',
    '#productDescription',
    '[data-feature-name="featurebullets"]'
  ]
  let productDescription: string | null = null
  for (const selector of descriptionSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      const desc = $el.text().trim()
      if (desc && desc.length > 20) {
        productDescription = desc
        break
      }
    }
  }

  // 🎯 优化品牌名提取 - 限定在核心产品区域
  const brandSelectors = [
    '#ppd #bylineInfo',
    '#centerCol #bylineInfo',
    '#dp-container #bylineInfo',
    '#bylineInfo'
  ]
  let brandName: string | null = null
  for (const selector of brandSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      const brand = $el.text().trim()
        .replace('Visit the ', '')
        .replace(' Store', '')
        .replace(/^Brand:\s*/i, '')
      if (brand && brand.length > 1) {
        brandName = brand
        break
      }
    }
  }
  // Fallback: 从data属性获取
  if (!brandName) {
    brandName = $('[data-brand]').attr('data-brand') || null
  }

  const productData: AmazonProductData = {
    productName,
    productDescription,
    productPrice: currentPrice,
    originalPrice,
    discount,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    features,
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 5),
    rating,
    reviewCount,
    salesRank,
    availability,
    primeEligible,
    reviewHighlights: reviewHighlights.slice(0, 10),
    topReviews: topReviews.slice(0, 5),
    technicalDetails,
    asin,
    category,
  }

  console.log(`✅ 抓取成功: ${productData.productName || 'Unknown'}`)
  console.log(`⭐ 评分: ${rating || 'N/A'}, 评论数: ${reviewCount || 'N/A'}, 销量排名: ${salesRank || 'N/A'}`)

  return productData
}

/**
 * Amazon Store data structure
 */
export interface AmazonStoreData {
  storeName: string | null
  storeDescription: string | null
  brandName: string | null
  products: Array<{
    name: string
    price: string | null
    rating: string | null
    reviewCount: string | null
    imageUrl: string | null
    asin: string | null
    hotScore?: number      // 🔥 新增：热销分数
    rank?: number          // 🔥 新增：热销排名
    isHot?: boolean        // 🔥 新增：是否为热销商品（Top 5）
    hotLabel?: string      // 🔥 新增：热销标签
    // 🎯 Phase 3: 数据维度增强
    promotion?: string | null       // 促销信息：折扣、优惠券、限时优惠
    badge?: string | null           // 徽章：Amazon's Choice、Best Seller、#1 in Category
    isPrime?: boolean               // Prime标识
  }>
  totalProducts: number
  storeUrl: string
  // 🔥 新增：热销洞察
  hotInsights?: {
    avgRating: number
    avgReviews: number
    topProductsCount: number
  }
}

/**
 * Scrape Amazon Store page with multiple products
 * Extracts store info and product listings for AI creative generation
 */
export async function scrapeAmazonStore(
  url: string,
  customProxyUrl?: string
): Promise<AmazonStoreData> {
  console.log(`📦 抓取Amazon Store: ${url}`)

  // Use longer timeout and custom scraping for store pages
  const { browser, proxy } = await createStealthBrowser(customProxyUrl)

  try {
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
    })

    const page = await context.newPage()
    await configureStealthPage(page)

    console.log(`🌐 访问URL: ${url}`)
    await randomDelay(500, 1500)

    // 🔥 P0优化：添加重试机制以处理代理连接问题
    const MAX_RETRIES = 3
    let response = null
    let lastError = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 尝试访问 (${attempt + 1}/${MAX_RETRIES})...`)

        response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000, // 增加超时时间到60秒
        })

        if (!response) throw new Error('No response received')
        console.log(`📊 HTTP状态: ${response.status()}`)

        // 成功，跳出重试循环
        lastError = null
        break
      } catch (error: any) {
        lastError = error
        console.error(`❌ 访问失败 (尝试 ${attempt + 1}/${MAX_RETRIES}): ${error.message}`)

        // 如果不是最后一次重试，等待后继续
        if (attempt < MAX_RETRIES - 1) {
          const waitTime = 2000 * (attempt + 1) // 指数退避: 2s, 4s, 6s
          console.log(`⏳ 等待 ${waitTime}ms 后重试...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
    }

    // 如果所有重试都失败，抛出最后一个错误
    if (lastError) {
      throw new Error(`Amazon Store访问失败（${MAX_RETRIES}次重试后）: ${lastError.message}`)
    }

    // Wait for store content to load
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.warn('⚠️ 网络未完全空闲，继续处理')
    })

    // Scroll down to trigger lazy loading of products
    console.log('🔄 滚动页面加载更多产品...')
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await randomDelay(800, 1200)
    }

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0))
    await randomDelay(500, 1000)

    const finalUrl = page.url()
    console.log(`✅ 最终URL: ${finalUrl}`)

    const html = await page.content()
    await context.close()

    // Parse HTML with cheerio
    const { load } = await import('cheerio')
    const $ = load(html)

  // Extract store name - 优化选择器优先级
  let storeName: string | null = null

  // 尝试从title提取（最可靠）
  const pageTitle = $('title').text().trim()
  if (pageTitle && !pageTitle.includes('results for')) {
    storeName = pageTitle.replace(' - Amazon.com', '').replace('.com', '').trim()
  }

  // 如果title不可用，尝试其他选择器
  if (!storeName) {
    storeName = $('[data-testid="store-name"]').text().trim() ||
                $('.stores-heading-desktop h1').text().trim() ||
                $('meta[property="og:title"]').attr('content')?.replace(' - Amazon.com', '').trim() ||
                null
  }

  // Extract store description
  const storeDescription = $('meta[name="description"]').attr('content') ||
                           $('meta[property="og:description"]').attr('content') ||
                           $('.stores-brand-description').text().trim() ||
                           null

  // Extract brand name - 优先从storeName提取（更可靠）
  let brandName: string | null = null

  // 🔥 优先级1: 从storeName提取（最可靠）
  if (storeName) {
    // 处理各种Amazon前缀格式
    brandName = storeName
      .replace(/^Amazon\.com:\s*/i, '')  // "Amazon.com: REOLINK"
      .replace(/^Amazon:\s*/i, '')       // "Amazon: REOLINK"
      .replace(/\s+Store$/i, '')         // "REOLINK Store"
      .replace(/\s+Official Store$/i, '') // "REOLINK Official Store"
      .trim()
  }

  // 🔥 优先级2: 从URL提取品牌名称 (e.g., /stores/Reolink/...)
  // 注意：跳过 /stores/page/ 这种结构
  if (!brandName) {
    const urlMatch = url.match(/\/stores\/([^\/]+)/)
    if (urlMatch && urlMatch[1] && urlMatch[1].toLowerCase() !== 'page') {
      brandName = decodeURIComponent(urlMatch[1]).replace(/-/g, ' ').trim()
    }
  }

  // Extract products from store listing
  const products: AmazonStoreData['products'] = []

  // Try multiple selectors for product cards - Amazon store specific selectors
  const productSelectors = [
    // Store page specific selectors
    '[class*="ProductCard"]',
    '[class*="product-card"]',
    '[data-csa-c-item-type="product"]',
    '[data-csa-c-type="item"]',
    'div[class*="sfkrT"]', // Common store product class
    'div[class*="ImageArea"]',
    // Search result selectors (for some store layouts)
    '[data-component-type="s-search-result"]',
    '.s-result-item[data-asin]',
    '.stores-widget-item',
    '[data-asin]'
  ]

  for (const selector of productSelectors) {
    if (products.length >= 5) break // If we found some products, stop trying more selectors

    $(selector).each((i, el) => {
      if (products.length >= 30) return false // Limit to 30 products

      const $el = $(el)
      const asin = $el.attr('data-asin') ||
                   $el.find('[data-asin]').attr('data-asin') ||
                   $el.find('a[href*="/dp/"]').attr('href')?.match(/\/dp\/([A-Z0-9]+)/)?.[1] ||
                   null

      // Try multiple name extraction methods
      const name = $el.find('h2 a span, .s-title-instructions-style span').text().trim() ||
                   $el.find('[class*="ProductTitle"], [class*="product-title"]').text().trim() ||
                   $el.find('span[class*="Title"]').text().trim() ||
                   $el.find('img[alt]').first().attr('alt') ||
                   ''

      // Extract price
      const price = $el.find('.a-price .a-offscreen').first().text().trim() ||
                    $el.find('[class*="Price"] .a-offscreen').text().trim() ||
                    $el.find('.a-color-price').text().trim() ||
                    $el.find('[class*="price"]').first().text().trim() ||
                    null

      // Extract rating
      const ratingText = $el.find('.a-icon-star-small span, .a-icon-star span').text().trim() ||
                         $el.find('[class*="star"]').text().trim()
      const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

      // Extract review count
      const reviewCountText = $el.find('[aria-label*="stars"]').attr('aria-label') ||
                              $el.find('.s-underline-text').text().trim() ||
                              $el.find('[class*="review"]').text().trim()
      const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

      // Extract image
      const imageUrl = $el.find('img.s-image, .s-product-image-container img').attr('src') ||
                       $el.find('img[src*="images-amazon"]').first().attr('src') ||
                       $el.find('img').first().attr('src') ||
                       null

      // 🎯 Phase 3: Extract promotion information
      const promotionText = $el.find('.a-badge-label, .s-coupon-highlight-color, [aria-label*="coupon"]').text().trim() ||
                            $el.find('[class*="discount"], [class*="deal"], [class*="coupon"]').first().text().trim() ||
                            $el.find('.a-color-price.a-text-bold').text().trim() ||
                            null
      const promotion = promotionText && promotionText.length > 0 && promotionText.length < 100 ? promotionText : null

      // 🎯 Phase 3: Extract badge information
      const badgeText = $el.find('[aria-label*="Amazon\'s Choice"], [aria-label*="Best Seller"]').attr('aria-label') ||
                        $el.find('.a-badge-label:contains("Amazon\'s Choice")').text().trim() ||
                        $el.find('.a-badge-label:contains("Best Seller")').text().trim() ||
                        $el.find('.a-badge-label:contains("#1")').text().trim() ||
                        $el.find('[class*="choice-badge"], [class*="best-seller"]').text().trim() ||
                        null
      const badge = badgeText && badgeText.length > 0 && badgeText.length < 100 ? badgeText : null

      // 🎯 Phase 3: Extract Prime eligibility
      const isPrime = $el.find('[aria-label*="Prime"], .a-icon-prime, [class*="prime"]').length > 0

      // Add product if we have a name
      if (name && name.length > 5 && !products.some(p => p.name === name)) {
        products.push({
          name,
          price,
          rating,
          reviewCount,
          imageUrl,
          asin,
          promotion,
          badge,
          isPrime,
        })
      }
    })
  }

  // Enhanced fallback: Try to extract products from any visible product images
  if (products.length < 5) {
    console.log('🔍 尝试从图片alt属性提取产品...')
    $('img[alt]').each((i, el) => {
      if (products.length >= 30) return false

      const alt = $(el).attr('alt')?.trim() || ''
      const src = $(el).attr('src') || ''

      // 🔥 优化过滤条件：放宽限制以匹配更多Amazon Store产品图片
      const isValidProductImage = alt &&
        alt.length > 5 &&  // 降低最小长度从15到5
        alt.length < 500 &&  // 提高最大长度从300到500
        !alt.toLowerCase().match(/logo|icon|banner|button|arrow|star|prime badge/i) &&  // 只排除明显的非产品元素
        (src.includes('images-amazon') || src.includes('ssl-images-amazon') || src.includes('m.media-amazon')) &&  // 支持更多Amazon CDN域名
        !products.some(p => p.name === alt)

      if (isValidProductImage) {
        // Try to find price near the image
        const $parent = $(el).closest('div').parent()
        const nearbyPrice = $parent.find('.a-price .a-offscreen').first().text().trim() ||
                           $parent.find('[class*="price"]').first().text().trim() ||
                           $parent.find('[class*="Price"]').first().text().trim() || null

        products.push({
          name: alt,
          price: nearbyPrice,
          rating: null,
          reviewCount: null,
          imageUrl: src,
          asin: src.match(/\/([A-Z0-9]{10})[\._]/)?.[1] || null,
          promotion: null,  // 🎯 Phase 3
          badge: null,      // 🎯 Phase 3
          isPrime: false,   // 🎯 Phase 3
        })
      }
    })
  }

  // 🔥 热销商品筛选逻辑
  console.log(`📊 原始产品数量: ${products.length}`)

  // 计算热销分数：score = rating × log(reviewCount + 1)
  const productsWithScores = products.map(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0

    // 热销分数公式：评分 × log(评论数 + 1)
    // 例如：4.5星 × log(1000) = 4.5 × 3 = 13.5
    const hotScore = rating > 0 && reviewCount > 0
      ? rating * Math.log10(reviewCount + 1)
      : 0

    return {
      ...p,
      hotScore,
      ratingNum: rating,
      reviewCountNum: reviewCount
    }
  })

  // 按热销分数降序排序
  productsWithScores.sort((a, b) => b.hotScore - a.hotScore)

  // 取前15-20个热销商品（如果商品总数少于15，则全部保留）
  const topCount = Math.min(15, productsWithScores.length)
  const topProducts = productsWithScores.slice(0, topCount)

  // 标注热销商品并格式化
  const enhancedProducts = topProducts.map((p, index) => ({
    name: p.name,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    imageUrl: p.imageUrl,
    asin: p.asin,
    hotScore: p.hotScore,
    rank: index + 1,
    isHot: index < 5,  // 前5名标记为"最热销"
    // 🎯 Phase 3: 保留新增字段
    promotion: p.promotion,
    badge: p.badge,
    isPrime: p.isPrime,
    hotLabel: index < 5 ? '🔥 热销商品' : '✅ 畅销商品'
  }))

  // 计算热销洞察
  const validProducts = topProducts.filter(p => p.ratingNum > 0 && p.reviewCountNum > 0)
  const hotInsights = validProducts.length > 0 ? {
    avgRating: validProducts.reduce((sum, p) => sum + p.ratingNum, 0) / validProducts.length,
    avgReviews: Math.round(validProducts.reduce((sum, p) => sum + p.reviewCountNum, 0) / validProducts.length),
    topProductsCount: topCount
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

  console.log(`✅ Store抓取成功: ${storeName}`)
  console.log(`📊 热销商品筛选: ${products.length} → ${enhancedProducts.length}`)
  if (hotInsights) {
    console.log(`💡 热销洞察: 平均评分 ${hotInsights.avgRating.toFixed(1)}⭐, 平均评论 ${hotInsights.avgReviews} 条`)
  }

  return storeData
  } finally {
    await browser.close()
  }
}

/**
 * Independent site store data structure
 */
export interface IndependentStoreData {
  storeName: string | null
  storeDescription: string | null
  logoUrl: string | null
  products: Array<{
    name: string
    price: string | null
    imageUrl: string | null
    productUrl: string | null
  }>
  totalProducts: number
  storeUrl: string
  platform: string | null // shopify, woocommerce, generic
}

/**
 * Scrape independent e-commerce store page
 * Extracts brand info and product listings for AI creative generation
 */
export async function scrapeIndependentStore(
  url: string,
  customProxyUrl?: string
): Promise<IndependentStoreData> {
  console.log(`🏪 抓取独立站店铺: ${url}`)

  const { browser, proxy } = await createStealthBrowser(customProxyUrl)

  try {
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
    })

    const page = await context.newPage()
    await configureStealthPage(page)

    console.log(`🌐 访问URL: ${url}`)
    await randomDelay(500, 1500)

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 40000,
    })

    if (!response) throw new Error('No response received')
    console.log(`📊 HTTP状态: ${response.status()}`)

    // Wait for content to load
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.warn('⚠️ 网络未完全空闲，继续处理')
    })

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
    await context.close()

    // Parse HTML with cheerio
    const { load } = await import('cheerio')
    const $ = load(html)

    // Detect platform
    let platform: string | null = null
    if ($('script[src*="cdn.shopify.com"]').length > 0 || $('[data-shopify]').length > 0) {
      platform = 'shopify'
    } else if ($('script[src*="woocommerce"]').length > 0 || $('body.woocommerce').length > 0) {
      platform = 'woocommerce'
    } else if ($('[class*="bigcommerce"]').length > 0) {
      platform = 'bigcommerce'
    }

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

    // Extract products - try multiple common e-commerce patterns
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
      if (products.length >= 5) break // If we found some products, stop trying

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

        // Extract image
        const imageUrl = $el.find('img').first().attr('src') ||
                         $el.find('img').first().attr('data-src') ||
                         null

        // Extract product link
        const productUrl = $el.find('a').first().attr('href') ||
                          $el.attr('href') ||
                          null

        // Add product if we have a valid name
        if (name && name.length > 3 && name.length < 200 && !products.some(p => p.name === name)) {
          products.push({
            name,
            price,
            imageUrl,
            productUrl: productUrl ? (productUrl.startsWith('http') ? productUrl : new URL(productUrl, finalUrl).href) : null,
          })
        }
      })
    }

    // Fallback: Extract from images with product-like alt text
    if (products.length < 5) {
      console.log('🔍 尝试从图片提取产品...')
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
            imageUrl: src.startsWith('http') ? src : (src.startsWith('//') ? `https:${src}` : new URL(src, finalUrl).href),
            productUrl: nearbyLink ? (nearbyLink.startsWith('http') ? nearbyLink : new URL(nearbyLink, finalUrl).href) : null,
          })
        }
      })
    }

    const storeData: IndependentStoreData = {
      storeName: storeName ? normalizeBrandName(storeName) : null,
      storeDescription,
      logoUrl,
      products,
      totalProducts: products.length,
      storeUrl: finalUrl,
      platform,
    }

    console.log(`✅ 独立站抓取成功: ${storeName}`)
    console.log(`📊 发现 ${products.length} 个产品`)

    return storeData
  } finally {
    await browser.close()
  }
}
