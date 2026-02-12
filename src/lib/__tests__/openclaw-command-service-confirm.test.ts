import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDatabaseMock,
  getQueueManagerForTaskTypeMock,
  createOrRefreshCommandConfirmationMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  getQueueManagerForTaskTypeMock: vi.fn(),
  createOrRefreshCommandConfirmationMock: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('../queue/queue-routing', () => ({
  getQueueManagerForTaskType: getQueueManagerForTaskTypeMock,
}))

vi.mock('../openclaw/commands/confirm-service', () => ({
  createOrRefreshCommandConfirmation: createOrRefreshCommandConfirmationMock,
  consumeCommandConfirmation: vi.fn(),
  recordOpenclawCallbackEvent: vi.fn(),
}))

import { executeOpenclawCommand } from '../openclaw/commands/command-service'

describe('openclaw command service confirmation guard', () => {
  let db: {
    type: 'sqlite'
    queryOne: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
  }
  let queueManager: {
    enqueue: ReturnType<typeof vi.fn>
  }

  function getInsertParams(): any[] {
    const insertCall = db.exec.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO openclaw_command_runs')
    )
    return insertCall?.[1] || []
  }

  function getInsertedBody(): Record<string, any> {
    const params = getInsertParams()
    const bodyJson = params[9]
    return bodyJson ? JSON.parse(bodyJson) : {}
  }

  function getValidPublishBody() {
    return {
      offerId: 1,
      googleAdsAccountId: 2,
      campaignConfig: {
        campaignName: 'Test Campaign',
      },
    }
  }

  beforeEach(() => {
    db = {
      type: 'sqlite',
      queryOne: vi.fn().mockResolvedValue(null),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }

    queueManager = {
      enqueue: vi.fn().mockResolvedValue('task-1'),
    }

    getDatabaseMock.mockReset()
    getDatabaseMock.mockResolvedValue(db)

    getQueueManagerForTaskTypeMock.mockReset()
    getQueueManagerForTaskTypeMock.mockReturnValue(queueManager)

    createOrRefreshCommandConfirmationMock.mockReset()
    createOrRefreshCommandConfirmationMock.mockResolvedValue({
      confirmToken: 'occf_test',
      expiresAt: '2026-02-11T00:00:00.000Z',
    })
  })

  it.each([
    {
      method: 'PUT',
      path: '/api/settings',
      body: {
        updates: [
          { category: 'ai', key: 'gemini_provider', value: 'official' },
        ],
      },
    },
    {
      method: 'POST',
      path: '/api/sync/trigger',
      body: undefined,
    },
    {
      method: 'POST',
      path: '/api/google-ads/credentials',
      body: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        refresh_token: 'refresh-token',
        developer_token: 'developer-token',
      },
    },
  ])('returns pending_confirm for high-risk path $method $path', async ({ method, path, body }) => {
    const result = await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method,
      path,
      body,
      channel: 'feishu',
      senderId: 'ou_test',
    })

    expect(result).toMatchObject({
      status: 'pending_confirm',
      riskLevel: 'high',
      confirmToken: 'occf_test',
    })

    expect(createOrRefreshCommandConfirmationMock).toHaveBeenCalledTimes(1)
    expect(createOrRefreshCommandConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1001 })
    )

    expect(getQueueManagerForTaskTypeMock).not.toHaveBeenCalled()
    expect(queueManager.enqueue).not.toHaveBeenCalled()
    expect(db.exec).toHaveBeenCalled()
  })

  it('fills fallback channel for session auth when channel is missing', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: getValidPublishBody(),
      senderId: 'ou_test',
    })

    const params = getInsertParams()

    expect(params[3]).toBe('web')
    expect(params[4]).toBe('ou_test')
  })

  it('fills fallback channel for user-token auth when channel is missing', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'user-token',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: getValidPublishBody(),
    })

    const params = getInsertParams()

    expect(params[3]).toBe('user-token')
    expect(params[4]).toBeNull()
  })

  it('fills fallback channel for gateway-binding auth when channel is missing', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'gateway-binding',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: getValidPublishBody(),
    })

    const params = getInsertParams()

    expect(params[3]).toBe('feishu')
  })

  it('rejects unsupported payload fields for guarded publish route', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/campaigns/publish',
        body: {
          ...getValidPublishBody(),
          attackerField: 'x',
        },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes publish aliases and force flags before persistence', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/campaigns/publish',
      body: {
        offer_id: 11,
        ad_creative_id: 99,
        google_ads_account_id: 22,
        campaign_config: { campaignName: 'Alias Campaign' },
        pause_old_campaigns: true,
        enable_campaign_immediately: false,
        enable_smart_optimization: true,
        variant_count: 4,
        force_launch: 'true',
        skipLaunchScore: false,
      },
    })

    const body = getInsertedBody()

    expect(body).toMatchObject({
      offerId: 11,
      adCreativeId: 99,
      googleAdsAccountId: 22,
      campaignConfig: { campaignName: 'Alias Campaign' },
      pauseOldCampaigns: true,
      enableCampaignImmediately: false,
      enableSmartOptimization: true,
      variantCount: 4,
      forcePublish: true,
    })

    expect(body.offer_id).toBeUndefined()
    expect(body.force_launch).toBeUndefined()
    expect(body.skipLaunchScore).toBeUndefined()
  })

  it('normalizes click-farm aliases to snake_case payload', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/click-farm/tasks',
      body: {
        offerId: 31,
        dailyClickCount: 120,
        startTime: '06:00',
        endTime: '24:00',
        durationDays: 30,
        scheduledStartDate: '2026-02-12',
        hourlyDistribution: new Array(24).fill(5),
        refererConfig: { type: 'none' },
      },
    })

    const body = getInsertedBody()

    expect(body).toMatchObject({
      offer_id: 31,
      daily_click_count: 120,
      start_time: '06:00',
      end_time: '24:00',
      duration_days: 30,
      scheduled_start_date: '2026-02-12',
      referer_config: { type: 'none' },
    })

    expect(Array.isArray(body.hourly_distribution)).toBe(true)
    expect(body.hourly_distribution).toHaveLength(24)
    expect(body.offerId).toBeUndefined()
    expect(body.dailyClickCount).toBeUndefined()
  })

  it('normalizes offer aliases to snake_case payload', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/offers',
      body: {
        url: 'https://example.com/product',
        targetCountry: 'US',
        affiliateLink: 'https://aff.example.com/track',
        productPrice: '$19.99',
      },
    })

    const body = getInsertedBody()

    expect(body).toMatchObject({
      url: 'https://example.com/product',
      target_country: 'US',
      affiliate_link: 'https://aff.example.com/track',
      product_price: '$19.99',
    })

    expect(body.targetCountry).toBeUndefined()
    expect(body.affiliateLink).toBeUndefined()
  })

  it('rejects guarded route when required field is missing', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/offers',
        body: {
          url: 'https://example.com/product',
        },
      })
    ).rejects.toThrow('missing required fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes dynamic settings route payload', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'PUT',
      path: '/api/settings/ai/gemini_provider',
      body: {
        value: 'official',
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({ value: 'official' })
  })

  it('rejects unknown fields for dynamic settings route', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'PUT',
        path: '/api/settings/ai/gemini_provider',
        body: {
          value: 'official',
          unexpected: true,
        },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('rejects unknown fields for sync scheduler control', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/sync/scheduler',
        body: {
          action: 'start',
          dryRun: true,
        },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('requires at least one updatable field for sync config', async () => {
    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'PUT',
        path: '/api/sync/config',
        body: {},
      })
    ).rejects.toThrow('at least one field is required')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes sync config snake_case aliases', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'PUT',
      path: '/api/sync/config',
      body: {
        auto_sync_enabled: true,
        notify_on_success: false,
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({
      autoSyncEnabled: true,
      notifyOnSuccess: false,
    })
  })

  it('allows sync trigger with empty body but rejects non-empty body', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/sync/trigger',
    })

    const params = getInsertParams()
    expect(params[9]).toBeNull()

    db.exec.mockClear()

    await expect(
      executeOpenclawCommand({
        userId: 1001,
        authType: 'session',
        method: 'POST',
        path: '/api/sync/trigger',
        body: { force: true },
      })
    ).rejects.toThrow('unsupported fields')

    expect(db.exec).not.toHaveBeenCalled()
  })

  it('normalizes google-ads service-account aliases', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'POST',
      path: '/api/google-ads/service-account',
      body: {
        name: 'mcc-primary',
        mcc_customer_id: '123-456-7890',
        developer_token: 'dev-token',
        service_account_json: '{"client_email":"test@example.com"}',
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({
      name: 'mcc-primary',
      mccCustomerId: '123-456-7890',
      developerToken: 'dev-token',
      serviceAccountJson: '{"client_email":"test@example.com"}',
    })
  })

  it('normalizes google-ads-accounts dynamic route aliases', async () => {
    await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method: 'PUT',
      path: '/api/google-ads-accounts/123',
      body: {
        account_name: 'main account',
        is_active: true,
        token_expires_at: '2026-02-12T00:00:00.000Z',
      },
    })

    const body = getInsertedBody()
    expect(body).toEqual({
      accountName: 'main account',
      isActive: true,
      tokenExpiresAt: '2026-02-12T00:00:00.000Z',
    })
  })

})
