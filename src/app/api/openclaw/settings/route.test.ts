import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from '@/app/api/openclaw/settings/route'

const authFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getSettingsByCategory: vi.fn(),
  getUserOnlySettingsByCategory: vi.fn(),
  updateSettings: vi.fn(),
}))

const syncFns = vi.hoisted(() => ({
  syncOpenclawConfig: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: authFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/settings', () => ({
  getSettingsByCategory: settingsFns.getSettingsByCategory,
  getUserOnlySettingsByCategory: settingsFns.getUserOnlySettingsByCategory,
  updateSettings: settingsFns.updateSettings,
}))

vi.mock('@/lib/openclaw/config', () => ({
  syncOpenclawConfig: syncFns.syncOpenclawConfig,
}))

describe('openclaw settings route AI global permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    settingsFns.getUserOnlySettingsByCategory.mockResolvedValue([])
    settingsFns.getSettingsByCategory.mockResolvedValue([])
    settingsFns.updateSettings.mockResolvedValue(undefined)
    syncFns.syncOpenclawConfig.mockResolvedValue(undefined)
  })

  it('GET merges user settings and global AI settings', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 7, role: 'member' },
    })

    settingsFns.getUserOnlySettingsByCategory.mockResolvedValueOnce([
      { key: 'feishu_app_id', value: 'cli_xxx', dataType: 'string' },
    ])
    settingsFns.getSettingsByCategory.mockResolvedValueOnce([
      { key: 'ai_models_json', value: '{"providers":{}}', dataType: 'text' },
      { key: 'openclaw_models_mode', value: 'merge', dataType: 'string' },
      { key: 'feishu_app_id', value: 'global-should-filter', dataType: 'string' },
    ])

    const req = new NextRequest('http://localhost/api/openclaw/settings')
    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.isAdmin).toBe(false)
    expect(payload.user).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'feishu_app_id', value: 'cli_xxx' }),
        expect.objectContaining({ key: 'ai_models_json', value: '{"providers":{}}' }),
      ])
    )
  })

  it('blocks non-admin from modifying global AI settings', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        updates: [{ key: 'ai_models_json', value: '{"providers":{}}' }],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('仅管理员可修改全局 AI 配置')
    expect(settingsFns.updateSettings).not.toHaveBeenCalled()
  })

  it('allows admin to update global AI settings and sync without actor user id', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 1, role: 'admin' },
    })

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        updates: [
          { key: 'ai_models_json', value: '{"providers":{"openai":{"models":["gpt-5"]}}}' },
          { key: 'openclaw_models_mode', value: 'merge' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSettings).toHaveBeenCalledWith([
      { category: 'openclaw', key: 'ai_models_json', value: '{"providers":{"openai":{"models":["gpt-5"]}}}' },
      { category: 'openclaw', key: 'openclaw_models_mode', value: 'merge' },
    ])
    expect(syncFns.syncOpenclawConfig).toHaveBeenCalledWith({ reason: 'openclaw-global-ai-settings' })
  })
})
