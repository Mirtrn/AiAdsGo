/**
 * AI分析服务模块
 * 封装AI产品分析、评论分析、竞品分析、广告元素提取等功能
 */

import { analyzeProductPage } from './ai'

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
    // Store data
    storeData?: {
      storeName?: string
      storeDescription?: string
      products?: any[]
      totalProducts?: number
    }
    // Product data
    amazonProductData?: {
      productName?: string
      brandName?: string
      productDescription?: string
      productPrice?: string
      imageUrls?: string[]
    }
    // Independent store data
    independentStoreData?: {
      storeName?: string
      storeDescription?: string
      products?: any[]
      totalProducts?: number
      platform?: string
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
    // 构建页面数据
    const debug = extractResult.debug || {}
    const isAmazonStore = debug.isAmazonStore || false
    const isAmazonProductPage = debug.isAmazonProductPage || false
    const isIndependentStore = debug.isIndependentStore || false

    let pageType: 'product' | 'store' = 'product'
    let pageData: { title: string; description: string; text: string }

    if (isAmazonStore && extractResult.storeData) {
      pageType = 'store'
      const products = extractResult.storeData.products || []
      const productSummaries = products
        .slice(0, 15)
        .map((p: any, i: number) => {
          const hotMarker = i < 5 ? '🔥 ' : '✅ '
          return `${hotMarker}${p.name} - ${p.price || 'N/A'} (Rating: ${p.rating || 'N/A'}, Reviews: ${p.reviews || 0})`
        })
        .join('\n')

      pageData = {
        title: extractResult.storeData.storeName || extractResult.brand || 'Unknown Store',
        description: extractResult.storeData.storeDescription || '',
        text: [
          `Store Name: ${extractResult.storeData.storeName || extractResult.brand || 'Unknown'}`,
          `Total Products: ${extractResult.storeData.totalProducts || 0}`,
          extractResult.productDescription ? `Description: ${extractResult.productDescription}` : '',
          '\n=== HOT-SELLING PRODUCTS (Top 15) ===',
          productSummaries,
        ].join('\n'),
      }
    } else if (isIndependentStore && extractResult.independentStoreData) {
      pageType = 'store'
      const products = extractResult.independentStoreData.products || []
      const productSummaries = products
        .slice(0, 15)
        .map((p: any, i: number) => `${i + 1}. ${p.name} - ${p.price || 'N/A'}`)
        .join('\n')

      pageData = {
        title: extractResult.independentStoreData.storeName || extractResult.brand || 'Unknown Store',
        description: extractResult.independentStoreData.storeDescription || '',
        text: [
          `Store Name: ${extractResult.independentStoreData.storeName}`,
          `Platform: ${extractResult.independentStoreData.platform || 'Unknown'}`,
          `Total Products: ${extractResult.independentStoreData.totalProducts}`,
          extractResult.productDescription ? `Description: ${extractResult.productDescription}` : '',
          '\n=== PRODUCTS ===',
          productSummaries,
        ].join('\n'),
      }
    } else if (extractResult.amazonProductData) {
      pageType = 'product'
      pageData = {
        title: extractResult.amazonProductData.productName || extractResult.brand || 'Unknown Product',
        description: extractResult.amazonProductData.productDescription || '',
        text: [
          `Product: ${extractResult.amazonProductData.productName || 'Unknown'}`,
          `Brand: ${extractResult.amazonProductData.brandName || 'Unknown'}`,
          `Price: ${extractResult.amazonProductData.productPrice || 'N/A'}`,
          extractResult.amazonProductData.productDescription ? `\nDescription:\n${extractResult.amazonProductData.productDescription}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
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

  } catch (error: any) {
    console.error('⚠️ AI产品分析失败（不影响流程）:', error.message)
    result.aiAnalysisSuccess = false
  }

  return result
}
