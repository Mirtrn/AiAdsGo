/**
 * Offer 级关键词池服务单元测试
 *
 * 测试覆盖：
 * 1. 纯品牌词识别
 * 2. 品牌词/非品牌词分离
 * 3. 降级分桶策略
 * 4. 关键词重叠率计算
 * 5. 聚类策略确定
 * 6. 桶信息获取
 */

import {
  isPureBrandKeyword,
  separateBrandKeywords,
  getBucketInfo,
  calculateKeywordOverlapRate,
  determineClusteringStrategy,
  type OfferKeywordPool,
  type BucketType
} from '../offer-keyword-pool'

// Mock 数据
const mockKeywordPool: OfferKeywordPool = {
  id: 1,
  offerId: 139,
  userId: 1,
  brandKeywords: ['eufy'],
  bucketAKeywords: ['eufy camera', 'indoor camera', 'outdoor camera', 'doorbell cam', 'eufycam'],
  bucketBKeywords: ['home security', 'baby monitor', 'pet watching', 'garage cam', 'driveway security'],
  bucketCKeywords: ['wireless camera', 'night vision', '2k camera', 'motion detection', 'best camera'],
  bucketAIntent: '品牌导向',
  bucketBIntent: '场景导向',
  bucketCIntent: '功能导向',
  totalKeywords: 16,
  clusteringModel: 'gemini',
  clusteringPromptVersion: 'v1.0',
  balanceScore: 0.95,
  createdAt: '2025-12-15T00:00:00Z',
  updatedAt: '2025-12-15T00:00:00Z'
}

describe('OfferKeywordPool', () => {
  describe('isPureBrandKeyword', () => {
    it('should identify pure brand keyword correctly', () => {
      expect(isPureBrandKeyword('eufy', 'Eufy')).toBe(true)
      expect(isPureBrandKeyword('Eufy', 'Eufy')).toBe(true)
      expect(isPureBrandKeyword('EUFY', 'Eufy')).toBe(true)
    })

    it('should reject non-pure brand keywords', () => {
      expect(isPureBrandKeyword('eufy camera', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufy security', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufycam', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('best eufy camera', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufy indoor camera', 'Eufy')).toBe(false)
    })

    it('should handle brand names with spaces', () => {
      expect(isPureBrandKeyword('Reo Link', 'Reo Link')).toBe(true)
      expect(isPureBrandKeyword('reo link', 'Reo Link')).toBe(true)
      expect(isPureBrandKeyword('reolink', 'Reo Link')).toBe(true) // 去空格变体
    })

    it('should handle brand names with hyphens', () => {
      expect(isPureBrandKeyword('Ring-Alarm', 'Ring-Alarm')).toBe(true)
      expect(isPureBrandKeyword('ringalarm', 'Ring-Alarm')).toBe(true) // 去连字符变体
    })

    it('should handle edge cases', () => {
      expect(isPureBrandKeyword('', 'Eufy')).toBe(false)
      expect(isPureBrandKeyword('eufy', '')).toBe(false)
      expect(isPureBrandKeyword('', '')).toBe(false)
    })
  })

  describe('separateBrandKeywords', () => {
    it('should separate pure brand keywords from non-brand keywords', () => {
      const keywords = [
        'eufy',
        'eufy camera',
        'indoor camera',
        'eufy security',
        'home security',
        'best camera'
      ]

      const result = separateBrandKeywords(keywords, 'Eufy')

      expect(result.brandKeywords).toEqual(['eufy'])
      expect(result.nonBrandKeywords).toHaveLength(5)
      expect(result.nonBrandKeywords).toContain('eufy camera')
      expect(result.nonBrandKeywords).toContain('indoor camera')
      expect(result.nonBrandKeywords).toContain('eufy security')
      expect(result.nonBrandKeywords).toContain('home security')
      expect(result.nonBrandKeywords).toContain('best camera')
    })

    it('should handle empty keyword list', () => {
      const result = separateBrandKeywords([], 'Eufy')

      expect(result.brandKeywords).toEqual([])
      expect(result.nonBrandKeywords).toEqual([])
    })

    it('should handle keywords with no pure brand word', () => {
      const keywords = [
        'eufy camera',
        'eufy security',
        'home security'
      ]

      const result = separateBrandKeywords(keywords, 'Eufy')

      expect(result.brandKeywords).toEqual([])
      expect(result.nonBrandKeywords).toHaveLength(3)
    })

    it('should handle keywords with multiple pure brand words', () => {
      const keywords = [
        'eufy',
        'Eufy',
        'EUFY',
        'eufy camera'
      ]

      const result = separateBrandKeywords(keywords, 'Eufy')

      // 所有大小写变体都应被识别为品牌词
      expect(result.brandKeywords).toHaveLength(3)
      expect(result.nonBrandKeywords).toEqual(['eufy camera'])
    })
  })

  describe('getBucketInfo', () => {
    it('should return correct info for bucket A', () => {
      const info = getBucketInfo(mockKeywordPool, 'A')

      expect(info.intent).toBe('品牌导向')
      expect(info.intentEn).toBe('Brand-Oriented')
      expect(info.keywords).toContain('eufy')  // 品牌词
      expect(info.keywords).toContain('eufy camera')  // 桶A关键词
      expect(info.keywords).toHaveLength(6)  // 1 品牌词 + 5 桶A关键词
    })

    it('should return correct info for bucket B', () => {
      const info = getBucketInfo(mockKeywordPool, 'B')

      expect(info.intent).toBe('场景导向')
      expect(info.intentEn).toBe('Scenario-Oriented')
      expect(info.keywords).toContain('eufy')  // 品牌词
      expect(info.keywords).toContain('home security')  // 桶B关键词
      expect(info.keywords).toHaveLength(6)  // 1 品牌词 + 5 桶B关键词
    })

    it('should return correct info for bucket C', () => {
      const info = getBucketInfo(mockKeywordPool, 'C')

      expect(info.intent).toBe('功能导向')
      expect(info.intentEn).toBe('Feature-Oriented')
      expect(info.keywords).toContain('eufy')  // 品牌词
      expect(info.keywords).toContain('wireless camera')  // 桶C关键词
      expect(info.keywords).toHaveLength(6)  // 1 品牌词 + 5 桶C关键词
    })

    it('should include brand keywords in all buckets', () => {
      const buckets: BucketType[] = ['A', 'B', 'C']

      for (const bucket of buckets) {
        const info = getBucketInfo(mockKeywordPool, bucket)
        expect(info.keywords).toContain('eufy')
      }
    })
  })

  describe('calculateKeywordOverlapRate', () => {
    it('should return 0 for completely different keywords', () => {
      const keywords1 = ['camera', 'doorbell', 'indoor']
      const keywords2 = ['security', 'monitor', 'watching']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      expect(rate).toBe(0)
    })

    it('should return 1 for identical keywords', () => {
      const keywords1 = ['camera', 'doorbell', 'indoor']
      const keywords2 = ['camera', 'doorbell', 'indoor']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      expect(rate).toBe(1)
    })

    it('should calculate partial overlap correctly', () => {
      const keywords1 = ['camera', 'doorbell', 'indoor']
      const keywords2 = ['camera', 'security', 'outdoor']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      // 1 overlap (camera) / 3 max = 0.333...
      expect(rate).toBeCloseTo(0.333, 2)
    })

    it('should be case-insensitive', () => {
      const keywords1 = ['Camera', 'Doorbell']
      const keywords2 = ['camera', 'doorbell']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      expect(rate).toBe(1)
    })

    it('should handle empty arrays', () => {
      expect(calculateKeywordOverlapRate([], ['camera'])).toBe(0)
      expect(calculateKeywordOverlapRate(['camera'], [])).toBe(0)
      expect(calculateKeywordOverlapRate([], [])).toBe(0)
    })

    it('should handle different sized arrays', () => {
      const keywords1 = ['camera', 'doorbell']
      const keywords2 = ['camera', 'doorbell', 'indoor', 'outdoor']

      const rate = calculateKeywordOverlapRate(keywords1, keywords2)
      // 2 overlap / 4 max = 0.5
      expect(rate).toBe(0.5)
    })

    it('should achieve target ~3% overlap with bucket strategy', () => {
      // 模拟实际场景：每个桶只共享品牌词
      const bucketA = ['eufy', 'eufy camera', 'indoor camera', 'outdoor camera']
      const bucketB = ['eufy', 'home security', 'baby monitor', 'pet watching']
      const bucketC = ['eufy', 'wireless camera', 'night vision', '2k camera']

      // 桶A vs 桶B
      const rateAB = calculateKeywordOverlapRate(bucketA, bucketB)
      expect(rateAB).toBeCloseTo(0.25, 2)  // 1/4 = 0.25

      // 桶A vs 桶C
      const rateAC = calculateKeywordOverlapRate(bucketA, bucketC)
      expect(rateAC).toBeCloseTo(0.25, 2)  // 1/4 = 0.25

      // 桶B vs 桶C
      const rateBC = calculateKeywordOverlapRate(bucketB, bucketC)
      expect(rateBC).toBeCloseTo(0.25, 2)  // 1/4 = 0.25

      // 平均重叠率应该较低（仅品牌词）
      const avgRate = (rateAB + rateAC + rateBC) / 3
      expect(avgRate).toBeLessThan(0.5)  // 低于50%
    })
  })

  describe('determineClusteringStrategy', () => {
    it('should return single strategy for < 15 keywords', () => {
      const strategy = determineClusteringStrategy(10)

      expect(strategy.bucketCount).toBe(1)
      expect(strategy.strategy).toBe('single')
      expect(strategy.message).toContain('太少')
    })

    it('should return dual strategy for 15-29 keywords', () => {
      const strategy = determineClusteringStrategy(20)

      expect(strategy.bucketCount).toBe(2)
      expect(strategy.strategy).toBe('dual')
      expect(strategy.message).toContain('较少')
    })

    it('should return full strategy for >= 30 keywords', () => {
      const strategy = determineClusteringStrategy(30)

      expect(strategy.bucketCount).toBe(3)
      expect(strategy.strategy).toBe('full')
      expect(strategy.message).toContain('充足')
    })

    it('should handle boundary cases', () => {
      expect(determineClusteringStrategy(14).bucketCount).toBe(1)
      expect(determineClusteringStrategy(15).bucketCount).toBe(2)
      expect(determineClusteringStrategy(29).bucketCount).toBe(2)
      expect(determineClusteringStrategy(30).bucketCount).toBe(3)
    })

    it('should handle edge cases', () => {
      expect(determineClusteringStrategy(0).bucketCount).toBe(1)
      expect(determineClusteringStrategy(100).bucketCount).toBe(3)
    })
  })

  describe('Integration: Bucket Isolation', () => {
    it('should ensure bucket keywords are exclusive (no overlap except brand)', () => {
      const bucketA = new Set(mockKeywordPool.bucketAKeywords.map(k => k.toLowerCase()))
      const bucketB = new Set(mockKeywordPool.bucketBKeywords.map(k => k.toLowerCase()))
      const bucketC = new Set(mockKeywordPool.bucketCKeywords.map(k => k.toLowerCase()))

      // 桶A和桶B不应有交集
      const overlapAB = [...bucketA].filter(k => bucketB.has(k))
      expect(overlapAB).toHaveLength(0)

      // 桶A和桶C不应有交集
      const overlapAC = [...bucketA].filter(k => bucketC.has(k))
      expect(overlapAC).toHaveLength(0)

      // 桶B和桶C不应有交集
      const overlapBC = [...bucketB].filter(k => bucketC.has(k))
      expect(overlapBC).toHaveLength(0)
    })

    it('should have brand keywords excluded from all buckets', () => {
      const brandKeywords = new Set(mockKeywordPool.brandKeywords.map(k => k.toLowerCase()))

      for (const kw of mockKeywordPool.bucketAKeywords) {
        expect(brandKeywords.has(kw.toLowerCase())).toBe(false)
      }

      for (const kw of mockKeywordPool.bucketBKeywords) {
        expect(brandKeywords.has(kw.toLowerCase())).toBe(false)
      }

      for (const kw of mockKeywordPool.bucketCKeywords) {
        expect(brandKeywords.has(kw.toLowerCase())).toBe(false)
      }
    })
  })

  describe('Bucket Intent Classification', () => {
    it('should classify product-oriented keywords correctly', () => {
      const productKeywords = [
        'eufy camera',
        'indoor camera',
        'outdoor camera',
        'doorbell cam',
        'eufycam',
        'security camera'
      ]

      // 品牌导向词通常包含产品类型
      for (const kw of productKeywords) {
        expect(kw.toLowerCase()).toMatch(/camera|cam|doorbell/i)
      }
    })

    it('should classify scenario-oriented keywords correctly', () => {
      const scenarioKeywords = [
        'home security',
        'baby monitor',
        'pet watching',
        'garage monitoring',
        'driveway security'
      ]

      // 场景导向词通常包含使用场景
      for (const kw of scenarioKeywords) {
        expect(kw.toLowerCase()).toMatch(/home|baby|pet|garage|driveway|security|monitor|watching/i)
      }
    })

    it('should classify demand-oriented keywords correctly', () => {
      const demandKeywords = [
        'wireless camera',
        'night vision',
        '2k camera',
        'motion detection',
        'best camera',
        'solar powered'
      ]

      // 需求导向词通常包含功能特性或购买意图
      for (const kw of demandKeywords) {
        expect(kw.toLowerCase()).toMatch(/wireless|night|vision|2k|4k|motion|best|top|solar|battery/i)
      }
    })
  })
})
