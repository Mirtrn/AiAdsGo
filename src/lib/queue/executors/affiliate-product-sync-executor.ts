import type { Task } from '@/lib/queue/types'
import {
  checkAffiliatePlatformConfig,
  type AffiliatePlatform,
  listAffiliateProducts,
  normalizeAffiliatePlatform,
  type ProductSortField,
  type ProductSortOrder,
  type SyncMode,
  syncAffiliateProducts,
  updateAffiliateProductSyncRun,
} from '@/lib/affiliate-products'
import {
  buildProductListCacheHash,
  getLatestProductListQuery,
  invalidateProductListCache,
  type ProductListCachePayload,
  setCachedProductList,
} from '@/lib/products-cache'

export type AffiliateProductSyncTaskData = {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  runId: number
  productId?: number
  trigger?: 'manual' | 'retry' | 'schedule'
}

const DEFAULT_CACHE_WARM_PARAMS: {
  page: number
  pageSize: number
  search: string
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
  platform: 'all'
} = {
  page: 1,
  pageSize: 20,
  search: '',
  sortBy: 'serial',
  sortOrder: 'desc',
  platform: 'all',
}

const ALLOWED_SORT_FIELDS: Set<ProductSortField> = new Set([
  'serial',
  'platform',
  'mid',
  'asin',
  'allowedCountries',
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'reviewCount',
  'promoLink',
  'relatedOfferCount',
  'updatedAt',
])

type CacheWarmParams = {
  page: number
  pageSize: number
  search: string
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
  platform: 'all' | AffiliatePlatform
}

function normalizeWarmParams(payload: ProductListCachePayload): CacheWarmParams {
  const page = Math.max(1, Number(payload.page || 1))
  const pageSize = Math.min(100, Math.max(10, Number(payload.pageSize || 20)))
  const search = String(payload.search || '').trim()

  const sortByRaw = String(payload.sortBy || 'serial') as ProductSortField
  const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'serial'

  const sortOrder = String(payload.sortOrder || 'desc').toLowerCase() === 'asc'
    ? 'asc'
    : 'desc' as ProductSortOrder

  const platform = payload.platform === 'all'
    ? 'all'
    : (normalizeAffiliatePlatform(payload.platform) || 'all')

  return {
    page,
    pageSize,
    search,
    sortBy,
    sortOrder,
    platform,
  }
}

async function warmProductListCacheByParams(userId: number, params: CacheWarmParams): Promise<void> {
  const listResult = await listAffiliateProducts(userId, params)
  const responsePayload = {
    success: true as const,
    items: listResult.items,
    total: listResult.total,
    page: listResult.page,
    pageSize: listResult.pageSize,
  }

  const cacheHash = buildProductListCacheHash(params)
  await setCachedProductList(userId, cacheHash, responsePayload)
}

async function refreshAndWarmProductListCache(userId: number): Promise<void> {
  await invalidateProductListCache(userId)

  const warmTargets = new Map<string, CacheWarmParams>()
  const defaultParams = normalizeWarmParams(DEFAULT_CACHE_WARM_PARAMS)
  warmTargets.set(buildProductListCacheHash(defaultParams), defaultParams)

  const latestQuery = await getLatestProductListQuery(userId)
  if (latestQuery) {
    const latestParams = normalizeWarmParams(latestQuery)
    warmTargets.set(buildProductListCacheHash(latestParams), latestParams)
  }

  for (const params of warmTargets.values()) {
    await warmProductListCacheByParams(userId, params)
  }
}

export async function executeAffiliateProductSync(task: Task<AffiliateProductSyncTaskData>) {
  const data = task.data
  if (!data?.userId || !data?.platform || !data?.runId) {
    throw new Error('任务参数不完整')
  }

  const startedAt = new Date().toISOString()
  await updateAffiliateProductSyncRun({
    runId: data.runId,
    status: 'running',
    startedAt,
    errorMessage: null,
  })

  try {
    const configCheck = await checkAffiliatePlatformConfig(data.userId, data.platform)
    if (!configCheck.configured) {
      throw new Error(`配置不完整: ${configCheck.missingKeys.join(', ')}`)
    }

    const result = await syncAffiliateProducts({
      userId: data.userId,
      platform: data.platform,
      mode: data.mode || 'platform',
      productId: data.productId,
    })

    try {
      await refreshAndWarmProductListCache(data.userId)
    } catch (cacheError: any) {
      console.warn('[affiliate-product-sync] cache refresh/warm failed:', cacheError?.message || cacheError)
    }

    await updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'completed',
      totalItems: result.totalFetched,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      failedCount: 0,
      completedAt: new Date().toISOString(),
      errorMessage: null,
    })

    return {
      success: true,
      runId: data.runId,
      ...result,
    }
  } catch (error: any) {
    await updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'failed',
      failedCount: 1,
      completedAt: new Date().toISOString(),
      errorMessage: error?.message || '同步失败',
    })
    throw error
  }
}
