/**
 * 关键词质量过滤模块 (v2.0)
 *
 * 职责：过滤低质量关键词，确保关键词与产品相关
 *
 * 过滤规则：
 * 1. 品牌变体词过滤：品牌名 + 随机字符后缀（如 eurekaddl）
 * 2. 语义查询词过滤：非购买意图的查询词（如 significato、serie）
 * 3. 品牌无关词过滤：多语言企业类型后缀（如 unito, gmbh, inc）
 * 4. 纯品牌词检测：支持多单词品牌（eufy security → eufy + eufy security）
 *
 * 🔥 2025-12-29 优化：
 * - 新增纯品牌词检测函数
 * - 新增多语言品牌无关词过滤
 * - 支持OAuth和服务账号两种模式
 */

import type { PoolKeywordData } from './offer-keyword-pool'

// ============================================
// 纯品牌词检测（🔥 2025-12-29 新增）
// ============================================

/**
 * 获取品牌的纯品牌词列表
 *
 * 对于多单词品牌名称，纯品牌词包含：
 * - 品牌全名（如 "eufy security"）
 * - 品牌首词（如 "eufy"）
 *
 * @param brandName - 品牌名称
 * @returns 纯品牌词数组
 *
 * @example
 * getPureBrandKeywords("eufy security") → ["eufy", "eufy security"]
 * getPureBrandKeywords("eureka") → ["eureka"]
 * getPureBrandKeywords("Wahl Professional") → ["wahl", "wahl professional"]
 */
export function getPureBrandKeywords(brandName: string): string[] {
  if (!brandName || !brandName.trim()) {
    return []
  }

  // 先trim再split，避免空字符串
  const trimmed = brandName.trim()
  const words = trimmed.split(/\s+/)
  const pureBrandKeywords: string[] = []

  // 添加品牌全名
  pureBrandKeywords.push(trimmed.toLowerCase())

  // 添加品牌首词（如果品牌名超过一个词）
  if (words.length > 1 && words[0]) {
    pureBrandKeywords.push(words[0].toLowerCase())
  }

  return [...new Set(pureBrandKeywords)]
}

/**
 * 检测关键词是否包含纯品牌词
 *
 * @param keyword - 要检测的关键词
 * @param pureBrandKeywords - 纯品牌词列表
 * @returns 是否包含纯品牌词
 *
 * @example
 * containsPureBrand("eufy security camera", ["eufy", "eufy security"]) → true
 * containsPureBrand("security camera", ["eufy", "eufy security"]) → false
 */
export function containsPureBrand(keyword: string, pureBrandKeywords: string[]): boolean {
  if (!keyword || !pureBrandKeywords || pureBrandKeywords.length === 0) {
    return false
  }

  const kwLower = keyword.toLowerCase()
  return pureBrandKeywords.some(brand => kwLower.includes(brand.toLowerCase()))
}

/**
 * 检测关键词是否为纯品牌词本身
 *
 * @param keyword - 要检测的关键词
 * @param pureBrandKeywords - 纯品牌词列表
 * @returns 是否为纯品牌词本身
 *
 * @example
 * isPureBrandKeyword("eufy", ["eufy", "eufy security"]) → true
 * isPureBrandKeyword("eufy security", ["eufy", "eufy security"]) → true
 * isPureBrandKeyword("eufy camera", ["eufy", "eufy security"]) → false
 */
export function isPureBrandKeyword(keyword: string, pureBrandKeywords: string[]): boolean {
  if (!keyword || !pureBrandKeywords || pureBrandKeywords.length === 0) {
    return false
  }

  const kwLower = keyword.toLowerCase().trim()
  return pureBrandKeywords.some(brand =>
    kwLower === brand.toLowerCase().trim()
  )
}

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
  'test', 'testing',  // test/testing=测试/评测，低转化意图

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
// 品牌无关词检测（🔥 2025-12-29 新增：多语言支持）
// ============================================

/**
 * 多语言企业类型后缀模式
 * 用于检测与品牌无关的商业实体关键词
 */
const BRAND_IRRELEVANT_PATTERNS: RegExp[] = [
  // 意大利语
  /\b\w+(unito|srl|sa|scarl)\b/i,
  // 德语
  /\b\w+(gmbh|ag|kg|mbh)\b/i,
  // 英语
  /\b\w+(inc|ltd|llc|corp|corporation|limited)\b/i,
  // 法语
  /\b\w+(sa|sas|eurl|sarl)\b/i,
  // 西班牙语
  /\b\w+(sa|srl|sl)\b/i,
  // 中文（使用Unicode正则）
  /\b(有限公司|股份有限公司|有限责任公司)\b/u,
  // 日语
  /\b(株式会社|有限会社)\b/,
  // 韩语
  /\b(주식회사|유한회사)\b/,
  // 荷兰语
  /\b\w+(bv)\b/i,
  // 波兰语
  /\b\w+(sp|sp\.?o\.?|z\.?o\.?o\.?)\b/i,
]

/**
 * 检测关键词是否为品牌无关词
 *
 * 品牌无关词特征：
 * - 包含企业类型后缀（unito, gmbh, inc等）
 * - 不包含纯品牌词
 *
 * @param keyword - 要检测的关键词
 * @param brandName - 品牌名称
 * @returns 是否为品牌无关词
 *
 * @example
 * isBrandIrrelevant("eureka unito", "eureka") → true (意大利语企业)
 * isBrandIrrelevant("eureka gmbh", "eureka") → true (德语企业)
 * isBrandIrrelevant("eureka security camera", "eureka") → false (包含品牌词)
 * isBrandIrrelevant("eureka unito") → true (无品牌名时只检查公司后缀)
 */
export function isBrandIrrelevant(keyword: string, brandName?: string): boolean {
  if (!keyword) return false

  const pureBrandKeywords = brandName ? getPureBrandKeywords(brandName) : []

  // 如果提供了品牌名，检查关键词是否包含品牌词
  // 如果不包含品牌词，不认为是品牌无关（完全不相关）
  if (pureBrandKeywords.length > 0 && !containsPureBrand(keyword, pureBrandKeywords)) {
    return false
  }

  // 检查是否匹配任一品牌无关模式
  return BRAND_IRRELEVANT_PATTERNS.some(pattern => pattern.test(keyword))
}

/**
 * 获取匹配的品牌无关词模式
 *
 * @param keyword - 要检测的关键词
 * @returns 匹配的模式（如果没有匹配返回null）
 */
export function getMatchedIrrelevantPattern(keyword: string): string | null {
  if (!keyword) return null

  for (const pattern of BRAND_IRRELEVANT_PATTERNS) {
    const match = keyword.match(pattern)
    if (match) {
      return match[0] || pattern.source
    }
  }

  return null
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
 * 关键词质量过滤选项（🔥 2025-12-29 更新）
 */
export interface KeywordQualityFilterOptions {
  brandName: string
  category?: string
  targetCountry?: string
  targetLanguage?: string
  minWordCount?: number  // 最少单词数
  maxWordCount?: number  // 最多单词数
  /**
   * 是否必须包含纯品牌词
   * @default true
   */
  mustContainBrand?: boolean
}

/**
 * 过滤低质量关键词（🔥 2025-12-29 增强）
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
    mustContainBrand = true,
  } = options

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const removed: Array<{ keyword: PoolKeywordData; reason: string }> = []
  const filtered: PoolKeywordData[] = []

  for (const kw of keywords) {
    const keyword = typeof kw === 'string' ? kw : kw.keyword
    const wordCount = keyword.trim().split(/\s+/).length

    let removeReason: string | null = null

    // 1. 检查是否必须包含纯品牌词
    if (mustContainBrand && !containsPureBrand(keyword, pureBrandKeywords)) {
      removeReason = `不含纯品牌词: "${keyword}"`
    }
    // 2. 检查品牌变体词
    else if (isBrandVariant(keyword, brandName)) {
      removeReason = `品牌变体词: "${keyword}"`
    }
    // 3. 检查品牌无关词（🔥 2025-12-29 新增）
    else if (isBrandIrrelevant(keyword, brandName)) {
      const pattern = getMatchedIrrelevantPattern(keyword)
      removeReason = pattern
        ? `品牌无关词: "${keyword}" (包含: ${pattern})`
        : `品牌无关词: "${keyword}"`
    }
    // 4. 检查语义查询词
    else if (isSemanticQuery(keyword)) {
      const pattern = getMatchedFilterPattern(keyword)
      removeReason = pattern
        ? `语义查询词: "${keyword}" (包含: ${pattern})`
        : `语义查询词: "${keyword}"`
    }
    // 5. 检查单词数
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
