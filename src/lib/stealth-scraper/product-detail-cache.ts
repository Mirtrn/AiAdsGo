/**
 * 统一产品详情缓存模块
 *
 * 为店铺热销商品和竞品分析提供统一的缓存机制
 * - 24小时TTL
 * - 支持完整产品详情数据
 * - 避免重复抓取同一ASIN
 */

import type { AmazonProductData } from './types'

interface CachedProductDetail {
  data: AmazonProductData
  timestamp: number
}

// 统一的产品详情缓存
const productDetailCache = new Map<string, CachedProductDetail>()
const CACHE_TTL = 24 * 60 * 60 * 1000  // 24小时

// 缓存统计
let cacheHits = 0
let cacheMisses = 0

/**
 * 从缓存获取产品详情
 */
export function getCachedProductDetail(asin: string): AmazonProductData | null {
  const cached = productDetailCache.get(asin)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    cacheHits++
    console.log(`  📦 产品缓存命中: ${asin}`)
    return cached.data
  }
  if (cached) {
    productDetailCache.delete(asin)  // 清理过期缓存
  }
  cacheMisses++
  return null
}

/**
 * 保存产品详情到缓存
 */
export function setCachedProductDetail(asin: string, data: AmazonProductData): void {
  productDetailCache.set(asin, {
    data,
    timestamp: Date.now()
  })
}

/**
 * 获取缓存统计信息
 */
export function getProductCacheStats(): {
  size: number
  hitRate: string
  hits: number
  misses: number
} {
  const total = cacheHits + cacheMisses
  const hitRate = total > 0 ? ((cacheHits / total) * 100).toFixed(1) : '0'
  return {
    size: productDetailCache.size,
    hitRate: `${hitRate}% (${cacheHits}/${total})`,
    hits: cacheHits,
    misses: cacheMisses
  }
}

/**
 * 清理过期缓存
 */
export function cleanupExpiredCache(): number {
  const now = Date.now()
  let cleaned = 0

  for (const [asin, cached] of productDetailCache.entries()) {
    if (now - cached.timestamp >= CACHE_TTL) {
      productDetailCache.delete(asin)
      cleaned++
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 清理了 ${cleaned} 个过期缓存`)
  }

  return cleaned
}

/**
 * 清空所有缓存（测试用）
 */
export function clearAllCache(): void {
  productDetailCache.clear()
  cacheHits = 0
  cacheMisses = 0
}

/**
 * 批量检查缓存，返回已缓存和未缓存的ASIN列表
 */
export function checkCacheBatch(asins: string[]): {
  cached: Array<{ asin: string; data: AmazonProductData }>
  uncached: string[]
} {
  const cached: Array<{ asin: string; data: AmazonProductData }> = []
  const uncached: string[] = []

  for (const asin of asins) {
    const data = getCachedProductDetail(asin)
    if (data) {
      cached.push({ asin, data })
    } else {
      uncached.push(asin)
    }
  }

  return { cached, uncached }
}
