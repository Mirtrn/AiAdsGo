import type { Task } from '@/lib/queue/types'
import {
  checkAffiliatePlatformConfig,
  type AffiliatePlatform,
  type AffiliateProductSyncCheckpoint,
  type AffiliateProductSyncProgress,
  getAffiliateProductSyncRunById,
  getLatestFailedAffiliateProductSyncRun,
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
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
} = {
  page: 1,
  pageSize: 20,
  search: '',
  sortBy: 'serial',
  sortOrder: 'desc',
  platform: 'all',
  reviewCountMin: null,
  reviewCountMax: null,
  priceAmountMin: null,
  priceAmountMax: null,
  commissionRateMin: null,
  commissionRateMax: null,
  commissionAmountMin: null,
  commissionAmountMax: null,
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
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
}

function normalizeOptionalBound(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
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
    reviewCountMin: normalizeOptionalBound(payload.reviewCountMin),
    reviewCountMax: normalizeOptionalBound(payload.reviewCountMax),
    priceAmountMin: normalizeOptionalBound(payload.priceAmountMin),
    priceAmountMax: normalizeOptionalBound(payload.priceAmountMax),
    commissionRateMin: normalizeOptionalBound(payload.commissionRateMin),
    commissionRateMax: normalizeOptionalBound(payload.commissionRateMax),
    commissionAmountMin: normalizeOptionalBound(payload.commissionAmountMin),
    commissionAmountMax: normalizeOptionalBound(payload.commissionAmountMax),
  }
}

async function warmProductListCacheByParams(userId: number, params: CacheWarmParams): Promise<void> {
  const listResult = await listAffiliateProducts(userId, {
    ...params,
    reviewCountMin: params.reviewCountMin ?? undefined,
    reviewCountMax: params.reviewCountMax ?? undefined,
    priceAmountMin: params.priceAmountMin ?? undefined,
    priceAmountMax: params.priceAmountMax ?? undefined,
    commissionRateMin: params.commissionRateMin ?? undefined,
    commissionRateMax: params.commissionRateMax ?? undefined,
    commissionAmountMin: params.commissionAmountMin ?? undefined,
    commissionAmountMax: params.commissionAmountMax ?? undefined,
  })
  const responsePayload = {
    success: true as const,
    items: listResult.items,
    total: listResult.total,
    productsWithLinkCount: listResult.productsWithLinkCount,
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

  const supportsPlatformResume = data.platform === 'partnerboost' && data.mode === 'platform'
  const toSafeCount = (value: unknown): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }

  const existingRun = await getAffiliateProductSyncRunById({
    runId: data.runId,
    userId: data.userId,
  })

  let resumeSourceRun = supportsPlatformResume && Number(existingRun?.cursor_page || 0) > 0
    ? existingRun
    : null

  if (supportsPlatformResume && !resumeSourceRun) {
    const latestFailedRun = await getLatestFailedAffiliateProductSyncRun({
      userId: data.userId,
      platform: data.platform,
      mode: data.mode,
      excludeRunId: data.runId,
    })
    if (latestFailedRun && Number(latestFailedRun.cursor_page || 0) > 0) {
      resumeSourceRun = latestFailedRun
      console.log(
        `[affiliate-product-sync] run ${data.runId} auto resume from failed run ${latestFailedRun.id} page ${latestFailedRun.cursor_page}`
      )
    }
  }

  const resumeFromPage = resumeSourceRun
    ? Math.max(1, toSafeCount(resumeSourceRun.cursor_page || 1))
    : undefined
  const baseTotalItems = resumeSourceRun ? toSafeCount(resumeSourceRun.total_items) : 0
  const baseCreatedCount = resumeSourceRun ? toSafeCount(resumeSourceRun.created_count) : 0
  const baseUpdatedCount = resumeSourceRun ? toSafeCount(resumeSourceRun.updated_count) : 0
  const baseProcessedBatches = resumeSourceRun ? toSafeCount(resumeSourceRun.processed_batches) : 0

  const startedAt = new Date().toISOString()
  await updateAffiliateProductSyncRun({
    runId: data.runId,
    status: 'running',
    startedAt: resumeSourceRun?.id === data.runId
      ? (existingRun?.started_at || startedAt)
      : startedAt,
    completedAt: null,
    totalItems: baseTotalItems,
    createdCount: baseCreatedCount,
    updatedCount: baseUpdatedCount,
    failedCount: 0,
    cursorPage: resumeFromPage || 1,
    processedBatches: baseProcessedBatches,
    lastHeartbeatAt: startedAt,
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
      resumeFromPage,
      progressEvery: 20,
      onProgress: async (progress: AffiliateProductSyncProgress) => {
        await updateAffiliateProductSyncRun({
          runId: data.runId,
          totalItems: baseTotalItems + toSafeCount(progress.totalFetched),
          createdCount: baseCreatedCount + toSafeCount(progress.createdCount),
          updatedCount: baseUpdatedCount + toSafeCount(progress.updatedCount),
          failedCount: progress.failedCount,
          lastHeartbeatAt: new Date().toISOString(),
        })
      },
      onCheckpoint: async (checkpoint: AffiliateProductSyncCheckpoint) => {
        await updateAffiliateProductSyncRun({
          runId: data.runId,
          totalItems: baseTotalItems + toSafeCount(checkpoint.totalFetched),
          createdCount: baseCreatedCount + toSafeCount(checkpoint.createdCount),
          updatedCount: baseUpdatedCount + toSafeCount(checkpoint.updatedCount),
          failedCount: checkpoint.failedCount,
          cursorPage: checkpoint.cursorPage,
          processedBatches: baseProcessedBatches + toSafeCount(checkpoint.processedBatches),
          lastHeartbeatAt: new Date().toISOString(),
        })
      },
    })

    try {
      await refreshAndWarmProductListCache(data.userId)
    } catch (cacheError: any) {
      console.warn('[affiliate-product-sync] cache refresh/warm failed:', cacheError?.message || cacheError)
    }

    const finalTotalItems = baseTotalItems + toSafeCount(result.totalFetched)
    const finalCreatedCount = baseCreatedCount + toSafeCount(result.createdCount)
    const finalUpdatedCount = baseUpdatedCount + toSafeCount(result.updatedCount)

    await updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'completed',
      totalItems: finalTotalItems,
      createdCount: finalCreatedCount,
      updatedCount: finalUpdatedCount,
      failedCount: 0,
      cursorPage: 0,
      completedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      errorMessage: null,
    })

    return {
      success: true,
      runId: data.runId,
      totalFetched: finalTotalItems,
      createdCount: finalCreatedCount,
      updatedCount: finalUpdatedCount,
    }
  } catch (error: any) {
    await updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'failed',
      failedCount: 1,
      lastHeartbeatAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMessage: error?.message || '同步失败',
    })
    throw error
  }
}
