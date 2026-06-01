import { describe, expect, it } from 'vitest'
import { mergeQueueConfig } from '../persisted-config'
import type { QueueConfig } from '../types'

describe('mergeQueueConfig', () => {
  it('lets persisted database config override unsafe startup env config while preserving unspecified task limits', () => {
    const startupConfig = {
      globalConcurrency: 25,
      perUserConcurrency: 3,
      perTypeConcurrency: {
        'offer-extraction': 20,
        'click-farm': 4,
        'url-swap': 2,
        'campaign-publish': 2,
      },
      taskTimeout: 900000,
    } as Partial<QueueConfig>

    const persistedConfig = {
      globalConcurrency: 4,
      perUserConcurrency: 2,
      perTypeConcurrency: {
        'offer-extraction': 1,
        'click-farm': 2,
        'url-swap': 1,
      },
      retryDelay: 15000,
    } as Partial<QueueConfig>

    const merged = mergeQueueConfig(startupConfig, persistedConfig)

    expect(merged.globalConcurrency).toBe(4)
    expect(merged.perUserConcurrency).toBe(2)
    expect(merged.perTypeConcurrency?.['offer-extraction']).toBe(1)
    expect(merged.perTypeConcurrency?.['click-farm']).toBe(2)
    expect(merged.perTypeConcurrency?.['url-swap']).toBe(1)
    expect(merged.perTypeConcurrency?.['campaign-publish']).toBe(2)
    expect(merged.taskTimeout).toBe(900000)
    expect(merged.retryDelay).toBe(15000)
  })
})
