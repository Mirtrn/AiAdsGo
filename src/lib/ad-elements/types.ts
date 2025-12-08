/**
 * Ad Elements Extractor - Type Definitions
 */

import type { AmazonProductData, AmazonStoreData } from '../stealth-scraper'

// Type alias for Store Product (extracted from AmazonStoreData.products)
export type StoreProduct = AmazonStoreData['products'][number]

// 扩展的Store Product类型（包含深度数据）
export type EnrichedStoreProduct = {
  name: string
  asin?: string | null
  price?: string | null
  rating?: string | null
  reviewCount?: string | null
  imageUrl?: string | null
  hotScore?: number
  hasDeepData?: boolean
  // 深度数据字段
  productData?: AmazonProductData | null
  reviewAnalysis?: any | null
  competitorAnalysis?: any | null
  productInfo?: any | null  // AI产品分析结果
}

/**
 * 提取的广告元素
 */
export interface ExtractedAdElements {
  // 关键字（已查询搜索量）
  keywords: Array<{
    keyword: string
    source: 'product_title' | 'google_suggest' | 'brand_variant'
    searchVolume: number
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
  }>

  // 广告标题（15个）
  headlines: string[]

  // 广告描述（4个）
  descriptions: string[]

  // 提取来源统计
  sources: {
    productCount: number
    keywordSources: Record<string, number>
    topProducts: Array<{
      name: string
      rating: string | null
      reviewCount: string | null
    }>
  }
}

/**
 * 商品数据接口（兼容单商品和店铺商品）
 */
export interface ProductInfo {
  name: string
  description?: string
  features?: string[]
  aboutThisItem?: string[]  // Amazon "About this item" 产品详细描述
  brand?: string
  rating?: string | null
  reviewCount?: string | null
  // Deep analysis fields from productInfo
  uniqueSellingPoints?: string
  targetAudience?: string
  productHighlights?: string
  brandDescription?: string
}

/**
 * 品类阈值配置
 */
export interface CategoryThreshold {
  highReviewBase: number  // High 流行度评论数基准
  mediumReviewBase: number  // Medium 流行度评论数基准
  multiplier: number  // 门槛倍数
  description: string
}
