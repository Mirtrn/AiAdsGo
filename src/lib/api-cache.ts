/**
 * API响应缓存工具
 * 使用内存缓存减少重复计算和数据库查询
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

class ApiCache {
  private cache: Map<string, CacheEntry<any>> = new Map()
  private defaultTTL: number = 5 * 60 * 1000 // 默认5分钟

  /**
   * 获取缓存数据
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  /**
   * 设置缓存数据
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const actualTTL = ttl || this.defaultTTL
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + actualTTL,
    }
    this.cache.set(key, entry)
  }

  /**
   * 删除缓存数据
   */
  delete(key: string): void {
    this.cache.delete(key)
  }

  /**
   * 按前缀删除多个缓存
   */
  deleteByPrefix(prefix: string): void {
    const keysToDelete: string[] = []
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key))
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    totalKeys: number
    validKeys: number
    expiredKeys: number
  } {
    let validKeys = 0
    let expiredKeys = 0
    const now = Date.now()

    for (const entry of this.cache.values()) {
      if (now <= entry.expiresAt) {
        validKeys++
      } else {
        expiredKeys++
      }
    }

    return {
      totalKeys: this.cache.size,
      validKeys,
      expiredKeys,
    }
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key))
  }

  /**
   * 获取或设置缓存（带回调函数）
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // 尝试从缓存获取
    const cached = this.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // 缓存未命中，执行获取函数
    const data = await fetchFn()
    this.set(key, data, ttl)
    return data
  }
}

// 导出单例实例
export const apiCache = new ApiCache()

// 定期清理过期缓存（每10分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    apiCache.cleanup()
  }, 10 * 60 * 1000)
}

/**
 * 生成缓存键
 */
export function generateCacheKey(
  prefix: string,
  userId: number,
  params?: Record<string, any>
): string {
  const paramStr = params ? JSON.stringify(params) : ''
  return `${prefix}:user:${userId}:${paramStr}`
}

/**
 * 用户相关数据缓存失效
 */
export function invalidateUserCache(userId: number): void {
  apiCache.deleteByPrefix(`user:${userId}`)
  apiCache.deleteByPrefix(`:user:${userId}:`)
}

/**
 * Offer相关缓存失效
 */
export function invalidateOfferCache(userId: number, offerId?: number): void {
  if (offerId) {
    apiCache.deleteByPrefix(`offer:${offerId}`)
  }
  apiCache.deleteByPrefix(`offers:user:${userId}`)
  apiCache.deleteByPrefix(`dashboard:user:${userId}`)
}

/**
 * Creative相关缓存失效
 */
export function invalidateCreativeCache(userId: number, creativeId?: number): void {
  if (creativeId) {
    apiCache.deleteByPrefix(`creative:${creativeId}`)
  }
  apiCache.deleteByPrefix(`creatives:user:${userId}`)
  apiCache.deleteByPrefix(`dashboard:user:${userId}`)
}

/**
 * Dashboard缓存失效
 */
export function invalidateDashboardCache(userId: number): void {
  apiCache.deleteByPrefix(`dashboard:user:${userId}`)
  apiCache.deleteByPrefix(`kpis:user:${userId}`)
  apiCache.deleteByPrefix(`trends:user:${userId}`)
  apiCache.deleteByPrefix(`insights:user:${userId}`)
}
