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

  it('returns existing summary for historical date when lock is enabled', async () => {
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
          commission: 10,
        },
      ],
      replaceExisting: true,
      lockHistorical: true,
    })

    expect(result).toEqual({
      reportDate: '2000-01-01',
      totalCommission: 10,
      attributedCommission: 7.5,
      unattributedCommission: 2.5,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 2,
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
    expect(exec).toHaveBeenCalledTimes(3)
  })

  it('matches partnerboost entries via aa_adgroupid link id when asin is missing', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_products') && sql.includes('mid IN')) {
        return []
      }
      if (sql.includes("platform = 'partnerboost'") && sql.includes('promo_link LIKE')) {
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

  it('allocates unmatched commission by global campaign weights as fallback', async () => {
    const today = formatLocalYmd(new Date())

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM affiliate_products')) {
        return []
      }
      if (sql.includes('FROM offers')) {
        return []
      }
      if (sql.includes('FROM campaigns c')) {
        return [
          {
            campaign_id: 3101,
            offer_id: 2101,
            conversions: 0,
            clicks: 3,
            cost: 9,
          },
          {
            campaign_id: 3102,
            offer_id: 2102,
            conversions: 0,
            clicks: 1,
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
          sourceOrderId: 'order-fallback-1',
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
      attributedCommission: 10,
      unattributedCommission: 0,
      attributedOffers: 2,
      attributedCampaigns: 2,
      writtenRows: 2,
    })

    const insertCalls = exec.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO affiliate_commission_attributions')
    )
    expect(insertCalls).toHaveLength(2)
  })
})
