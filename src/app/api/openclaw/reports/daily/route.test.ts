import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/openclaw/reports/daily/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const reportFns = vi.hoisted(() => ({
  getOrCreateDailyReport: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getOpenclawSettingsMap: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/reports', () => ({
  getOrCreateDailyReport: reportFns.getOrCreateDailyReport,
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getOpenclawSettingsMap: settingsFns.getOpenclawSettingsMap,
}))

describe('openclaw reports daily route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reportFns.getOrCreateDailyReport.mockResolvedValue({
      date: '2026-02-09',
      generatedAt: '2026-02-09T00:00:00.000Z',
    })
    settingsFns.getOpenclawSettingsMap.mockResolvedValue({})
  })

  it('returns 403 when request user cannot be resolved', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('未授权')
    expect(reportFns.getOrCreateDailyReport).not.toHaveBeenCalled()
  })

  it('forces realtime refresh when query flag is provided', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 7,
      authType: 'session',
    })

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09&force_realtime=1')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(reportFns.getOrCreateDailyReport).toHaveBeenCalledWith(7, '2026-02-09', { forceRefresh: true })
    expect(payload.forceRefreshApplied).toBe(true)
    expect(payload.forceRefreshReason).toBe('query')
  })

  it('forces realtime refresh for Feishu gateway binding when mode is realtime', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 11,
      authType: 'gateway-binding',
    })

    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      openclaw_affiliate_sync_mode: 'realtime',
    })

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09', {
      headers: {
        'x-openclaw-channel': 'feishu',
      },
    })
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(settingsFns.getOpenclawSettingsMap).toHaveBeenCalledWith(11)
    expect(reportFns.getOrCreateDailyReport).toHaveBeenCalledWith(11, '2026-02-09', { forceRefresh: true })
    expect(payload.forceRefreshApplied).toBe(true)
    expect(payload.forceRefreshReason).toBe('feishu_mode')
  })

  it('keeps cache path for Feishu gateway binding when mode is incremental', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 19,
      authType: 'gateway-binding',
    })

    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      openclaw_affiliate_sync_mode: 'incremental',
    })

    const req = new NextRequest('http://localhost/api/openclaw/reports/daily?date=2026-02-09', {
      headers: {
        'x-openclaw-channel': 'feishu',
      },
    })
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(reportFns.getOrCreateDailyReport).toHaveBeenCalledWith(19, '2026-02-09', { forceRefresh: false })
    expect(payload.forceRefreshApplied).toBe(false)
    expect(payload.forceRefreshReason).toBeNull()
  })
})
