import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/campaigns/trends/route'

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

describe('GET /api/campaigns/trends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })
  })

  it('returns 401 when unauthorized', async () => {
    authFns.verifyAuth.mockResolvedValue({ authenticated: false, user: null })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('merges attributed and unattributed commissions by date', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', cost: 12.5 }]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date)')) {
        return [{ date: '2026-02-24', impressions: 100, clicks: 20, cost: 10 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [
          { date: '2026-02-24', commission: 3 },
          { date: '2026-02-25', commission: 1.5 },
        ]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        return [
          { date: '2026-02-24', commission: 2 },
          { date: '2026-02-25', commission: 3.5 },
        ]
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7&currency=USD')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)

    const day24 = data.trends.find((row: any) => row.date === '2026-02-24')
    const day25 = data.trends.find((row: any) => row.date === '2026-02-25')

    expect(day24?.commission).toBe(5)
    expect(day24?.conversions).toBe(5)
    expect(day24?.roas).toBe(0.5)
    expect(day25?.commission).toBe(5)
    expect(day25?.conversions).toBe(5)
    expect(day25?.roas).toBe(0)
  })

  it('falls back when unattributed table is unavailable', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [{ currency: 'USD', cost: 12.5 }]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date)')) {
        return [{ date: '2026-02-24', impressions: 50, clicks: 10, cost: 5 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        return [{ date: '2026-02-24', commission: 3 }]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        throw new Error('relation "openclaw_affiliate_attribution_failures" does not exist')
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.trends.find((row: any) => row.date === '2026-02-24')?.commission).toBe(3)
    expect(data.trends.find((row: any) => row.date === '2026-02-24')?.roas).toBe(0.6)
  })

  it('applies currency filter and excludes in-window pending/campaign-miss failures from unattributed totals', async () => {
    const query = vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY COALESCE(currency')) {
        return [
          { currency: 'USD', cost: 12.5 },
          { currency: 'CNY', cost: 8.2 },
        ]
      }
      if (sql.includes('FROM campaign_performance') && sql.includes('GROUP BY DATE(date)')) {
        expect(params?.[3]).toBe('CNY')
        return [{ date: '2026-02-24', impressions: 80, clicks: 16, cost: 6.4 }]
      }
      if (sql.includes('FROM affiliate_commission_attributions')) {
        expect(params?.[3]).toBe('CNY')
        return [{ date: '2026-02-24', commission: 1 }]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures')) {
        expect(sql).toContain("COALESCE(reason_code, '') <> ?")
        expect(sql).toContain("COALESCE(reason_code, '') NOT IN")
        expect(params).toEqual(
          expect.arrayContaining([
            'campaign_mapping_miss',
            'pending_product_mapping_miss',
            'pending_offer_mapping_miss',
          ])
        )
        expect(params?.[params.length - 1]).toBe('CNY')
        return [{ date: '2026-02-24', commission: 2 }]
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    dbFns.getDatabase.mockResolvedValue({ query })

    const req = new NextRequest('http://localhost/api/campaigns/trends?daysBack=7&currency=CNY')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary?.currency).toBe('CNY')
    expect(data.trends.find((row: any) => row.date === '2026-02-24')?.commission).toBe(3)
  })
})
