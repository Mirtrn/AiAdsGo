import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosPost = vi.hoisted(() => vi.fn())
const getServiceAccountConfig = vi.hoisted(() => vi.fn())
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
  trackApiUsage: vi.fn(),
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

describe('listAccessibleCustomersPython', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      serviceAccountEmail: 'service-account@example.iam.gserviceaccount.com',
      privateKey: 'PRIVATE_KEY_SECRET',
      developerToken: 'DEV_TOKEN_SECRET',
      mccCustomerId: '1234567890',
    })
  })

  it('throws a sanitized error instead of exposing the Axios request body', async () => {
    const { listAccessibleCustomersPython } = await import('../python-ads-client')
    const axiosError = Object.assign(new Error('timeout of 30000ms exceeded'), {
      isAxiosError: true,
      code: 'ECONNABORTED',
      config: {
        data: JSON.stringify({
          service_account: {
            private_key: 'PRIVATE_KEY_SECRET',
            developer_token: 'DEV_TOKEN_SECRET',
          },
        }),
      },
    })
    axiosPost.mockRejectedValue(axiosError)

    let thrown: any
    try {
      await listAccessibleCustomersPython({ userId: 7, serviceAccountId: 'sa-1' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain('/api/google-ads/list-accessible-customers')
    expect(thrown.message).toContain('timeout of 30000ms exceeded')
    expect(thrown.isAxiosError).toBeUndefined()
    expect(thrown.config).toBeUndefined()
    expect(JSON.stringify(thrown)).not.toContain('PRIVATE_KEY_SECRET')
    expect(JSON.stringify(thrown)).not.toContain('DEV_TOKEN_SECRET')
  })
})
