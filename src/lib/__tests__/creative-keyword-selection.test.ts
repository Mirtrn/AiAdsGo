import { describe, expect, it } from 'vitest'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  CREATIVE_KEYWORD_MAX_WORDS,
  selectCreativeKeywords,
} from '../creative-keyword-selection'

describe('creative-keyword-selection', () => {
  it('caps total creative keywords to 50', () => {
    const keywordsWithVolume = Array.from({ length: 80 }, (_, index) => ({
      keyword: `brandx keyword ${index + 1}`,
      searchVolume: 1000 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume,
      brandName: 'BrandX',
    })

    expect(result.keywordsWithVolume).toHaveLength(CREATIVE_KEYWORD_MAX_COUNT)
    expect(result.keywords).toHaveLength(CREATIVE_KEYWORD_MAX_COUNT)
    expect(result.truncated).toBe(true)
  })

  it('reserves at least 10 branded slots when available', () => {
    const brandKeywords = Array.from({ length: 12 }, (_, index) => ({
      keyword: `brandx model ${index + 1}`,
      searchVolume: 10,
      source: 'AI_GENERATED',
      matchType: 'PHRASE' as const,
    }))
    const nonBrandKeywords = Array.from({ length: 70 }, (_, index) => ({
      keyword: `generic landscape light ${index + 1}`,
      searchVolume: 10000 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...brandKeywords, ...nonBrandKeywords],
      brandName: 'BrandX',
    })

    const brandedCount = result.keywords.filter(keyword => keyword.toLowerCase().includes('brandx')).length
    expect(brandedCount).toBeGreaterThanOrEqual(CREATIVE_BRAND_KEYWORD_RESERVE)
  })

  it('deduplicates normalized keyword variants', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'BrandX-Laser', searchVolume: 100, source: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'brandx laser', searchVolume: 200, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
        { keyword: 'brandx_laser', searchVolume: 150, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
    })

    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywords[0].toLowerCase()).toContain('brandx')
  })

  it('prefers higher-priority source for equal keyword', () => {
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: 'brandx spotlight', searchVolume: 20, source: 'AI_GENERATED', matchType: 'PHRASE' },
        { keyword: 'brandx spotlight', searchVolume: 20, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'BrandX',
    })

    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywordsWithVolume[0].source).toBe('KEYWORD_POOL')
  })

  it('drops keywords exceeding global max word count', () => {
    const tooLongKeyword = 'ninja bn401 nutri pro compact personal blender auto iq technology 1100 peak watts for frozen drinks smoothies sauces'
    const result = selectCreativeKeywords({
      keywordsWithVolume: [
        { keyword: tooLongKeyword, searchVolume: 120000, source: 'KEYWORD_POOL', matchType: 'EXACT' },
        { keyword: 'lampick hair dryer', searchVolume: 4000, source: 'KEYWORD_POOL', matchType: 'PHRASE' },
      ],
      brandName: 'Lampick',
    })

    expect(result.keywords).toContain('lampick hair dryer')
    expect(result.keywords).not.toContain(tooLongKeyword)
    expect(
      result.keywords.every(keyword => keyword.trim().split(/\s+/).filter(Boolean).length <= CREATIVE_KEYWORD_MAX_WORDS)
    ).toBe(true)
  })

  it('enforces at least 10 branded keywords by synthesizing from non-brand candidates', () => {
    const brandedSeed = [{
      keyword: 'lampick hair dryer',
      searchVolume: 5000,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }]
    const nonBrandKeywords = Array.from({ length: 30 }, (_, index) => ({
      keyword: `hair dryer ${index + 1}`,
      searchVolume: 3000 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...brandedSeed, ...nonBrandKeywords],
      brandName: 'Lampick',
      maxKeywords: 30,
      minBrandKeywords: 10,
    })

    const brandedCount = result.keywords.filter(keyword => keyword.toLowerCase().includes('lampick')).length
    expect(brandedCount).toBeGreaterThanOrEqual(10)
    expect(
      result.keywords.every(keyword => keyword.trim().split(/\s+/).filter(Boolean).length <= CREATIVE_KEYWORD_MAX_WORDS)
    ).toBe(true)
  })

  it('supports brand-only mode and emits only branded keywords', () => {
    const brandKeywords = [
      { keyword: 'lampick hair dryer', searchVolume: 5000, source: 'KEYWORD_POOL', matchType: 'PHRASE' as const },
      { keyword: 'lampick ionic dryer', searchVolume: 4200, source: 'KEYWORD_POOL', matchType: 'PHRASE' as const },
    ]
    const nonBrandKeywords = Array.from({ length: 20 }, (_, index) => ({
      keyword: `hair dryer ${index + 1}`,
      searchVolume: 3500 - index,
      source: 'KEYWORD_POOL',
      matchType: 'PHRASE' as const,
    }))

    const result = selectCreativeKeywords({
      keywordsWithVolume: [...brandKeywords, ...nonBrandKeywords],
      brandName: 'Lampick',
      maxKeywords: 12,
      brandOnly: true,
    })

    expect(result.keywordsWithVolume).toHaveLength(12)
    expect(result.keywords.every(keyword => keyword.toLowerCase().includes('lampick'))).toBe(true)
  })
})
