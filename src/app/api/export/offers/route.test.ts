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

describe('GET /api/export/offers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([
      {
        id: 1,
        product_name: 'Demo',
        product_url: 'https://example.com/product',
      },
    ])
  })

  it('exports offers using offers.url as the product_url compatibility field', async () => {
    const req = new NextRequest('http://localhost/api/export/offers?format=json', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data[0].product_url).toBe('https://example.com/product')

    const sql = String(dbFns.query.mock.calls[0][0])
    expect(sql).toContain('url AS product_url')
    expect(sql).not.toMatch(/\n\s*product_url,\s*\n/)
  })
})
