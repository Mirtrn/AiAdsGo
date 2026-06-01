import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../concurrency-limit'

describe('mapWithConcurrency', () => {
  it('keeps result order while limiting active work', async () => {
    let active = 0
    let maxActive = 0

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return value * 10
    })

    expect(results).toEqual([10, 20, 30, 40, 50])
    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
