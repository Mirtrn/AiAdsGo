import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/campaigns/performance/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

describe('GET /api/campaigns/performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/campaigns/performance?daysBack=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('applies currency filter and excludes campaign_mapping_miss failures from total commission', async () => {
    const query = vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [
          { currency: 'USD', total_cost: 20 },
          { currency: 'CNY', total_cost: 40 },
        ]
      }

      if (sql.includes('FROM campaigns c')) {
        return [
          {
            id: 1,
            campaign_id: 'cmp_1',
            campaign_name: 'Campaign 1',
            offer_id: 11,
            offer_brand: 'Brand A',
            offer_url: 'https://example.com',
            status: 'ENABLED',
            google_campaign_id: 'g_1',
            google_ads_account_id: 99,
            budget_amount: 20,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-02-25T00:00:00.000Z',
            created_at: '2026-02-20T00:00:00.000Z',
            published_at: '2026-02-20T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 99,
            ads_account_customer_id: '123456',
            ads_account_name: 'CNY Account',
            ads_account_is_active: 1,
            ads_account_is_deleted: 0,
            ads_account_currency: 'CNY',
            offer_is_deleted: 0,
          },
        ]
      }

      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY campaign_id, COALESCE(currency')) {
        return [
          {
            campaign_id: 1,
            currency: 'CNY',
            impressions: 100,
            clicks: 20,
            cost: 40,
          },
        ]
      }

      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id')) {
        expect(params?.[3]).toBe('CNY')
        return [{ campaign_id: 1, commission: 7 }]
      }

      throw new Error(`unexpected query sql: ${sql}`)
    })

    let totalsCallCount = 0
    let attributedCallCount = 0
    let unattributedCallCount = 0

    const queryOne = vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('COALESCE(SUM(impressions), 0) as impressions')) {
        expect(params?.[3]).toBe('CNY')
        totalsCallCount += 1
        if (totalsCallCount === 1) {
          return { impressions: 100, clicks: 20, cost: 40 }
        }
        return { impressions: 50, clicks: 10, cost: 20 }
      }

      if (sql.includes('FROM affiliate_commission_attributions')) {
        expect(params?.[3]).toBe('CNY')
        attributedCallCount += 1
        if (attributedCallCount === 1) {
          return { total_commission: 7 }
        }
        return { total_commission: 4 }
      }

      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        expect(sql).toContain("COALESCE(reason_code, '') <> ?")
        expect(params?.[3]).toBe('campaign_mapping_miss')
        expect(params?.[4]).toBe('CNY')
        unattributedCallCount += 1
        if (unattributedCallCount === 1) {
          return { total_commission: 3 }
        }
        return { total_commission: 1 }
      }

      if (sql.includes('FROM sync_logs')) {
        return { latest_sync_at: null }
      }

      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/campaigns/performance?daysBack=7&currency=CNY')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currency).toBe('CNY')
    expect(data.summary?.totalCommission).toBe(10)
    expect(data.summary?.attributedCommission).toBe(7)
    expect(data.summary?.unattributedCommission).toBe(3)
    expect(data.campaigns?.[0]?.performance?.commission).toBe(7)
    expect(data.campaigns?.[0]?.performance?.conversions).toBe(7)
    expect(unattributedCallCount).toBe(2)
  })
})
