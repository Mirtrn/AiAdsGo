import type { Task } from '@/lib/queue/types'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import {
  checkAffiliatePlatformConfig,
  type AffiliatePlatform,
  type AffiliateProductSyncCheckpoint,
  type AffiliateProductSyncProgress,
  getAffiliateProductSyncRunById,
  listAffiliateProducts,
  normalizeAffiliatePlatform,
  type ProductSortField,
  type ProductSortOrder,
  recordAffiliateProductSyncHourlySnapshot,
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

const PLATFORM_CONTINUATION_DELAY_MS = 2 * 60 * 1000

const DEFAULT_CACHE_WARM_PARAMS: {
  page: number
  pageSize: number
  search: string
  mid: string
  targetCountry: string
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
  platform: 'all'
  status: 'all' | 'active' | 'invalid' | 'sync_missing' | 'unknown'
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
  createdAtFrom: string | null
  createdAtTo: string | null
} = {
  page: 1,
  pageSize: 20,
  search: '',
  mid: '',
  targetCountry: 'all',
  sortBy: 'serial',
  sortOrder: 'desc',
  platform: 'all',
  status: 'all',
  reviewCountMin: null,
  reviewCountMax: null,
  priceAmountMin: null,
  priceAmountMax: null,
  commissionRateMin: null,
  commissionRateMax: null,
  commissionAmountMin: null,
  commissionAmountMax: null,
  createdAtFrom: null,
  createdAtTo: null,
}

const ALLOWED_SORT_FIELDS: Set<ProductSortField> = new Set([
  'serial',
  'platform',
  'mid',
  'asin',
  'createdAt',
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
  mid: string
  targetCountry: string
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
  platform: 'all' | AffiliatePlatform
  status: 'all' | 'active' | 'invalid' | 'sync_missing' | 'unknown'
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
  createdAtFrom: string | null
  createdAtTo: string | null
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

function normalizeOptionalDate(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function normalizeWarmParams(payload: ProductListCachePayload): CacheWarmParams {
  const page = Math.max(1, Number(payload.page || 1))
  const pageSize = Math.min(100, Math.max(10, Number(payload.pageSize || 20)))
  const search = String(payload.search || '').trim()
  const mid = String(payload.mid || '').trim()

  const sortByRaw = String(payload.sortBy || 'serial') as ProductSortField
  const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'serial'

  const sortOrder = String(payload.sortOrder || 'desc').toLowerCase() === 'asc'
    ? 'asc'
    : 'desc' as ProductSortOrder

  const platform = payload.platform === 'all'
    ? 'all'
    : (normalizeAffiliatePlatform(payload.platform) || 'all')
  const statusRaw = String(payload.status || '').trim().toLowerCase()
  const status = statusRaw === 'active' || statusRaw === 'invalid' || statusRaw === 'sync_missing' || statusRaw === 'unknown'
    ? statusRaw
    : 'all'
  const rawTargetCountry = String(payload.targetCountry || '').trim().toUpperCase()
  const targetCountry = /^[A-Z]{2,3}$/.test(rawTargetCountry) ? rawTargetCountry : 'all'
  const createdAtFrom = normalizeOptionalDate(payload.createdAtFrom)
  const createdAtTo = normalizeOptionalDate(payload.createdAtTo)
  const normalizedDateRange = createdAtFrom && createdAtTo && createdAtFrom > createdAtTo
    ? { createdAtFrom: createdAtTo, createdAtTo: createdAtFrom }
    : { createdAtFrom, createdAtTo }

  return {
    page,
    pageSize,
    search,
    mid,
    targetCountry,
    sortBy,
    sortOrder,
    platform,
    status,
    reviewCountMin: normalizeOptionalBound(payload.reviewCountMin),
    reviewCountMax: normalizeOptionalBound(payload.reviewCountMax),
    priceAmountMin: normalizeOptionalBound(payload.priceAmountMin),
    priceAmountMax: normalizeOptionalBound(payload.priceAmountMax),
    commissionRateMin: normalizeOptionalBound(payload.commissionRateMin),
    commissionRateMax: normalizeOptionalBound(payload.commissionRateMax),
    commissionAmountMin: normalizeOptionalBound(payload.commissionAmountMin),
    commissionAmountMax: normalizeOptionalBound(payload.commissionAmountMax),
    createdAtFrom: normalizedDateRange.createdAtFrom,
    createdAtTo: normalizedDateRange.createdAtTo,
  }
}

async function warmProductListCacheByParams(userId: number, params: CacheWarmParams): Promise<void> {
  const listResult = await listAffiliateProducts(userId, {
    ...params,
    mid: params.mid,
    targetCountry: params.targetCountry === 'all' ? undefined : params.targetCountry,
    reviewCountMin: params.reviewCountMin ?? undefined,
    reviewCountMax: params.reviewCountMax ?? undefined,
    priceAmountMin: params.priceAmountMin ?? undefined,
    priceAmountMax: params.priceAmountMax ?? undefined,
    commissionRateMin: params.commissionRateMin ?? undefined,
    commissionRateMax: params.commissionRateMax ?? undefined,
    commissionAmountMin: params.commissionAmountMin ?? undefined,
    commissionAmountMax: params.commissionAmountMax ?? undefined,
    createdAtFrom: params.createdAtFrom ?? undefined,
    createdAtTo: params.createdAtTo ?? undefined,
  })
  const responsePayload = {
    success: true as const,
    items: listResult.items,
    total: listResult.total,
    productsWithLinkCount: listResult.productsWithLinkCount,
    activeProductsCount: listResult.activeProductsCount,
    invalidProductsCount: listResult.invalidProductsCount,
    syncMissingProductsCount: listResult.syncMissingProductsCount,
    unknownProductsCount: listResult.unknownProductsCount,
    blacklistedCount: listResult.blacklistedCount,
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

  const supportsPlatformResume = data.mode === 'platform'
    && (data.platform === 'partnerboost' || data.platform === 'yeahpromos')
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

  const resumeFromPage = resumeSourceRun
    ? Math.max(1, toSafeCount(resumeSourceRun.cursor_page || 1))
    : undefined
  const resumeFromScope = resumeSourceRun
    ? (String(resumeSourceRun.cursor_scope || '').trim() || undefined)
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
    cursorScope: resumeFromScope || null,
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
      resumeFromScope,
      progressEvery: 20,
      onProgress: async (progress: AffiliateProductSyncProgress) => {
        await recordAffiliateProductSyncHourlySnapshot({
          userId: data.userId,
          runId: data.runId,
          platform: data.platform,
          totalItems: baseTotalItems + toSafeCount(progress.totalFetched),
        })

        await updateAffiliateProductSyncRun({
          runId: data.runId,
          status: 'running', // ✅ 确保状态始终为 running
          totalItems: baseTotalItems + toSafeCount(progress.totalFetched),
          createdCount: baseCreatedCount + toSafeCount(progress.createdCount),
          updatedCount: baseUpdatedCount + toSafeCount(progress.updatedCount),
          failedCount: progress.failedCount,
          lastHeartbeatAt: new Date().toISOString(),
        })
      },
      onCheckpoint: async (checkpoint: AffiliateProductSyncCheckpoint) => {
        await recordAffiliateProductSyncHourlySnapshot({
          userId: data.userId,
          runId: data.runId,
          platform: data.platform,
          totalItems: baseTotalItems + toSafeCount(checkpoint.totalFetched),
        })

        await updateAffiliateProductSyncRun({
          runId: data.runId,
          status: 'running', // ✅ 确保状态始终为 running
          totalItems: baseTotalItems + toSafeCount(checkpoint.totalFetched),
          createdCount: baseCreatedCount + toSafeCount(checkpoint.createdCount),
          updatedCount: baseUpdatedCount + toSafeCount(checkpoint.updatedCount),
          failedCount: checkpoint.failedCount,
          cursorPage: checkpoint.cursorPage,
          cursorScope: checkpoint.cursorScope || null,
          processedBatches: baseProcessedBatches + toSafeCount(checkpoint.processedBatches),
          lastHeartbeatAt: new Date().toISOString(),
        })
      },
    })

    await recordAffiliateProductSyncHourlySnapshot({
      userId: data.userId,
      runId: data.runId,
      platform: data.platform,
      totalItems: baseTotalItems + toSafeCount(result.totalFetched),
    })

    try {
      await refreshAndWarmProductListCache(data.userId)
    } catch (cacheError: any) {
      console.warn('[affiliate-product-sync] cache refresh/warm failed:', cacheError?.message || cacheError)
    }

    const finalTotalItems = baseTotalItems + toSafeCount(result.totalFetched)
    const finalCreatedCount = baseCreatedCount + toSafeCount(result.createdCount)
    const finalUpdatedCount = baseUpdatedCount + toSafeCount(result.updatedCount)

    const shouldContinuePlatformSync = data.mode === 'platform' && Boolean(result.hasMore)
    if (shouldContinuePlatformSync) {
      const nextCursorPage = Math.max(1, toSafeCount(result.nextCursorPage || 1))
      const nextCursorScope = String(result.nextCursorScope || '').trim() || null
      const continuationScheduledAt = new Date(Date.now() + PLATFORM_CONTINUATION_DELAY_MS).toISOString()
      const heartbeatAt = new Date().toISOString()

      await updateAffiliateProductSyncRun({
        runId: data.runId,
        status: 'running', // ✅ 修复：保持 running 状态，不要重置为 queued
        totalItems: finalTotalItems,
        createdCount: finalCreatedCount,
        updatedCount: finalUpdatedCount,
        failedCount: 0,
        cursorPage: nextCursorPage,
        cursorScope: nextCursorScope,
        completedAt: null,
        lastHeartbeatAt: heartbeatAt,
        errorMessage: null,
      })

      const queue = getQueueManagerForTaskType('affiliate-product-sync')
      await queue.enqueue(
        'affiliate-product-sync',
        {
          userId: data.userId,
          platform: data.platform,
          mode: data.mode,
          runId: data.runId,
          productId: data.productId,
          trigger: 'retry',
          scheduledAt: continuationScheduledAt,
        },
        data.userId,
        {
          priority: 'normal',
          maxRetries: 1,
        }
      )

      return {
        success: true,
        runId: data.runId,
        totalFetched: finalTotalItems,
        createdCount: finalCreatedCount,
        updatedCount: finalUpdatedCount,
        continued: true,
      }
    }

    await updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'completed',
      totalItems: finalTotalItems,
      createdCount: finalCreatedCount,
      updatedCount: finalUpdatedCount,
      failedCount: 0,
      cursorPage: 0,
      cursorScope: null,
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
