import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  verifyOpenclawGatewayTokenMock,
  verifyOpenclawUserTokenMock,
  resolveOpenclawUserFromBindingMock,
  isOpenclawEnabledForUserMock,
  checkOpenclawRateLimitMock,
  fetchAutoadsAsUserMock,
  executeOpenclawCommandMock,
  resolveOpenclawParentRequestIdMock,
} = vi.hoisted(() => ({
  verifyOpenclawGatewayTokenMock: vi.fn(),
  verifyOpenclawUserTokenMock: vi.fn(),
  resolveOpenclawUserFromBindingMock: vi.fn(),
  isOpenclawEnabledForUserMock: vi.fn(),
  checkOpenclawRateLimitMock: vi.fn(),
  fetchAutoadsAsUserMock: vi.fn(),
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
    executeOpenclawCommandMock.mockReset()
    resolveOpenclawParentRequestIdMock.mockReset()

    verifyOpenclawGatewayTokenMock.mockResolvedValue(true)
    resolveOpenclawUserFromBindingMock.mockResolvedValue(1001)
    isOpenclawEnabledForUserMock.mockResolvedValue(true)
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
        path: '/api/offers',
        body: { url: 'https://example.com/p' },
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
      path: '/api/offers',
      query: undefined,
      body: { url: 'https://example.com/p' },
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
})
