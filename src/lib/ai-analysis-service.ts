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

    // ========== P0评论深度分析 ==========
    if (input.enableReviewAnalysis) {
      try {
        console.log(`🔍 开始评论分析...`)

        // 构建评论数据（从Amazon产品数据或店铺数据中提取）
        const reviews: RawReview[] = []

        if (extractResult.amazonProductData) {
          // TODO: 从amazonProductData中提取评论数据（需要scraper支持）
          console.log('⚠️ Amazon产品评论数据暂未实现')
        } else if (extractResult.storeData?.products) {
          // 从店铺产品中提取评论信息
          extractResult.storeData.products.forEach((product: any) => {
            if (product.rating && product.reviews > 0) {
              reviews.push({
                rating: product.rating,
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

        // 构建竞品数据（从店铺产品数据中提取）
        const competitors: CompetitorProduct[] = []

        if (extractResult.storeData?.products) {
          // 将店铺中的其他产品视为竞品
          extractResult.storeData.products.slice(0, 10).forEach((product: any) => {
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
          const productPrice = extractResult.amazonProductData?.productPrice
            ? parseFloat(extractResult.amazonProductData.productPrice.replace(/[^0-9.]/g, ''))
            : null

          const ourProduct = {
            name: extractResult.amazonProductData?.productName || extractResult.brand || 'Unknown',
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

        const scraped = {
          pageType: pageType as 'product' | 'store' | 'unknown',
          product: extractResult.amazonProductData as any,
          storeProducts: extractResult.storeData?.products as any,
          hasDeepData: !!(extractResult.amazonProductData || extractResult.storeData),
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
