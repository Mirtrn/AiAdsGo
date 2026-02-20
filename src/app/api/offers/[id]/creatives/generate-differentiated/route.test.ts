import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '@/app/api/offers/[id]/creatives/generate-differentiated/route'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const adCreativeFns = vi.hoisted(() => ({
  generateAdCreative: vi.fn(),
  createAdCreative: vi.fn(),
}))

const scoringFns = vi.hoisted(() => ({
  evaluateCreativeAdStrength: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getOrCreateKeywordPool: vi.fn(),
  getKeywordPoolByOfferId: vi.fn(),
  getBucketInfo: vi.fn(),
  getAvailableBuckets: vi.fn(),
  getUsedBuckets: vi.fn(),
  isCreativeLimitReached: vi.fn(),
  calculateKeywordOverlapRate: vi.fn(),
  determineClusteringStrategy: vi.fn(),
}))

const rebuildFns = vi.hoisted(() => ({
  postRebuild: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/ad-creative-generator', () => ({
  generateAdCreative: adCreativeFns.generateAdCreative,
}))

vi.mock('@/lib/ad-creative', () => ({
  createAdCreative: adCreativeFns.createAdCreative,
}))

vi.mock('@/lib/scoring', () => ({
  evaluateCreativeAdStrength: scoringFns.evaluateCreativeAdStrength,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  getOrCreateKeywordPool: keywordPoolFns.getOrCreateKeywordPool,
  getKeywordPoolByOfferId: keywordPoolFns.getKeywordPoolByOfferId,
  getBucketInfo: keywordPoolFns.getBucketInfo,
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
  getUsedBuckets: keywordPoolFns.getUsedBuckets,
  isCreativeLimitReached: keywordPoolFns.isCreativeLimitReached,
  calculateKeywordOverlapRate: keywordPoolFns.calculateKeywordOverlapRate,
  determineClusteringStrategy: keywordPoolFns.determineClusteringStrategy,
}))

vi.mock('@/app/api/offers/[id]/rebuild/route', () => ({
  POST: rebuildFns.postRebuild,
}))

describe('POST /api/offers/:id/creatives/generate-differentiated', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      user_id: 1,
      scrape_status: 'completed',
    })

    rebuildFns.postRebuild.mockResolvedValue(
      NextResponse.json({
        success: true,
        taskId: 'rebuild-96',
        offerId: 96,
      })
    )
  })

  it('delegates forceRegeneratePool=true to offer rebuild and returns 202', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        forceRegeneratePool: true,
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(202)
    expect(rebuildFns.postRebuild).toHaveBeenCalledTimes(1)
    expect(keywordPoolFns.getOrCreateKeywordPool).not.toHaveBeenCalled()
    expect(data.success).toBe(true)
    expect(data.data.rebuildTaskId).toBe('rebuild-96')
  })

  it('passes through rebuild errors when delegation fails', async () => {
    rebuildFns.postRebuild.mockResolvedValueOnce(
      NextResponse.json(
        {
          error: 'Invalid data',
          message: 'Offer缺少推广链接，无法重建',
        },
        { status: 400 }
      )
    )

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        forceRegeneratePool: true,
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(keywordPoolFns.getOrCreateKeywordPool).not.toHaveBeenCalled()
    expect(data.message).toBe('Offer缺少推广链接，无法重建')
  })
})
