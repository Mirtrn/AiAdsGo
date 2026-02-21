import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getOpenclawSettingsMapMock: vi.fn(),
  persistAffiliateCommissionAttributionsMock: vi.fn(),
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getOpenclawSettingsMap: hoisted.getOpenclawSettingsMapMock,
  parseNumber: (value: unknown, fallback = 0) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  },
}))

vi.mock('@/lib/openclaw/affiliate-commission-attribution', () => ({
  persistAffiliateCommissionAttributions: hoisted.persistAffiliateCommissionAttributionsMock,
}))

import { fetchAffiliateCommissionRevenue } from './affiliate-revenue'

describe('fetchAffiliateCommissionRevenue partnerboost row parsing', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    hoisted.getOpenclawSettingsMapMock.mockResolvedValue({
      partnerboost_token: 'pb-token',
      partnerboost_base_url: 'https://app.partnerboost.com',
      yeahpromos_token: '',
      yeahpromos_site_id: '',
    })

    hoisted.persistAffiliateCommissionAttributionsMock.mockResolvedValue({
      reportDate: '2026-02-19',
      totalCommission: 8.94,
      attributedCommission: 8.94,
      unattributedCommission: 0,
      attributedOffers: 1,
      attributedCampaigns: 1,
      writtenRows: 1,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses documented amazon report fields (estCommission/order_id/adGroupId/link)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: { code: 0, msg: 'success' },
        data: {
          list: [
            {
              asin: 'B0C6DHK68Q',
              estCommission: 8.94,
              order_id: 'C1TIP-PJ09161555',
              adGroupId: 'a6e3PBLq_xxx',
              link: 'https://www.amazon.com/dp/B0C6DHK68Q?aa_adgroupid=a6e3PBLq_xxx',
              uid: 'sherry',
            },
          ],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-19',
    })

    expect(revenue.totalCommission).toBe(8.94)
    expect(hoisted.persistAffiliateCommissionAttributionsMock).toHaveBeenCalledTimes(1)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.commission).toBe(8.94)
    expect(entry?.sourceOrderId).toBe('C1TIP-PJ09161555')
    expect(entry?.sourceAsin).toBe('B0C6DHK68Q')
    expect(entry?.sourceMid).toBe('a6e3PBLq_xxx')
    expect(entry?.sourceLink).toContain('/dp/B0C6DHK68Q')
  })

  it('parses table-style fields with spaces/dots (Order ID/Product ID/Est. Commission/PartnerBoost ID)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: { code: 0, msg: 'success' },
        data: {
          list: [
            {
              'MID': '136628',
              'MCID': 'dreo1',
              'Order ID': 'C28VV-CPBOTIS5YX',
              'Product ID': 'B0CCJGKY4M',
              'Est. Commission': '$8.94',
              'PartnerBoost ID': '1a53b14a65c1ae1c16f7b0d459b10a80',
              'Referrer URL': 'https://www.amazon.com/dp/B0CCJGKY4M',
            },
          ],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-19',
    })

    expect(revenue.totalCommission).toBe(8.94)
    expect(hoisted.persistAffiliateCommissionAttributionsMock).toHaveBeenCalledTimes(1)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.commission).toBe(8.94)
    expect(entry?.sourceOrderId).toBe('C28VV-CPBOTIS5YX')
    expect(entry?.sourceAsin).toBe('B0CCJGKY4M')
    expect(entry?.sourceMid).toBe('1a53b14a65c1ae1c16f7b0d459b10a80')
    expect(entry?.sourceLink).toContain('/dp/B0CCJGKY4M')
  })
})
