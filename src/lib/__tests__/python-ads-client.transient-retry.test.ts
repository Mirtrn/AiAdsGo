import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const axiosPost = vi.hoisted(() => vi.fn())
const getServiceAccountConfig = vi.hoisted(() => vi.fn())
const trackApiUsage = vi.hoisted(() => vi.fn())
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    post: axiosPost,
  },
}))

vi.mock('../google-ads-service-account', () => ({
  getServiceAccountConfig,
}))

vi.mock('../google-ads-api-tracker', () => ({
  trackApiUsage,
  ApiOperationType: {
    GET_KEYWORD_IDEAS: 'GET_KEYWORD_IDEAS',
    SEARCH: 'SEARCH',
    MUTATE: 'MUTATE',
    MUTATE_BATCH: 'MUTATE_BATCH',
  },
}))

vi.mock('../structured-logger', () => ({
  logger,
}))

function mockServiceAccount() {
  getServiceAccountConfig.mockResolvedValue({
    id: 'sa-1',
    serviceAccountEmail: 'service-account@example.iam.gserviceaccount.com',
    privateKey: 'PRIVATE_KEY_SECRET',
    developerToken: 'DEV_TOKEN_SECRET',
    mccCustomerId: '1234567890',
  })
}

describe('python Ads client transient retry handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    axiosPost.mockReset()
    getServiceAccountConfig.mockReset()
    trackApiUsage.mockReset()
    vi.resetModules()
    mockServiceAccount()
    process.env.PYTHON_ADS_RETRY_INITIAL_DELAY_MS = '1'
    process.env.PYTHON_ADS_AD_GROUP_RECOVERY_QUERY_ATTEMPTS = '1'
  })

  afterEach(() => {
    delete process.env.PYTHON_ADS_RETRY_INITIAL_DELAY_MS
    delete process.env.PYTHON_ADS_AD_GROUP_RECOVERY_QUERY_ATTEMPTS
  })

  it('retries keyword creation when Google Ads reports concurrent modification', async () => {
    const { createKeywordsPython } = await import('../python-ads-client')
    const concurrentModificationError = Object.assign(new Error('Request failed with status code 500'), {
      isAxiosError: true,
      response: {
        status: 500,
        headers: { 'x-request-id': 'py-req-1' },
        data: {
          detail:
            'errors { error_code { database_error: CONCURRENT_MODIFICATION } ' +
            'message: "Multiple requests were attempting to modify the same resource at once. Retry the request." }',
        },
      },
    })

    axiosPost
      .mockRejectedValueOnce(concurrentModificationError)
      .mockResolvedValueOnce({
        data: {
          results: [{ resource_name: 'customers/123/adGroupCriteria/456~789' }],
          removed_keywords: [],
        },
      })

    const result = await createKeywordsPython({
      userId: 7,
      serviceAccountId: 'sa-1',
      customerId: '123',
      adGroupResourceName: 'customers/123/adGroups/456',
      keywords: [
        {
          text: 'security camera',
          matchType: 'PHRASE',
          status: 'ENABLED',
        },
      ],
    })

    expect(result.resourceNames).toEqual(['customers/123/adGroupCriteria/456~789'])
    expect(axiosPost).toHaveBeenCalledTimes(2)
    expect(trackApiUsage).toHaveBeenCalledWith(expect.objectContaining({ isSuccess: true }))
  })

  it('recovers ad group creation transport resets by returning the existing remote ad group', async () => {
    const { createAdGroupPython } = await import('../python-ads-client')
    const transportReset = Object.assign(new Error('socket hang up'), {
      isAxiosError: true,
      code: 'ECONNRESET',
    })

    axiosPost
      .mockRejectedValueOnce(transportReset)
      .mockResolvedValueOnce({
        data: {
          results: [
            {
              ad_group: {
                id: '777',
                resource_name: 'customers/123/adGroups/777',
                name: 'Recovered Ad Group',
              },
            },
          ],
        },
      })

    const resourceName = await createAdGroupPython({
      userId: 7,
      serviceAccountId: 'sa-1',
      customerId: '123',
      campaignResourceName: 'customers/123/campaigns/456',
      name: 'Recovered Ad Group',
      status: 'ENABLED',
      cpcBidMicros: 170000,
    })

    expect(resourceName).toBe('customers/123/adGroups/777')
    expect(axiosPost).toHaveBeenCalledTimes(2)
    expect(axiosPost.mock.calls[1][0]).toContain('/api/google-ads/query')
    expect(axiosPost.mock.calls[1][1].query).toContain("ad_group.name = 'Recovered Ad Group'")
    expect(trackApiUsage).toHaveBeenCalledWith(expect.objectContaining({ isSuccess: true }))
  })

  it('retries ad group creation after a transport reset when recovery query finds nothing', async () => {
    const { createAdGroupPython } = await import('../python-ads-client')
    const transportReset = Object.assign(new Error('socket hang up'), {
      isAxiosError: true,
      code: 'ECONNRESET',
    })

    axiosPost
      .mockRejectedValueOnce(transportReset)
      .mockResolvedValueOnce({ data: { results: [] } })
      .mockResolvedValueOnce({ data: { resource_name: 'customers/123/adGroups/888' } })

    const resourceName = await createAdGroupPython({
      userId: 7,
      serviceAccountId: 'sa-1',
      customerId: '123',
      campaignResourceName: 'customers/123/campaigns/456',
      name: 'New Ad Group',
      status: 'ENABLED',
      cpcBidMicros: 170000,
    })

    expect(resourceName).toBe('customers/123/adGroups/888')
    expect(axiosPost).toHaveBeenCalledTimes(3)
    expect(axiosPost.mock.calls[1][0]).toContain('/api/google-ads/query')
    expect(axiosPost.mock.calls[2][0]).toContain('/api/google-ads/ad-group/create')
  })
})
