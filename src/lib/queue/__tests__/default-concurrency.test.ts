import { afterEach, describe, expect, it } from 'vitest'
import { UnifiedQueueManager } from '../unified-queue-manager'

const savedEnv = {
  REDIS_URL: process.env.REDIS_URL,
  QUEUE_GLOBAL_CONCURRENCY: process.env.QUEUE_GLOBAL_CONCURRENCY,
  QUEUE_PER_USER_CONCURRENCY: process.env.QUEUE_PER_USER_CONCURRENCY,
  QUEUE_OFFER_EXTRACTION_CONCURRENCY: process.env.QUEUE_OFFER_EXTRACTION_CONCURRENCY,
  QUEUE_CLICK_FARM_CONCURRENCY: process.env.QUEUE_CLICK_FARM_CONCURRENCY,
  QUEUE_CLICK_FARM_CONCURRENCY_HARD_CAP: process.env.QUEUE_CLICK_FARM_CONCURRENCY_HARD_CAP,
  QUEUE_CLICK_FARM_BATCH_CONCURRENCY_HARD_CAP: process.env.QUEUE_CLICK_FARM_BATCH_CONCURRENCY_HARD_CAP,
  QUEUE_CLICK_FARM_TRIGGER_CONCURRENCY_HARD_CAP: process.env.QUEUE_CLICK_FARM_TRIGGER_CONCURRENCY_HARD_CAP,
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
    delete process.env.QUEUE_CLICK_FARM_CONCURRENCY
    delete process.env.QUEUE_CLICK_FARM_CONCURRENCY_HARD_CAP
    delete process.env.QUEUE_CLICK_FARM_BATCH_CONCURRENCY_HARD_CAP
    delete process.env.QUEUE_CLICK_FARM_TRIGGER_CONCURRENCY_HARD_CAP
    delete process.env.QUEUE_URL_SWAP_CONCURRENCY

    const queue = new UnifiedQueueManager({ redisUrl: undefined })
    const config = queue.getConfig()

    expect(config.globalConcurrency).toBeLessThanOrEqual(10)
    expect(config.perUserConcurrency).toBeLessThanOrEqual(5)
    expect(config.perTypeConcurrency['offer-extraction']).toBeLessThanOrEqual(2)
    expect(config.perTypeConcurrency['click-farm']).toBeLessThanOrEqual(3)
    expect(config.perTypeConcurrency['click-farm-batch']).toBeLessThanOrEqual(2)
    expect(config.perTypeConcurrency['click-farm-trigger']).toBeLessThanOrEqual(2)
    expect(config.perTypeConcurrency['url-swap']).toBeLessThanOrEqual(2)
  })

  it('preserves default task limits when a caller provides only partial per-type overrides', () => {
    delete process.env.REDIS_URL
    delete process.env.QUEUE_CLICK_FARM_CONCURRENCY
    delete process.env.QUEUE_CLICK_FARM_CONCURRENCY_HARD_CAP

    const queue = new UnifiedQueueManager({
      redisUrl: undefined,
      perTypeConcurrency: {
        'click-farm': 2,
      },
    })
    const config = queue.getConfig()

    expect(config.perTypeConcurrency['click-farm']).toBe(2)
    expect(config.perTypeConcurrency['offer-extraction']).toBeDefined()
    expect(config.perTypeConcurrency['campaign-publish']).toBeDefined()
    expect(config.perTypeConcurrency['url-swap']).toBeDefined()
  })
})
