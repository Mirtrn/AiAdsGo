/**
 * Scraper Types and Interfaces
 *
 * Shared type definitions for all scraper modules
 */

import type { Browser, BrowserContext } from 'playwright'
import type { ProxyCredentials } from '../proxy/fetch-proxy-ip'

// Re-export ProxyCredentials for external use
export type { ProxyCredentials } from '../proxy/fetch-proxy-ip'

/**
 * 浏览器实例结果（支持连接池和独立创建两种模式）
 */
export interface StealthBrowserResult {
  browser: Browser
  context: BrowserContext
  proxy?: ProxyCredentials
  instanceId?: string  // 连接池模式时有值
  fromPool: boolean    // 标记是否来自连接池
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
  aboutThisItem: string[]  // Amazon "About this item" 产品详细描述
  imageUrls: string[]
  // New fields for AI creative generation
  rating: string | null
  reviewCount: string | null
  salesRank: string | null
  badge: string | null  // 🎯 P3优化: Amazon trust badges (Amazon's Choice, Best Seller等)
  availability: string | null
  primeEligible: boolean
  reviewHighlights: string[]
  topReviews: string[]
  technicalDetails: Record<string, string>
  asin: string | null
  category: string | null
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
  // 🆕 Phase 2: 产品分类（全局店铺理解）
  productCategories?: {
    primaryCategories: Array<{
      name: string
      count: number
      url?: string
    }>
    categoryTree?: {
      [parentCategory: string]: string[]
    }
    totalCategories: number
  }
  // 🔥 新增：深度抓取结果（热销商品详情页数据）
  deepScrapeResults?: {
    topProducts: Array<{
      asin: string
      productData: AmazonProductData | null
      reviews: string[]           // 评价摘要
      competitorAsins: string[]   // 竞品ASIN列表
      scrapeStatus: 'success' | 'failed' | 'skipped'
      error?: string
    }>
    totalScraped: number
    successCount: number
    failedCount: number
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
    productUrl: string | null
  }>
  totalProducts: number
  storeUrl: string
  platform: string | null // shopify, woocommerce, generic
}

/**
 * Scrape URL result
 */
export interface ScrapeUrlResult {
  html: string
  title: string
  finalUrl: string
  redirectChain: string[]
  screenshot?: Buffer
}

/**
 * Affiliate link resolution result
 */
export interface AffiliateLinkResult {
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
}
