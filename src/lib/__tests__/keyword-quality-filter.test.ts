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

    it('should remove ambiguous-brand unrelated topics when context filter enabled', () => {
      const input = [
        { keyword: 'rove', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove r2 4k', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove r2 4k dash cam', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove beetle larvae', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove concept', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'rove concept miami', searchVolume: 0, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Rove',
        category: 'On-Dash Cameras',
        productName: 'ROVE R2-4K DUAL Dash Cam Front and Rear',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'rove',
        'rove r2 4k',
        'rove r2 4k dash cam',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'rove beetle larvae',
        'rove concept',
        'rove concept miami',
      ])
    })

    it('should enforce context relevance even for high-volume ambiguous-brand keywords', () => {
      const input = [
        { keyword: 'moes', searchVolume: 450000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes sprinkler timer', searchVolume: 12000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes cafe', searchVolume: 3600, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes tacos', searchVolume: 1300, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes barbeque', searchVolume: 33100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes sw grill menu', searchVolume: 49500, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Moes',
        category: 'Hose Timers',
        productName: 'MOES 3 Outlet Sprinkler Timer',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'moes',
        'moes sprinkler timer',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'moes cafe',
        'moes tacos',
        'moes barbeque',
        'moes sw grill menu',
      ])
      expect(result.removed.every(r => r.reason.includes('与商品无关'))).toBe(true)
    })

    it('should keep audio synonym variants for context relevance', () => {
      const input = [
        { keyword: 'sonos', searchVolume: 246000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos speaker', searchVolume: 49500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos soundbar', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos jobs', searchVolume: 3600, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Sonos',
        category: 'Wireless Home Audio Systems',
        productName: 'SONOS Arc',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'sonos',
        'sonos speaker',
        'sonos soundbar',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['sonos jobs'])
    })

    it('should rescue short model terms when supported by multiple kept context keywords', () => {
      const input = [
        { keyword: 'sonos', searchVolume: 246000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos arc soundbar', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos arc surround sound', searchVolume: 6600, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos beam soundbar', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos beam surround sound', searchVolume: 4400, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos arc', searchVolume: 40500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'sonos beam', searchVolume: 14800, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'ikea sonos', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Sonos',
        category: 'Wireless Home Audio Systems',
        productName: 'Home sound system',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'sonos',
        'sonos arc soundbar',
        'sonos arc surround sound',
        'sonos beam soundbar',
        'sonos beam surround sound',
        'sonos arc',
        'sonos beam',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['ikea sonos'])
    })

    it('should not restore visual-noise keywords via context support fallback', () => {
      const input = [
        { keyword: 'running girl sports bra purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl sports bras purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl bra purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl sports bra buy', searchVolume: 0, source: 'KEYWORD_POOL' as const },
        { keyword: 'running girl gif purchase', searchVolume: 0, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Running Girl',
        category: 'Sports Bras',
        productName: 'RUNNING GIRL Sports Bras for Women Seamless Padded Yoga Bra',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'running girl sports bra purchase',
        'running girl sports bras purchase',
        'running girl bra purchase',
        'running girl sports bra buy',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['running girl gif purchase'])
    })

    it('should keep robotic vacuum variants like robovac', () => {
      const input = [
        { keyword: 'eufy', searchVolume: 60500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy robovac', searchVolume: 14800, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy robot vacuum', searchVolume: 9900, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy vacuum cleaner', searchVolume: 5400, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'eufy security camera', searchVolume: 6600, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Eufy',
        category: 'Robotic Vacuum Cleaners',
        productName: 'Eufy X10 Pro Omni',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'eufy',
        'eufy robovac',
        'eufy robot vacuum',
        'eufy vacuum cleaner',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual(['eufy security camera'])
    })

    it('should restore limited commercial terms when context filter removes almost all candidates', () => {
      const input = [
        { keyword: 'acme', searchVolume: 9000, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme charger', searchVolume: 2400, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme charging adapter', searchVolume: 1800, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme powerbank', searchVolume: 1200, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme cafe', searchVolume: 1500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'acme food', searchVolume: 1300, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Acme',
        category: 'Portable Energy Devices',
        productName: 'Acme Home Battery Station',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'acme',
        'acme charger',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'acme charging adapter',
        'acme powerbank',
        'acme cafe',
        'acme food',
      ])
    })

    it('should skip context gating when context is placeholder text', () => {
      const input = [
        { keyword: 'anker charger power bank', searchVolume: 90500, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'anker portable charger', searchVolume: 27100, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'anker nano power bank', searchVolume: 18100, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Anker',
        category: 'Data not available',
        productName: undefined,
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'anker charger power bank',
        'anker portable charger',
        'anker nano power bank',
      ])
      expect(result.removed).toHaveLength(0)
    })

    it('should not over-filter when context signals are insufficient', () => {
      const input = [
        { keyword: 'moes tacos', searchVolume: 1300, source: 'KEYWORD_PLANNER' as const },
        { keyword: 'moes cafe', searchVolume: 3600, source: 'KEYWORD_PLANNER' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Moes',
        category: 'Timer',
        productName: 'MOES Device',
        mustContainBrand: true,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'moes tacos',
        'moes cafe',
      ])
      expect(result.removed).toHaveLength(0)
    })

    it('should remove cross-category terms even when non-brand keywords are allowed', () => {
      const input = [
        { keyword: 'lampick', searchVolume: 50, source: 'KEYWORD_POOL' as const },
        { keyword: 'hair dryer', searchVolume: 90500, source: 'KEYWORD_POOL' as const },
        { keyword: 'best blow dryer', searchVolume: 6600, source: 'KEYWORD_POOL' as const },
        { keyword: 'cheap blender', searchVolume: 74000, source: 'KEYWORD_POOL' as const },
        { keyword: 'smoothie blender', searchVolume: 12100, source: 'KEYWORD_POOL' as const },
      ]

      const result = filterKeywordQuality(input, {
        brandName: 'Lampick',
        category: 'Hair Dryers',
        productName: 'Lampick Ionic Hair Dryer',
        mustContainBrand: false,
        minContextTokenMatches: 1,
      })

      expect(result.filtered.map(k => k.keyword)).toEqual([
        'lampick',
        'hair dryer',
        'best blow dryer',
      ])
      expect(result.removed.map(r => r.keyword.keyword)).toEqual([
        'cheap blender',
        'smoothie blender',
      ])
    })
  })
})
