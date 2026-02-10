import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/feishu/verify/route'

const authFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getOpenclawSettingsMap: vi.fn(),
}))

const feishuApiFns = vi.hoisted(() => ({
  getTenantAccessToken: vi.fn(),
  feishuRequest: vi.fn(),
  resolveFeishuApiBase: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: authFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getOpenclawSettingsMap: settingsFns.getOpenclawSettingsMap,
}))

vi.mock('@/lib/openclaw/feishu-api', () => ({
  getTenantAccessToken: feishuApiFns.getTenantAccessToken,
  feishuRequest: feishuApiFns.feishuRequest,
  resolveFeishuApiBase: feishuApiFns.resolveFeishuApiBase,
}))

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/openclaw/feishu/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('openclaw feishu verify route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'member' },
    })

    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      feishu_app_id: 'cli_xxx',
      feishu_app_secret: 'sec_xxx',
      feishu_domain: 'feishu',
      feishu_target: 'ou_target_default',
      feishu_allow_from: '[]',
    })

    feishuApiFns.getTenantAccessToken.mockResolvedValue('tenant_token_xxx')
    feishuApiFns.resolveFeishuApiBase.mockReturnValue('https://open.feishu.cn/open-apis')
  })

  it('starts verification for open_id target', async () => {
    feishuApiFns.feishuRequest
      .mockResolvedValueOnce({ data: { message_id: 'omsg_start_1' } })
      .mockResolvedValueOnce({ data: { chat_id: 'oc_chat_1' } })

    const res = await POST(createRequest({ action: 'start', target: 'ou_sender_1' }))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.step).toBe('pending')
    expect(payload.verification.expectedSenderOpenId).toBe('ou_sender_1')
    expect(payload.verification.verificationId).toBeTruthy()
    expect(payload.verification.code).toMatch(/^[23456789A-HJ-NP-Z]{6}$/)

    expect(feishuApiFns.feishuRequest).toHaveBeenCalledTimes(2)
    expect(feishuApiFns.feishuRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'POST',
        url: expect.stringContaining('/im/v1/messages?receive_id_type=open_id'),
      })
    )
    expect(feishuApiFns.feishuRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('/im/v1/messages/omsg_start_1'),
      })
    )
  })

  it('returns 400 when app secret is missing', async () => {
    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      feishu_app_id: 'cli_xxx',
      feishu_app_secret: '',
      feishu_domain: 'feishu',
      feishu_target: 'ou_target_default',
      feishu_allow_from: '[]',
    })

    const res = await POST(createRequest({ action: 'start' }))
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('请先填写飞书 App Secret')
  })

  it('returns 400 when non-open target cannot resolve expected sender', async () => {
    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      feishu_app_id: 'cli_xxx',
      feishu_app_secret: 'sec_xxx',
      feishu_domain: 'feishu',
      feishu_target: 'on_union_1',
      feishu_allow_from: '["ou_a","ou_b"]',
    })

    const res = await POST(createRequest({ action: 'start' }))
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('当前 target 不是 open_id')
  })

  it('checks verification as pending when no valid reply found', async () => {
    feishuApiFns.feishuRequest
      .mockResolvedValueOnce({ data: { message_id: 'omsg_start_2' } })

    const startRes = await POST(createRequest({
      action: 'start',
      target: 'oc_chat_2',
      expectedSenderOpenId: 'ou_expected_2',
    }))
    const startPayload = await startRes.json()

    feishuApiFns.feishuRequest
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              message_id: 'omsg_reply_mismatch',
              create_time: String(Date.now()),
              sender: { id: { open_id: 'ou_other_user' } },
              body: { content: JSON.stringify({ text: 'not-the-code' }) },
            },
          ],
        },
      })

    const checkRes = await POST(createRequest({
      action: 'check',
      verificationId: startPayload.verification.verificationId,
    }))
    const checkPayload = await checkRes.json()

    expect(checkRes.status).toBe(200)
    expect(checkPayload.success).toBe(true)
    expect(checkPayload.verified).toBe(false)
    expect(checkPayload.pending).toBe(true)
    expect(checkPayload.message).toContain('暂未检测到有效验证码回执')
  })

  it('checks verification as success when sender and code match', async () => {
    feishuApiFns.feishuRequest
      .mockResolvedValueOnce({ data: { message_id: 'omsg_start_3' } })

    const startRes = await POST(createRequest({
      action: 'start',
      target: 'oc_chat_3',
      expectedSenderOpenId: 'ou_expected_3',
    }))
    const startPayload = await startRes.json()
    const code = String(startPayload?.verification?.code || '')

    feishuApiFns.feishuRequest
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              message_id: 'omsg_reply_ok',
              create_time: String(Date.now()),
              sender: { id: { open_id: 'ou_expected_3' } },
              body: { content: JSON.stringify({ text: `收到验证码 ${code}` }) },
            },
          ],
        },
      })

    const checkRes = await POST(createRequest({
      action: 'check',
      verificationId: startPayload.verification.verificationId,
    }))
    const checkPayload = await checkRes.json()

    expect(checkRes.status).toBe(200)
    expect(checkPayload.success).toBe(true)
    expect(checkPayload.verified).toBe(true)
    expect(checkPayload.pending).toBe(false)
    expect(checkPayload.message).toContain('双向通信验证成功')
  })

  it('returns 404 for unknown verification session', async () => {
    const res = await POST(createRequest({
      action: 'check',
      verificationId: 'not-found-session-123',
    }))
    const payload = await res.json()

    expect(res.status).toBe(404)
    expect(payload.success).toBe(false)
    expect(payload.found).toBe(false)
  })
})
