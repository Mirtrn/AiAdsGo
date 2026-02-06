import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis'

const LIST_TTL_SECONDS = 120

function getListKey(userId: number, hash: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:${hash}`
}

function getListPattern(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:*`
}

export async function getCachedProductList<T>(userId: number, hash: string): Promise<T | null> {
  try {
    const redis = getRedisClient()
    const raw = await redis.get(getListKey(userId, hash))
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCachedProductList(userId: number, hash: string, value: unknown): Promise<void> {
  try {
    const redis = getRedisClient()
    await redis.setex(getListKey(userId, hash), LIST_TTL_SECONDS, JSON.stringify(value))
  } catch {
    // ignore cache write failure
  }
}

export async function invalidateProductListCache(userId: number): Promise<void> {
  try {
    const redis = getRedisClient()
    const pattern = getListPattern(userId)
    let cursor = '0'

    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = result[0]
      const keys = result[1] || []
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } while (cursor !== '0')
  } catch {
    // ignore cache invalidation failure
  }
}

