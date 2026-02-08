import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/gateway/reload/route'

const authFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const configFns = vi.hoisted(() => ({
  syncOpenclawConfig: vi.fn(),
}))

const gatewayFns = vi.hoisted(() => ({
  getOpenclawGatewaySnapshot: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: authFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/openclaw/config', () => ({
  syncOpenclawConfig: configFns.syncOpenclawConfig,
}))

vi.mock('@/lib/openclaw/gateway-ws', () => ({
  getOpenclawGatewaySnapshot: gatewayFns.getOpenclawGatewaySnapshot,
}))

describe('POST /api/openclaw/gateway/reload', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 1, role: 'admin' },
    })
    configFns.syncOpenclawConfig.mockResolvedValue(undefined)
    gatewayFns.getOpenclawGatewaySnapshot.mockResolvedValue({
      fetchedAt: '2026-02-08T00:00:00.000Z',
      health: { ok: true },
      skills: null,
      errors: [],
    })
  })

  it('returns auth error when unauthenticated', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: false,
      status: 401,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toBe('Unauthorized')
    expect(configFns.syncOpenclawConfig).not.toHaveBeenCalled()
  })

  it('blocks non-admin users', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 3, role: 'member' },
    })

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('仅管理员可执行配置热加载')
    expect(configFns.syncOpenclawConfig).not.toHaveBeenCalled()
  })

  it('syncs config and returns refreshed gateway status', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.gatewayStatus).toEqual(
      expect.objectContaining({
        success: true,
        fetchedAt: '2026-02-08T00:00:00.000Z',
      })
    )
    expect(configFns.syncOpenclawConfig).toHaveBeenCalledWith({ reason: 'openclaw-manual-hot-reload' })
    expect(gatewayFns.getOpenclawGatewaySnapshot).toHaveBeenCalledWith({ force: true })
  })

  it('returns success with warning when gateway status check fails', async () => {
    gatewayFns.getOpenclawGatewaySnapshot.mockRejectedValue(new Error('Gateway unavailable'))

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.gatewayStatus).toEqual(
      expect.objectContaining({ success: false, error: 'Gateway unavailable' })
    )
  })

  it('returns 500 when config sync fails', async () => {
    configFns.syncOpenclawConfig.mockRejectedValue(new Error('sync failed'))

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(500)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('sync failed')
    expect(gatewayFns.getOpenclawGatewaySnapshot).not.toHaveBeenCalled()
  })
})
