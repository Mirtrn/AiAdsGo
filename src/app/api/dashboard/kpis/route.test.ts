import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/kpis/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const cacheFns = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  generateCacheKey: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/api-cache', () => ({
  apiCache: {
    get: cacheFns.get,
    set: cacheFns.set,
  },
  generateCacheKey: cacheFns.generateCacheKey,
}))

vi.mock('@/lib/api-performance', () => ({
  withPerformanceMonitoring: (handler: any) => handler,
}))

describe('GET /api/dashboard/kpis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })
    cacheFns.generateCacheKey.mockReturnValue('kpis:test')
    cacheFns.get.mockReturnValue(null)
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('excludes campaign_mapping_miss failures when calculating commission totals', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT currency') && sql.includes('FROM campaign_performance')) {
        return [{ currency: 'USD' }]
      }

      throw new Error(`unexpected query sql: ${sql}`)
    })

    let periodCallCount = 0
    let attributedCallCount = 0
    let unattributedCallCount = 0

    const queryOne = vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('SUM(impressions) as impressions')) {
        periodCallCount += 1
        if (periodCallCount === 1) {
          return { impressions: 1000, clicks: 100, cost: 50 }
        }
        return { impressions: 800, clicks: 80, cost: 40 }
      }

      if (sql.includes('FROM affiliate_commission_attributions')) {
        attributedCallCount += 1
        if (attributedCallCount === 1) {
          return { total_commission: 8 }
        }
        return { total_commission: 4 }
      }

      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        expect(sql).toContain("COALESCE(reason_code, '') <> ?")
        expect(params?.[3]).toBe('campaign_mapping_miss')
        unattributedCallCount += 1
        if (unattributedCallCount === 1) {
          return { total_commission: 2 }
        }
        return { total_commission: 1 }
      }

      throw new Error(`unexpected queryOne sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({
      query,
      queryOne,
    })

    const req = new NextRequest('http://localhost/api/dashboard/kpis?days=7&refresh=true')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data?.current?.commission).toBe(10)
    expect(data.data?.current?.conversions).toBe(10)
    expect(data.data?.previous?.commission).toBe(5)
    expect(data.data?.changes?.commission).toBe(100)
    expect(data.data?.current?.currency).toBe('USD')
    expect(unattributedCallCount).toBe(2)
    expect(cacheFns.set).toHaveBeenCalledWith(
      'kpis:test',
      expect.objectContaining({ success: true }),
      expect.any(Number)
    )
  })
})
