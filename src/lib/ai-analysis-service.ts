/**
 * AI分析服务模块
 * 封装AI产品分析、评论分析、竞品分析、广告元素提取等功能
 */

import { analyzeProductPage } from './ai'
import { analyzeReviewsWithAI, type RawReview } from './review-analyzer'
import { analyzeCompetitorsWithAI, type CompetitorProduct } from './competitor-analyzer'
import { extractAdElements } from './ad-elements-extractor'

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

        // 方式1: 从Amazon产品页的topReviews字段提取（格式："4.5 stars - Title: Review text..."）
        if (isAmazonProductPage && extractResult.topReviews && extractResult.topReviews.length > 0) {
          console.log(`📊 从Amazon产品页提取 ${extractResult.topReviews.length} 条评论...`)
          extractResult.topReviews.forEach((reviewText: string) => {
            // 解析评论格式："4.5 stars - Title: Review text..."
            const ratingMatch = reviewText.match(/^([\d.]+)\s+stars?/i)
            const rating = ratingMatch ? `${ratingMatch[1]} out of 5 stars` : null

            reviews.push({
              rating,
              title: reviewText.split(' - ')[1]?.split(':')[0]?.trim() || null,
              body: reviewText.split(':').slice(1).join(':').trim() || reviewText,
              helpful: null,
              verified: false,
              date: new Date().toISOString(),
              author: 'Amazon Customer',
            })
          })
        }
        // 方式2: 从店铺产品中提取评论信息（适用于Amazon Store和独立站）
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
        }

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
          console.log('⚠️ 未找到评论数据，跳过评论分析')
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

        // 从店铺产品数据中提取竞品（适用于Amazon Store和独立站）
        if (extractResult.products && extractResult.products.length > 0) {
          console.log(`📊 从店铺产品中提取竞品数据 (${extractResult.products.length}个产品)...`)
          // 将店铺中的其他产品视为竞品
          extractResult.products.slice(0, 10).forEach((product: any) => {
            const priceNum = product.price ? parseFloat(product.price.replace(/[^0-9.]/g, '')) : null
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
        }

        if (competitors.length >= 2) {
          // 🔥 修复：从扁平化结构中提取产品价格信息
          const productPrice = extractResult.price
            ? parseFloat(extractResult.price.replace(/[^0-9.]/g, ''))
            : null

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
          console.log('⚠️ 竞品数据不足，跳过竞品分析')
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
