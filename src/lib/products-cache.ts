import crypto from 'crypto'
import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis'

const LIST_TTL_SECONDS = 120
const LIST_INDEX_TTL_SECONDS = 24 * 60 * 60
const MAX_INVALIDATE_SCAN_ROUNDS = 20

function getListKey(userId: number, hash: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:${hash}`
}

function getListPattern(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:*`
}

function getListIndexKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:index`
}

export type ProductListCachePayload = {
  page: number
  pageSize: number
  search: string
  sortBy: string
  sortOrder: string
  platform: string
}

export function buildProductListCacheHash(payload: ProductListCachePayload): string {
  return crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex')
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
    const listKey = getListKey(userId, hash)
    const indexKey = getListIndexKey(userId)
    const payload = JSON.stringify(value)

    await redis
      .multi()
      .setex(listKey, LIST_TTL_SECONDS, payload)
      .sadd(indexKey, listKey)
      .expire(indexKey, LIST_INDEX_TTL_SECONDS)
      .exec()
  } catch {
    // ignore cache write failure
  }
}

export async function invalidateProductListCache(userId: number): Promise<void> {
  try {
    const redis = getRedisClient()
    const indexKey = getListIndexKey(userId)

    const indexedKeys = await redis.smembers(indexKey)
    if (indexedKeys.length > 0) {
      await redis.del(...indexedKeys)
    }
    await redis.del(indexKey)

    // 兼容历史缓存键：使用有上限的scan兜底清理，避免全库scan阻塞接口响应
    const pattern = getListPattern(userId)
    let cursor = '0'
    let rounds = 0

    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = String(result?.[0] ?? '0')
      const keys = Array.isArray(result?.[1]) ? result[1] : []
      if (keys.length > 0) {
        await redis.del(...keys)
      }
      rounds += 1
    } while (cursor !== '0' && rounds < MAX_INVALIDATE_SCAN_ROUNDS)
  } catch {
    // ignore cache invalidation failure
  }
}
