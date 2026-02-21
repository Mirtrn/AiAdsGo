import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkAffiliatePlatformConfig: vi.fn(),
  getAffiliateProductSyncRunById: vi.fn(),
  listAffiliateProducts: vi.fn(),
  normalizeAffiliatePlatform: vi.fn(),
  syncAffiliateProducts: vi.fn(),
  updateAffiliateProductSyncRun: vi.fn(),
  buildProductListCacheHash: vi.fn(),
  getLatestProductListQuery: vi.fn(),
  invalidateProductListCache: vi.fn(),
  setCachedProductList: vi.fn(),
}))

vi.mock('@/lib/affiliate-products', () => ({
  checkAffiliatePlatformConfig: mocks.checkAffiliatePlatformConfig,
  getAffiliateProductSyncRunById: mocks.getAffiliateProductSyncRunById,
  listAffiliateProducts: mocks.listAffiliateProducts,
  normalizeAffiliatePlatform: mocks.normalizeAffiliatePlatform,
  syncAffiliateProducts: mocks.syncAffiliateProducts,
  updateAffiliateProductSyncRun: mocks.updateAffiliateProductSyncRun,
}))

vi.mock('@/lib/products-cache', () => ({
  buildProductListCacheHash: mocks.buildProductListCacheHash,
  getLatestProductListQuery: mocks.getLatestProductListQuery,
  invalidateProductListCache: mocks.invalidateProductListCache,
  setCachedProductList: mocks.setCachedProductList,
}))

import { executeAffiliateProductSync } from '../affiliate-product-sync-executor'

function createTask(data: Partial<{
  userId: number
  platform: 'partnerboost' | 'yeahpromos'
  mode: 'platform' | 'delta' | 'single'
  runId: number
  productId: number
  trigger: 'manual' | 'retry' | 'schedule'
}> = {}) {
  return {
    id: `task-${data.runId || 99}`,
    type: 'affiliate-product-sync',
    userId: data.userId || 1,
    status: 'pending',
    priority: 'normal',
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 1,
    data: {
      userId: data.userId || 1,
      platform: data.platform || 'partnerboost',
      mode: data.mode || 'platform',
      runId: data.runId || 99,
      productId: data.productId,
      trigger: data.trigger || 'schedule',
    },
  } as any
}

describe('affiliate-product-sync executor resume behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: true,
      missingKeys: [],
      values: {},
    })
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 99,
      user_id: 1,
      platform: 'partnerboost',
      mode: 'platform',
      status: 'queued',
      total_items: 0,
      created_count: 0,
      updated_count: 0,
      failed_count: 0,
      cursor_page: 0,
      processed_batches: 0,
      started_at: null,
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 10,
      createdCount: 1,
      updatedCount: 9,
    })
    mocks.updateAffiliateProductSyncRun.mockResolvedValue(undefined)

    mocks.invalidateProductListCache.mockResolvedValue(undefined)
    mocks.getLatestProductListQuery.mockResolvedValue(null)
    mocks.buildProductListCacheHash.mockReturnValue('cache-hash')
    mocks.listAffiliateProducts.mockResolvedValue({
      items: [],
      total: 0,
      productsWithLinkCount: 0,
      activeProductsCount: 0,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
      page: 1,
      pageSize: 20,
    })
    mocks.setCachedProductList.mockResolvedValue(undefined)
  })

  it('does not resume from historical failed runs when current run has no checkpoint', async () => {
    const task = createTask({ runId: 201, trigger: 'schedule' })
    await executeAffiliateProductSync(task)

    expect(mocks.syncAffiliateProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        platform: 'partnerboost',
        mode: 'platform',
        resumeFromPage: undefined,
      })
    )
  })

  it('keeps resume for the same run when checkpoint exists', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 202,
      user_id: 1,
      platform: 'partnerboost',
      mode: 'platform',
      status: 'running',
      total_items: 32000,
      created_count: 120,
      updated_count: 31880,
      failed_count: 0,
      cursor_page: 321,
      processed_batches: 32,
      started_at: '2026-02-21T10:00:00.000Z',
      completed_at: null,
    })

    const task = createTask({ runId: 202, trigger: 'retry' })
    await executeAffiliateProductSync(task)

    expect(mocks.syncAffiliateProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        platform: 'partnerboost',
        mode: 'platform',
        resumeFromPage: 321,
      })
    )
  })
})
