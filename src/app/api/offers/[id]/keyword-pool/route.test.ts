import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '@/app/api/offers/[id]/keyword-pool/route'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getKeywordPoolByOfferId: vi.fn(),
  getOrCreateKeywordPool: vi.fn(),
  generateOfferKeywordPool: vi.fn(),
  deleteKeywordPool: vi.fn(),
  getAvailableBuckets: vi.fn(),
  getUsedBuckets: vi.fn(),
  getBucketInfo: vi.fn(),
  determineClusteringStrategy: vi.fn(),
}))

const rebuildFns = vi.hoisted(() => ({
  postRebuild: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  getKeywordPoolByOfferId: keywordPoolFns.getKeywordPoolByOfferId,
  getOrCreateKeywordPool: keywordPoolFns.getOrCreateKeywordPool,
  generateOfferKeywordPool: keywordPoolFns.generateOfferKeywordPool,
  deleteKeywordPool: keywordPoolFns.deleteKeywordPool,
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
  getUsedBuckets: keywordPoolFns.getUsedBuckets,
  getBucketInfo: keywordPoolFns.getBucketInfo,
  determineClusteringStrategy: keywordPoolFns.determineClusteringStrategy,
}))

vi.mock('@/app/api/offers/[id]/rebuild/route', () => ({
  POST: rebuildFns.postRebuild,
}))

describe('POST /api/offers/:id/keyword-pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    offerFns.findOfferById.mockResolvedValue({
      id: 77,
      user_id: 1,
    })

    keywordPoolFns.getKeywordPoolByOfferId.mockResolvedValue(null)
    keywordPoolFns.generateOfferKeywordPool.mockResolvedValue({
      id: 501,
      offerId: 77,
      totalKeywords: 12,
      brandKeywords: [],
      bucketAKeywords: [],
      bucketBKeywords: [],
      bucketCKeywords: [],
      balanceScore: 0.92,
      clusteringModel: 'mock-cluster',
    })
    keywordPoolFns.determineClusteringStrategy.mockReturnValue({
      bucketCount: 3,
      strategy: 'mixed',
      message: 'test strategy',
    })
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['A', 'B', 'C'])

    rebuildFns.postRebuild.mockResolvedValue(
      NextResponse.json({
        success: true,
        taskId: 'rebuild-77',
        offerId: 77,
        message: 'Offer重建任务已创建，正在后台处理',
      })
    )
  })

  it('delegates forceRegenerate=true to offer rebuild route', async () => {
    const req = new NextRequest('http://localhost/api/offers/77/keyword-pool', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        forceRegenerate: true,
        keywords: ['k1', 'k2'],
      }),
    })

    const res = await POST(req, { params: { id: '77' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(rebuildFns.postRebuild).toHaveBeenCalledTimes(1)
    expect(keywordPoolFns.generateOfferKeywordPool).not.toHaveBeenCalled()
    expect(data.taskId).toBe('rebuild-77')
  })

  it('keeps normal pool creation path when forceRegenerate is false', async () => {
    const req = new NextRequest('http://localhost/api/offers/77/keyword-pool', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        keywords: ['keyword-1'],
      }),
    })

    const res = await POST(req, { params: { id: '77' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(rebuildFns.postRebuild).not.toHaveBeenCalled()
    expect(keywordPoolFns.generateOfferKeywordPool).toHaveBeenCalledWith(77, 1, ['keyword-1'])
    expect(data.success).toBe(true)
    expect(data.message).toBe('关键词池创建成功')
  })
})
