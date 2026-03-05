import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkAffiliatePlatformConfig: vi.fn(),
  getAffiliateProductSyncRunById: vi.fn(),
  listAffiliateProducts: vi.fn(),
  normalizeAffiliatePlatform: vi.fn(),
  recordAffiliateProductSyncHourlySnapshot: vi.fn(),
  syncAffiliateProducts: vi.fn(),
  updateAffiliateProductSyncRun: vi.fn(),
  buildProductListCacheHash: vi.fn(),
  getLatestProductListQuery: vi.fn(),
  invalidateProductListCache: vi.fn(),
  setCachedProductList: vi.fn(),
  getQueueManagerForTaskType: vi.fn(),
  queueEnqueue: vi.fn(),
}))

vi.mock('@/lib/affiliate-products', () => ({
  checkAffiliatePlatformConfig: mocks.checkAffiliatePlatformConfig,
  getAffiliateProductSyncRunById: mocks.getAffiliateProductSyncRunById,
  listAffiliateProducts: mocks.listAffiliateProducts,
  normalizeAffiliatePlatform: mocks.normalizeAffiliatePlatform,
  recordAffiliateProductSyncHourlySnapshot: mocks.recordAffiliateProductSyncHourlySnapshot,
  syncAffiliateProducts: mocks.syncAffiliateProducts,
  updateAffiliateProductSyncRun: mocks.updateAffiliateProductSyncRun,
}))

vi.mock('@/lib/products-cache', () => ({
  buildProductListCacheHash: mocks.buildProductListCacheHash,
  getLatestProductListQuery: mocks.getLatestProductListQuery,
  invalidateProductListCache: mocks.invalidateProductListCache,
  setCachedProductList: mocks.setCachedProductList,
}))

vi.mock('@/lib/queue/queue-routing', () => ({
  getQueueManagerForTaskType: mocks.getQueueManagerForTaskType,
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
    mocks.recordAffiliateProductSyncHourlySnapshot.mockResolvedValue(undefined)
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
    mocks.queueEnqueue.mockResolvedValue('task-next')
    mocks.getQueueManagerForTaskType.mockReturnValue({
      enqueue: mocks.queueEnqueue,
    })
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
      cursor_scope: 'DE',
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
        resumeFromScope: 'DE',
      })
    )
  })

  it('re-enqueues next shard for yeahpromos platform sync when hasMore=true', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 303,
      user_id: 1,
      platform: 'yeahpromos',
      mode: 'platform',
      status: 'running',
      total_items: 200,
      created_count: 30,
      updated_count: 170,
      failed_count: 0,
      cursor_page: 2,
      cursor_scope: 'amazon.com',
      processed_batches: 2,
      started_at: '2026-02-21T10:00:00.000Z',
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 12,
      createdCount: 2,
      updatedCount: 10,
      hasMore: true,
      nextCursorPage: 5,
      nextCursorScope: 'amazon.co.uk',
    })

    const task = createTask({
      runId: 303,
      platform: 'yeahpromos',
      mode: 'platform',
      trigger: 'manual',
    })
    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 303,
        continued: true,
      })
    )
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'affiliate-product-sync',
      expect.objectContaining({
        userId: 1,
        platform: 'yeahpromos',
        mode: 'platform',
        runId: 303,
        trigger: 'retry',
      }),
      1,
      expect.objectContaining({
        priority: 'normal',
        maxRetries: 1,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 303,
        status: 'queued',
        cursorPage: 5,
        cursorScope: 'amazon.co.uk',
        completedAt: null,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).not.toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 303,
        status: 'completed',
      })
    )
  })

  it('re-enqueues next shard for partnerboost platform sync when hasMore=true', async () => {
    mocks.getAffiliateProductSyncRunById.mockResolvedValue({
      id: 404,
      user_id: 1,
      platform: 'partnerboost',
      mode: 'platform',
      status: 'running',
      total_items: 50000,
      created_count: 120,
      updated_count: 49880,
      failed_count: 0,
      cursor_page: 501,
      cursor_scope: 'US',
      processed_batches: 50,
      started_at: '2026-03-05T06:53:52.070Z',
      completed_at: null,
    })
    mocks.syncAffiliateProducts.mockResolvedValue({
      totalFetched: 1000,
      createdCount: 2,
      updatedCount: 998,
      hasMore: true,
      nextCursorPage: 511,
      nextCursorScope: 'US',
    })

    const task = createTask({
      runId: 404,
      platform: 'partnerboost',
      mode: 'platform',
      trigger: 'manual',
    })
    const result = await executeAffiliateProductSync(task)

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        runId: 404,
        continued: true,
      })
    )
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'affiliate-product-sync',
      expect.objectContaining({
        userId: 1,
        platform: 'partnerboost',
        mode: 'platform',
        runId: 404,
        trigger: 'retry',
      }),
      1,
      expect.objectContaining({
        priority: 'normal',
        maxRetries: 1,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 404,
        status: 'queued',
        cursorPage: 511,
        cursorScope: 'US',
        completedAt: null,
      })
    )
    expect(mocks.updateAffiliateProductSyncRun).not.toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 404,
        status: 'completed',
      })
    )
  })
})
