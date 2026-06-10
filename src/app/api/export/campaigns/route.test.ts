import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: dbFns.query,
  })),
}))

describe('GET /api/export/campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([
      {
        id: 1,
        campaign_name: 'Demo campaign',
        offer_url: 'https://example.com/offer',
      },
    ])
  })

  it('exports campaign offer URLs from offers.url', async () => {
    const req = new NextRequest('http://localhost/api/export/campaigns?format=json', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data[0].offer_url).toBe('https://example.com/offer')

    const sql = String(dbFns.query.mock.calls[0][0])
    expect(sql).toContain('o.url as offer_url')
    expect(sql).not.toContain('o.product_url as offer_url')
  })
})
