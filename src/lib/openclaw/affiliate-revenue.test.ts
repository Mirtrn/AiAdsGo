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

function makeOkJsonResponse(payload: any): any {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

function makeErrorResponse(status: number, text: string): any {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  }
}

describe('fetchAffiliateCommissionRevenue partnerboost commission sync', () => {
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
    vi.restoreAllMocks()
  })

  it('uses transaction sale_comm as primary commission and enriches via report by order_id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            list: [
              {
                order_id: 'C28VW-7C7IDG8UPD',
                adGroupId: 'a6e3PBLq_xxx',
                link: 'https://www.amazon.com/dp/B0CCY6VG8Z?aa_adgroupid=a6e3PBLq_xxx',
                estCommission: 0,
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            total_page: 1,
            list: [
              {
                order_id: 'C28VW-7C7IDG8UPD',
                sale_comm: '3.99',
                prod_id: 'B0CCY6VG8Z',
                partnerboost_id: '8aed2d6efd41e6b9d26b0b0fd20c9591',
                status: 'Pending',
              },
            ],
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-20',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/datafeed/get_amazon_report')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api.php?mod=medium&op=transaction')
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('begin_date=2026-02-20')

    expect(revenue.totalCommission).toBe(3.99)
    expect(hoisted.persistAffiliateCommissionAttributionsMock).toHaveBeenCalledTimes(1)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.commission).toBe(3.99)
    expect(entry?.sourceOrderId).toBe('C28VW-7C7IDG8UPD')
    expect(entry?.sourceAsin).toBe('B0CCY6VG8Z')
    expect(entry?.sourceLinkId).toBe('a6e3PBLq_xxx')
    expect(entry?.sourceLink).toContain('/dp/B0CCY6VG8Z')
  })

  it('uses single report adGroup as fallback when transaction row has no match and no linkId', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            list: [
              {
                order_id: 'REPORT-ONLY-1',
                adGroupId: 'pb_adg_single',
                link: 'https://www.amazon.com/dp/B0CCY6VG8Z?aa_adgroupid=pb_adg_single',
                estCommission: 0,
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            total_page: 1,
            list: [
              {
                order_id: 'TX-ORDER-1',
                sale_comm: '3.99',
                prod_id: 'B0CCY6VG8Z',
              },
            ],
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-20',
    })

    expect(revenue.totalCommission).toBe(3.99)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.sourceOrderId).toBe('TX-ORDER-1')
    expect(entry?.sourceAsin).toBe('B0CCY6VG8Z')
    expect(entry?.sourceLink).toContain('aa_adgroupid=pb_adg_single')
    expect(entry?.sourceLinkId).toBe('pb_adg_single')
  })

  it('falls back to report-only commission when transaction API request fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          status: { code: 0, msg: 'success' },
          data: {
            list: [
              {
                'Order ID': 'C28VV-CPBOTIS5YX',
                'Product ID': 'B0CCJGKY4M',
                'Est. Commission': '$8.94',
                adGroupId: 'pb_adg_002',
                'Referrer URL': 'https://www.amazon.com/dp/B0CCJGKY4M?aa_adgroupid=pb_adg_002',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(makeErrorResponse(500, 'upstream error'))
    vi.stubGlobal('fetch', fetchMock)

    const revenue = await fetchAffiliateCommissionRevenue({
      userId: 1,
      reportDate: '2026-02-20',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalled()
    expect(revenue.totalCommission).toBe(8.94)
    expect(hoisted.persistAffiliateCommissionAttributionsMock).toHaveBeenCalledTimes(1)
    const input = hoisted.persistAffiliateCommissionAttributionsMock.mock.calls[0]?.[0]
    const entry = input?.entries?.[0]
    expect(entry?.commission).toBe(8.94)
    expect(entry?.sourceOrderId).toBe('C28VV-CPBOTIS5YX')
    expect(entry?.sourceAsin).toBe('B0CCJGKY4M')
    expect(entry?.sourceLinkId).toBe('pb_adg_002')
    expect(entry?.sourceLink).toContain('/dp/B0CCJGKY4M')
  })
})
