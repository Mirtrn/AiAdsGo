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

describe('persistAffiliateCommissionAttributions simplified attribution', () => {
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
  })

  it('splits explicit ASIN commission by rolling cost share', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) {
        return []
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) {
        return []
      }
      if (sql.includes('FROM offers')) {
        return [
          { id: 2001, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0C7GYLKPM', final_url: null, affiliate_link: null },
          { id: 2002, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0C7GYLKPM', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) {
        return []
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 3001, offer_id: 2001, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 30, clicks: 2 },
          { campaign_id: 3002, offer_id: 2002, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 10, clicks: 20 },
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
          commission: 12,
          sourceAsin: 'B0C7GYLKPM',
          raw: { id: 'evt-asin-cost-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 12,
      attributedCommission: 12,
      unattributedCommission: 0,
      attributedOffers: 2,
      attributedCampaigns: 2,
      writtenRows: 2,
    })

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(2)
    expect((attributionInsertCalls[0]?.[1] as any[])[8]).toBe(9)
    expect((attributionInsertCalls[1]?.[1] as any[])[8]).toBe(3)
  })

  it('falls back to rolling clicks when ASIN candidates have zero cost', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 2101, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0CLICKS01', final_url: null, affiliate_link: null },
          { id: 2102, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0CLICKS01', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) return []
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 3101, offer_id: 2101, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 0, clicks: 9 },
          { campaign_id: 3102, offer_id: 2102, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 0, clicks: 3 },
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
          commission: 12,
          sourceAsin: 'B0CLICKS01',
          raw: { id: 'evt-asin-clicks-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result.attributedCommission).toBe(12)
    expect(result.unattributedCommission).toBe(0)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect((attributionInsertCalls[0]?.[1] as any[])[8]).toBe(9)
    expect((attributionInsertCalls[1]?.[1] as any[])[8]).toBe(3)
  })

  it('equal-splits unmatched ASIN commission within the same brand', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 2201, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0KNOWN001', final_url: null, affiliate_link: null },
          { id: 2202, brand: 'Novilla', url: 'https://www.amazon.com/dp/B0KNOWN002', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) return []
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 3201, offer_id: 2201, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 40, clicks: 10 },
          { campaign_id: 3202, offer_id: 2202, brand: 'Novilla', created_at: `${today}T00:00:00.000Z`, cost: 5, clicks: 2 },
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
          commission: 10,
          sourceAsin: 'B0UNKNOWN99',
          raw: { id: 'evt-brand-split-1', advert_name: 'Novilla' },
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
      attributedOffers: 2,
      attributedCampaigns: 2,
      writtenRows: 2,
    })

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect((attributionInsertCalls[0]?.[1] as any[])[8]).toBe(5)
    expect((attributionInsertCalls[1]?.[1] as any[])[8]).toBe(5)
  })

  it('keeps previously attributed events frozen', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) {
        return [
          { event_id: 'yeahpromos|evt-frozen-1', offer_id: 2301, campaign_id: 3301, commission_amount: 6.66 },
        ]
      }
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) {
        return []
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
          commission: 6.66,
          sourceAsin: 'B0FROZEN01',
          raw: { id: 'evt-frozen-1', advert_name: 'Novilla' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 6.66,
      attributedCommission: 6.66,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 0,
    })

    expect(exec).not.toHaveBeenCalled()
  })

  it('marks commission unattributed when neither ASIN nor brand can map to campaigns', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) return []
      if (sql.includes('FROM affiliate_product_offer_links apol')) return []
      if (sql.includes('FROM campaigns c')) return []
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 9,
      reportDate: today,
      entries: [
        {
          platform: 'yeahpromos',
          reportDate: today,
          commission: 8.88,
          sourceAsin: 'B0NOHIT001',
          raw: { id: 'evt-unattributed-1' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    expect(result).toEqual({
      reportDate: today,
      totalCommission: 8.88,
      attributedCommission: 0,
      unattributedCommission: 8.88,
      attributedOffers: 0,
      attributedCampaigns: 0,
      writtenRows: 0,
    })

    const failureInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO openclaw_affiliate_attribution_failures')
    )
    expect(failureInsertCalls).toHaveLength(1)
    expect((failureInsertCalls[0]?.[1] as any[])[10]).toBe('campaign_mapping_miss')
  })

  it('uses brand from affiliate_products for fallback attribution when no offer link exists', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_commission_attributions') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM openclaw_affiliate_attribution_failures') && sql.includes('AS event_id')) return []
      if (sql.includes('FROM offers')) {
        return [
          { id: 4001, brand: 'Waterdrop', url: 'https://www.amazon.com/dp/B0LINKED01', final_url: null, affiliate_link: null },
        ]
      }
      if (sql.includes('FROM affiliate_product_offer_links apol')) {
        // Only B0LINKED01 has offer link, B0NOLINK01 does not
        return [{ offer_id: 4001, asin: 'B0LINKED01' }]
      }
      if (sql.includes('FROM affiliate_products') && sql.includes('brand IS NOT NULL')) {
        // B0NOLINK01 exists in affiliate_products with brand info but no offer link
        return [
          { asin: 'B0LINKED01', brand: 'Waterdrop' },
          { asin: 'B0NOLINK01', brand: 'Waterdrop' },
        ]
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          { campaign_id: 5001, offer_id: 4001, brand: 'Waterdrop', created_at: `${today}T00:00:00.000Z`, cost: 100, clicks: 50 },
        ]
      }
      return []
    })

    const result = await persistAffiliateCommissionAttributions({
      userId: 10,
      reportDate: today,
      entries: [
        {
          platform: 'partnerboost',
          reportDate: today,
          commission: 15.5,
          sourceAsin: 'B0NOLINK01',
          raw: { id: 'evt-nolink-1' },
        },
      ],
      replaceExisting: true,
      lockHistorical: false,
    })

    // Should successfully attribute via brand fallback
    expect(result.attributedCommission).toBe(15.5)
    expect(result.unattributedCommission).toBe(0)
    expect(result.attributedCampaigns).toBe(1)

    const attributionInsertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(attributionInsertCalls).toHaveLength(1)
    // Verify it's attributed to campaign 5001 (index 7: campaign_id)
    expect((attributionInsertCalls[0]?.[1] as any[])[7]).toBe(5001)
    // Verify attribution rule is brand_equal_split
    const rawPayload = JSON.parse((attributionInsertCalls[0]?.[1] as any[])[10])
    expect(rawPayload._autoads_attribution_rule).toBe('brand_equal_split')
  })
})
