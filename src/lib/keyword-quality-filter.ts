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
 * 检测关键词是否包含纯品牌词（部分匹配）
 *
 * 用于过滤场景：只保留包含品牌词的关键词
 * 注意：精确匹配请使用 isPureBrandKeyword
 *
 * @param keyword - 要检测的关键词
 * @param pureBrandKeywords - 纯品牌词列表
 * @returns 是否包含纯品牌词（部分匹配）
 *
 * @example
 * containsPureBrand("eufy security camera", ["eufy", "eufy security"]) → true
 * containsPureBrand("security camera", ["eufy", "eufy security"]) → false
 */
export function containsPureBrand(keyword: string, pureBrandKeywords: string[]): boolean {
  if (!keyword || !pureBrandKeywords || pureBrandKeywords.length === 0) {
    return false
  }

  const normalizedKeyword = keyword.toLowerCase().normalize('NFKC')
  const keywordTokens = normalizedKeyword
    .split(/[^\p{L}\p{N}]+/u)
    .map(t => t.trim())
    .filter(Boolean)

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const containsBrandWithBoundaries = (normalizedBrand: string): boolean => {
    const brandWords = normalizedBrand
      .trim()
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean)

    if (brandWords.length === 0) return false

    // Allow separators between brand words: space / hyphen / punctuation.
    const phrasePattern = brandWords.map(escapeRegExp).join('[^\\p{L}\\p{N}]+')
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrasePattern}(?:$|[^\\p{L}\\p{N}])`, 'iu')
    return re.test(normalizedKeyword)
  }

  // 1) Preferred: whole-word / whole-phrase matching to avoid "rove" matching "rover".
  for (const brand of pureBrandKeywords) {
    const normalizedBrand = (brand || '').toLowerCase().normalize('NFKC').trim()
    if (!normalizedBrand) continue
    if (containsBrandWithBoundaries(normalizedBrand)) return true
  }

  // 2) Fallback: allow some common concatenations (brand+model/brand+product word).
  // This preserves cases like "eufycam" or "eurekaj15" while still rejecting "rover".
  for (const brand of pureBrandKeywords) {
    const normalizedBrand = (brand || '').toLowerCase().normalize('NFKC').trim()
    if (!normalizedBrand) continue
    if (normalizedBrand.includes(' ')) continue

    for (const token of keywordTokens) {
      if (!token.startsWith(normalizedBrand) || token.length <= normalizedBrand.length) continue

      const suffix = token.slice(normalizedBrand.length)
      if (!suffix) continue

      // Brand + model number (e.g. "eurekaJ15", "eufy2")
      if (/\d/.test(suffix)) return true

      // Brand + common product word (e.g. "eufycam", "eufysecurity")
      if (PRODUCT_WORD_PATTERNS.includes(suffix)) return true

      // Brand + product word + digits (e.g. "eufycam2")
      if (PRODUCT_WORD_PATTERNS.some(word => suffix.startsWith(word) && /\d/.test(suffix.slice(word.length)))) {
        return true
      }
    }
  }

  return false
}

/**
 * 检测关键词是否为纯品牌词本身
 *
 * 纯品牌词定义：
 * - 品牌全名（如 "eufy security"）
 * - 品牌首词（如 "eufy"）
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
// 品牌词匹配策略（🔥 2026-01-05 新增：明确用途，避免混用）
// ============================================

/**
 * 品牌词匹配策略说明
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  场景1: 关键词过滤（保留包含品牌词的关键词）                      │
 * │  → shouldKeepByBrand() - 部分匹配（"reolink argus" ✅）          │
 * │                                                                 │
 * │  场景2: 匹配类型分配（判断是否"纯品牌词"用 EXACT）                │
 * │  → shouldUseExactMatch() - 精确匹配（"reolink" ✅, "reolink argus" ❌）│
 * └─────────────────────────────────────────────────────────────────┘
 */

/**
 * 判断关键词是否应该保留（用于质量过滤）
 *
 * 规则：只要包含品牌词就保留
 * 用途：filterKeywordQuality() 的 mustContainBrand 检查
 *
 * @param keyword - 要检测的关键词
 * @param pureBrandKeywords - 纯品牌词列表
 * @returns 是否应该保留
 *
 * @example
 * shouldKeepByBrand("reolink argus", ["reolink"]) → true
 * shouldKeepByBrand("security camera", ["reolink"]) → false
 */
export function shouldKeepByBrand(keyword: string, pureBrandKeywords: string[]): boolean {
  return containsPureBrand(keyword, pureBrandKeywords)
}

/**
 * 判断关键词是否应该使用 EXACT 匹配类型
 *
 * 规则：必须是纯品牌词本身（无修饰词）
 * 用途：ad-creative-generator.ts 的匹配类型分配
 *
 * @param keyword - 要检测的关键词
 * @param pureBrandKeywords - 纯品牌词列表
 * @returns 是否应该使用 EXACT 匹配
 *
 * @example
 * shouldUseExactMatch("reolink", ["reolink"]) → true
 * shouldUseExactMatch("reolink argus", ["reolink"]) → false
 */
export function shouldUseExactMatch(keyword: string, pureBrandKeywords: string[]): boolean {
  return isPureBrandKeyword(keyword, pureBrandKeywords)
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

  // 竞品平台（🔥 2025-12-29 扩充：防止跨平台关键词浪费）
  // 主流电商平台
  'ebay', 'amazon', 'walmart', 'target', 'bestbuy', 'best buy',
  'costco', 'sams club', 'sams', 'kroger', 'walgreens',
  // 国际电商平台
  'alibaba', 'aliexpress', 'wish', 'temu', 'shein',
  'craigslist', 'mercari', 'poshmark', 'etsy',
  // 品牌官网/直销平台
  'official site', 'official website', 'direct', 'manufacturer',
]

// ============================================
// 平台检测（🔥 2025-12-29 新增）
// ============================================

/**
 * 电商平台域名映射
 */
const PLATFORM_DOMAINS: Record<string, string[]> = {
  amazon: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.jp', 'amzn.to'],
  walmart: ['walmart.com', 'walmart.ca'],
  ebay: ['ebay.com', 'ebay.co.uk', 'ebay.de'],
  target: ['target.com'],
  bestbuy: ['bestbuy.com'],
  costco: ['costco.com'],
  aliexpress: ['aliexpress.com'],
  alibaba: ['alibaba.com'],
  etsy: ['etsy.com'],
  wish: ['wish.com'],
  temu: ['temu.com'],
  shein: ['shein.com'],
}

/**
 * 平台关键词模式（包含常见拼写错误）
 */
const PLATFORM_KEYWORDS: Record<string, string[]> = {
  amazon: ['amazon', 'amazone', 'amzn', 'amazn'],  // amazone是常见拼写错误
  walmart: ['walmart', 'wal mart', 'wal-mart', 'walmat'],
  ebay: ['ebay', 'e bay', 'e-bay'],
  target: ['target'],
  bestbuy: ['best buy', 'bestbuy', 'bestbuy'],
  costco: ['costco'],
  sams: ['sams club', 'sams', "sam's club"],
  aliexpress: ['aliexpress', 'ali express'],
  alibaba: ['alibaba'],
  etsy: ['etsy'],
  wish: ['wish'],
  temu: ['temu'],
  shein: ['shein'],
}

/**
 * 从URL提取平台名称
 *
 * @param url - 产品URL
 * @returns 平台名称（小写）或null
 *
 * @example
 * extractPlatformFromUrl('https://www.amazon.com/dp/B123') → 'amazon'
 * extractPlatformFromUrl('https://www.walmart.com/ip/456') → 'walmart'
 */
export function extractPlatformFromUrl(url: string): string | null {
  if (!url) return null

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // 检查每个平台的域名列表
    for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
      if (domains.some(domain => hostname.includes(domain))) {
        return platform
      }
    }
  } catch {
    // URL解析失败
  }

  return null
}

/**
 * 检测关键词中包含的平台名称
 *
 * @param keyword - 关键词
 * @returns 检测到的平台名称数组
 *
 * @example
 * detectPlatformsInKeyword('anker power bank walmart') → ['walmart']
 * detectPlatformsInKeyword('amazon best buy comparison') → ['amazon', 'bestbuy']
 */
export function detectPlatformsInKeyword(keyword: string): string[] {
  if (!keyword) return []

  const kwLower = keyword.toLowerCase()
  const detectedPlatforms: string[] = []

  for (const [platform, patterns] of Object.entries(PLATFORM_KEYWORDS)) {
    for (const pattern of patterns) {
      // 使用单词边界匹配，避免误匹配
      const regex = new RegExp(`\\b${pattern}\\b`, 'i')
      if (regex.test(kwLower)) {
        detectedPlatforms.push(platform)
        break // 找到一个匹配即可，跳出当前平台的模式循环
      }
    }
  }

  return [...new Set(detectedPlatforms)]
}

/**
 * 检测关键词平台是否与URL平台冲突
 *
 * @param keyword - 关键词
 * @param productUrl - 产品URL
 * @returns 是否冲突
 *
 * @example
 * isPlatformMismatch('anker walmart', 'https://amazon.com/...') → true
 * isPlatformMismatch('anker charger', 'https://amazon.com/...') → false
 * isPlatformMismatch('anker amazon', 'https://amazon.com/...') → false
 */
export function isPlatformMismatch(keyword: string, productUrl: string): boolean {
  const urlPlatform = extractPlatformFromUrl(productUrl)
  if (!urlPlatform) {
    // 无法识别URL平台，不过滤
    return false
  }

  const keywordPlatforms = detectPlatformsInKeyword(keyword)
  if (keywordPlatforms.length === 0) {
    // 关键词不包含平台名，不过滤
    return false
  }

  // 如果关键词包含平台名，但与URL平台不匹配，则视为冲突
  return !keywordPlatforms.includes(urlPlatform)
}

// ============================================
// 品牌变体词检测
// ============================================

/**
 * 常见产品词列表（后缀包含这些词时不认为是品牌变体词）
 */
const PRODUCT_WORD_PATTERNS = [
  'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'air', 's',
  'se', 'x', 'c', 'e', 'a', 'v', 't',
  'edition', 'version', 'gen', 'generation',
  'camera', 'cam', 'vacuum', 'robot', 'cleaner',
  'doorbell', 'security', 'tracker', 'sensor',
  'starter', 'bundle', 'kit', 'set', 'pack'
]

/**
 * 检测是否为品牌变体词
 *
 * 品牌变体词特征：
 * - 品牌名 + 3个以上无意义字母后缀
 * - 例如：eureka + ddl = eurekaddl
 *
 * 🔥 2026-01-02 优化：
 * - 包含数字的后缀不是变体词（产品型号，如 j15, x20）
 * - 后缀完全等于常见产品词的不是变体词（如 pro, ultra, max）
 * - 后缀以"产品词+"开头的（如 pro-）的不是变体词
 * - 纯品牌词（后缀为空）豁免
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

  // 🔧 关键修复：仅把“品牌名后直接拼接的后缀”视为变体词
  // 例如：eurekaddl（brand+ddl）✅
  // 例如：auxito led / auxito-led / auxito_led ❌（这是正常的品牌+产品词组合）
  const boundaryChar = normalized.charAt(brand.length)
  if (boundaryChar && !/[a-z0-9]/.test(boundaryChar)) {
    return false
  }

  // 提取品牌名后面的部分
  const suffix = normalized.slice(brand.length).trim()

  // 如果后面没有内容，不是变体词（纯品牌词）
  if (!suffix) {
    return false
  }

  // 1. 检查后缀是否包含数字（如果包含数字，不是变体词，是产品型号）
  if (/\d/.test(suffix)) {
    // 包含数字，如 "j15", "x20", "e20s" - 这些是产品型号，不是变体词
    return false
  }

  // 2. 检查后缀是否等于常见产品词（或产品词+空格后缀）
  // 只排除单个产品词（如 "pro", "ultra"），不排除连写词（如 "camerabundle"）
  const isExactProductWord = PRODUCT_WORD_PATTERNS.includes(suffix)
  if (isExactProductWord) {
    return false
  }

  // 3. 检查后缀是否以"产品词-"开头（如 "pro-bundle", "ultra-s"）
  const hasProductWordPrefix = PRODUCT_WORD_PATTERNS.some(pattern =>
    suffix.startsWith(pattern + '-') || suffix.startsWith(pattern + ' ')
  )
  if (hasProductWordPrefix) {
    return false
  }

  // 4. 检查后缀长度：3-10个字母后缀认为是变体词
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

  // 1. 检查是否包含品牌名（避免子串误匹配，如 "rove" 命中 "rover"）
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  if (pureBrandKeywords.length > 0 && containsPureBrand(normalized, pureBrandKeywords)) {
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
 * 匹配格式: "品牌 商业后缀" (如 "eureka unito")
 */
const BRAND_IRRELEVANT_PATTERNS: RegExp[] = [
  // 意大利语 - 匹配 "word suffix" 格式
  /\b\w+\s+(unito|srl|sa|scarl)\b/i,
  // 德语
  /\b\w+\s+(gmbh|ag|kg|mbh)\b/i,
  // 英语
  /\b\w+\s+(inc|ltd|llc|corp|corporation|limited)\b/i,
  // 法语
  /\b\w+\s+(sa|sas|eurl|sarl)\b/i,
  // 西班牙语
  /\b\w+\s+(sa|srl|sl)\b/i,
  // 中文（不使用 \b，改用捕获组）
  /(有限公司|股份有限公司|有限责任公司)/,
  // 日语（不使用 \b，改用捕获组）
  /(株式会社|有限会社)/,
  // 韩语（不使用 \b，改用捕获组）
  /(주식회사|유한회사)/,
  // 荷兰语
  /\b\w+\s+(bv)\b/i,
  // 波兰语
  /\b\w+\s+(sp|sp\.?o\.?|z\.?o\.?o\.?)\b/i,
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
// 低意图关键词过滤（🔥 2025-12-29 新增）
// ============================================

/**
 * 过滤低购买意图关键词
 *
 * 低意图关键词特征：
 * - 信息查询类（what is, how to, meaning...）
 * - 评测比较类（review, comparison, versus...）
 * - 免费/二手类（free, used, repair...）
 *
 * @param keywords - 关键词数组
 * @returns 过滤后的关键词
 *
 * @example
 * filterLowIntentKeywords(['what is eufy', 'eufy camera price']) → ['eufy camera price']
 */
export function filterLowIntentKeywords(keywords: string[]): string[] {
  if (!keywords || keywords.length === 0) return []

  return keywords.filter(kw => {
    const lowerKw = kw.toLowerCase()

    // 跳过空字符串
    if (!lowerKw.trim()) return false

    // 检查是否匹配低意图模式
    for (const pattern of SEMANTIC_QUERY_PATTERNS) {
      if (lowerKw.includes(pattern.toLowerCase())) {
        return false
      }
    }

    return true
  })
}

/**
 * 过滤地理不匹配关键词（🔥 2025-12-29 新增）
 *
 * @param keywords - 关键词数组
 * @param targetCountry - 目标国家
 * @returns 过滤后的关键词
 */
export function filterMismatchedGeoKeywords(keywords: string[], _targetCountry: string): string[] {
  // 当前实现返回所有关键词
  // 未来可以根据目标国家过滤特定地理词
  if (!keywords || keywords.length === 0) return []
  return keywords.filter(kw => kw && kw.trim())
}

// ============================================
// 搜索量阈值计算（🔥 2025-12-29 新增）
// ============================================

/**
 * 计算搜索量阈值
 *
 * 阈值计算逻辑：
 * - 如果有足够数据（>=5个关键词），取中位数的10%作为阈值
 * - 如果数据不足，返回最小阈值50
 * - 如果所有搜索量都很低（最大值<500），阈值设为0（不过滤）
 *
 * @param searchVolumes - 搜索量数组
 * @param minThreshold - 最小阈值（默认50）
 * @returns 计算后的阈值
 */
export function calculateSearchVolumeThreshold(
  searchVolumes: number[],
  minThreshold: number = 50
): number {
  if (!searchVolumes || searchVolumes.length === 0) {
    return 0
  }

  // 过滤掉0值
  const validVolumes = searchVolumes.filter(v => v > 0)

  if (validVolumes.length === 0) {
    return 0
  }

  // 如果最大值很小（<500），不设置阈值
  const maxVolume = Math.max(...validVolumes)
  if (maxVolume < 500) {
    return 0
  }

  // 计算中位数
  const sorted = [...validVolumes].sort((a, b) => a - b)
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)]

  // 阈值 = 中位数的10%
  const threshold = Math.floor(median * 0.1)

  // 返回最大值（阈值和最小阈值比较）
  return Math.max(threshold, minThreshold)
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
  productUrl?: string  // 🔥 新增：产品URL，用于平台冲突检测
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
    productUrl,  // 🔥 新增：用于平台冲突检测
  } = options

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const removed: Array<{ keyword: PoolKeywordData; reason: string }> = []
  const filtered: PoolKeywordData[] = []

  for (const kw of keywords) {
    const keyword = typeof kw === 'string' ? kw : kw.keyword
    const wordCount = keyword.trim().split(/\s+/).length

    let removeReason: string | null = null

    // 1. 检查是否必须包含纯品牌词（使用策略函数）
    // 🔥 2026-01-05 使用 shouldKeepByBrand 策略函数，明确用途
    if (mustContainBrand && !shouldKeepByBrand(keyword, pureBrandKeywords)) {
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
    // 4. 🔥 新增：检查平台冲突（2025-12-29）
    else if (productUrl && isPlatformMismatch(keyword, productUrl)) {
      const urlPlatform = extractPlatformFromUrl(productUrl)
      const kwPlatforms = detectPlatformsInKeyword(keyword)
      removeReason = `平台冲突: "${keyword}" (包含 ${kwPlatforms.join('/')}，但URL是 ${urlPlatform})`
    }
    // 5. 检查语义查询词（🔥 2025-12-29 优化：如果关键词平台与URL平台匹配，允许通过）
    else if (isSemanticQuery(keyword)) {
      // 🔥 特殊处理：如果关键词包含的平台名与URL平台匹配，则不过滤
      // 例如：对于Amazon URL，"anker amazon"应该被保留而不是被语义查询词过滤
      const urlPlatform = productUrl ? extractPlatformFromUrl(productUrl) : null
      const kwPlatforms = detectPlatformsInKeyword(keyword)
      const isMatchingPlatform = urlPlatform && kwPlatforms.length > 0 && kwPlatforms.includes(urlPlatform)

      if (!isMatchingPlatform) {
        const pattern = getMatchedFilterPattern(keyword)
        removeReason = pattern
          ? `语义查询词: "${keyword}" (包含: ${pattern})`
          : `语义查询词: "${keyword}"`
      }
    }
    // 6. 检查单词数
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
