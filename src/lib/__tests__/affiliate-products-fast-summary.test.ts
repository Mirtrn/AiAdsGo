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

vi.mock('@/lib/products-cache', () => ({
  buildProductSummaryCacheHash: vi.fn(() => 'summary-hash'),
  getCachedProductSummary: vi.fn(async () => null),
  setCachedProductSummary: vi.fn(async () => {}),
}))

describe('listAffiliateProducts fastSummary platform stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
    dbFns.queryOne.mockResolvedValue(null)
    dbFns.exec.mockResolvedValue({ changes: 0 })
  })

  it('returns non-zero platform totals for status=all when summary cache misses', async () => {
    dbFns.query.mockResolvedValueOnce([
      { platform: 'yeahpromos', total_count: 63074 },
      { platform: 'partnerboost', total_count: 182650 },
    ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    const result = await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'all',
      fastSummary: true,
      skipItems: true,
    })

    expect(result.total).toBe(245724)
    expect(result.platformStats.yeahpromos.total).toBe(63074)
    expect(result.platformStats.yeahpromos.visibleCount).toBe(63074)
    expect(result.platformStats.partnerboost.total).toBe(182650)
    expect(result.platformStats.partnerboost.visibleCount).toBe(182650)
    expect(dbFns.query).toHaveBeenCalledTimes(1)
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })

  it('returns per-platform visible counts for status=active while preserving platform totals', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        { platform: 'yeahpromos', total_count: 63074 },
        { platform: 'partnerboost', total_count: 182650 },
      ])
      .mockResolvedValueOnce([
        { platform: 'yeahpromos', visible_count: 6636 },
        { platform: 'partnerboost', visible_count: 172107 },
      ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    const result = await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'active',
      fastSummary: true,
      skipItems: true,
    })

    expect(result.total).toBe(178743)
    expect(result.activeProductsCount).toBe(178743)
    expect(result.platformStats.yeahpromos.total).toBe(63074)
    expect(result.platformStats.yeahpromos.visibleCount).toBe(6636)
    expect(result.platformStats.yeahpromos.activeProductsCount).toBe(6636)
    expect(result.platformStats.partnerboost.total).toBe(182650)
    expect(result.platformStats.partnerboost.visibleCount).toBe(172107)
    expect(result.platformStats.partnerboost.activeProductsCount).toBe(172107)
    expect(dbFns.query).toHaveBeenCalledTimes(2)
    expect(dbFns.queryOne).not.toHaveBeenCalled()
  })

  it('filters by targetCountry using allowedCountries containment with UK/GB alias', async () => {
    dbFns.query.mockResolvedValueOnce([
      { platform: 'partnerboost', total_count: 42 },
    ])

    const { listAffiliateProducts } = await import('@/lib/affiliate-products')
    await listAffiliateProducts(1, {
      page: 1,
      pageSize: 20,
      status: 'all',
      targetCountry: 'UK',
      fastSummary: true,
      skipItems: true,
    })

    expect(dbFns.query).toHaveBeenCalledTimes(1)
    const [sql, params] = dbFns.query.mock.calls[0]
    expect(String(sql)).toContain('allowed_countries_json')
    expect(params).toEqual(expect.arrayContaining([
      '%"uk"%',
      '%"gb"%',
    ]))
  })
})
