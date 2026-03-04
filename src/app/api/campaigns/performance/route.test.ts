import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/campaigns/performance?daysBack=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('treats daysBack as an inclusive date window (daysBack=7 => today + previous 6 days)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-02-25T04:00:00.000Z')) // 2026-02-25 12:00 Asia/Shanghai

      let capturedRange: { start?: string; end?: string } = {}

      const query = vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
          capturedRange = {
            start: String(params?.[1] || ''),
            end: String(params?.[2] || ''),
          }
          return []
        }
        if (sql.includes('FROM campaigns c')) {
          return []
        }
        return []
      })

      const queryOne = vi.fn(async (sql: string) => {
        if (sql.includes('FROM sync_logs')) {
          return { latest_sync_at: null }
        }
        return { impressions: 0, clicks: 0, cost: 0, total_commission: 0 }
      })

      dbFns.getDatabase.mockResolvedValue({
        type: 'sqlite',
        query,
        queryOne,
      })

      const req = new NextRequest('http://localhost/api/campaigns/performance?daysBack=7')
      const res = await GET(req)
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.success).toBe(true)
      expect(capturedRange.end).toBe('2026-02-25')
      expect(capturedRange.start).toBe('2026-02-19')
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies currency filter and excludes in-window pending/campaign-miss failures from total commission', async () => {
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
        return [{ campaign_id: 1, currency: 'CNY', commission: 7 }]
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
        expect(sql).not.toContain("COALESCE(reason_code, '') NOT IN")
        expect(params).toEqual(
          expect.arrayContaining([
            'campaign_mapping_miss',
          ])
        )
        expect(params).not.toEqual(expect.arrayContaining([
          'pending_product_mapping_miss',
          'pending_offer_mapping_miss',
        ]))
        expect(params?.[params.length - 1]).toBe('CNY')
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
    expect(data.summary?.baseCurrency).toBe('USD')
    expect(data.summary?.totalCommission).toBe(10)
    expect(data.summary?.attributedCommission).toBe(7)
    expect(data.summary?.unattributedCommission).toBe(3)
    expect(data.campaigns?.[0]?.performance?.commission).toBe(7)
    expect(data.campaigns?.[0]?.performance?.conversions).toBe(7)
    expect(unattributedCallCount).toBe(2)
  })

  it('keeps ads account native currency for budget while using reporting currency for performance values', async () => {
    const query = vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', total_cost: 80 }]
      }

      if (sql.includes('FROM campaigns c')) {
        return [
          {
            id: 1,
            campaign_id: 'cmp_cny_budget',
            campaign_name: 'CNY Budget Campaign',
            offer_id: 11,
            offer_brand: 'Brand A',
            offer_url: 'https://example.com',
            status: 'ENABLED',
            google_campaign_id: 'g_1',
            google_ads_account_id: 77,
            budget_amount: 50,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-03-03T00:00:00.000Z',
            created_at: '2026-03-03T00:00:00.000Z',
            published_at: '2026-03-03T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 77,
            ads_account_customer_id: '5247163195',
            ads_account_name: 'RMB Account',
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
            currency: 'USD',
            impressions: 120,
            clicks: 12,
            cost: 24,
          },
        ]
      }

      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id')) {
        expect(params?.[3]).toBe('USD')
        return [{ campaign_id: 1, currency: 'USD', commission: 3 }]
      }

      throw new Error(`unexpected query sql: ${sql}`)
    })

    const queryOne = vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM sync_logs')) {
        return { latest_sync_at: null }
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('COALESCE(SUM(impressions), 0) as impressions')) {
        expect(params?.[3]).toBe('USD')
        return { impressions: 120, clicks: 12, cost: 24 }
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        expect(params?.[3]).toBe('USD')
        return { total_commission: 3 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        expect(params?.[params.length - 1]).toBe('USD')
        return { total_commission: 0 }
      }
      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/campaigns/performance?daysBack=7&currency=USD')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currency).toBe('USD')
    expect(data.campaigns?.[0]).toEqual(expect.objectContaining({
      budgetAmount: 50,
      adsAccountCurrency: 'CNY',
      performanceCurrency: 'USD',
    }))
    expect(data.campaigns?.[0]?.performance?.costLocal).toBe(24)
    expect(data.campaigns?.[0]?.performance?.cpcLocal).toBe(2)
  })

  it('uses row currency aligned commission in mixed-currency campaign rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [
          { currency: 'USD', total_cost: 10 },
          { currency: 'CNY', total_cost: 30 },
        ]
      }

      if (sql.includes('FROM campaigns c')) {
        return [
          {
            id: 1,
            campaign_id: 'cmp_mixed',
            campaign_name: 'Mixed Currency Campaign',
            offer_id: 11,
            offer_brand: 'Brand A',
            offer_url: 'https://example.com',
            status: 'ENABLED',
            google_campaign_id: 'g_1',
            google_ads_account_id: 77,
            budget_amount: 50,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-03-03T00:00:00.000Z',
            created_at: '2026-03-03T00:00:00.000Z',
            published_at: '2026-03-03T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 77,
            ads_account_customer_id: '5247163195',
            ads_account_name: 'Mixed Account',
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
            currency: 'USD',
            impressions: 50,
            clicks: 5,
            cost: 10,
          },
          {
            campaign_id: 1,
            currency: 'CNY',
            impressions: 150,
            clicks: 15,
            cost: 30,
          },
        ]
      }

      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id, COALESCE(currency')) {
        return [
          { campaign_id: 1, currency: 'USD', commission: 9 },
          { campaign_id: 1, currency: 'CNY', commission: 4 },
        ]
      }

      throw new Error(`unexpected query sql: ${sql}`)
    })

    const queryOne = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sync_logs')) {
        return { latest_sync_at: null }
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('COALESCE(SUM(impressions), 0) as impressions')) {
        return { impressions: 200, clicks: 20, cost: 40 }
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return { total_commission: 13 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return { total_commission: 0 }
      }
      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/campaigns/performance?daysBack=7')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currency).toBe('MIXED')
    expect(data.campaigns?.[0]?.performanceCurrency).toBe('CNY')
    expect(data.campaigns?.[0]?.performance?.costLocal).toBe(30)
    expect(data.campaigns?.[0]?.performance?.cpcLocal).toBe(2)
    expect(data.campaigns?.[0]?.performance?.costUsd).toBe(30)
    expect(data.campaigns?.[0]?.performance?.commission).toBe(4)
    expect(data.campaigns?.[0]?.performance?.conversions).toBe(4)
  })

  it('sorts mixed-currency cost columns by base currency when requested', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [
          { currency: 'USD', total_cost: 50 },
          { currency: 'CNY', total_cost: 100 },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            id: 1,
            campaign_id: 'cmp_usd',
            campaign_name: 'USD Campaign',
            offer_id: 11,
            offer_brand: 'Brand A',
            offer_url: 'https://example.com/usd',
            status: 'ENABLED',
            google_campaign_id: 'g_1',
            google_ads_account_id: 100,
            budget_amount: 20,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-03-03T00:00:00.000Z',
            created_at: '2026-03-03T00:00:00.000Z',
            published_at: '2026-03-03T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 100,
            ads_account_customer_id: '111111',
            ads_account_name: 'USD Account',
            ads_account_is_active: 1,
            ads_account_is_deleted: 0,
            ads_account_currency: 'USD',
            offer_is_deleted: 0,
          },
          {
            id: 2,
            campaign_id: 'cmp_cny',
            campaign_name: 'CNY Campaign',
            offer_id: 12,
            offer_brand: 'Brand B',
            offer_url: 'https://example.com/cny',
            status: 'ENABLED',
            google_campaign_id: 'g_2',
            google_ads_account_id: 101,
            budget_amount: 20,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-03-03T00:00:00.000Z',
            created_at: '2026-03-03T00:00:00.000Z',
            published_at: '2026-03-03T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 101,
            ads_account_customer_id: '222222',
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
          { campaign_id: 1, currency: 'USD', impressions: 100, clicks: 10, cost: 50 },
          { campaign_id: 2, currency: 'CNY', impressions: 100, clicks: 10, cost: 100 },
        ]
      }
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id, COALESCE(currency')) {
        return []
      }
      throw new Error(`unexpected query sql: ${sql}`)
    })

    const queryOne = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sync_logs')) {
        return { latest_sync_at: null }
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('COALESCE(SUM(impressions), 0) as impressions')) {
        return { impressions: 200, clicks: 20, cost: 150 }
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return { total_commission: 0 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return { total_commission: 0 }
      }
      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
      queryOne,
    })

    const req = new NextRequest(
      'http://localhost/api/campaigns/performance?daysBack=7&sortBy=cost&sortOrder=desc'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.campaigns).toHaveLength(2)
    expect(data.campaigns[0]?.campaignName).toBe('USD Campaign')
    expect(data.campaigns[1]?.campaignName).toBe('CNY Campaign')
  })

  it('keeps response contract when campaigns parallel mode is enabled', async () => {
    vi.stubEnv('FF_CAMPAIGNS_PARALLEL', 'true')

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return []
      }
      if (sql.includes('FROM campaigns c')) {
        return []
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY campaign_id, COALESCE(currency')) {
        return []
      }
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id')) {
        return []
      }
      throw new Error(`unexpected query sql: ${sql}`)
    })

    const queryOne = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sync_logs')) {
        return { latest_sync_at: null }
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('COALESCE(SUM(impressions), 0) as impressions')) {
        return { impressions: 0, clicks: 0, cost: 0 }
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return { total_commission: 0 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return { total_commission: 0 }
      }
      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/campaigns/performance?daysBack=7')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(Array.isArray(data.campaigns)).toBe(true)
    expect(data.summary).toEqual(
      expect.objectContaining({
        totalCampaigns: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalCommission: 0,
      })
    )
  })

  it('supports optional paging/filter/sort params while keeping summary global', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', total_cost: 30 }]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            id: 1,
            campaign_id: 'cmp_alpha',
            campaign_name: 'Alpha Campaign',
            offer_id: 11,
            offer_brand: 'Brand A',
            offer_url: 'https://example.com/a',
            status: 'ENABLED',
            google_campaign_id: 'g_1',
            google_ads_account_id: 100,
            budget_amount: 20,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-02-25T00:00:00.000Z',
            created_at: '2026-02-20T00:00:00.000Z',
            published_at: '2026-02-20T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 100,
            ads_account_customer_id: '123456',
            ads_account_name: 'Main',
            ads_account_is_active: 1,
            ads_account_is_deleted: 0,
            ads_account_currency: 'USD',
            offer_is_deleted: 0,
          },
          {
            id: 2,
            campaign_id: 'cmp_removed',
            campaign_name: 'Removed Campaign',
            offer_id: 12,
            offer_brand: 'Brand B',
            offer_url: 'https://example.com/b',
            status: 'REMOVED',
            google_campaign_id: 'g_2',
            google_ads_account_id: 101,
            budget_amount: 10,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-02-25T00:00:00.000Z',
            created_at: '2026-02-18T00:00:00.000Z',
            published_at: '2026-02-18T00:00:00.000Z',
            is_deleted: 1,
            deleted_at: '2026-02-25T00:00:00.000Z',
            ads_account_id: 101,
            ads_account_customer_id: '654321',
            ads_account_name: 'Backup',
            ads_account_is_active: 1,
            ads_account_is_deleted: 0,
            ads_account_currency: 'USD',
            offer_is_deleted: 0,
          },
        ]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY campaign_id, COALESCE(currency')) {
        return [
          { campaign_id: 1, currency: 'USD', impressions: 100, clicks: 20, cost: 30 },
          { campaign_id: 2, currency: 'USD', impressions: 10, clicks: 2, cost: 3 },
        ]
      }
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id')) {
        return [
          { campaign_id: 1, commission: 12 },
          { campaign_id: 2, commission: 1 },
        ]
      }
      throw new Error(`unexpected query sql: ${sql}`)
    })

    const queryOne = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sync_logs')) {
        return { latest_sync_at: null }
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('COALESCE(SUM(impressions), 0) as impressions')) {
        return { impressions: 110, clicks: 22, cost: 33 }
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return { total_commission: 13 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return { total_commission: 0 }
      }
      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
      queryOne,
    })

    const req = new NextRequest(
      'http://localhost/api/campaigns/performance?daysBack=7&limit=1&offset=0&search=alpha&status=ENABLED&showDeleted=false&sortBy=campaignName&sortOrder=asc'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.total).toBe(1)
    expect(data.limit).toBe(1)
    expect(data.offset).toBe(0)
    expect(data.campaigns).toHaveLength(1)
    expect(data.campaigns[0]).toEqual(expect.objectContaining({
      id: 1,
      campaignName: 'Alpha Campaign',
      status: 'ENABLED',
    }))
    expect(data.summary).toEqual(expect.objectContaining({
      totalCampaigns: 2,
      activeCampaigns: 1,
      statusDistribution: expect.objectContaining({
        enabled: 1,
        removed: 1,
        total: 2,
      }),
    }))
  })

  it('supports ids-based lookup while keeping summary global', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', total_cost: 60 }]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            id: 1,
            campaign_id: 'cmp_alpha',
            campaign_name: 'Alpha Campaign',
            offer_id: 11,
            offer_brand: 'Brand A',
            offer_url: 'https://example.com/a',
            status: 'ENABLED',
            google_campaign_id: 'g_1',
            google_ads_account_id: 100,
            budget_amount: 20,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-02-25T00:00:00.000Z',
            created_at: '2026-02-20T00:00:00.000Z',
            published_at: '2026-02-20T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 100,
            ads_account_customer_id: '123456',
            ads_account_name: 'Main',
            ads_account_is_active: 1,
            ads_account_is_deleted: 0,
            ads_account_currency: 'USD',
            offer_is_deleted: 0,
          },
          {
            id: 2,
            campaign_id: 'cmp_removed',
            campaign_name: 'Removed Campaign',
            offer_id: 12,
            offer_brand: 'Brand B',
            offer_url: 'https://example.com/b',
            status: 'REMOVED',
            google_campaign_id: 'g_2',
            google_ads_account_id: 101,
            budget_amount: 10,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-02-25T00:00:00.000Z',
            created_at: '2026-02-19T00:00:00.000Z',
            published_at: '2026-02-19T00:00:00.000Z',
            is_deleted: 1,
            deleted_at: '2026-02-25T00:00:00.000Z',
            ads_account_id: 101,
            ads_account_customer_id: '654321',
            ads_account_name: 'Backup',
            ads_account_is_active: 1,
            ads_account_is_deleted: 0,
            ads_account_currency: 'USD',
            offer_is_deleted: 0,
          },
          {
            id: 3,
            campaign_id: 'cmp_paused',
            campaign_name: 'Paused Campaign',
            offer_id: 13,
            offer_brand: 'Brand C',
            offer_url: 'https://example.com/c',
            status: 'PAUSED',
            google_campaign_id: 'g_3',
            google_ads_account_id: 102,
            budget_amount: 30,
            budget_type: 'DAILY',
            creation_status: 'SUCCESS',
            creation_error: null,
            last_sync_at: '2026-02-25T00:00:00.000Z',
            created_at: '2026-02-18T00:00:00.000Z',
            published_at: '2026-02-18T00:00:00.000Z',
            is_deleted: 0,
            deleted_at: null,
            ads_account_id: 102,
            ads_account_customer_id: '999888',
            ads_account_name: 'Third',
            ads_account_is_active: 1,
            ads_account_is_deleted: 0,
            ads_account_currency: 'USD',
            offer_is_deleted: 0,
          },
        ]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY campaign_id, COALESCE(currency')) {
        return [
          { campaign_id: 1, currency: 'USD', impressions: 100, clicks: 20, cost: 30 },
          { campaign_id: 2, currency: 'USD', impressions: 10, clicks: 2, cost: 3 },
          { campaign_id: 3, currency: 'USD', impressions: 50, clicks: 10, cost: 15 },
        ]
      }
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('GROUP BY campaign_id')) {
        return [
          { campaign_id: 1, commission: 12 },
          { campaign_id: 2, commission: 1 },
          { campaign_id: 3, commission: 6 },
        ]
      }
      throw new Error(`unexpected query sql: ${sql}`)
    })

    const queryOne = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sync_logs')) {
        return { latest_sync_at: null }
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('COALESCE(SUM(impressions), 0) as impressions')) {
        return { impressions: 160, clicks: 32, cost: 48 }
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return { total_commission: 19 }
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return { total_commission: 0 }
      }
      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
      queryOne,
    })

    const req = new NextRequest(
      'http://localhost/api/campaigns/performance?daysBack=7&ids=2,999,1'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.total).toBe(2)
    expect(data.campaigns).toHaveLength(2)
    expect(new Set(data.campaigns.map((item: { id: number }) => item.id))).toEqual(new Set([1, 2]))
    expect(data.summary).toEqual(expect.objectContaining({
      totalCampaigns: 3,
      statusDistribution: expect.objectContaining({
        enabled: 1,
        paused: 1,
        removed: 1,
        total: 3,
      }),
    }))
  })
})
