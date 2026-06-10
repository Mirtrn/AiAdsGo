import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = {
  query: vi.fn(),
  exec: vi.fn(),
}

const queueFns = {
  enqueue: vi.fn(),
}

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    type: 'postgres',
    query: dbFns.query,
    exec: dbFns.exec,
  }),
}))

vi.mock('@/lib/queue/unified-queue-manager', () => ({
  getQueueManager: () => queueFns,
}))

import { requeuePendingOfferTasksForActiveUploads, syncUploadRecordsFromOfferTasks } from './batch-recovery'

describe('syncUploadRecordsFromOfferTasks', () => {
  beforeEach(() => {
    dbFns.query.mockReset()
    dbFns.exec.mockReset()
    queueFns.enqueue.mockReset()
    dbFns.exec.mockResolvedValue({ changes: 1 })
    queueFns.enqueue.mockResolvedValue('offer-task-1')
  })

  it('finalizes a processing upload record when all child tasks are terminal', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        {
          id: 'upload-1',
          batch_id: 'batch-1',
          file_name: 'offer-import-template.csv',
          valid_count: 4,
          status: 'processing',
        },
      ])
      .mockResolvedValueOnce([
        { status: 'completed', count: '3' },
        { status: 'failed', count: '1' },
      ])

    const result = await syncUploadRecordsFromOfferTasks({ userId: 7 })

    expect(result).toMatchObject({ checked: 1, updated: 1, finalized: 1 })
    expect(dbFns.exec).toHaveBeenCalledTimes(2)
    expect(dbFns.exec.mock.calls[0][1]).toEqual(['partial', 3, 1, 'batch-1'])
    expect(dbFns.exec.mock.calls[1][1]).toEqual(['partial', 3, 1, 75, 'upload-1'])
  })

  it('syncs counts but keeps processing status while child tasks remain pending', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        {
          id: 'upload-2',
          batch_id: 'batch-2',
          file_name: 'offer-import-template.csv',
          valid_count: 9,
          status: 'processing',
        },
      ])
      .mockResolvedValueOnce([
        { status: 'completed', count: '3' },
        { status: 'failed', count: '1' },
        { status: 'pending', count: '5' },
      ])

    const result = await syncUploadRecordsFromOfferTasks({ userId: 7 })

    expect(result).toMatchObject({ checked: 1, updated: 1, finalized: 0 })
    expect(dbFns.exec).toHaveBeenCalledTimes(2)
    expect(dbFns.exec.mock.calls[0][1]).toEqual([3, 1, 'running', 'batch-2'])
    expect(dbFns.exec.mock.calls[1][1]).toEqual([3, 1, 33.3, 'processing', 'upload-2'])
  })

  it('requeues stale pending child offer tasks for active upload records', async () => {
    dbFns.query.mockResolvedValueOnce([
      {
        id: 'offer-task-1',
        user_id: 7,
        batch_id: 'batch-3',
        affiliate_link: 'https://example.com/product',
        target_country: 'US',
        page_type: 'store',
        store_product_links: '["https://example.com/a","https://example.com/b"]',
        brand_name: 'Example',
        product_price: '19.99',
        commission_payout: '10%',
        skip_cache: true,
        skip_warmup: false,
      },
    ])

    const result = await requeuePendingOfferTasksForActiveUploads({
      userId: 7,
      minPendingAgeMs: 0,
      limit: 10,
    })

    expect(result).toMatchObject({
      checked: 1,
      requeued: 1,
      failed: 0,
      taskIds: ['offer-task-1'],
    })
    expect(queueFns.enqueue).toHaveBeenCalledWith(
      'offer-extraction',
      {
        affiliateLink: 'https://example.com/product',
        targetCountry: 'US',
        skipCache: true,
        skipWarmup: false,
        productPrice: '19.99',
        commissionPayout: '10%',
        brandName: 'Example',
        pageType: 'store',
        storeProductLinks: ['https://example.com/a', 'https://example.com/b'],
      },
      7,
      {
        priority: 'normal',
        requireProxy: true,
        maxRetries: 2,
        taskId: 'offer-task-1',
      }
    )
  })
})
