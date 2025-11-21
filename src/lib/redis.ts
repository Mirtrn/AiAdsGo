import Redis from 'ioredis'

// 7天缓存时间（秒）
const CACHE_TTL = 7 * 24 * 60 * 60

// 单例Redis连接
let redisClient: Redis | null = null

/**
 * 获取Redis客户端连接
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not set')
    }

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    })

    redisClient.on('error', (err) => {
      console.error('Redis连接错误:', err.message)
    })

    redisClient.on('connect', () => {
      console.log('Redis已连接')
    })
  }

  return redisClient
}

/**
 * 生成网页缓存的key
 * @param url - 网页URL
 * @param language - 目标语言
 */
function generateCacheKey(url: string, language: string): string {
  // 标准化URL（移除尾部斜杠和查询参数中的tracking）
  const normalizedUrl = url
    .replace(/\/$/, '')
    .replace(/[?&](ref|tag|utm_[^&]+)=[^&]*/g, '')

  return `scrape:${language}:${Buffer.from(normalizedUrl).toString('base64')}`
}

/**
 * SEO数据结构
 */
export interface SeoData {
  metaTitle: string
  metaDescription: string
  metaKeywords: string
  ogTitle: string
  ogDescription: string
  ogImage: string
  canonicalUrl: string
  h1: string[]
  imageAlts: string[]
}

/**
 * 网页抓取数据的缓存结构
 * 注意：不存储完整HTML以节省存储空间，只保留AI生成创意所需的文本内容和SEO信息
 */
export interface CachedPageData {
  title: string
  description: string
  text: string
  seo: SeoData
  cachedAt: string
  url: string
  language: string
}

/**
 * 从缓存获取网页数据
 * @param url - 网页URL
 * @param language - 目标语言
 * @returns 缓存的数据或null
 */
export async function getCachedPageData(
  url: string,
  language: string
): Promise<CachedPageData | null> {
  try {
    const redis = getRedisClient()
    const key = generateCacheKey(url, language)

    const cached = await redis.get(key)
    if (cached) {
      console.log(`📦 缓存命中: ${url}`)
      return JSON.parse(cached)
    }

    console.log(`📭 缓存未命中: ${url}`)
    return null
  } catch (error: any) {
    console.error('Redis读取失败:', error.message)
    return null
  }
}

/**
 * 将网页数据保存到缓存
 * @param url - 网页URL
 * @param language - 目标语言
 * @param data - 网页数据（包含文本内容和SEO信息）
 */
export async function setCachedPageData(
  url: string,
  language: string,
  data: { title: string; description: string; text: string; seo?: SeoData }
): Promise<void> {
  try {
    const redis = getRedisClient()
    const key = generateCacheKey(url, language)

    const cacheData: CachedPageData = {
      title: data.title,
      description: data.description,
      text: data.text,
      seo: data.seo || {
        metaTitle: '',
        metaDescription: '',
        metaKeywords: '',
        ogTitle: '',
        ogDescription: '',
        ogImage: '',
        canonicalUrl: '',
        h1: [],
        imageAlts: [],
      },
      url,
      language,
      cachedAt: new Date().toISOString(),
    }

    await redis.setex(key, CACHE_TTL, JSON.stringify(cacheData))
    console.log(`💾 已缓存网页数据: ${url} (TTL: 7天, 大小: ${JSON.stringify(cacheData).length} bytes)`)
  } catch (error: any) {
    console.error('Redis写入失败:', error.message)
    // 缓存失败不影响主流程
  }
}

/**
 * 清除特定URL的缓存
 * @param url - 网页URL
 * @param language - 目标语言
 */
export async function clearPageCache(url: string, language: string): Promise<void> {
  try {
    const redis = getRedisClient()
    const key = generateCacheKey(url, language)
    await redis.del(key)
    console.log(`🗑️ 已清除缓存: ${url}`)
  } catch (error: any) {
    console.error('Redis删除失败:', error.message)
  }
}

/**
 * 检查Redis连接状态
 */
export async function checkRedisConnection(): Promise<boolean> {
  try {
    const redis = getRedisClient()
    await redis.ping()
    return true
  } catch (error) {
    return false
  }
}

/**
 * 关闭Redis连接
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    console.log('Redis连接已关闭')
  }
}

// ============================================
// Keyword Search Volume Caching
// ============================================

const PREFIX = process.env.REDIS_KEY_PREFIX || 'autoads:'

// Keyword volume cache key format: autoads:kw:US:en:keyword
export function getKeywordCacheKey(keyword: string, country: string, language: string): string {
  return `${PREFIX}kw:${country}:${language}:${keyword.toLowerCase()}`
}

// Cache keyword search volume (TTL: 7 days)
export async function cacheKeywordVolume(
  keyword: string,
  country: string,
  language: string,
  volume: number,
  ttlSeconds: number = CACHE_TTL
): Promise<void> {
  try {
    const client = getRedisClient()
    const key = getKeywordCacheKey(keyword, country, language)
    await client.setex(key, ttlSeconds, JSON.stringify({ volume, cachedAt: Date.now() }))
  } catch (error: any) {
    console.error('[Redis] Cache keyword volume error:', error.message)
  }
}

// Get cached keyword volume
export async function getCachedKeywordVolume(
  keyword: string,
  country: string,
  language: string
): Promise<{ volume: number; cachedAt: number } | null> {
  try {
    const client = getRedisClient()
    const key = getKeywordCacheKey(keyword, country, language)
    const data = await client.get(key)
    if (data) {
      return JSON.parse(data)
    }
  } catch (error: any) {
    console.error('[Redis] Get keyword volume error:', error.message)
  }
  return null
}

// Batch get cached volumes
export async function getBatchCachedVolumes(
  keywords: string[],
  country: string,
  language: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  try {
    const client = getRedisClient()
    const keys = keywords.map(kw => getKeywordCacheKey(kw, country, language))
    if (keys.length === 0) return result

    const values = await client.mget(...keys)

    keywords.forEach((kw, idx) => {
      if (values[idx]) {
        const data = JSON.parse(values[idx] as string)
        result.set(kw.toLowerCase(), data.volume)
      }
    })
  } catch (error: any) {
    console.error('[Redis] Batch get error:', error.message)
  }
  return result
}

// Batch cache volumes
export async function batchCacheVolumes(
  data: Array<{ keyword: string; volume: number }>,
  country: string,
  language: string,
  ttlSeconds: number = CACHE_TTL
): Promise<void> {
  try {
    const client = getRedisClient()
    const pipeline = client.pipeline()

    for (const item of data) {
      const key = getKeywordCacheKey(item.keyword, country, language)
      pipeline.setex(key, ttlSeconds, JSON.stringify({ volume: item.volume, cachedAt: Date.now() }))
    }

    await pipeline.exec()
  } catch (error: any) {
    console.error('[Redis] Batch cache error:', error.message)
  }
}
