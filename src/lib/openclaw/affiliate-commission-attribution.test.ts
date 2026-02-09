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
})
