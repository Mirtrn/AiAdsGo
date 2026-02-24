import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

import { getDatabase } from '@/lib/db'
import { persistAffiliateCommissionAttributions } from '@/lib/openclaw/affiliate-commission-attribution'

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

describe('persistAffiliateCommissionAttributions historical lock', () => {
  const query = vi.fn()
  const queryOne = vi.fn()
  const exec = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()

    query.mockReset()
    queryOne.mockReset()
    exec.mockReset()

    vi.mocked(getDatabase).mockReturnValue({
      type: 'sqlite',
      query,
      queryOne,
      exec,
      transaction: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
      close: vi.fn(),
    } as any)
  })

  it('returns existing summary for historical date when lock is enabled and fully attributed', async () => {
    queryOne.mockResolvedValueOnce({
      written_rows: 2,
      attributed_commission: 7.5,
      attributed_offers: 1,
      attributed_campaigns: 1,
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 7,
      reportDate: '2000-01-01',
      entries: [
        {
          platform: 'partnerboost',
          reportDate: '2000-01-01',
          commission: 7.5,
        },
      ],
      replaceExisting: true,
      lockHistorical: true,
    })

    expect(result).toEqual({
      reportDate: '2000-01-01',
      totalCommission: 7.5,
      attributedCommission: 7.5,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 2,
    })

    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(exec).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('bypasses historical lock when existing attribution is partial and fetched total is higher', async () => {
    queryOne.mockResolvedValueOnce({
      written_rows: 1,
      attributed_commission: 7.5,
      attributed_offers: 1,
      attributed_campaigns: 1,
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 7,
      reportDate: '2000-01-01',
      entries: [
        {
          platform: 'partnerboost',
          reportDate: '2000-01-01',
          commission: 10,
        },
      ],
      replaceExisting: false,
      lockHistorical: true,
    })

    expect(result).toEqual({
      reportDate: '2000-01-01',
      totalCommission: 10,
      attributedCommission: 0,
      unattributedCommission: 10,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })

    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(exec).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('does not apply historical lock on current date', async () => {
    const today = formatLocalYmd(new Date())

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 12.34,
        },
      ],
      replaceExisting: false,
      lockHistorical: true,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 12.34,
      attributedCommission: 0,
      unattributedCommission: 12.34,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })

    expect(queryOne).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('falls back to active offer ASIN matching when product-offer links are missing', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_products')) {
        return [{ id: 101, mid: 'pb-mid-1', asin: 'B0C7GYLKPM' }]
      }
      if (sql.includes('FROM affiliate_product_offer_links')) {
        return []
      }
      if (sql.includes('FROM offers')) {
        return [
          {
            id: 2001,
            url: 'https://www.amazon.com/dp/B0C7GYLKPM',
            final_url: null,
            affiliate_link: null,
          },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            campaign_id: 3001,
            offer_id: 2001,
            conversions: 1,
            clicks: 10,
            cost: 2,
          },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 12.34,
          sourceMid: 'pb-mid-1',
          sourceAsin: 'B0C7GYLKPM',
          sourceOrderId: 'order-1',
          raw: { estCommission: 12.34 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 12.34,
      attributedCommission: 12.34,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM offers'), [9])
    expect(exec).toHaveBeenCalledTimes(4)
  })

  it('matches partnerboost entries via aa_adgroupid link id when asin is missing', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_products') && sql.includes('LOWER(COALESCE(mid')) {
        return []
      }
      if (sql.includes("platform = 'partnerboost'") && sql.includes('LOWER(COALESCE(promo_link')) {
        return [
          {
            id: 501,
            promo_link: 'https://www.amazon.com/dp/B0C7GYLKPM?aa_adgroupid=pb_link_123',
            short_promo_link: null,
          },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links')) {
        return [{ product_id: 501, offer_id: 2001 }]
      }
      if (sql.includes('FROM offers')) {
        return []
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            campaign_id: 3001,
            offer_id: 2001,
            conversions: 1,
            clicks: 10,
            cost: 2,
          },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 9.87,
          sourceOrderId: 'order-link-1',
          sourceLink: 'https://www.amazon.com/dp/B0C7GYLKPM?aa_adgroupid=pb_link_123',
          raw: { estCommission: 9.87 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 9.87,
      attributedCommission: 9.87,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })
  })

  it('falls back to offer links by aa_adgroupid when affiliate_products lookup misses', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes("platform = 'partnerboost'") && sql.includes('LOWER(COALESCE(promo_link')) {
        return []
      }
      if (sql.includes('FROM affiliate_products')) {
        return []
      }
      if (sql.includes('FROM affiliate_product_offer_links')) {
        return []
      }
      if (sql.includes('FROM offers')) {
        return [
          {
            id: 2001,
            url: null,
            final_url: null,
            affiliate_link: 'https://www.amazon.com/dp/B0C7GYLKPM?aa_adgroupid=pb_link_123',
          },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            campaign_id: 3001,
            offer_id: 2001,
            conversions: 1,
            clicks: 10,
            cost: 2,
          },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 9.87,
          sourceOrderId: 'order-link-fallback-1',
          sourceLinkId: 'pb_link_123',
          raw: { estCommission: 9.87 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 9.87,
      attributedCommission: 9.87,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })
  })

  it('derives partnerboost link id from sourceMid when sourceLink fields are missing', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_products') && sql.includes('LOWER(COALESCE(mid')) {
        return []
      }
      if (sql.includes("platform = 'partnerboost'") && sql.includes('LOWER(COALESCE(promo_link')) {
        return [
          {
            id: 501,
            promo_link: 'https://www.amazon.com/dp/B0C7GYLKPM?aa_adgroupid=pb_link_mid_only',
            short_promo_link: null,
          },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links')) {
        return [{ product_id: 501, offer_id: 2001 }]
      }
      if (sql.includes('FROM offers')) {
        return []
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            campaign_id: 3001,
            offer_id: 2001,
            conversions: 1,
            clicks: 10,
            cost: 2,
          },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 5.55,
          sourceOrderId: 'order-mid-fallback-1',
          sourceMid: 'pb_link_mid_only',
          raw: { estCommission: 5.55 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 5.55,
      attributedCommission: 5.55,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })
  })

  it('prefers partnerboost link-id match over asin/mid candidates', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes("platform = 'partnerboost'") && sql.includes('LOWER(COALESCE(promo_link')) {
        return [
          {
            id: 202,
            promo_link: 'https://www.amazon.com/dp/B0LINKASIN1?aa_adgroupid=pb_link_123',
            short_promo_link: null,
          },
        ]
      }
      if (sql.includes('FROM affiliate_products')) {
        return [{ id: 101, mid: 'pb-mid-1', asin: 'B0C7GYLKPM' }]
      }
      if (sql.includes('FROM affiliate_product_offer_links')) {
        return [
          { product_id: 101, offer_id: 2001 },
          { product_id: 202, offer_id: 2002 },
        ]
      }
      if (sql.includes('FROM offers')) {
        return []
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            campaign_id: 3001,
            offer_id: 2001,
            conversions: 1,
            clicks: 5,
            cost: 1.5,
          },
          {
            campaign_id: 3002,
            offer_id: 2002,
            conversions: 1,
            clicks: 5,
            cost: 1.5,
          },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 10,
          sourceOrderId: 'order-priority-1',
          sourceMid: 'pb-mid-1',
          sourceAsin: 'B0C7GYLKPM',
          sourceLinkId: 'pb_link_123',
          raw: { estCommission: 10 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 10,
      attributedCommission: 10,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })

    const insertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(insertCalls).toHaveLength(1)
    const insertParams = insertCalls[0]?.[1] as any[]
    expect(insertParams?.[6]).toBe(2002)
    expect(insertParams?.[7]).toBe(3002)
  })

  it('falls back to historical campaign mapping when product/offer mapping misses', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('source_order_id')) {
        return [
          {
            platform: 'partnerboost',
            source_order_id: 'order-historical-1',
            source_mid: 'legacy-mid-1',
            source_asin: 'B0HIST0001',
            offer_id: 2001,
            campaign_id: 3001,
            commission: 25,
          },
        ]
      }
      if (sql.includes('FROM campaigns c') && sql.includes("UPPER(COALESCE(c.status")) {
        return [
          {
            campaign_id: 3999,
            offer_id: 2999,
            conversions: 1,
            clicks: 2,
            cost: 3,
          },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 10,
          sourceOrderId: 'order-historical-1',
          sourceMid: 'legacy-mid-1',
          sourceAsin: 'B0MISS00001',
          raw: { estCommission: 10 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 10,
      attributedCommission: 10,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(1)
    const attributionParams = attributionInsertCalls[0]?.[1] as any[]
    expect(attributionParams?.[6]).toBe(2001)
    expect(attributionParams?.[7]).toBe(3001)

    const failureInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO openclaw_affiliate_attribution_failures')
    )
    expect(failureInsertCalls).toHaveLength(0)
  })

  it('falls back to top active campaign when no mapping is available', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('source_order_id')) {
        return []
      }
      if (sql.includes('FROM campaigns c') && sql.includes("UPPER(COALESCE(c.status")) {
        return [
          {
            campaign_id: 3002,
            offer_id: 2002,
            conversions: 1,
            clicks: 10,
            cost: 2,
          },
          {
            campaign_id: 3001,
            offer_id: 2001,
            conversions: 5,
            clicks: 20,
            cost: 8,
          },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 11.25,
          sourceOrderId: 'order-global-fallback-1',
          sourceMid: 'yp-mid-unknown',
          sourceAsin: 'B0GLOBAL01A',
          raw: { sale_comm: 11.25 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 11.25,
      attributedCommission: 11.25,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(1)
    const attributionParams = attributionInsertCalls[0]?.[1] as any[]
    expect(attributionParams?.[6]).toBe(2001)
    expect(attributionParams?.[7]).toBe(3001)

    const failureInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO openclaw_affiliate_attribution_failures')
    )
    expect(failureInsertCalls).toHaveLength(0)
  })

  it('keeps unmatched commission unattributed when no offer match exists', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async () => [])

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 10,
          sourceOrderId: 'order-unmatched-1',
          sourceAsin: 'B0ZZZZZZZZ',
          raw: { estCommission: 10 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 10,
      attributedCommission: 0,
      unattributedCommission: 10,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })

    const failureInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO openclaw_affiliate_attribution_failures')
    )
    expect(failureInsertCalls).toHaveLength(1)
    const failureParams = failureInsertCalls[0]?.[1] as any[]
    expect(failureParams?.[10]).toBe('product_mapping_miss')
  })

  it('records campaign_mapping_miss when matched offer has no active campaign', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes("platform = 'partnerboost'") && sql.includes('LOWER(COALESCE(promo_link')) {
        return []
      }
      if (sql.includes('FROM affiliate_products')) {
        return [{ id: 101, mid: 'pb-mid-1', asin: 'B0C7GYLKPM' }]
      }
      if (sql.includes('FROM affiliate_product_offer_links')) {
        return [{ product_id: 101, offer_id: 2001 }]
      }
      if (sql.includes('FROM campaigns c')) {
        return []
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 8.88,
          sourceOrderId: 'order-no-campaign-1',
          sourceMid: 'pb-mid-1',
          raw: { estCommission: 8.88 },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 8.88,
      attributedCommission: 8.88,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 0,
      writtenRows: 1,
    })

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(1)
    const attributionParams = attributionInsertCalls[0]?.[1] as any[]
    expect(attributionParams?.[6]).toBe(2001)
    expect(attributionParams?.[7]).toBeNull()

    const failureInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO openclaw_affiliate_attribution_failures')
    )
    expect(failureInsertCalls).toHaveLength(1)
    const failureParams = failureInsertCalls[0]?.[1] as any[]
    expect(failureParams?.[7]).toBe(2001)
    expect(failureParams?.[10]).toBe('campaign_mapping_miss')
  })
})
