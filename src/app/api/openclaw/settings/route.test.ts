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
    settingsFns.getSettingsByCategory.mockResolvedValue([
      { key: 'ai_models_json', value: '', dataType: 'text' },
      { key: 'openclaw_models_mode', value: 'merge', dataType: 'string' },
      { key: 'openclaw_models_bedrock_discovery_json', value: '[]', dataType: 'text' },
      { key: 'feishu_app_id', value: '', dataType: 'string' },
      { key: 'feishu_app_secret', value: '', dataType: 'string' },
      { key: 'feishu_accounts_json', value: '{}', dataType: 'text' },
    ])
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

  it('blocks scope=user payloads that include global AI keys', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        updates: [{ key: 'ai_models_json', value: '{"providers":{}}' }],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('用户保存不允许包含全局 AI 配置')
    expect(settingsFns.updateSettings).not.toHaveBeenCalled()
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

  it('skips missing template keys instead of throwing 500', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    settingsFns.getSettingsByCategory.mockResolvedValueOnce([
      { key: 'feishu_app_id', value: '', dataType: 'string' },
      { key: 'feishu_app_secret', value: '', dataType: 'string' },
    ])

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        updates: [
          { key: 'feishu_app_id', value: 'cli_new' },
          { key: 'feishu_auth_mode', value: 'strict' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.skippedKeys).toEqual(['feishu_auth_mode'])
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      [{ category: 'openclaw', key: 'feishu_app_id', value: 'cli_new' }],
      9
    )
    expect(syncFns.syncOpenclawConfig).toHaveBeenCalledWith({
      reason: 'openclaw-user-settings',
      actorUserId: 9,
    })
  })
  it('accepts affiliate sync user-scoped keys', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    settingsFns.getSettingsByCategory.mockResolvedValueOnce([
      { key: 'openclaw_affiliate_sync_enabled', value: 'true', dataType: 'boolean' },
      { key: 'openclaw_affiliate_sync_interval_hours', value: '1', dataType: 'number' },
      { key: 'openclaw_affiliate_sync_mode', value: 'incremental', dataType: 'string' },
    ])

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        updates: [
          { key: 'openclaw_affiliate_sync_enabled', value: 'true' },
          { key: 'openclaw_affiliate_sync_interval_hours', value: '2' },
          { key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.skippedKeys).toEqual([])
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      [
        { category: 'openclaw', key: 'openclaw_affiliate_sync_enabled', value: 'true' },
        { category: 'openclaw', key: 'openclaw_affiliate_sync_interval_hours', value: '2' },
        { category: 'openclaw', key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
      ],
      9
    )
    expect(syncFns.syncOpenclawConfig).toHaveBeenCalledWith({
      reason: 'openclaw-user-settings-nonsync',
      actorUserId: 9,
    })
  })

  it('accepts gateway guardrail keys and triggers user config sync', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    settingsFns.getSettingsByCategory.mockResolvedValueOnce([
      { key: 'gateway_auth_rate_limit_json', value: '{}', dataType: 'json' },
      { key: 'gateway_tools_json', value: '{}', dataType: 'json' },
    ])

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        updates: [
          {
            key: 'gateway_auth_rate_limit_json',
            value: '{"maxAttempts":8,"windowMs":60000,"lockoutMs":300000,"exemptLoopback":true}',
          },
          {
            key: 'gateway_tools_json',
            value: '{"allow":["message"],"deny":["sessions_spawn"]}',
          },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.skippedKeys).toEqual([])
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      [
        {
          category: 'openclaw',
          key: 'gateway_auth_rate_limit_json',
          value: '{"maxAttempts":8,"windowMs":60000,"lockoutMs":300000,"exemptLoopback":true}',
        },
        {
          category: 'openclaw',
          key: 'gateway_tools_json',
          value: '{"allow":["message"],"deny":["sessions_spawn"]}',
        },
      ],
      9
    )
    expect(syncFns.syncOpenclawConfig).toHaveBeenCalledWith({
      reason: 'openclaw-user-settings',
      actorUserId: 9,
    })
  })

  it('rejects invalid strategy cron expressions on user save', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        updates: [
          { key: 'openclaw_strategy_enabled', value: 'false' },
          { key: 'openclaw_strategy_cron', value: 'not-a-cron' },
          { key: 'openclaw_strategy_ads_account_ids', value: '[123456789]' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('Cron')
    expect(settingsFns.updateSettings).not.toHaveBeenCalled()
  })

  it('rejects enabling strategy without ads account ids', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        updates: [
          { key: 'openclaw_strategy_enabled', value: 'true' },
          { key: 'openclaw_strategy_cron', value: '0 9 * * *' },
          { key: 'openclaw_strategy_ads_account_ids', value: '[]' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('至少需要配置一个 Ads 账号ID')
    expect(settingsFns.updateSettings).not.toHaveBeenCalled()
  })

  it('accepts valid strategy config updates', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 9, role: 'member' },
    })

    settingsFns.getSettingsByCategory.mockResolvedValueOnce([
      { key: 'openclaw_strategy_enabled', value: 'false', dataType: 'boolean' },
      { key: 'openclaw_strategy_cron', value: '0 9 * * *', dataType: 'string' },
      { key: 'openclaw_strategy_ads_account_ids', value: '[]', dataType: 'json' },
      { key: 'openclaw_strategy_enforce_autoads_only', value: 'true', dataType: 'boolean' },
      { key: 'openclaw_strategy_max_offers_per_run', value: '3', dataType: 'number' },
      { key: 'openclaw_strategy_default_budget', value: '20', dataType: 'number' },
      { key: 'openclaw_strategy_max_cpc', value: '1.2', dataType: 'number' },
      { key: 'openclaw_strategy_min_cpc', value: '0.1', dataType: 'number' },
      { key: 'openclaw_strategy_daily_budget_cap', value: '1000', dataType: 'number' },
      { key: 'openclaw_strategy_daily_spend_cap', value: '100', dataType: 'number' },
      { key: 'openclaw_strategy_target_roas', value: '1', dataType: 'number' },
      { key: 'openclaw_strategy_priority_asins', value: '[]', dataType: 'json' },
    ])

    const req = new NextRequest('http://localhost/api/openclaw/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'user',
        updates: [
          { key: 'openclaw_strategy_enabled', value: 'true' },
          { key: 'openclaw_strategy_cron', value: '0 */6 * * *' },
          { key: 'openclaw_strategy_ads_account_ids', value: '[123456789,987654321]' },
          { key: 'openclaw_strategy_enforce_autoads_only', value: 'true' },
          { key: 'openclaw_strategy_max_offers_per_run', value: '6' },
          { key: 'openclaw_strategy_default_budget', value: '40' },
          { key: 'openclaw_strategy_max_cpc', value: '1.8' },
          { key: 'openclaw_strategy_min_cpc', value: '0.2' },
          { key: 'openclaw_strategy_daily_budget_cap', value: '1000' },
          { key: 'openclaw_strategy_daily_spend_cap', value: '100' },
          { key: 'openclaw_strategy_target_roas', value: '0.8' },
          { key: 'openclaw_strategy_priority_asins', value: '["B08N5WRWNW"]' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      expect.arrayContaining([
        { category: 'openclaw', key: 'openclaw_strategy_enabled', value: 'true' },
        { category: 'openclaw', key: 'openclaw_strategy_cron', value: '0 */6 * * *' },
        { category: 'openclaw', key: 'openclaw_strategy_ads_account_ids', value: '[123456789,987654321]' },
      ]),
      9
    )
    expect(syncFns.syncOpenclawConfig).toHaveBeenCalledWith({
      reason: 'openclaw-user-settings-nonsync',
      actorUserId: 9,
    })
  })

})
