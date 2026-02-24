import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/strategy/recommendations/[id]/approve/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const recommendationFns = vi.hoisted(() => ({
  approveStrategyRecommendation: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/strategy-recommendations', () => ({
  approveStrategyRecommendation: recommendationFns.approveStrategyRecommendation,
}))

describe('POST /api/openclaw/strategy/recommendations/:id/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 403 when unauthorized', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/r1/approve', {
      method: 'POST',
    })
    const res = await POST(req, { params: { id: 'r1' } })

    expect(res.status).toBe(403)
  })

  it('approves recommendation successfully', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 9,
      authType: 'session',
    })
    recommendationFns.approveStrategyRecommendation.mockResolvedValue({
      id: 'rec-1',
      status: 'approved',
    })

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/rec-1/approve', {
      method: 'POST',
    })
    const res = await POST(req, { params: { id: 'rec-1' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(recommendationFns.approveStrategyRecommendation).toHaveBeenCalledWith({
      userId: 9,
      recommendationId: 'rec-1',
    })
  })
})
