import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from '@/app/api/settings/route'

const settingsFns = vi.hoisted(() => ({
  clearUserSettings: vi.fn(),
  getAllSettings: vi.fn(),
  getSettingsByCategory: vi.fn(),
  updateSettings: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  invalidateProxyPoolCache: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  clearUserSettings: settingsFns.clearUserSettings,
  getAllSettings: settingsFns.getAllSettings,
  getSettingsByCategory: settingsFns.getSettingsByCategory,
  updateSettings: settingsFns.updateSettings,
}))

vi.mock('@/lib/offer-utils', () => ({
  invalidateProxyPoolCache: offerFns.invalidateProxyPoolCache,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

describe('settings route affiliate sync safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockResolvedValue({
      queryOne: vi.fn().mockResolvedValue(null),
    })
    settingsFns.getAllSettings.mockResolvedValue([
      {
        category: 'affiliate_sync',
        key: 'partnerboost_base_url',
        value: 'https://custom.example.com',
        dataType: 'string',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: 'PartnerBoost API Base URL',
      },
      {
        category: 'affiliate_sync',
        key: 'openclaw_affiliate_sync_interval_hours',
        value: '12',
        dataType: 'number',
        isSensitive: false,
        isRequired: false,
        validationStatus: null,
        validationMessage: null,
        lastValidatedAt: null,
        description: '佣金同步间隔',
      },
    ])
    settingsFns.updateSettings.mockResolvedValue(undefined)
  })

  it('returns fixed defaults for affiliate sync readonly fields', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      headers: { 'x-user-id': '7' },
    })

    const res = await GET(req)
    const payload = await res.json()
    const affiliateSettings = payload.settings.affiliate_sync

    expect(res.status).toBe(200)
    expect(affiliateSettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'partnerboost_base_url', value: 'https://app.partnerboost.com' }),
        expect.objectContaining({ key: 'openclaw_affiliate_sync_interval_hours', value: '1' }),
      ])
    )
  })

  it('forces fixed defaults when saving affiliate sync readonly fields', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '7',
      },
      body: JSON.stringify({
        updates: [
          { category: 'affiliate_sync', key: 'partnerboost_base_url', value: 'https://custom.example.com' },
          { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_interval_hours', value: '12' },
          { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSettings).toHaveBeenCalledWith([
      { category: 'affiliate_sync', key: 'partnerboost_base_url', value: 'https://app.partnerboost.com' },
      { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_interval_hours', value: '1' },
      { category: 'affiliate_sync', key: 'openclaw_affiliate_sync_mode', value: 'realtime' },
    ], 7)
  })
})
