import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/campaigns/[id]/update-cpc/route'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
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

vi.mock('@/lib/python-ads-client', () => ({
  executeGAQLQueryPython: vi.fn(),
  updateCampaignPython: vi.fn(),
  updateAdGroupPython: vi.fn(),
}))

vi.mock('@/lib/google-ads-mutate-helpers', () => ({
  normalizeGoogleAdsApiUpdateOperations: vi.fn((operations: any[]) => operations),
}))

describe('PUT /api/campaigns/:id/update-cpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: {
        userId: 1,
      },
    })
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('returns 422 with expected googleCampaignId when local campaign id is used', async () => {
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('AND google_campaign_id = ?')) {
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

    const req = new NextRequest('http://localhost/api/campaigns/1972/update-cpc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        newCpc: 0.2,
      }),
    })

    const res = await PUT(req, { params: { id: '1972' } })
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('USE_GOOGLE_CAMPAIGN_ID')
    expect(data.localCampaignId).toBe(1972)
    expect(data.googleCampaignId).toBe('23578044853')
    expect(data.expectedPath).toBe('/api/campaigns/23578044853/update-cpc')
  })
})
