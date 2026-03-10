import { filterKeywordQuality } from '../keyword-quality-filter'
import type { PoolKeywordData } from '../offer-keyword-pool'

describe('filterKeywordQuality - High Performing Search Terms', () => {
  it('should NOT filter high-performing search terms even without brand', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'best solar lights outdoor',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'cheap solar lights', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: true, // 要求必须包含品牌
      minWordCount: 1,
      maxWordCount: 8
    })

    // 高性能搜索词应该保留（即使不含品牌）
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0].keyword).toBe('best solar lights outdoor')

    // 普通关键词应该被过滤（不含品牌）
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].keyword.keyword).toBe('cheap solar lights')
  })

  it('should NOT filter high-performing search terms with semantic query words', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'solar lights review',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'solar lights comparison', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: false,
      minWordCount: 1,
      maxWordCount: 8
    })

    // 高性能搜索词应该保留（即使包含 "review"）
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0].keyword).toBe('solar lights review')

    // 普通关键词应该被过滤（包含 "comparison"）
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].keyword.keyword).toBe('solar lights comparison')
  })

  it('should NOT filter high-performing search terms with "free" or "cheap"', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'free solar lights',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'cheap solar lights',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'discount solar lights', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: false,
      minWordCount: 1,
      maxWordCount: 8
    })

    // 高性能搜索词应该全部保留
    expect(result.filtered).toHaveLength(2)
    expect(result.filtered.map(k => k.keyword)).toContain('free solar lights')
    expect(result.filtered.map(k => k.keyword)).toContain('cheap solar lights')

    // 普通关键词应该被过滤
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].keyword.keyword).toBe('discount solar lights')
  })

  it('should NOT filter high-performing search terms exceeding word count', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'best outdoor solar lights for garden path and driveway',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'outdoor solar lights for garden path and driveway', // 普通关键词，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: false,
      minWordCount: 1,
      maxWordCount: 5 // 限制最多5个单词
    })

    // 高性能搜索词应该保留（即使超过5个单词）
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0].keyword).toBe('best outdoor solar lights for garden path and driveway')

    // 普通关键词应该被过滤（超过5个单词）
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].reason).toContain('单词数不匹配')
  })

  it('should preserve high-performing search terms in mixed keyword list', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'SolarBrand lights',
        searchVolume: 1000,
        source: 'KEYWORD_POOL',
        priority: 'HIGH'
      },
      {
        keyword: 'best solar lights',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'solar lights review',
        searchVolume: 0,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH'
      },
      {
        keyword: 'cheap lights', // 不含品牌，会被过滤
        searchVolume: 0,
        source: 'AI_ENHANCED',
        priority: 'MEDIUM'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: true,
      minWordCount: 1,
      maxWordCount: 8
    })

    // 应该保留：品牌词 + 2个高性能搜索词
    expect(result.filtered).toHaveLength(3)
    expect(result.filtered.map(k => k.keyword)).toContain('SolarBrand lights')
    expect(result.filtered.map(k => k.keyword)).toContain('best solar lights')
    expect(result.filtered.map(k => k.keyword)).toContain('solar lights review')

    // 应该过滤：不含品牌的普通关键词
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].keyword.keyword).toBe('cheap lights')
  })

  it('should handle empty high-performing search terms list', () => {
    const keywords: PoolKeywordData[] = [
      {
        keyword: 'SolarBrand lights',
        searchVolume: 1000,
        source: 'KEYWORD_POOL',
        priority: 'HIGH'
      }
    ]

    const result = filterKeywordQuality(keywords, {
      brandName: 'SolarBrand',
      mustContainBrand: true,
      minWordCount: 1,
      maxWordCount: 8
    })

    expect(result.filtered).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })
})
