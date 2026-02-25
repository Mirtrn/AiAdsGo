import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  checkAffiliatePlatformConfig: vi.fn(),
  createAffiliateProductSyncRun: vi.fn(),
  updateAffiliateProductSyncRun: vi.fn(),
  getQueueManagerForTaskType: vi.fn(),
}))

vi.mock('../../db', () => ({
  getDatabase: mocks.getDatabase,
}))

vi.mock('../../affiliate-products', () => ({
  checkAffiliatePlatformConfig: mocks.checkAffiliatePlatformConfig,
  createAffiliateProductSyncRun: mocks.createAffiliateProductSyncRun,
  updateAffiliateProductSyncRun: mocks.updateAffiliateProductSyncRun,
}))

vi.mock('../queue-routing', () => ({
  getQueueManagerForTaskType: mocks.getQueueManagerForTaskType,
}))

import { AffiliateProductSyncScheduler } from './affiliate-product-sync-scheduler'

describe('AffiliateProductSyncScheduler YP support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDatabase.mockResolvedValue({
      type: 'postgres',
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    })
    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: false,
      missingKeys: [],
      values: {},
    })
  })

  it('schedules YP full sync when PB is not configured and YP is configured', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 360,
      fullIntervalHours: 24,
      lastDeltaAt: null,
      lastFullAt: null,
    })
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimesByPlatform').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: false,
          missingKeys: ['partnerboost_token'],
          values: {},
        }
      }
      return {
        configured: true,
        missingKeys: [],
        values: {
          yeahpromos_token: 'token',
          yeahpromos_site_id: 'site',
        },
      }
    })

    const queued = await scheduler.scheduleForUser(1, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        platform: 'yeahpromos',
        mode: 'platform',
      })
    )
    expect(scheduler.upsertUserSystemSetting).toHaveBeenCalledWith(
      1,
      'affiliate_yp_last_full_sync_at',
      expect.any(String)
    )
  })

  it('keeps PB scheduling priority when PB is due', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadUserScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 360,
      fullIntervalHours: 24,
      lastDeltaAt: null,
      lastFullAt: null,
    })
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimes').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })
    const ypConfigSpy = vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig')

    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: true,
      missingKeys: [],
      values: {},
    })

    const queued = await scheduler.scheduleForUser(2, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        platform: 'partnerboost',
        mode: 'platform',
      })
    )
    expect(scheduler.upsertUserSystemSetting).toHaveBeenCalledWith(
      2,
      'affiliate_pb_last_full_sync_at',
      expect.any(String)
    )
    expect(ypConfigSpy).not.toHaveBeenCalled()
  })

  it('schedules YP delta when full is not due but delta is due', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 360,
      fullIntervalHours: 24,
      lastDeltaAt: new Date('2026-02-22T00:00:00.000Z'),
      lastFullAt: new Date('2026-02-23T20:00:00.000Z'),
    })
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimesByPlatform').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: false,
          missingKeys: ['partnerboost_token'],
          values: {},
        }
      }
      return {
        configured: true,
        missingKeys: [],
        values: {
          yeahpromos_token: 'token',
          yeahpromos_site_id: 'site',
        },
      }
    })

    const queued = await scheduler.scheduleForUser(9, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        platform: 'yeahpromos',
        mode: 'delta',
      })
    )
    expect(scheduler.upsertUserSystemSetting).toHaveBeenCalledWith(
      9,
      'affiliate_yp_last_delta_sync_at',
      expect.any(String)
    )
  })

  it('skips scheduling when an active run exists', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any
    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(true)

    const queued = await scheduler.scheduleForUser(3, new Date('2026-02-24T00:00:00.000Z'))

    expect(queued).toBe(false)
    expect(mocks.checkAffiliatePlatformConfig).not.toHaveBeenCalled()
  })

  it('uses openclaw global interval as PB delta fallback when platform-specific interval is absent', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    const dbQueryMock = vi.fn().mockResolvedValue([
      { key: 'affiliate_pb_last_delta_sync_at', value: '2026-02-23T22:00:00.000Z' },
      { key: 'affiliate_pb_last_full_sync_at', value: '2026-02-24T00:00:00.000Z' },
    ])
    const dbQueryOneMock = vi.fn().mockResolvedValue({ value: '1' })
    mocks.getDatabase.mockResolvedValue({
      type: 'postgres',
      query: dbQueryMock,
      queryOne: dbQueryOneMock,
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    })

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimes').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    mocks.checkAffiliatePlatformConfig.mockResolvedValue({
      configured: true,
      missingKeys: [],
      values: {},
    })

    const queued = await scheduler.scheduleForUser(5, new Date('2026-02-24T01:30:00.000Z'))

    expect(queued).toBe(true)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        platform: 'partnerboost',
        mode: 'delta',
      })
    )
    expect(dbQueryOneMock).toHaveBeenCalledWith(
      expect.stringContaining("category = 'openclaw'"),
      [5, 'openclaw_affiliate_sync_interval_hours']
    )
    expect(dbQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("key IN (?, ?, ?, ?)"),
      [
        5,
        'affiliate_pb_delta_interval_minutes',
        'affiliate_pb_full_interval_hours',
        'affiliate_pb_last_delta_sync_at',
        'affiliate_pb_last_full_sync_at',
      ]
    )
  })

  it('passes openclaw global interval fallback into YP schedule config when PB is not configured', async () => {
    const scheduler = new AffiliateProductSyncScheduler() as any

    vi.spyOn(scheduler, 'hasActiveSyncRun').mockResolvedValue(false)
    vi.spyOn(scheduler, 'enqueueSyncTask').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'upsertUserSystemSetting').mockResolvedValue(undefined)
    vi.spyOn(scheduler, 'loadOpenclawGlobalDeltaIntervalMinutes').mockResolvedValue(60)
    vi.spyOn(scheduler, 'loadLatestCompletedRunTimesByPlatform').mockResolvedValue({
      lastDeltaAt: null,
      lastFullAt: null,
    })

    const ypScheduleSpy = vi.spyOn(scheduler, 'loadYeahpromosScheduleConfig').mockResolvedValue({
      deltaIntervalMinutes: 60,
      fullIntervalHours: 24,
      lastDeltaAt: new Date('2026-02-23T22:00:00.000Z'),
      lastFullAt: new Date('2026-02-24T00:00:00.000Z'),
    })

    mocks.checkAffiliatePlatformConfig.mockImplementation(async (_userId: number, platform: string) => {
      if (platform === 'partnerboost') {
        return {
          configured: false,
          missingKeys: ['partnerboost_token'],
          values: {},
        }
      }
      return {
        configured: true,
        missingKeys: [],
        values: {
          yeahpromos_token: 'token',
          yeahpromos_site_id: 'site',
        },
      }
    })

    const queued = await scheduler.scheduleForUser(6, new Date('2026-02-24T01:30:00.000Z'))

    expect(queued).toBe(true)
    expect(ypScheduleSpy).toHaveBeenCalledWith(6, 60)
    expect(scheduler.enqueueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 6,
        platform: 'yeahpromos',
        mode: 'delta',
      })
    )
  })
})
