import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    query: dbFns.query,
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
    transaction: async (fn: () => Promise<unknown>) => await fn(),
    close: async () => {},
  })),
}))

describe('upsertAffiliateProducts postgres two-phase upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue(undefined)
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('builds a typed incoming CTE to avoid text inference mismatches', async () => {
    const { upsertAffiliateProducts } = await import('@/lib/affiliate-products')

    const result = await upsertAffiliateProducts(1, 'partnerboost', [
      {
        platform: 'partnerboost',
        mid: 'PB-MID-001',
        asin: 'B000TEST01',
        brand: 'Brand',
        productName: 'Demo Product',
        productUrl: 'https://example.com/product',
        promoLink: 'https://example.com/promo',
        shortPromoLink: null,
        allowedCountries: ['US'],
        priceAmount: 19.99,
        priceCurrency: 'USD',
        commissionRate: 10,
        commissionAmount: 2,
        reviewCount: 120,
        rawJson: '{"mid":"PB-MID-001"}',
      },
    ], { progressEvery: 1 })

    expect(result).toMatchObject({
      totalFetched: 1,
      createdCount: 1,
      updatedCount: 0,
    })

    expect(dbFns.exec).toHaveBeenCalledTimes(2)

    const updateSql = String(dbFns.exec.mock.calls[0]?.[0] || '')
    const updateParams = dbFns.exec.mock.calls[0]?.[1] || []
    const insertSql = String(dbFns.exec.mock.calls[1]?.[0] || '')

    expect(updateSql).toContain('WITH incoming AS')
    expect(updateSql).toContain('FROM (VALUES')
    expect(updateSql).toContain('AS v (')
    expect(updateSql).toContain('v.user_id::integer AS user_id')
    expect(updateSql).toContain('v.price_amount::double precision AS price_amount')
    expect(updateSql).toContain('v.review_count::integer AS review_count')
    expect(updateSql).toContain('WHERE p.user_id = incoming.user_id')
    expect(updateSql).not.toContain('WHERE p.user_id = incoming.user_id::integer')

    expect(insertSql).toContain('ON p.user_id = incoming.user_id')
    expect(insertSql).not.toContain('ON p.user_id = incoming.user_id::integer')

    expect(updateParams).toHaveLength(20)
    expect(updateParams[0]).toBe(1)
    expect(typeof updateParams[0]).toBe('number')
    expect(updateParams[11]).toBe(19.99)
  })
})
