import { describe, expect, it } from 'vitest'
import { filterKeywordQuality, isBrandVariant } from '../keyword-quality-filter'

describe('keyword-quality-filter', () => {
  describe('isBrandVariant', () => {
    it('should treat concatenated suffix as brand variant', () => {
      expect(isBrandVariant('eurekaddl', 'eureka')).toBe(true)
      expect(isBrandVariant('EURekaDDL', 'Eureka')).toBe(true)
    })

    it('should not treat spaced/hyphenated brand+product terms as variants', () => {
      expect(isBrandVariant('auxito led', 'auxito')).toBe(false)
      expect(isBrandVariant('auxito led lights', 'auxito')).toBe(false)
      expect(isBrandVariant('auxito-led', 'auxito')).toBe(false)
      expect(isBrandVariant('auxito_led', 'auxito')).toBe(false)
      expect(isBrandVariant('eureka j15', 'eureka')).toBe(false)
      expect(isBrandVariant('eureka-j15', 'eureka')).toBe(false)
    })
  })

  describe('filterKeywordQuality', () => {
    it('should keep valid brand+product keywords (regression)', () => {
      const input = [
        { keyword: 'auxito', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
        { keyword: 'auxito led', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
        { keyword: 'auxito led lights', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
        { keyword: 'auxito led headlights', searchVolume: 1000, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, { brandName: 'auxito', mustContainBrand: true })
      expect(result.removed).toHaveLength(0)
      expect(result.filtered.map(k => k.keyword)).toEqual([
        'auxito',
        'auxito led',
        'auxito led lights',
        'auxito led headlights',
      ])
    })
  })
})

