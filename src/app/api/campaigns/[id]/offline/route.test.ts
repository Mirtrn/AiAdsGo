import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/campaigns/[id]/offline/route'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(async () => ({ changes: 1 })),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: vi.fn(async () => ({ authenticated: true, user: { userId: 1 } })),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    exec: dbFns.exec,
    query: dbFns.query,
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/url-swap', () => ({
  markUrlSwapTargetsRemovedByCampaignId: vi.fn(async () => {}),
  pauseUrlSwapTargetsByOfferId: vi.fn(async () => {}),
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: vi.fn(),
}))

vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds: vi.fn(async () => ({ removedCount: 2, scannedCount: 10 })),
}))

vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds: vi.fn(async () => ({ removedCount: 1, scannedCount: 6 })),
}))

vi.mock('@/lib/queue/init-queue', () => ({
  getOrCreateQueueManager: vi.fn(async () => ({
    getPendingTasks: vi.fn(async () => []),
    removeTask: vi.fn(async () => true),
  })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  updateGoogleAdsCampaignStatus: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(async () => null),
  getCustomerWithCredentials: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: vi.fn(async () => null),
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(async () => null),
}))

const { verifyAuth } = await import('@/lib/auth')
const { markUrlSwapTargetsRemovedByCampaignId } = await import('@/lib/url-swap')
const { invalidateOfferCache } = await import('@/lib/api-cache')
const { removePendingClickFarmQueueTasksByTaskIds } = await import('@/lib/click-farm/queue-cleanup')
const { removePendingUrlSwapQueueTasksByTaskIds } = await import('@/lib/url-swap/queue-cleanup')

describe('POST /api/campaigns/:id/offline', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(verifyAuth).mockResolvedValue({ authenticated: true, user: { userId: 1 } })
    dbFns.exec.mockResolvedValue({ changes: 1 })
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue({
      id: 123,
      campaign_id: '999000111',
      google_campaign_id: '999000111',
      google_ads_account_id: 88,
      status: 'ENABLED',
      is_deleted: false,
      offer_id: 777,
      offer_brand: 'BrandX',
      offer_target_country: 'US',
      offer_is_deleted: false,
      customer_id: null,
      parent_mcc_id: null,
      ads_account_active: true,
      ads_account_deleted: false,
      ads_account_status: 'ENABLED',
    })

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM click_farm_tasks') && sql.includes("status = 'paused'") && sql.includes("pause_reason = 'offline'")) {
        return [
          { id: 'cf-task-1' },
          { id: 'cf-task-2' },
        ]
      }
      if (sql.includes('FROM url_swap_tasks') && sql.includes("status = 'disabled'")) {
        return [
          { id: 'us-task-1' },
          { id: 'us-task-2' },
        ]
      }
      return []
    })
  })

  it('cleans click-farm queue by task IDs when pauseClickFarmTasks is true', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pauseClickFarmTasks: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.clickFarmPaused).toBe(1)
    expect(vi.mocked(markUrlSwapTargetsRemovedByCampaignId)).toHaveBeenCalledWith(123, 1)
    expect(vi.mocked(invalidateOfferCache)).toHaveBeenCalledWith(1, 777)
    expect(vi.mocked(removePendingClickFarmQueueTasksByTaskIds)).toHaveBeenCalledWith(['cf-task-1', 'cf-task-2'], 1)
  })

  it('cleans url-swap queue by task IDs when pauseUrlSwapTasks is true', async () => {
    const req = new NextRequest('http://localhost/api/campaigns/123/offline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pauseUrlSwapTasks: true,
      }),
    })

    const res = await POST(req, { params: { id: '123' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.urlSwapPaused).toBe(1)
    expect(vi.mocked(removePendingUrlSwapQueueTasksByTaskIds)).toHaveBeenCalledWith(['us-task-1', 'us-task-2'], 1)
  })
})
