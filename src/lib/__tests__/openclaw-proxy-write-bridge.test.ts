import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  verifyOpenclawGatewayTokenMock,
  verifyOpenclawUserTokenMock,
  resolveOpenclawUserFromBindingMock,
  isOpenclawEnabledForUserMock,
  checkOpenclawRateLimitMock,
  fetchAutoadsAsUserMock,
  recordOpenclawActionMock,
  executeOpenclawCommandMock,
  resolveOpenclawParentRequestIdMock,
} = vi.hoisted(() => ({
  verifyOpenclawGatewayTokenMock: vi.fn(),
  verifyOpenclawUserTokenMock: vi.fn(),
  resolveOpenclawUserFromBindingMock: vi.fn(),
  isOpenclawEnabledForUserMock: vi.fn(),
  checkOpenclawRateLimitMock: vi.fn(),
  fetchAutoadsAsUserMock: vi.fn(),
  recordOpenclawActionMock: vi.fn(),
  executeOpenclawCommandMock: vi.fn(),
  resolveOpenclawParentRequestIdMock: vi.fn(),
}))

vi.mock('../openclaw/auth', () => ({
  verifyOpenclawGatewayToken: verifyOpenclawGatewayTokenMock,
}))

vi.mock('../openclaw/tokens', () => ({
  verifyOpenclawUserToken: verifyOpenclawUserTokenMock,
}))

vi.mock('../openclaw/bindings', () => ({
  resolveOpenclawUserFromBinding: resolveOpenclawUserFromBindingMock,
}))

vi.mock('../openclaw/request-auth', () => ({
  isOpenclawEnabledForUser: isOpenclawEnabledForUserMock,
}))

vi.mock('../openclaw/rate-limit', () => ({
  checkOpenclawRateLimit: checkOpenclawRateLimitMock,
}))

vi.mock('../openclaw/autoads-client', () => ({
  fetchAutoadsAsUser: fetchAutoadsAsUserMock,
}))

vi.mock('../openclaw/action-logs', () => ({
  recordOpenclawAction: recordOpenclawActionMock,
}))

vi.mock('../openclaw/commands/command-service', () => ({
  executeOpenclawCommand: executeOpenclawCommandMock,
}))

vi.mock('../openclaw/request-correlation', () => ({
  resolveOpenclawParentRequestId: resolveOpenclawParentRequestIdMock,
}))

import { handleOpenclawProxyRequest } from '../openclaw/proxy'

describe('openclaw proxy write bridge', () => {
  beforeEach(() => {
    verifyOpenclawGatewayTokenMock.mockReset()
    verifyOpenclawUserTokenMock.mockReset()
    resolveOpenclawUserFromBindingMock.mockReset()
    isOpenclawEnabledForUserMock.mockReset()
    checkOpenclawRateLimitMock.mockReset()
    fetchAutoadsAsUserMock.mockReset()
    recordOpenclawActionMock.mockReset()
    executeOpenclawCommandMock.mockReset()
    resolveOpenclawParentRequestIdMock.mockReset()

    verifyOpenclawGatewayTokenMock.mockResolvedValue(true)
    resolveOpenclawUserFromBindingMock.mockResolvedValue(1001)
    isOpenclawEnabledForUserMock.mockResolvedValue(true)
    recordOpenclawActionMock.mockResolvedValue(undefined)
    resolveOpenclawParentRequestIdMock.mockImplementation(async (params: { explicitParentRequestId?: string }) => {
      return params.explicitParentRequestId
    })
  })

  it('bridges write requests to command executor and keeps sender context', async () => {
    executeOpenclawCommandMock.mockResolvedValue({
      status: 'queued',
      runId: 'run-1',
      taskId: 'task-1',
      riskLevel: 'low',
    })

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'POST',
        path: '/api/offers/extract',
        body: { affiliate_link: 'https://example.com/p', target_country: 'US' },
        channel: 'feishu',
        senderId: 'ou_test',
        accountId: 'user-1',
        intent: 'offer.create',
        idempotencyKey: 'idem-1',
        parentRequestId: 'om_message_1',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-openclaw-proxy-bridge')).toBe('commands-execute')
    expect(await response.json()).toMatchObject({
      success: true,
      bridged: true,
      status: 'queued',
      runId: 'run-1',
    })

    expect(executeOpenclawCommandMock).toHaveBeenCalledWith({
      userId: 1001,
      authType: 'gateway-binding',
      method: 'POST',
      path: '/api/offers/extract',
      query: undefined,
      body: { affiliate_link: 'https://example.com/p', target_country: 'US' },
      channel: 'feishu',
      senderId: 'ou_test',
      intent: 'offer.create',
      idempotencyKey: 'idem-1',
      parentRequestId: 'om_message_1',
    })

    expect(fetchAutoadsAsUserMock).not.toHaveBeenCalled()
  })

  it('returns 202 when bridged write requires confirmation', async () => {
    executeOpenclawCommandMock.mockResolvedValue({
      status: 'pending_confirm',
      runId: 'run-2',
      riskLevel: 'high',
      confirmToken: 'occf_test',
      expiresAt: '2026-02-12T00:00:00.000Z',
    })

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'POST',
        path: '/api/campaigns/publish',
        body: { offerId: 1, googleAdsAccountId: 2, campaignConfig: { campaignName: 'A' } },
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      success: true,
      bridged: true,
      status: 'pending_confirm',
      runId: 'run-2',
    })
  })

  it('uses stream timeout for /stream read routes', async () => {
    fetchAutoadsAsUserMock.mockResolvedValue(
      new Response('data: ok\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    )

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'GET',
        path: '/api/offers/extract/stream/task-1',
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(200)
    expect(fetchAutoadsAsUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1001,
        method: 'GET',
        path: '/api/offers/extract/stream/task-1',
        timeoutMs: 30 * 60 * 1000,
      })
    )
  })

  it('keeps standard timeout for non-stream read routes', async () => {
    fetchAutoadsAsUserMock.mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const response = await handleOpenclawProxyRequest({
      authHeader: 'Bearer gateway-token',
      request: {
        method: 'GET',
        path: '/api/campaigns',
        channel: 'feishu',
        senderId: 'ou_test',
      },
    })

    expect(response.status).toBe(200)
    expect(fetchAutoadsAsUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1001,
        method: 'GET',
        path: '/api/campaigns',
        timeoutMs: 45_000,
      })
    )
  })
})
