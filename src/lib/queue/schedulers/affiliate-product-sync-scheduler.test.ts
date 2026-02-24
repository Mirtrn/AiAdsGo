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
})
