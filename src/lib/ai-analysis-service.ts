/**
 * AI分析服务模块
 * 封装AI产品分析、评论分析、竞品分析、广告元素提取等功能
 */

import { analyzeProductPage } from './ai'
import { analyzeReviewsWithAI, type RawReview } from './review-analyzer'
import { analyzeCompetitorsWithAI, type CompetitorProduct } from './competitor-analyzer'
import { extractAdElements } from './ad-elements-extractor'
import { scrapeAmazonProduct } from './stealth-scraper/amazon-product'
import { parsePrice } from './pricing-utils'  // 🔧 新增：统一价格解析函数
import { getProxyUrlForCountry } from './settings'  // 🔥 修复（2025-12-09）：动态获取代理URL

export interface AIAnalysisInput {
  extractResult: {
    finalUrl: string
    finalUrlSuffix?: string
    brand?: string | null
    productDescription?: string | null
    targetLanguage?: string
    redirectCount?: number
    redirectChain?: string[]
    pageTitle?: string | null
    resolveMethod?: string
    productCount?: number
    pageType?: 'store' | 'product'
    // Flattened store properties (Amazon Store & Independent Store)
    storeName?: string
    storeDescription?: string
    platform?: string
    products?: any[]
    logoUrl?: string
    hotInsights?: {
      avgRating?: number
      avgReviews?: number
      topProductsCount?: number
    }
    // 店铺分类数据（店铺维度增强）
    productCategories?: {
      primaryCategories?: Array<{
        name: string
        count: number
        url?: string
      }>
      categoryTree?: Record<string, string[]>
      totalCategories?: number
    }
    // 深度抓取结果（热销商品详情页数据）
    deepScrapeResults?: {
      topProducts?: Array<{
        asin: string
        productData?: any
        reviews?: string[]
        competitorAsins?: string[]
        scrapeStatus: 'success' | 'failed' | 'skipped'
        error?: string
      }>
      totalScraped?: number
      successCount?: number
      failedCount?: number
    }
    // Flattened product properties
    productName?: string
    price?: string
    rating?: string | null
    reviewCount?: string | null
    reviewHighlights?: string[]
    topReviews?: string[]
    features?: string[]
    aboutThisItem?: string[]
    technicalDetails?: Record<string, string>
    imageUrls?: string[]
    originalPrice?: string | null
    discount?: string | null
    salesRank?: string | null
    availability?: string | null
    primeEligible?: boolean
    asin?: string | null
    category?: string | null
    // 🔥 新增：竞品ASIN列表（已过滤同品牌产品，包含价格和品牌信息）
    relatedAsins?: Array<{
      asin: string
      price: number | null
      brand: string | null
    }>
    // Legacy nested data (kept for backwards compatibility)
    storeData?: {
      storeName?: string
      storeDescription?: string
      products?: any[]
      totalProducts?: number
      storeUrl?: string
      brandName?: string | null
      hotInsights?: {
        avgRating: number
        avgReviews: number
        topProductsCount: number
      }
      productCategories?: {
        primaryCategories: Array<{
          name: string
          count: number
          url?: string
        }>
        categoryTree?: Record<string, string[]>
        totalCategories: number
      }
      deepScrapeResults?: {
        topProducts: Array<{
          asin: string
          productData: any
          reviews: string[]
          competitorAsins: string[]
          scrapeStatus: 'success' | 'failed' | 'skipped'
          error?: string
        }>
        totalScraped: number
        successCount: number
        failedCount: number
      }
    }
    amazonProductData?: {
      productName?: string
      brandName?: string
      productDescription?: string
      productPrice?: string
      imageUrls?: string[]
    }
    independentStoreData?: {
      storeName?: string
      storeDescription?: string
      products?: any[]
      totalProducts?: number
      platform?: string
      logoUrl?: string
    }
    // Debug info
    debug?: {
      isAmazonStore?: boolean
      isAmazonProductPage?: boolean
      isIndependentStore?: boolean
    }
  }
  targetCountry: string
  targetLanguage: string
  userId: number
  enableReviewAnalysis?: boolean
  enableCompetitorAnalysis?: boolean
  enableAdExtraction?: boolean
  // 🔥 新增（2025-12-08）：启用Playwright深度抓取，与手动创建流程保持一致
  // 当启用时，会使用Playwright抓取30条评论和5个竞品，而不是使用初始数据估算
  enablePlaywrightDeepScraping?: boolean
}

export interface AIAnalysisResult {
  aiAnalysisSuccess: boolean
  aiProductInfo?: {
    brandDescription?: string
    uniqueSellingPoints?: string
    productHighlights?: string
    targetAudience?: string
    category?: string
    // 🎯 P0优化（2025-12-07）：新增完整字段
    keywords?: string[]
    sellingPoints?: string[]
    productDescription?: string
    pricing?: {
      current?: string
      original?: string
      discount?: string
      competitiveness?: 'Premium' | 'Competitive' | 'Budget'
      valueAssessment?: string
    }
    reviews?: {
      rating?: number
      count?: number
      sentiment?: 'Positive' | 'Mixed' | 'Negative'
      positives?: string[]
      concerns?: string[]
      useCases?: string[]
    }
    promotions?: {
      active?: boolean
      types?: string[]
      urgency?: string | null
      freeShipping?: boolean
    }
    competitiveEdges?: {
      badges?: string[]
      primeEligible?: boolean
      stockStatus?: string
      salesRank?: string
    }
    // 🎯 v3.2优化（2025-12-08）：店铺/单品差异化分析字段
    // 店铺分析专用字段
    storeQualityLevel?: 'Premium' | 'Standard' | 'Budget' | 'Unknown'
    categoryDiversification?: {
      level: 'Focused' | 'Moderate' | 'Diverse'
      categories?: string[]
      primaryCategory?: string
    }
    hotInsights?: {
      avgRating?: number
      avgReviews?: number
      topProductsCount?: number
      bestSeller?: string
      priceRange?: { min: number; max: number }
    }
    // 单品分析专用字段
    marketFit?: {
      score: number // 0-100
      level: 'Excellent' | 'Good' | 'Average' | 'Poor'
      strengths?: string[]
      gaps?: string[]
    }
    credibilityLevel?: {
      score: number // 0-100
      level: 'High' | 'Medium' | 'Low'
      factors?: string[]
    }
    categoryPosition?: {
      rank?: string
      percentile?: number
      competitors?: number
    }
    // 页面类型标识
    pageType?: 'store' | 'product'
  }
  reviewAnalysis?: any
  reviewAnalysisSuccess?: boolean
  competitorAnalysis?: any
  competitorAnalysisSuccess?: boolean
  extractedKeywords?: string[]
  extractedHeadlines?: string[]
  extractedDescriptions?: string[]
  extractionMetadata?: any
  adExtractionSuccess?: boolean
}

/**
 * 根据国家获取Amazon域名
 */
function getAmazonDomain(country: string): string {
  const domainMap: Record<string, string> = {
    'US': 'com',
    'UK': 'co.uk',
    'DE': 'de',
    'FR': 'fr',
    'IT': 'it',
    'ES': 'es',
    'JP': 'co.jp',
    'CA': 'ca',
    'AU': 'com.au',
    'IN': 'in',
    'MX': 'com.mx',
    'BR': 'com.br',
  }
  return domainMap[country] || 'com'
}

// 🔥 新增（2025-12-09）：竞品详情缓存（24小时有效期）
interface CachedCompetitor {
  data: CompetitorProduct
  timestamp: number
}

const competitorCache = new Map<string, CachedCompetitor>()
const CACHE_TTL = 24 * 60 * 60 * 1000  // 24小时

/**
 * 从缓存获取竞品详情
 */
function getCachedCompetitor(asin: string): CompetitorProduct | null {
  const cached = competitorCache.get(asin)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`  📦 缓存命中: ${asin}`)
    return cached.data
  }
  if (cached) {
    competitorCache.delete(asin)  // 清理过期缓存
  }
  return null
}

/**
 * 保存竞品详情到缓存
 */
function setCachedCompetitor(asin: string, data: CompetitorProduct): void {
  competitorCache.set(asin, {
    data,
    timestamp: Date.now()
  })
}

/**
 * 获取缓存统计
 */
function getCacheStats(): { size: number, hitRate: string } {
  return {
    size: competitorCache.size,
    hitRate: `${competitorCache.size} items cached`
  }
}

/**
 * 基于价格区间的智能ASIN选择
 * 策略：从低/中/高价位各选1个，保证价格多样性
 *
 * @param asins - 竞品ASIN列表（包含价格信息）
 * @param limit - 最多选择数量
 * @returns 选中的ASIN列表
 */
function selectAsinsByPriceRange(
  asins: Array<{ asin: string, price: number | null, brand: string | null }>,
  limit: number = 3
): string[] {
  if (asins.length === 0) return []
  if (asins.length <= limit) return asins.map(a => a.asin)

  // 分离有价格和无价格的ASIN
  const withPrice = asins.filter(a => a.price !== null && a.price > 0)
  const withoutPrice = asins.filter(a => a.price === null || a.price <= 0)

  console.log(`📊 价格分析: ${withPrice.length}个有价格, ${withoutPrice.length}个无价格`)

  // 如果有价格的ASIN不足，使用均匀间隔选择
  if (withPrice.length < 2) {
    console.log(`⚠️ 价格信息不足，使用均匀间隔选择`)
    const step = Math.floor(asins.length / limit)
    return asins
      .filter((_, i) => i % step === 0)
      .slice(0, limit)
      .map(a => a.asin)
  }

  // 按价格排序
  const sorted = [...withPrice].sort((a, b) => (a.price || 0) - (b.price || 0))
  const minPrice = sorted[0].price || 0
  const maxPrice = sorted[sorted.length - 1].price || 0

  console.log(`💰 价格范围: ${minPrice} - ${maxPrice}`)

  // 计算价格区间
  const priceRange = maxPrice - minPrice
  const lowThreshold = minPrice + priceRange * 0.33
  const highThreshold = minPrice + priceRange * 0.67

  // 分组
  const lowPrice = sorted.filter(a => (a.price || 0) <= lowThreshold)
  const midPrice = sorted.filter(a => (a.price || 0) > lowThreshold && (a.price || 0) <= highThreshold)
  const highPrice = sorted.filter(a => (a.price || 0) > highThreshold)

  console.log(`📈 价格分组: 低价${lowPrice.length}个, 中价${midPrice.length}个, 高价${highPrice.length}个`)

  // 从每个价格区间选择
  const selected: string[] = []

  // 低价位：选择最低价
  if (lowPrice.length > 0) {
    selected.push(lowPrice[0].asin)
    console.log(`  ✅ 低价位: ${lowPrice[0].asin} (${lowPrice[0].price})`)
  }

  // 中价位：选择中间价格
  if (midPrice.length > 0 && selected.length < limit) {
    const midIndex = Math.floor(midPrice.length / 2)
    selected.push(midPrice[midIndex].asin)
    console.log(`  ✅ 中价位: ${midPrice[midIndex].asin} (${midPrice[midIndex].price})`)
  }

  // 高价位：选择最高价
  if (highPrice.length > 0 && selected.length < limit) {
    selected.push(highPrice[highPrice.length - 1].asin)
    console.log(`  ✅ 高价位: ${highPrice[highPrice.length - 1].asin} (${highPrice[highPrice.length - 1].price})`)
  }

  // 如果不足limit个，从其他区间补充
  const allCandidates = [...sorted, ...withoutPrice]
  for (const candidate of allCandidates) {
    if (selected.length >= limit) break
    if (!selected.includes(candidate.asin)) {
      selected.push(candidate.asin)
      console.log(`  ➕ 补充: ${candidate.asin} (${candidate.price || '无价格'})`)
    }
  }

  return selected.slice(0, limit)
}

/**
 * 批量抓取竞品详情
 * 复用现有的 scrapeAmazonProduct 函数，自动继承代理重试、反爬虫、品牌过滤等功能
 * 🔥 优化（2025-12-09）：支持缓存和基于价格区间的智能选择
 *
 * @param relatedAsins - 竞品ASIN列表（包含价格和品牌信息）
 * @param targetCountry - 目标国家
 * @param customProxyUrl - 自定义代理URL（可选）
 * @param limit - 最多抓取数量（默认3个，避免过度抓取）
 * @returns 竞品产品详情列表
 */
async function batchScrapeCompetitorDetails(
  relatedAsins: Array<{ asin: string, price: number | null, brand: string | null }>,
  targetCountry: string,
  customProxyUrl?: string,
  limit: number = 3
): Promise<CompetitorProduct[]> {
  console.log(`🔍 批量抓取竞品详情 (最多${limit}个)...`)
  console.log(`📊 缓存状态: ${getCacheStats().hitRate}`)

  // Step 1: 基于价格区间智能选择ASIN（低/中/高价位各1个）
  const selectedAsins = selectAsinsByPriceRange(relatedAsins, limit)
  console.log(`📋 已选择${selectedAsins.length}个多样化ASIN (按价格区间): ${selectedAsins.join(', ')}`)

  // Step 2: 检查缓存，分离已缓存和需抓取的ASIN
  const cachedCompetitors: CompetitorProduct[] = []
  const asinsToScrape: string[] = []

  for (const asin of selectedAsins) {
    const cached = getCachedCompetitor(asin)
    if (cached) {
      cachedCompetitors.push(cached)
    } else {
      asinsToScrape.push(asin)
    }
  }

  console.log(`📦 缓存: ${cachedCompetitors.length}个命中, ${asinsToScrape.length}个需抓取`)

  // Step 3: 构建竞品URL列表（只抓取未缓存的）
  if (asinsToScrape.length === 0) {
    console.log(`✅ 全部命中缓存，无需抓取`)
    return cachedCompetitors
  }

  const amazonDomain = getAmazonDomain(targetCountry)
  const competitorUrls = asinsToScrape.map(asin => ({
    asin,
    url: `https://www.amazon.${amazonDomain}/dp/${asin}`
  }))

  // Step 4: 并行抓取详情（使用Promise.allSettled避免单点失败）
  const results = await Promise.allSettled(
    competitorUrls.map(async ({ asin, url }) => {
      try {
        console.log(`  🔄 正在抓取竞品: ${asin}`)

        // 🔥 复用现有的 scrapeAmazonProduct 函数
        // 优势：自动包含代理重试、反爬虫、品牌过滤等逻辑
        const productData = await scrapeAmazonProduct(
          url,
          customProxyUrl,
          targetCountry,
          1  // 竞品抓取只重试1次（避免过长等待）
        )

        // 转换为 CompetitorProduct 格式
        const competitor: CompetitorProduct = {
          asin,
          name: productData.productName || `Product ${asin}`,
          brand: productData.brandName || 'Unknown',
          price: parsePrice(productData.productPrice),  // 🔧 修复：使用统一价格解析函数
          priceText: productData.productPrice || null,
          rating: productData.rating
            ? parseFloat(productData.rating)
            : null,
          reviewCount: productData.reviewCount
            ? parseInt(productData.reviewCount.replace(/[^0-9]/g, ''), 10)
            : null,
          imageUrl: productData.imageUrls?.[0] || null,
          source: 'related_products' as const,
          features: productData.features || productData.aboutThisItem || [],
        }

        // 🔥 保存到缓存
        setCachedCompetitor(asin, competitor)

        console.log(`  ✅ 成功抓取: ${asin} - ${competitor.name} (${competitor.brand})`)
        return competitor
      } catch (error: any) {
        console.warn(`  ❌ 竞品详情抓取失败 (${asin}):`, error.message)
        return null
      }
    })
  )

  // Step 5: 过滤成功的结果
  const scrapedCompetitors = results
    .filter((r): r is PromiseFulfilledResult<CompetitorProduct | null> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value!)

  // Step 6: 合并缓存和新抓取的结果
  const allCompetitors = [...cachedCompetitors, ...scrapedCompetitors]

  console.log(`✅ 批量抓取完成: 缓存${cachedCompetitors.length}个 + 新抓取${scrapedCompetitors.length}/${asinsToScrape.length}个 = 共${allCompetitors.length}个竞品`)

  return allCompetitors
}

/**
 * 执行AI分析
 * 包括产品分析、评论分析、竞品分析、广告元素提取
 */
export async function executeAIAnalysis(input: AIAnalysisInput): Promise<AIAnalysisResult> {
  const {
    extractResult,
    targetCountry,
    targetLanguage,
    userId,
  } = input

  const result: AIAnalysisResult = {
    aiAnalysisSuccess: false,
    reviewAnalysisSuccess: false,
    competitorAnalysisSuccess: false,
    adExtractionSuccess: false,
    extractedKeywords: [],
    extractedHeadlines: [],
    extractedDescriptions: [],
  }

  try {
    // 🔥 修复：构建页面数据（适配扁平化的extractResult结构）
    const debug = extractResult.debug || {}
    const isAmazonStore = debug.isAmazonStore || false
    const isAmazonProductPage = debug.isAmazonProductPage || false
    const isIndependentStore = debug.isIndependentStore || false

    let pageType: 'product' | 'store' = 'product'
    let pageData: { title: string; description: string; text: string }

    if (isAmazonStore && extractResult.products) {
      pageType = 'store'
      const products = extractResult.products || []
      const productSummaries = products
        .slice(0, 15)
        .map((p: any, i: number) => {
          const hotMarker = i < 5 ? '🔥 ' : '✅ '
          return `${hotMarker}${p.name} - ${p.price || 'N/A'} (Rating: ${p.rating || 'N/A'}, Reviews: ${p.reviews || 0})`
        })
        .join('\n')

      // 🎯 P1优化：增强店铺数据，添加分类和热销洞察
      const textParts = [
        `Store Name: ${extractResult.storeName || extractResult.brand || 'Unknown'}`,
        `Total Products: ${extractResult.productCount || 0}`,
        extractResult.productDescription ? `Description: ${extractResult.productDescription}` : '',
      ]

      // 添加热销洞察
      if (extractResult.hotInsights) {
        textParts.push(
          `\n=== HOT-SELLING INSIGHTS ===`,
          `Average Rating: ${extractResult.hotInsights.avgRating?.toFixed(1) || 'N/A'}`,
          `Average Reviews: ${extractResult.hotInsights.avgReviews?.toFixed(0) || 'N/A'}`,
          `Top Products Count: ${extractResult.hotInsights.topProductsCount || 0}`
        )
      }

      // 添加产品分类信息
      if (extractResult.productCategories?.primaryCategories && extractResult.productCategories.primaryCategories.length > 0) {
        const categories = extractResult.productCategories.primaryCategories
          .slice(0, 5)
          .map(c => `${c.name} (${c.count} products)`)
          .join(', ')
        textParts.push(
          `\n=== PRODUCT CATEGORIES ===`,
          categories
        )
      }

      // 添加热销产品列表
      textParts.push('\n=== HOT-SELLING PRODUCTS (Top 15) ===', productSummaries)

      pageData = {
        title: extractResult.storeName || extractResult.brand || 'Unknown Store',
        description: extractResult.productDescription || extractResult.storeDescription || '',
        text: textParts.filter(Boolean).join('\n'),
      }
    } else if (isIndependentStore && extractResult.products) {
      pageType = 'store'
      const products = extractResult.products || []
      const productSummaries = products
        .slice(0, 15)
        .map((p: any, i: number) => `${i + 1}. ${p.name} - ${p.price || 'N/A'}`)
        .join('\n')

      pageData = {
        title: extractResult.storeName || extractResult.brand || 'Unknown Store',
        description: extractResult.productDescription || '',
        text: [
          `Store Name: ${extractResult.storeName}`,
          `Platform: ${extractResult.platform || 'Unknown'}`,
          `Total Products: ${extractResult.productCount}`,
          extractResult.productDescription ? `Description: ${extractResult.productDescription}` : '',
          '\n=== PRODUCTS ===',
          productSummaries,
        ].join('\n'),
      }
    } else if (isAmazonProductPage && extractResult.productName) {
      pageType = 'product'
      // 🎯 P1优化：添加未使用的数据字段（rating, reviewCount, category）
      const textParts = [
        `Product: ${extractResult.productName || 'Unknown'}`,
        `Brand: ${extractResult.brand || 'Unknown'}`,
        `Category: ${extractResult.category || 'General'}`,
        `Price: ${extractResult.price || 'N/A'}`,
      ]

      // 添加评分和评论数
      if (extractResult.rating || extractResult.reviewCount) {
        textParts.push(
          `Rating: ${extractResult.rating || 'N/A'}`,
          `Reviews: ${extractResult.reviewCount || 'N/A'}`
        )
      }

      // 添加产品描述
      if (extractResult.productDescription) {
        textParts.push(`\nDescription:\n${extractResult.productDescription}`)
      }

      pageData = {
        title: extractResult.productName || extractResult.brand || 'Unknown Product',
        description: extractResult.productDescription || '',
        text: textParts.filter(Boolean).join('\n'),
      }
    } else {
      // 通用产品页面
      pageType = 'product'
      pageData = {
        title: extractResult.brand || 'Unknown Product',
        description: extractResult.productDescription || '',
        text: [
          extractResult.brand ? `Brand: ${extractResult.brand}` : '',
          extractResult.productDescription ? `\nDescription:\n${extractResult.productDescription}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      }
    }

    // 调用AI分析
    console.log(`🤖 开始AI产品分析 (页面类型: ${pageType})...`)
    const aiProductInfo = await analyzeProductPage(
      {
        url: extractResult.finalUrl,
        brand: extractResult.brand || 'Unknown',
        title: pageData.title,
        description: pageData.description,
        text: pageData.text,
        targetCountry,
        pageType,
      },
      userId
    )

    result.aiAnalysisSuccess = true
    result.aiProductInfo = aiProductInfo
    console.log('✅ AI产品分析完成')

    // ========== P0评论深度分析 ==========
    if (input.enableReviewAnalysis) {
      try {
        console.log(`🔍 开始评论分析...`)

        // 🔥 修复：从扁平化的extractResult中提取评论数据
        const reviews: RawReview[] = []
        const debug = extractResult.debug || {}
        const isAmazonProductPage = debug.isAmazonProductPage || false
        const isAmazonStore = debug.isAmazonStore || false

        // 🔍 诊断日志：验证数据传递 (UPDATED: 2025-12-08 13:50)
        console.log(`🔍 [FIX-V2] 评论分析上下文:`)
        console.log(`  - isAmazonStore: ${isAmazonStore}`)
        console.log(`  - isAmazonProductPage: ${isAmazonProductPage}`)
        console.log(`  - products: ${extractResult.products?.length || 0}个`)
        console.log(`  - pageType: ${extractResult.pageType || 'unknown'}`)
        console.log(`  - enablePlaywrightDeepScraping: ${input.enablePlaywrightDeepScraping || false}`)
        console.log(`  - debug存在: ${!!debug}`)
        console.log(`  - debug内容:`, JSON.stringify(debug, null, 2))

        // 🔥 新增（2025-12-08）：Playwright深度评论抓取（与手动创建流程一致）
        // 当 enablePlaywrightDeepScraping=true 且是Amazon单品页面时，使用Playwright抓取30条真实评论
        if (isAmazonProductPage && input.enablePlaywrightDeepScraping && extractResult.finalUrl) {
          console.log(`🚀 [DEEP SCRAPE] 启用Playwright深度评论抓取（30条评论）...`)

          try {
            const { getPlaywrightPool } = await import('@/lib/playwright-pool')
            const { scrapeAmazonReviews } = await import('@/lib/review-analyzer')
            const pool = getPlaywrightPool()

            const { context, instanceId } = await pool.acquire(undefined, undefined, targetCountry)
            const page = await context.newPage()

            try {
              await page.goto(extractResult.finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
              const scrapedReviews = await scrapeAmazonReviews(page, 30)

              if (scrapedReviews.length > 0) {
                console.log(`✅ Playwright抓取${scrapedReviews.length}条评论，执行AI分析...`)
                const reviewAnalysis = await analyzeReviewsWithAI(
                  scrapedReviews,
                  extractResult.brand || extractResult.productName || 'Unknown Product',
                  targetCountry,
                  userId,
                  { enableCompression: true, enableCache: true }
                )

                result.reviewAnalysis = reviewAnalysis
                result.reviewAnalysisSuccess = true
                console.log(`✅ [DEEP SCRAPE] 评论深度分析完成 (${scrapedReviews.length}条真实评论)`)
              } else {
                console.log('⚠️ [DEEP SCRAPE] Playwright未抓取到评论，使用备用数据')
                // 降级到使用已抓取的topReviews数据
              }
            } finally {
              await page.close()
              pool.release(instanceId)
            }
          } catch (playwrightError: any) {
            console.warn(`⚠️ [DEEP SCRAPE] Playwright评论抓取失败，降级使用已抓取数据:`, playwrightError.message)
            // 降级逻辑会在下面的else分支处理
          }
        }

        // 🔥 原有逻辑：单品页面使用已抓取的 topReviews 数据进行评论分析（作为备用方案）
        // 只有在 Playwright 深度抓取未执行或失败时才使用
        if (isAmazonProductPage && !result.reviewAnalysisSuccess) {
          // 检查是否有已抓取的评论数据
          const topReviews = extractResult.topReviews || []
          const reviewHighlights = extractResult.reviewHighlights || []

          if (topReviews.length > 0 || reviewHighlights.length > 0) {
            console.log(`📊 单品页面：使用已抓取的评论数据 (${topReviews.length}条评论, ${reviewHighlights.length}条高亮)...`)

            // 将 topReviews（string[]）转换为 RawReview[] 格式
            // topReviews 格式："4.5 stars - Title: Review text..."
            topReviews.forEach((reviewStr: string) => {
              // 解析评论字符串
              const ratingMatch = reviewStr.match(/^([\d.]+)\s*(?:out of 5\s*)?stars?\s*-?\s*/i)
              const rating = ratingMatch ? `${ratingMatch[1]} out of 5 stars` : null
              const textWithoutRating = ratingMatch ? reviewStr.replace(ratingMatch[0], '') : reviewStr

              // 尝试分离标题和正文
              const titleMatch = textWithoutRating.match(/^([^:]+):\s*(.+)$/)
              const title = titleMatch ? titleMatch[1].trim() : null
              const body = titleMatch ? titleMatch[2].trim() : textWithoutRating.trim()

              reviews.push({
                rating,
                title,
                body,
                helpful: null,
                verified: false,
                date: new Date().toISOString(),
                author: 'Amazon Reviewer',
              })
            })

            // 添加评论高亮作为摘要评论
            reviewHighlights.forEach((highlight: string) => {
              reviews.push({
                rating: extractResult.rating || null,
                title: 'Review Highlight',
                body: highlight,
                helpful: null,
                verified: true,
                date: new Date().toISOString(),
                author: 'Multiple Reviewers',
              })
            })

            if (reviews.length > 0) {
              const reviewAnalysis = await analyzeReviewsWithAI(
                reviews,
                extractResult.brand || extractResult.productName || 'Unknown Product',
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true }
              )

              result.reviewAnalysis = reviewAnalysis
              result.reviewAnalysisSuccess = true
              console.log(`✅ 单品页面评论分析完成 (${reviews.length}条评论)`)
            } else {
              console.log('⚠️ 单品页面未找到有效评论数据')
              result.reviewAnalysisSuccess = true  // 不视为失败
            }
          } else {
            console.log('ℹ️ 单品页面无评论数据可分析')
            result.reviewAnalysisSuccess = true  // 不视为失败
          }
        }
        // 🔥 修复（2025-12-08）：店铺页面判断逻辑优化
        // 问题：之前的条件 (isAmazonStore || extractResult.products) && extractResult.products && extractResult.products.length > 0
        // 当 isAmazonStore=true 但 products=[] 时，条件失败，导致跳过分析
        // 修复：优先判断 isAmazonStore，如果是店铺页面，即使没有产品也应该尝试分析
        else if (isAmazonStore) {
          // Amazon Store页面：即使没有产品数据，也标记为成功（可能是抓取失败，不应阻塞流程）
          if (!extractResult.products || extractResult.products.length === 0) {
            console.log(`⚠️ Amazon Store页面未提取到产品数据，跳过评论分析`)
            result.reviewAnalysisSuccess = true  // 标记为成功，不阻塞流程
          } else {
            // 店铺页面：从产品列表中提取评论信息
            console.log(`📊 从店铺产品中提取评论信息 (${extractResult.products.length}个产品)...`)
            extractResult.products.forEach((product: any) => {
              if (product.rating && product.reviews > 0) {
                reviews.push({
                  rating: typeof product.rating === 'number'
                    ? `${product.rating} out of 5 stars`
                    : product.rating,
                  title: product.name || null,
                  body: product.name || null,
                  helpful: null,
                  verified: false,
                  date: new Date().toISOString(),
                  author: 'Unknown',
                })
              }
            })

            if (reviews.length > 0) {
              const reviewAnalysis = await analyzeReviewsWithAI(
                reviews,
                extractResult.brand || 'Unknown Product',
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true }
              )

              result.reviewAnalysis = reviewAnalysis
              result.reviewAnalysisSuccess = true
              console.log(`✅ 评论分析完成 (${reviews.length}条评论)`)
            } else {
              console.log('⚠️ 店铺产品中未找到评论数据')
              result.reviewAnalysisSuccess = true  // 不视为失败
            }
          }
        }
        // 非Amazon店铺，但有产品数据（独立站等）
        else if (extractResult.products && extractResult.products.length > 0) {
          console.log(`📊 从店铺产品中提取评论信息 (${extractResult.products.length}个产品)...`)
          extractResult.products.forEach((product: any) => {
            if (product.rating && product.reviews > 0) {
              reviews.push({
                rating: typeof product.rating === 'number'
                  ? `${product.rating} out of 5 stars`
                  : product.rating,
                title: product.name || null,
                body: product.name || null,
                helpful: null,
                verified: false,
                date: new Date().toISOString(),
                author: 'Unknown',
              })
            }
          })

          if (reviews.length > 0) {
            const reviewAnalysis = await analyzeReviewsWithAI(
              reviews,
              extractResult.brand || 'Unknown Product',
              targetCountry,
              userId,
              { enableCompression: true, enableCache: true }
            )

            result.reviewAnalysis = reviewAnalysis
            result.reviewAnalysisSuccess = true
            console.log(`✅ 评论分析完成 (${reviews.length}条评论)`)
          } else {
            console.log('⚠️ 店铺产品中未找到评论数据')
            result.reviewAnalysisSuccess = true  // 不视为失败
          }
        } else {
          console.log('ℹ️ 非店铺页面，评论分析将由后续流程处理')
          result.reviewAnalysisSuccess = true  // 标记为成功，让后续流程继续
        }
      } catch (error: any) {
        console.error('⚠️ 评论分析失败（不影响流程）:', error.message)
        result.reviewAnalysisSuccess = false
      }
    }

    // ========== P0竞品对比分析 ==========
    if (input.enableCompetitorAnalysis) {
      try {
        console.log(`🔍 开始竞品分析...`)

        // 🔥 修复：从扁平化的extractResult中构建竞品数据
        const competitors: CompetitorProduct[] = []
        const debug = extractResult.debug || {}
        const isAmazonProductPage = debug.isAmazonProductPage || false
        const isAmazonStore = debug.isAmazonStore || false

        // 🔍 诊断日志：验证数据传递
        console.log(`🔍 竞品分析上下文:`)
        console.log(`  - isAmazonStore: ${isAmazonStore}`)
        console.log(`  - isAmazonProductPage: ${isAmazonProductPage}`)
        console.log(`  - products: ${extractResult.products?.length || 0}个`)
        console.log(`  - pageType: ${extractResult.pageType || 'unknown'}`)
        console.log(`  - enablePlaywrightDeepScraping: ${input.enablePlaywrightDeepScraping || false}`)
        console.log(`  - debug存在: ${!!debug}`)
        console.log(`  - debug内容:`, JSON.stringify(debug, null, 2))

        // 🔥 新增（2025-12-08）：Playwright深度竞品抓取（与手动创建流程一致）
        // 优先使用已提取的relatedAsins，避免重复抓取
        // 只有在没有relatedAsins或数量不足时，才启用Playwright深度抓取
        const hasRelatedAsins = extractResult.relatedAsins && extractResult.relatedAsins.length > 0

        if (isAmazonProductPage && !hasRelatedAsins && input.enablePlaywrightDeepScraping && extractResult.finalUrl) {
          console.log(`🚀 [DEEP SCRAPE] 未找到已提取的竞品ASIN，启用Playwright深度抓取（5个竞品）...`)

          try {
            const { getPlaywrightPool } = await import('@/lib/playwright-pool')
            const { scrapeAmazonCompetitors } = await import('@/lib/competitor-analyzer')
            const pool = getPlaywrightPool()

            const { context, instanceId } = await pool.acquire(undefined, undefined, targetCountry)
            const page = await context.newPage()

            try {
              await page.goto(extractResult.finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
              const scrapedCompetitors = await scrapeAmazonCompetitors(page, 5)

              if (scrapedCompetitors.length > 0) {
                console.log(`✅ Playwright抓取${scrapedCompetitors.length}个竞品，执行AI分析...`)

                // 从产品数据构建"我们的产品"对象
                // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
                const priceNum = parsePrice(extractResult.price)

                const ourProduct = {
                  name: extractResult.productName || extractResult.brand || 'Unknown Product',
                  brand: extractResult.brand || null,
                  price: priceNum,
                  rating: extractResult.rating ? parseFloat(extractResult.rating) : null,
                  reviewCount: extractResult.reviewCount ? parseInt(extractResult.reviewCount.replace(/[^0-9]/g, ''), 10) : null,
                  features: extractResult.features || extractResult.aboutThisItem || [],
                }

                const competitorAnalysis = await analyzeCompetitorsWithAI(
                  ourProduct,
                  scrapedCompetitors,
                  targetCountry,
                  userId,
                  { enableCompression: true, enableCache: true }
                )

                result.competitorAnalysis = competitorAnalysis
                result.competitorAnalysisSuccess = true
                console.log(`✅ [DEEP SCRAPE] 竞品深度分析完成 (${scrapedCompetitors.length}个真实竞品)`)
              } else {
                console.log('⚠️ [DEEP SCRAPE] Playwright未抓取到竞品，使用备用分析')
                // 降级到使用市场定位分析
              }
            } finally {
              await page.close()
              pool.release(instanceId)
            }
          } catch (playwrightError: any) {
            console.warn(`⚠️ [DEEP SCRAPE] Playwright竞品抓取失败，降级使用市场定位分析:`, playwrightError.message)
            // 降级逻辑会在下面的else分支处理
          }
        } else if (isAmazonProductPage && hasRelatedAsins) {
          // 🔥 新增（2025-12-09）：使用已提取的竞品ASIN，避免重复抓取
          console.log(`✅ 复用已提取的${extractResult.relatedAsins!.length}个竞品ASIN（已过滤同品牌产品）`)

          try {
            // 🔥 修复（2025-12-09）：动态获取代理URL（与商品抓取保持一致）
            const competitorProxyUrl = await getProxyUrlForCountry(targetCountry, userId)
            console.log(`🔧 竞品抓取代理: ${competitorProxyUrl ? '已配置' : '未配置'}`)

            // 构建"我们的产品"对象
            // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
            const priceNum = parsePrice(extractResult.price)

            const ourProduct = {
              name: extractResult.productName || extractResult.brand || 'Unknown Product',
              brand: extractResult.brand || null,
              price: priceNum,
              rating: extractResult.rating ? parseFloat(extractResult.rating) : null,
              reviewCount: extractResult.reviewCount ? parseInt(extractResult.reviewCount.replace(/[^0-9]/g, ''), 10) : null,
              features: extractResult.features || extractResult.aboutThisItem || [],
            }

            // 🔥 新增（2025-12-09）：批量抓取竞品详情（3个），获取完整产品信息
            const competitors = await batchScrapeCompetitorDetails(
              extractResult.relatedAsins!,
              targetCountry,
              competitorProxyUrl,  // 🔥 修复：使用动态获取的代理URL
              3           // 最多抓取3个竞品详情（数量控制）
            )

            if (competitors.length > 0) {
              // 使用完整的竞品数据进行分析
              const competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                competitors,
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true }
              )

              result.competitorAnalysis = competitorAnalysis
              result.competitorAnalysisSuccess = true
              console.log(`✅ [DETAILED COMPETITORS] 竞品详细分析完成 (${competitors.length}个完整竞品数据)`)
            } else {
              // 降级：使用简化的ASIN列表（无详情）
              console.warn(`⚠️ 竞品详情抓取全部失败，使用简化ASIN分析`)

              const simplifiedCompetitors: CompetitorProduct[] = extractResult.relatedAsins!.slice(0, 5).map(item => ({
                asin: item.asin,  // 🔥 从对象中提取ASIN字符串
                name: `Competitor Product ${item.asin}`,
                brand: item.brand || 'Competitor Brand',  // 使用提取的品牌信息
                price: item.price,  // 使用提取的价格信息
                priceText: item.price ? `$${item.price.toFixed(2)}` : null,
                rating: null,
                reviewCount: null,
                imageUrl: null,
                source: 'same_category' as const,
                features: [],
              }))

              const competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                simplifiedCompetitors,
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true }
              )

              result.competitorAnalysis = competitorAnalysis
              result.competitorAnalysisSuccess = true
              console.log(`✅ [SIMPLIFIED ASINS] 竞品简化分析完成 (${simplifiedCompetitors.length}个ASIN)`)
            }
          } catch (error: any) {
            console.warn(`⚠️ [REUSE ASINS] 竞品分析失败:`, error.message)
            // 降级到市场定位分析
          }
        }

        // 🔥 原有逻辑：单品页面使用市场定位分析（作为备用方案）
        // 只有在 Playwright 深度抓取未执行或失败时才使用
        if (isAmazonProductPage && !result.competitorAnalysisSuccess) {
          // 检查是否有足够的产品数据进行分析
          const hasProductData = extractResult.price || extractResult.rating || extractResult.category

          if (hasProductData) {
            console.log(`📊 单品页面：使用产品数据进行竞品市场定位分析...`)

            // 从产品数据构建"我们的产品"对象
            // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
            const priceNum = parsePrice(extractResult.price)

            const ourProduct = {
              name: extractResult.productName || extractResult.brand || 'Unknown Product',
              brand: extractResult.brand || null,
              price: priceNum,
              rating: extractResult.rating ? parseFloat(extractResult.rating) : null,
              reviewCount: extractResult.reviewCount ? parseInt(extractResult.reviewCount.replace(/[^0-9]/g, ''), 10) : null,
              features: extractResult.features || extractResult.aboutThisItem || [],
            }

            // 基于产品类别和salesRank推断竞争环境（无需实际抓取竞品）
            // 创建虚拟竞品数据用于AI分析（基于品类平均值）
            const categoryCompetitors: CompetitorProduct[] = []

            // 如果有salesRank，可以推断竞争强度
            if (extractResult.salesRank) {
              const rankMatch = extractResult.salesRank.match(/#?([\d,]+)/i)
              const rank = rankMatch ? parseInt(rankMatch[1].replace(/,/g, ''), 10) : null

              if (rank && rank < 10000) {
                // 高排名产品：创建虚拟竞品对比
                categoryCompetitors.push({
                  asin: 'category-avg',
                  name: `${extractResult.category || 'Category'} Average Product`,
                  brand: 'Category Average',
                  price: priceNum ? priceNum * 0.9 : null, // 假设品类平均价格略低
                  priceText: null,
                  rating: 4.2, // 品类平均评分
                  reviewCount: 500,
                  imageUrl: null,
                  source: 'same_category',  // 使用允许的类型
                  features: [],
                })

                categoryCompetitors.push({
                  asin: 'category-leader',
                  name: `${extractResult.category || 'Category'} Best Seller`,
                  brand: 'Category Leader',
                  price: priceNum ? priceNum * 1.2 : null, // 假设品类领先者价格略高
                  priceText: null,
                  rating: 4.6, // 领先者评分
                  reviewCount: 5000,
                  imageUrl: null,
                  source: 'same_category',  // 使用允许的类型
                  features: [],
                })
              }
            }

            // 只有当有足够数据时才进行分析
            if (categoryCompetitors.length >= 1 || (ourProduct.price && ourProduct.rating)) {
              const competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                categoryCompetitors.length > 0 ? categoryCompetitors : [{
                  asin: 'market-benchmark',
                  name: 'Market Benchmark',
                  brand: 'Market Average',
                  price: priceNum || 50,
                  priceText: null,
                  rating: 4.0,
                  reviewCount: 1000,
                  imageUrl: null,
                  source: 'same_category',  // 使用允许的类型
                  features: [],
                }],
                targetCountry,
                userId
              )

              result.competitorAnalysis = competitorAnalysis
              result.competitorAnalysisSuccess = true
              console.log(`✅ 单品页面竞品分析完成 (市场定位分析)`)
            } else {
              console.log('⚠️ 单品页面产品数据不足以进行竞品分析')
              result.competitorAnalysisSuccess = true  // 不视为失败
            }
          } else {
            console.log('ℹ️ 单品页面无足够产品数据进行竞品分析')
            result.competitorAnalysisSuccess = true  // 不视为失败
          }
        }
        // 🔥 修复（2025-12-08）：店铺页面判断逻辑优化
        // 问题：之前的条件 (isAmazonStore || extractResult.products) && extractResult.products && extractResult.products.length > 0
        // 当 isAmazonStore=true 但 products=[] 时，条件失败，导致跳过分析
        // 修复：优先判断 isAmazonStore，如果是店铺页面，即使没有产品也应该尝试分析
        else if (isAmazonStore) {
          // Amazon Store页面：即使没有产品数据，也标记为成功（可能是抓取失败，不应阻塞流程）
          if (!extractResult.products || extractResult.products.length === 0) {
            console.log(`⚠️ Amazon Store页面未提取到产品数据，跳过竞品分析`)
            result.competitorAnalysisSuccess = true  // 标记为成功，不阻塞流程
          } else {
            // 店铺页面：从产品数据中提取竞品
            console.log(`📊 从店铺产品中提取竞品数据 (${extractResult.products.length}个产品)...`)
            // 将店铺中的其他产品视为竞品
            extractResult.products.slice(0, 10).forEach((product: any) => {
              const priceNum = parsePrice(product.price)  // 🔧 修复：使用统一价格解析函数
              const ratingNum = product.rating ? parseFloat(product.rating) : null
              competitors.push({
                asin: product.asin || null,
                name: product.name || 'Unknown',
                brand: extractResult.brand || null,
                price: priceNum,
                priceText: product.price || null,
                rating: ratingNum,
                reviewCount: product.reviews || null,
                imageUrl: product.imageUrl || null,
                source: 'same_category',
                features: [],
              })
            })

            if (competitors.length >= 2) {
              // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
              const productPrice = parsePrice(extractResult.price)

              const ourProduct = {
                name: extractResult.productName || extractResult.brand || 'Unknown',
                brand: extractResult.brand || null,
                price: productPrice,
                rating: null,
                reviewCount: null,
                features: [],
              }

              const competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                competitors,
                targetCountry,
                userId
              )

              result.competitorAnalysis = competitorAnalysis
              result.competitorAnalysisSuccess = true
              console.log(`✅ 竞品分析完成 (对比${competitors.length}个竞品)`)
            } else {
              console.log('⚠️ 店铺产品数据不足（需要>=2个产品）')
              result.competitorAnalysisSuccess = true  // 不视为失败
            }
          }
        }
        // 非Amazon店铺，但有产品数据（独立站等）
        else if (extractResult.products && extractResult.products.length > 0) {
          console.log(`📊 从店铺产品中提取竞品数据 (${extractResult.products.length}个产品)...`)
          // 将店铺中的其他产品视为竞品
          extractResult.products.slice(0, 10).forEach((product: any) => {
            const priceNum = parsePrice(product.price)  // 🔧 修复：使用统一价格解析函数
            const ratingNum = product.rating ? parseFloat(product.rating) : null
            competitors.push({
              asin: product.asin || null,
              name: product.name || 'Unknown',
              brand: extractResult.brand || null,
              price: priceNum,
              priceText: product.price || null,
              rating: ratingNum,
              reviewCount: product.reviews || null,
              imageUrl: product.imageUrl || null,
              source: 'same_category',
              features: [],
            })
          })

          if (competitors.length >= 2) {
            // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
            const productPrice = parsePrice(extractResult.price)

            const ourProduct = {
              name: extractResult.productName || extractResult.brand || 'Unknown',
              brand: extractResult.brand || null,
              price: productPrice,
              rating: null,
              reviewCount: null,
              features: [],
            }

            const competitorAnalysis = await analyzeCompetitorsWithAI(
              ourProduct,
              competitors,
              targetCountry,
              userId
            )

            result.competitorAnalysis = competitorAnalysis
            result.competitorAnalysisSuccess = true
            console.log(`✅ 竞品分析完成 (对比${competitors.length}个竞品)`)
          } else {
            console.log('⚠️ 店铺产品数据不足（需要>=2个产品）')
            result.competitorAnalysisSuccess = true  // 不视为失败
          }
        } else {
          console.log('ℹ️ 非店铺页面，竞品分析将由后续流程处理')
          result.competitorAnalysisSuccess = true  // 标记为成功，让后续流程继续
        }
      } catch (error: any) {
        console.error('⚠️ 竞品分析失败（不影响流程）:', error.message)
        result.competitorAnalysisSuccess = false
      }
    }

    // ========== 广告元素提取 ==========
    if (input.enableAdExtraction) {
      try {
        console.log(`🔍 开始广告元素提取...`)

        // 🔥 修复：重构数据结构以适配extractAdElements期望的格式
        // extractResult现在是扁平结构，需要根据debug标志重新组装
        const debug = extractResult.debug || {}
        const isAmazonProductPage = debug.isAmazonProductPage || false
        const isAmazonStore = debug.isAmazonStore || false

        // 重构Amazon产品数据（如果是Amazon产品页）
        const amazonProductData = isAmazonProductPage && extractResult.rating ? {
          productName: extractResult.productName,
          brandName: extractResult.brand,
          productDescription: extractResult.productDescription,
          productPrice: extractResult.price,
          rating: extractResult.rating,
          reviewCount: extractResult.reviewCount,
          reviewHighlights: extractResult.reviewHighlights,
          topReviews: extractResult.topReviews,
          features: extractResult.features,
          aboutThisItem: extractResult.aboutThisItem,
          technicalDetails: extractResult.technicalDetails,
          imageUrls: extractResult.imageUrls,
          originalPrice: extractResult.originalPrice,
          discount: extractResult.discount,
          salesRank: extractResult.salesRank,
          availability: extractResult.availability,
          primeEligible: extractResult.primeEligible,
          asin: extractResult.asin,
          category: extractResult.category,
        } : undefined

        // 重构店铺产品数据（如果是Amazon Store或独立站）
        const storeProducts = extractResult.products || undefined

        const scraped = {
          pageType: pageType as 'product' | 'store' | 'unknown',
          product: amazonProductData as any,
          storeProducts: storeProducts as any,
          hasDeepData: !!(amazonProductData || storeProducts),
        }

        const adElements = await extractAdElements(
          scraped,
          extractResult.brand || 'Unknown',
          targetCountry,
          targetLanguage,
          userId
        )

        // 转换keywords为string[]格式（只保留keyword字段）
        result.extractedKeywords = adElements.keywords.map(k => k.keyword)
        result.extractedHeadlines = adElements.headlines
        result.extractedDescriptions = adElements.descriptions
        result.extractionMetadata = adElements.sources
        result.adExtractionSuccess = true
        console.log(`✅ 广告元素提取完成 (${result.extractedKeywords?.length || 0}个关键词)`)
      } catch (error: any) {
        console.error('⚠️ 广告元素提取失败（不影响流程）:', error.message)
        result.adExtractionSuccess = false
      }
    }

  } catch (error: any) {
    console.error('⚠️ AI产品分析失败（不影响流程）:', error.message)
    result.aiAnalysisSuccess = false
  }

  console.log('🎉 AI分析全流程完成')
  return result
}
