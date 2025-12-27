/**
 * 关键词质量过滤模块
 *
 * 职责：过滤低质量关键词，确保关键词与产品相关
 *
 * 过滤规则：
 * 1. 品牌变体词过滤：品牌名 + 随机字符后缀（如 eurekaddl）
 * 2. 语义查询词过滤：非购买意图的查询词（如 significato、serie）
 * 3. 产品类别验证：确保关键词与产品类别相关
 */

import type { PoolKeywordData } from './offer-keyword-pool'

// ============================================
// 语义查询词列表（需要过滤的关键词类型）
// ============================================

/**
 * 语义查询词模式（不区分大小写）
 * 这些词通常表示用户在进行信息查询，而非购买意图
 */
const SEMANTIC_QUERY_PATTERNS = [
  // 语义查询类（meaning, definition, what is...）
  'significato', 'meaning', 'definition', 'what is', 'cosa significa',
  'translate', 'translation', 'traduzione',

  // 媒体/娱乐类（TV series, shows...）
  'serie', 'series', 'tv', 'television', 'show', 'episode',
  'stagione', 'stagioni', 'netflix', 'streaming',

  // 历史/百科类
  'history', 'storia', 'wikipedia', 'wiki',

  // 地点/地名类
  'palace', 'hotel', 'spa', 'resort', 'restaurant',
  'location', 'where to', 'near me',

  // 教育/教程类
  'how to', 'tutorial', 'guide', 'manual', 'instructions',

  // 价格比较类（保留price/cost用于产品搜索，但过滤compare/review）
  'compare', 'comparison', 'versus', 'vs ',
  'review', 'reviews', 'rating', 'ratings',

  // 低转化意图词
  'free', 'cheap', 'cheapest', 'discount', 'coupon', 'code',
  'job', 'jobs', 'career', 'salary', 'employment', 'hiring',

  // 下载/软件类
  'download', 'software', 'app', 'apk', 'pdf', 'ebook', 'digital',

  // 二手/维修类
  'used', 'refurbished', 'repair', 'fix', 'broken', 'replacement',
  'parts', 'spare parts', 'manual', 'instructions',

  // DIY/自制类
  'diy', 'homemade', 'handmade', 'build your own', 'make your own',

  // 竞品平台
  'ebay', 'craigslist', 'alibaba', 'aliexpress', 'wish', 'amazon',
]

// ============================================
// 品牌变体词检测
// ============================================

/**
 * 检测是否为品牌变体词
 *
 * 品牌变体词特征：
 * - 品牌名 + 3个以上无意义字母后缀
 * - 例如：eureka + ddl = eurekaddl
 *
 * @param keyword - 关键词
 * @param brandName - 品牌名称
 * @returns 是否为品牌变体词
 */
export function isBrandVariant(keyword: string, brandName: string): boolean {
  if (!keyword || !brandName) return false

  const normalized = keyword.toLowerCase().trim()
  const brand = brandName.toLowerCase().trim()

  // 检查是否以品牌名开头
  if (!normalized.startsWith(brand)) {
    return false
  }

  // 提取品牌名后面的部分
  const suffix = normalized.slice(brand.length)

  // 如果后面没有内容，不是变体词
  if (!suffix) {
    return false
  }

  // 检查后缀是否都是字母
  if (!/^[a-z]+$/.test(suffix)) {
    return false // 包含数字或特殊字符，不算变体词
  }

  // 后缀长度 >= 3 且 <= 8，认为是变体词
  // 例如：eurekaddl (ddl=3), eurekajetpack (jetpack=8)
  const suffixLength = suffix.length
  return suffixLength >= 3 && suffixLength <= 10
}

/**
 * 从关键词中提取有效的品牌组合
 *
 * 例如：
 * - eurekaddl → eureka
 * - eureka-j15 → eureka, j15
 * - eureka j15 pro → eureka, j15
 *
 * @param keyword - 关键词
 * @param brandName - 品牌名称
 * @returns 有效的品牌相关词组
 */
export function extractValidBrandTerms(keyword: string, brandName: string): string[] {
  const normalized = keyword.toLowerCase().trim()
  const brand = brandName.toLowerCase().trim()
  const terms: string[] = []

  // 1. 检查是否包含品牌名
  if (normalized.includes(brand)) {
    terms.push(brand)
  }

  // 2. 提取产品型号（常见的模式）
  // 例如：j15, j15 pro, j20, ne20s, e20s 等
  const modelPatterns = [
    /([a-z]?\d{1,2}[a-z]*(?:\s+(?:pro|ultra|max|plus))?)/gi,
    /([a-z]{1,2}\d{2}[a-z]*)/gi,
  ]

  for (const pattern of modelPatterns) {
    const matches = keyword.match(pattern)
    if (matches) {
      for (const match of matches) {
        const cleaned = match.toLowerCase().trim()
        if (cleaned.length >= 2 && cleaned !== brand && !terms.includes(cleaned)) {
          terms.push(cleaned)
        }
      }
    }
  }

  return [...new Set(terms)]
}

// ============================================
// 语义查询词检测
// ============================================

/**
 * 检测是否为语义查询词
 *
 * @param keyword - 关键词
 * @returns 是否为语义查询词
 */
export function isSemanticQuery(keyword: string): boolean {
  if (!keyword) return false

  const normalized = keyword.toLowerCase()

  // 检查是否匹配任一语义查询模式
  return SEMANTIC_QUERY_PATTERNS.some(pattern => {
    // 完整词匹配或边界匹配
    const regex = new RegExp(`\\b${pattern}\\b`, 'i')
    return regex.test(normalized)
  })
}

/**
 * 检查关键词中是否包含需要过滤的模式
 *
 * @param keyword - 关键词
 * @returns 匹配的过滤模式（如果没有匹配返回null）
 */
export function getMatchedFilterPattern(keyword: string): string | null {
  if (!keyword) return null

  const normalized = keyword.toLowerCase()

  for (const pattern of SEMANTIC_QUERY_PATTERNS) {
    const regex = new RegExp(`\\b${pattern}\\b`, 'i')
    if (regex.test(normalized)) {
      return pattern
    }
  }

  return null
}

// ============================================
// 主过滤函数
// ============================================

/**
 * 关键词质量过滤选项
 */
export interface KeywordQualityFilterOptions {
  brandName: string
  category?: string
  targetCountry?: string
  targetLanguage?: string
  minWordCount?: number  // 最少单词数
  maxWordCount?: number  // 最多单词数
}

/**
 * 过滤低质量关键词
 *
 * @param keywords - 关键词数组（PoolKeywordData[]）
 * @param options - 过滤选项
 * @returns 过滤后的关键词和被过滤的关键词
 */
export function filterKeywordQuality(
  keywords: PoolKeywordData[],
  options: KeywordQualityFilterOptions
): {
  filtered: PoolKeywordData[]
  removed: Array<{ keyword: PoolKeywordData; reason: string }>
} {
  const {
    brandName,
    category,
    minWordCount = 1,
    maxWordCount = 8,
  } = options

  const removed: Array<{ keyword: PoolKeywordData; reason: string }> = []
  const filtered: PoolKeywordData[] = []

  for (const kw of keywords) {
    const keyword = typeof kw === 'string' ? kw : kw.keyword
    const wordCount = keyword.trim().split(/\s+/).length

    let removeReason: string | null = null

    // 1. 检查品牌变体词
    if (isBrandVariant(keyword, brandName)) {
      removeReason = `品牌变体词: "${keyword}"`
    }
    // 2. 检查语义查询词
    else if (isSemanticQuery(keyword)) {
      const pattern = getMatchedFilterPattern(keyword)
      removeReason = pattern
        ? `语义查询词: "${keyword}" (包含: ${pattern})`
        : `语义查询词: "${keyword}"`
    }
    // 3. 检查单词数
    else if (wordCount < minWordCount || wordCount > maxWordCount) {
      removeReason = `单词数不匹配: ${wordCount} (范围: ${minWordCount}-${maxWordCount})`
    }

    if (removeReason) {
      removed.push({ keyword: kw, reason: removeReason })
    } else {
      filtered.push(kw)
    }
  }

  return { filtered, removed }
}

/**
 * 简单关键词过滤（字符串数组版本）
 *
 * @param keywords - 关键词字符串数组
 * @param brandName - 品牌名称
 * @returns 过滤后的关键词
 */
export function filterKeywordsSimple(
  keywords: string[],
  brandName: string
): string[] {
  const poolKeywords: PoolKeywordData[] = keywords.map(kw => ({
    keyword: kw,
    searchVolume: 0,
    source: 'FILTERED',
  }))

  const result = filterKeywordQuality(poolKeywords, { brandName })
  return result.filtered.map(kw => typeof kw === 'string' ? kw : kw.keyword)
}

// ============================================
// 统计报告
// ============================================

/**
 * 生成过滤统计报告
 */
export function generateFilterReport(
  originalCount: number,
  removed: Array<{ keyword: PoolKeywordData; reason: string }>
): string {
  if (removed.length === 0) {
    return `✅ 所有 ${originalCount} 个关键词通过质量检查`
  }

  const filteredCount = originalCount - removed.length
  const removalRate = ((removed.length / originalCount) * 100).toFixed(1)

  // 按原因分组统计
  const reasonGroups: Record<string, number> = {}
  for (const item of removed) {
    // 提取主要原因类别
    let category = '其他'
    if (item.reason.includes('品牌变体词')) {
      category = '品牌变体词'
    } else if (item.reason.includes('语义查询词')) {
      category = '语义查询词'
    } else if (item.reason.includes('单词数')) {
      category = '单词数不匹配'
    }
    reasonGroups[category] = (reasonGroups[category] || 0) + 1
  }

  let report = `📊 关键词质量过滤报告:\n`
  report += `   原始: ${originalCount} 个 → 过滤后: ${filteredCount} 个\n`
  report += `   移除: ${removed.length} 个 (${removalRate}%)\n`

  for (const [category, count] of Object.entries(reasonGroups)) {
    report += `   - ${category}: ${count} 个\n`
  }

  // 显示被移除的关键词示例（最多5个）
  if (removed.length > 0) {
    const examples = removed.slice(0, 5).map(item => {
      const keyword = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      return `     - "${keyword}": ${item.reason}`
    })
    report += `   示例:\n${examples.join('\n')}`
  }

  return report
}
