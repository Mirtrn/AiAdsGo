import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/commands/confirm/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const commandFns = vi.hoisted(() => ({
  confirmOpenclawCommand: vi.fn(),
}))

const correlationFns = vi.hoisted(() => ({
  resolveOpenclawParentRequestId: vi.fn(),
  resolveOpenclawParentRequestIdFromHeaders: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/commands/command-service', () => ({
  confirmOpenclawCommand: commandFns.confirmOpenclawCommand,
}))

vi.mock('@/lib/openclaw/request-correlation', () => ({
  resolveOpenclawParentRequestId: correlationFns.resolveOpenclawParentRequestId,
  resolveOpenclawParentRequestIdFromHeaders: correlationFns.resolveOpenclawParentRequestIdFromHeaders,
}))

describe('POST /api/openclaw/commands/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 99,
      authType: 'gateway-binding',
    })
    correlationFns.resolveOpenclawParentRequestIdFromHeaders.mockReturnValue({
      parentRequestId: null,
      source: 'none',
    })
    correlationFns.resolveOpenclawParentRequestId.mockResolvedValue(null)
    commandFns.confirmOpenclawCommand.mockResolvedValue({
      status: 'confirmed',
      runId: 'run-confirm-1',
    })
  })

  it('uses body metadata as auth fallback for gateway binding', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/commands/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gateway-token',
      },
      body: JSON.stringify({
        runId: 'run-confirm-1',
        confirmToken: 'confirm_token_12345',
        action: 'confirm',
        channel: 'feishu',
        sender_open_id: 'ou_confirm_1',
        account_id: 'acct_confirm_1',
        tenant_key: 'tenant_confirm_1',
      }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(authFns.resolveOpenclawRequestUser).toHaveBeenCalledTimes(1)
    expect(authFns.resolveOpenclawRequestUser.mock.calls[0]?.[1]).toEqual({
      channel: 'feishu',
      senderId: 'ou_confirm_1',
      accountId: 'acct_confirm_1',
      tenantKey: 'tenant_confirm_1',
    })
    expect(commandFns.confirmOpenclawCommand).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-confirm-1',
      userId: 99,
      decision: 'confirm',
      channel: 'feishu',
    }))
  })

  it('returns json 500 when auth resolution throws before command confirmation', async () => {
    authFns.resolveOpenclawRequestUser.mockRejectedValueOnce(new Error('openclaw bindings query failed'))

    const req = new NextRequest('http://localhost/api/openclaw/commands/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gateway-token',
      },
      body: JSON.stringify({
        runId: 'run-confirm-1',
        confirmToken: 'confirm_token_12345',
      }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(500)
    expect(payload.error).toContain('openclaw bindings query failed')
    expect(commandFns.confirmOpenclawCommand).not.toHaveBeenCalled()
  })
})
