import { afterEach, describe, expect, it } from 'vitest'
import { UnifiedQueueManager } from '../unified-queue-manager'

const savedEnv = {
  REDIS_URL: process.env.REDIS_URL,
  QUEUE_GLOBAL_CONCURRENCY: process.env.QUEUE_GLOBAL_CONCURRENCY,
  QUEUE_PER_USER_CONCURRENCY: process.env.QUEUE_PER_USER_CONCURRENCY,
  QUEUE_OFFER_EXTRACTION_CONCURRENCY: process.env.QUEUE_OFFER_EXTRACTION_CONCURRENCY,
  QUEUE_URL_SWAP_CONCURRENCY: process.env.QUEUE_URL_SWAP_CONCURRENCY,
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('UnifiedQueueManager default concurrency', () => {
  it('uses production-safe defaults for browser-heavy tasks', () => {
    delete process.env.REDIS_URL
    delete process.env.QUEUE_GLOBAL_CONCURRENCY
    delete process.env.QUEUE_PER_USER_CONCURRENCY
    delete process.env.QUEUE_OFFER_EXTRACTION_CONCURRENCY
    delete process.env.QUEUE_URL_SWAP_CONCURRENCY

    const queue = new UnifiedQueueManager({ redisUrl: undefined })
    const config = queue.getConfig()

    expect(config.globalConcurrency).toBeLessThanOrEqual(10)
    expect(config.perUserConcurrency).toBeLessThanOrEqual(5)
    expect(config.perTypeConcurrency['offer-extraction']).toBeLessThanOrEqual(2)
    expect(config.perTypeConcurrency['url-swap']).toBeLessThanOrEqual(2)
  })
})
