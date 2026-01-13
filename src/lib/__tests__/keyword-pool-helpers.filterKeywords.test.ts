import { describe, it, expect } from 'vitest'
import { filterKeywords } from '../keyword-pool-helpers'
import type { PoolKeywordData } from '../offer-keyword-pool'

describe('keyword-pool-helpers.filterKeywords', () => {
  it('filters out high-volume generic keywords when category/product tokens exist', () => {
    const input: PoolKeywordData[] = [
      { keyword: 'bettabot', searchVolume: 0, source: 'TEST' },
      { keyword: 'robot vacuum', searchVolume: 20000, source: 'TEST' },
      { keyword: 'betta fish', searchVolume: 50000, source: 'TEST' },
      { keyword: 'betta fish tank', searchVolume: 30000, source: 'TEST' },
    ]

    const out = filterKeywords(input, 'Bettabot', 'robot vacuum cleaner', 'US', 'Bettabot X1 robot vacuum cleaner')
    const texts = out.map(k => k.keyword.toLowerCase())

    expect(texts).toContain('bettabot')
    expect(texts).toContain('robot vacuum')
    expect(texts).not.toContain('betta fish')
    expect(texts).not.toContain('betta fish tank')
  })

  it('keeps top high-volume category keywords when no relevance tokens are available', () => {
    const input: PoolKeywordData[] = [
      { keyword: 'brandx', searchVolume: 0, source: 'TEST' },
      { keyword: 'betta fish', searchVolume: 50000, source: 'TEST' },
      { keyword: 'dog food', searchVolume: 40000, source: 'TEST' },
      { keyword: 'cat toy', searchVolume: 30000, source: 'TEST' },
      { keyword: 'random thing', searchVolume: 20000, source: 'TEST' },
    ]

    const out = filterKeywords(input, 'BrandX', '', 'US', null)
    const texts = out.map(k => k.keyword.toLowerCase())

    expect(texts).toContain('brandx')
    expect(texts).toContain('betta fish')
    expect(texts).toContain('dog food')
    expect(texts).toContain('cat toy')
    expect(texts).not.toContain('random thing')
  })
})

