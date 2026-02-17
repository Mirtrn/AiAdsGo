import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/campaigns/[id]/cpc/route'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/google-ads-api', () => ({
  getCustomerWithCredentials: vi.fn(),
  getGoogleAdsCredentialsFromDB: vi.fn(),
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: vi.fn(),
}))

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: vi.fn(() => null),
}))

vi.mock('@/lib/python-ads-client', () => ({
  executeGAQLQueryPython: vi.fn(),
}))

describe('GET /api/campaigns/:id/cpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 422 with expected googleCampaignId when local campaign id is used', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('AND c.google_campaign_id = ?')) {
        return undefined
      }
      if (sql.includes('WHERE user_id = ?') && sql.includes('AND id = ?')) {
        return {
          id: 1972,
          campaign_id: '23578044853',
          google_campaign_id: '23578044853',
          status: 'ENABLED',
          is_deleted: false,
        }
      }
      return undefined
    })

    const req = new NextRequest('http://localhost/api/campaigns/1972/cpc', {
      method: 'GET',
      headers: {
        'x-user-id': '1',
      },
    })

    const res = await GET(req, { params: { id: '1972' } })
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('USE_GOOGLE_CAMPAIGN_ID')
    expect(data.localCampaignId).toBe(1972)
    expect(data.googleCampaignId).toBe('23578044853')
    expect(data.expectedPath).toBe('/api/campaigns/23578044853/cpc')
  })
})

