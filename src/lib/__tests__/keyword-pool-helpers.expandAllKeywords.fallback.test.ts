import { describe, it, expect, vi } from 'vitest'
import type { PoolKeywordData } from '../offer-keyword-pool'

// Avoid native bcrypt binary issues in test environments (arch mismatch).
vi.mock('bcrypt', () => {
  const stub = {
    hash: async () => 'stub-hash',
    compare: async () => true,
  }
  return { default: stub, ...stub }
})

describe('keyword-pool-helpers.expandAllKeywords (OAuth fallback)', () => {
  it('falls back to initialKeywords when customerId is missing (prevents empty pool)', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [
      { keyword: 'midland', searchVolume: 0, source: 'TEST', matchType: 'BROAD' },
      { keyword: 'midland weather radio', searchVolume: 0, source: 'TEST', matchType: 'BROAD' },
    ]

    const out = await expandAllKeywords(
      initial,
      'Midland',
      'Weather Radios',
      'US',
      'English',
      'oauth',
      undefined,
      62,
      undefined // customerId missing
    )

    expect(out.map(k => k.keyword)).toEqual(initial.map(k => k.keyword))
  })

  it('falls back to pure brand keywords when initialKeywords is empty', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const out = await expandAllKeywords(
      [],
      'Midland',
      'Weather Radios',
      'US',
      'English',
      'oauth',
      undefined,
      62,
      undefined // customerId missing
    )

    expect(out.length).toBeGreaterThan(0)
    expect(out.map(k => k.keyword.toLowerCase())).toContain('midland')
  })
})
