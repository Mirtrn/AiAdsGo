import crypto from 'crypto'
import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis'

const LIST_TTL_SECONDS = 120
const LIST_INDEX_TTL_SECONDS = 24 * 60 * 60
const LAST_QUERY_TTL_SECONDS = 24 * 60 * 60
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

function getLatestQueryKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:latest-query`
}

function getLegacyLatestQueryKey(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}products:user:${userId}:list:last-query`
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

function normalizeProductListCachePayload(input: unknown): ProductListCachePayload | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const obj = input as Record<string, unknown>
  const page = Number(obj.page)
  const pageSize = Number(obj.pageSize)
  const search = typeof obj.search === 'string' ? obj.search : ''
  const sortBy = typeof obj.sortBy === 'string' ? obj.sortBy : ''
  const sortOrder = typeof obj.sortOrder === 'string' ? obj.sortOrder.toLowerCase() : ''
  const platform = typeof obj.platform === 'string' ? obj.platform : ''

  if (!Number.isFinite(page) || page < 1) {
    return null
  }
  if (!Number.isFinite(pageSize) || pageSize < 10 || pageSize > 100) {
    return null
  }
  if (!sortBy) {
    return null
  }
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    return null
  }
  if (!platform) {
    return null
  }

  return {
    page,
    pageSize,
    search,
    sortBy,
    sortOrder,
    platform,
  }
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

export async function setLatestProductListQuery(userId: number, payload: ProductListCachePayload): Promise<void> {
  try {
    const normalized = normalizeProductListCachePayload(payload)
    if (!normalized) {
      return
    }

    const redis = getRedisClient()
    await redis.setex(getLatestQueryKey(userId), LAST_QUERY_TTL_SECONDS, JSON.stringify(normalized))
  } catch {
    // ignore cache write failure
  }
}

export async function getLatestProductListQuery(userId: number): Promise<ProductListCachePayload | null> {
  try {
    const redis = getRedisClient()
    const [raw, legacyRaw] = await Promise.all([
      redis.get(getLatestQueryKey(userId)),
      redis.get(getLegacyLatestQueryKey(userId)),
    ])
    const value = raw || legacyRaw
    if (!value) {
      return null
    }

    return normalizeProductListCachePayload(JSON.parse(value))
  } catch {
    return null
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
