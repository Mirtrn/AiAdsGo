import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockDb: any
let getKeywordSearchVolumes: typeof import('../keyword-planner').getKeywordSearchVolumes

const mockGetBatchCachedVolumes = vi.fn()
const mockBatchCacheVolumes = vi.fn()
const mockGenerateKeywordHistoricalMetrics = vi.fn()

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../redis', () => ({
  getCachedKeywordVolume: vi.fn(),
  cacheKeywordVolume: vi.fn(),
  getBatchCachedVolumes: (...args: any[]) => mockGetBatchCachedVolumes(...args),
  batchCacheVolumes: (...args: any[]) => mockBatchCacheVolumes(...args),
}))

vi.mock('../google-ads-oauth', () => ({
  refreshAccessToken: vi.fn().mockResolvedValue(undefined),
  getGoogleAdsCredentials: vi.fn().mockResolvedValue({
    refresh_token: 'rt',
    login_customer_id: '123',
  }),
}))

vi.mock('../google-ads-api-tracker', () => ({
  trackApiUsage: vi.fn(),
  ApiOperationType: { GET_KEYWORD_IDEAS: 'GET_KEYWORD_IDEAS' },
}))

vi.mock('../google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('../google-ads-api', () => ({
  GoogleAdsApi: vi.fn(),
  enums: { KeywordPlanNetwork: { GOOGLE_SEARCH: 2 } },
  getCustomerWithCredentials: vi.fn(),
  getGoogleAdsClient: () => ({
    Customer: () => ({
      keywordPlanIdeas: {
        generateKeywordHistoricalMetrics: (...args: any[]) => mockGenerateKeywordHistoricalMetrics(...args),
      },
      callMetadata: {},
    }),
  }),
}))

describe('KeywordPlanner developer token access handling', () => {
  beforeEach(() => {
    mockDb = {
      type: 'postgres',
      query: vi.fn(),
      queryOne: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
    }
  })

  beforeEach(async () => {
    vi.resetModules()
    mockGetBatchCachedVolumes.mockReset()
    mockBatchCacheVolumes.mockReset()
    mockGenerateKeywordHistoricalMetrics.mockReset()
    ;({ getKeywordSearchVolumes } = await import('../keyword-planner'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns volumeUnavailableReason and skips caching when developer token is test-only', async () => {
    mockGetBatchCachedVolumes.mockResolvedValue(new Map())
    mockDb.query.mockImplementation((sql: string) => {
      const s = String(sql)
      if (s.includes('FROM system_settings')) {
        return [
          { key: 'client_id', value: 'cid', encrypted_value: null },
          { key: 'client_secret', value: 'secret', encrypted_value: null },
          { key: 'developer_token', value: 'dt', encrypted_value: null },
        ]
      }
      if (s.includes('FROM global_keywords')) return []
      return []
    })

    mockGenerateKeywordHistoricalMetrics.mockRejectedValue({
      errors: [
        {
          message:
            'The developer token is only approved for use with test accounts. To access non-test accounts, apply for Basic or Standard access.',
        },
      ],
    })

    const out = await getKeywordSearchVolumes(['k1', 'k2'], 'US', 'en', 1)

    expect(out).toHaveLength(2)
    expect(out.every((v: any) => v.avgMonthlySearches === 0)).toBe(true)
    expect(out.every((v: any) => v.volumeUnavailableReason === 'DEV_TOKEN_TEST_ONLY')).toBe(true)

    expect(mockGenerateKeywordHistoricalMetrics).toHaveBeenCalledTimes(1)
    expect(mockBatchCacheVolumes).not.toHaveBeenCalled()
    expect(mockDb.exec).not.toHaveBeenCalled()
  })
})

