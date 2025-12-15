/**
 * 统一关键词服务 v2.0
 *
 * 优化目标：
 * 1. 最大化品牌相关搜索词
 * 2. 最大化广告质量（关键词、创意、着陆页一致）
 * 3. 保留高搜索量词
 *
 * 核心改进：
 * - 智能种子词构建（品牌相关种子词 → 品牌相关结果）
 * - 白名单过滤（替代竞品黑名单，100%可靠）
 * - 按搜索量降序排序（确保高价值词不丢失）
 * - 统一数据源（创意嵌入 = 投放关键词）
 */

import { getKeywordSearchVolumes } from './keyword-planner'
import { getKeywordIdeas } from './google-ads-keyword-planner'

// ============================================
// 类型定义
// ============================================

export interface UnifiedKeywordData {
  keyword: string
  searchVolume: number
  competition: string
  competitionIndex: number
  lowTopPageBid: number
  highTopPageBid: number
  source: 'BRAND' | 'CATEGORY' | 'FEATURE' | 'EXPANSION'
  matchType: 'EXACT' | 'PHRASE' | 'BROAD'
}

/**
 * 白名单过滤结果（P0-2优化：包含竞品品牌提取）
 */
export interface WhitelistFilterResult<T> {
  /** 过滤后的关键词 */
  filtered: T[]
  /** 识别到的竞品品牌（可用作否定关键词） */
  competitorBrands: string[]
  /** 统计信息 */
  stats: {
    brandKept: number      // 品牌词保留数
    genericKept: number    // 通用词保留数
    competitorFiltered: number  // 竞品词过滤数
  }
}

/**
 * 统一关键词服务返回结果（P0-2优化：包含竞品品牌）
 */
export interface UnifiedKeywordResult {
  /** 关键词列表 */
  keywords: UnifiedKeywordData[]
  /** 识别到的竞品品牌（建议用作否定关键词） */
  competitorBrands: string[]
}

export interface OfferData {
  brand: string
  category?: string | null
  productTitle?: string
  productFeatures?: string
  storeProductNames?: string[]
  scrapedData?: string
}

export interface KeywordServiceParams {
  offer: OfferData
  country: string
  language: string
  customerId?: string
  refreshToken?: string
  accountId?: number
  userId?: number
  // 可选配置
  minSearchVolume?: number
  maxKeywords?: number
}

// ============================================
// 常见品牌名列表（用于白名单过滤）
// ============================================

const KNOWN_BRAND_PATTERNS = [
  // 安防/摄像头
  'ring', 'arlo', 'nest', 'wyze', 'blink', 'eufy', 'lorex', 'swann', 'hikvision', 'dahua',
  'adt', 'simplisafe', 'vivint', 'frontpoint', 'abode', 'cove', 'scout',
  // 智能家居
  'amazon', 'google', 'apple', 'samsung', 'philips', 'hue', 'lutron', 'ecobee', 'honeywell',
  // 电子产品
  'sony', 'panasonic', 'lg', 'canon', 'nikon', 'gopro', 'dji', 'anker', 'aukey',
  // 通用检测模式（首字母大写的品牌格式）
]

// ============================================
// 优化1: 品牌名变体自动生成
// ============================================

/**
 * 生成品牌名变体
 *
 * 覆盖用户搜索时的常见变体：
 * - 大小写变体
 * - 带空格/不带空格变体
 * - 常见拼写错误（双字母简化）
 * - CamelCase 分词
 * - 🆕 核心品牌词提取（首词）
 */
export function generateBrandVariants(brand: string): string[] {
  if (!brand || brand.length < 2) return []

  const variants = new Set<string>()
  const brandLower = brand.toLowerCase()
  const brandUpper = brand.toUpperCase()

  // 基础变体
  variants.add(brandLower)
  variants.add(brand) // 原始形式

  // 带空格/不带空格变体
  if (brand.includes(' ')) {
    // "Reo Link" → "reolink"
    variants.add(brand.replace(/\s+/g, '').toLowerCase())

    // 🆕 核心品牌词提取：提取首词作为独立品牌词
    // "Eufy Security" → "eufy"（用户最常搜索的核心词）
    const words = brand.split(/\s+/)
    if (words.length >= 2) {
      const firstWord = words[0].toLowerCase()
      // 首词长度>=3才添加（避免"a", "the"等无意义词）
      if (firstWord.length >= 3) {
        variants.add(firstWord)
        console.log(`   🎯 核心品牌词: "${firstWord}"`)
      }
    }
  } else if (brand.length > 5) {
    // CamelCase 分词: "ReoLink" → "reo link"
    const camelSplit = brand.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    if (camelSplit !== brandLower) {
      variants.add(camelSplit)
    }

    // 尝试在中间插入空格（适用于组合词）
    // "reolink" → "reo link" (尝试常见分割点)
    const midPoint = Math.floor(brand.length / 2)
    for (let i = midPoint - 1; i <= midPoint + 1; i++) {
      if (i > 2 && i < brand.length - 2) {
        const withSpace = brandLower.slice(0, i) + ' ' + brandLower.slice(i)
        variants.add(withSpace)
      }
    }
  }

  // 常见拼写错误：删除双字母
  // "reolink" 本身没有双字母，但 "google" → "gogle"
  const withoutDoubles = brandLower.replace(/(.)\1/g, '$1')
  if (withoutDoubles !== brandLower && withoutDoubles.length >= 3) {
    variants.add(withoutDoubles)
  }

  // 常见拼写错误：末尾多加/少加字母
  // 不生成太多变体，保持简洁

  const result = Array.from(variants).filter(v => v.length >= 2)

  console.log(`   🔤 品牌变体: ${result.join(', ')}`)

  return result
}

// ============================================
// 智能种子词构建
// ============================================

/**
 * 构建智能种子词池
 *
 * 从 Offer 数据提取品牌相关的种子词，用于 Keyword Planner 查询
 * 品牌相关种子词 → Keyword Planner 返回更相关结果
 *
 * 优化(2025-12-14): 添加品牌名变体生成，覆盖常见搜索变体
 */
export function buildSmartSeedPool(offer: OfferData): string[] {
  const seeds: string[] = []
  const seenSeeds = new Set<string>()
  const brandName = offer.brand

  if (!brandName) return seeds

  const addSeed = (seed: string) => {
    const normalized = seed.toLowerCase().trim()
    if (normalized && !seenSeeds.has(normalized) && normalized.length > 2) {
      seenSeeds.add(normalized)
      seeds.push(seed.trim())
    }
  }

  // 🆕 0. 品牌名变体（覆盖用户搜索时的常见变体）
  console.log('\n   📌 Step 0: 生成品牌名变体')
  const brandVariants = generateBrandVariants(brandName)
  brandVariants.forEach(addSeed)

  // 1. 品牌+品类（为每个品牌变体生成组合）
  if (offer.category) {
    const categoryClean = offer.category.replace(/[&,]/g, ' ').trim().split(/\s+/)[0]
    if (categoryClean && categoryClean.length > 2) {
      // 主品牌名 + 品类
      addSeed(`${brandName} ${categoryClean}`)
      // 品牌变体 + 品类（取前2个变体）
      brandVariants.slice(0, 2).forEach(variant => {
        if (variant !== brandName.toLowerCase()) {
          addSeed(`${variant} ${categoryClean.toLowerCase()}`)
        }
      })
    }
  }

  // 3. 从产品标题提取
  if (offer.productTitle) {
    const titleSeeds = extractKeywordsFromProductTitle(offer.productTitle, brandName)
    titleSeeds.forEach(addSeed)
  }

  // 4. 从 scraped_data 提取
  if (offer.scrapedData) {
    try {
      const scrapedData = JSON.parse(offer.scrapedData)

      // 4.1 产品名称
      const productName = scrapedData.productName || scrapedData.title
      if (productName && productName !== brandName) {
        const titleSeeds = extractKeywordsFromProductTitle(productName, brandName)
        titleSeeds.forEach(addSeed)
      }

      // 4.2 店铺多商品聚合
      if (scrapedData.products && Array.isArray(scrapedData.products)) {
        const storeProductNames = scrapedData.products
          .slice(0, 10)
          .map((p: any) => p.title || p.productName || p.name)
          .filter((name: string) => name && name.length > 3)

        const storeSeeds = aggregateStoreProductSeeds(storeProductNames, brandName)
        storeSeeds.forEach(addSeed)
      }
    } catch {}
  }

  // 5. 从产品特性提取
  if (offer.productFeatures) {
    const featureSeeds = extractFeatureSeeds(offer.productFeatures, brandName)
    featureSeeds.forEach(addSeed)
  }

  // 限制种子词数量（API 限制）
  const finalSeeds = seeds.slice(0, 20)

  console.log(`🌱 智能种子词池: ${finalSeeds.length}个`)
  finalSeeds.forEach((seed, i) => console.log(`   ${i + 1}. "${seed}"`))

  return finalSeeds
}

/**
 * 从产品标题提取种子词
 */
function extractKeywordsFromProductTitle(productTitle: string, brandName: string): string[] {
  if (!productTitle || !brandName) return []

  const keywords: string[] = []
  const brandLower = brandName.toLowerCase()
  const titleLower = productTitle.toLowerCase()

  // 移除品牌名，获取产品描述部分
  const titleWithoutBrand = productTitle
    .replace(new RegExp(brandName, 'gi'), '')
    .replace(/^\s*[-–—]\s*/, '')
    .trim()

  // 分词并过滤
  const words = titleWithoutBrand
    .split(/\s+/)
    .filter(w => {
      const isShort = w.length < 3
      const isSpec = /^[\d.]+[pPkKgGmMtT"']*$/.test(w) || /^\d+x\d+$/i.test(w)
      const isCommon = /^(with|for|and|the|a|an|in|on|of|to|by|from|new|pro|plus|max|mini|lite)$/i.test(w)
      return !isShort && !isSpec && !isCommon
    })

  // 策略1: 品牌名 + 前2个核心词
  if (words.length >= 2) {
    keywords.push(`${brandName} ${words.slice(0, 2).join(' ')}`)
  }

  // 策略2: 品牌名 + 单个核心产品词
  const productTypeWords = words.filter(w =>
    /^[A-Z][a-z]+$/.test(w) || /^[a-z]+$/.test(w)
  )

  for (const word of productTypeWords.slice(0, 2)) {
    const combo = `${brandName} ${word}`
    if (!keywords.includes(combo)) {
      keywords.push(combo)
    }
  }

  return keywords.slice(0, 3)
}

/**
 * 从店铺多商品提取种子词
 */
function aggregateStoreProductSeeds(productNames: string[], brandName: string): string[] {
  if (!productNames || productNames.length === 0 || !brandName) return []

  const seeds: string[] = []
  const wordFrequency = new Map<string, number>()

  for (const productName of productNames) {
    const nameWithoutBrand = productName
      .replace(new RegExp(brandName, 'gi'), '')
      .trim()

    const words = nameWithoutBrand
      .split(/[\s\-–—,]+/)
      .filter(w => {
        if (w.length < 3) return false
        if (/^[\d.]+[pPkKgGmMtThHzZ"']*$/.test(w)) return false
        if (/^\d+x\d+$/i.test(w)) return false
        if (/^(with|for|and|the|a|an|in|on|of|to|by|from|new|pro|plus|max|mini|lite|version|edition|series|gen|generation|pack|set|kit|bundle)$/i.test(w)) return false
        return true
      })

    for (const word of words) {
      const wordLower = word.toLowerCase()
      wordFrequency.set(wordLower, (wordFrequency.get(wordLower) || 0) + 1)
    }
  }

  // 取出现次数>=2的高频词
  const frequentWords = Array.from(wordFrequency.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)

  for (const word of frequentWords) {
    seeds.push(`${brandName} ${word}`)
  }

  return seeds
}

/**
 * 从产品特性提取种子词
 */
function extractFeatureSeeds(features: string, brandName: string): string[] {
  if (!features || !brandName) return []

  const seeds: string[] = []
  const seenSeeds = new Set<string>()

  const highValueFeatures: Record<string, string> = {
    '4k': '4K',
    '1080p': 'HD',
    'night vision': 'night vision',
    'motion detection': 'motion detection',
    'two-way audio': 'two-way audio',
    'wireless': 'wireless',
    'solar': 'solar',
    'battery': 'battery',
    'waterproof': 'waterproof',
    'ptz': 'PTZ',
    'smart': 'smart',
    'alexa': 'Alexa',
    'bluetooth': 'bluetooth',
    'portable': 'portable',
  }

  const featureList = features
    .split(/[;,]/)
    .map(f => f.trim().toLowerCase())
    .filter(f => f.length > 3)

  for (const feature of featureList) {
    for (const [pattern, seedWord] of Object.entries(highValueFeatures)) {
      if (feature.includes(pattern)) {
        const seed = `${brandName} ${seedWord}`
        if (!seenSeeds.has(seed.toLowerCase())) {
          seenSeeds.add(seed.toLowerCase())
          seeds.push(seed)
        }
        break
      }
    }
  }

  return seeds.slice(0, 5)
}

// ============================================
// 白名单过滤
// ============================================

/**
 * 检测关键词是否包含已知品牌名
 *
 * 返回: 品牌名 或 null
 */
function detectBrandInKeyword(keyword: string): string | null {
  const keywordLower = keyword.toLowerCase()

  // 检查已知品牌列表
  for (const brand of KNOWN_BRAND_PATTERNS) {
    // 完整词匹配（避免 "spring" 匹配 "ring"）
    const regex = new RegExp(`\\b${brand}\\b`, 'i')
    if (regex.test(keywordLower)) {
      return brand
    }
  }

  return null
}

/**
 * 白名单过滤（P0-2优化：提取竞品品牌用作否定关键词）
 *
 * 规则：
 * 1. ✅ 保留: 包含自身品牌名的关键词
 * 2. ✅ 保留: 不含任何品牌名的通用品类词
 * 3. ❌ 排除: 包含其他品牌名的关键词（竞品）
 *
 * 🆕 优化(2025-12): 返回识别到的竞品品牌列表，可用于创建否定关键词
 */
export function filterByWhitelist<T extends { keyword: string }>(
  keywords: T[],
  brandName: string
): WhitelistFilterResult<T> {
  const brandLower = brandName.toLowerCase()
  // 🆕 提取品牌核心词（如 "Eufy Security" → "eufy"）
  const coreBrandLower = brandName.split(' ')[0].toLowerCase()

  let brandKept = 0
  let genericKept = 0
  let competitorFiltered = 0

  // 🆕 收集识别到的竞品品牌
  const competitorBrandsSet = new Set<string>()

  const filtered = keywords.filter(kw => {
    const keywordLower = kw.keyword.toLowerCase()

    // 1. 包含自身品牌名（完整或核心） → 保留
    if (keywordLower.includes(brandLower) || keywordLower.includes(coreBrandLower)) {
      brandKept++
      return true
    }

    // 2. 检测是否包含其他品牌名
    const detectedBrand = detectBrandInKeyword(kw.keyword)

    if (detectedBrand) {
      // 🆕 检查检测到的品牌是否是自身品牌核心词
      if (detectedBrand.toLowerCase() === coreBrandLower) {
        // 检测到的是自身品牌核心词，保留（不应被过滤）
        brandKept++
        return true
      }

      // 包含其他品牌名 → 排除（竞品）
      competitorFiltered++
      competitorBrandsSet.add(detectedBrand)  // 🆕 收集竞品品牌
      console.log(`   ❌ 过滤竞品词: "${kw.keyword}" (检测到竞品: ${detectedBrand})`)
      return false
    }

    // 3. 不含任何品牌名 → 保留（通用品类词）
    genericKept++
    return true
  })

  const competitorBrands = Array.from(competitorBrandsSet)

  console.log(`\n📋 白名单过滤结果:`)
  console.log(`   ✅ 品牌词保留: ${brandKept}`)
  console.log(`   ✅ 通用词保留: ${genericKept}`)
  console.log(`   ❌ 竞品词过滤: ${competitorFiltered}`)
  if (competitorBrands.length > 0) {
    console.log(`   🏷️ 识别竞品品牌: ${competitorBrands.join(', ')}`)
  }

  return {
    filtered,
    competitorBrands,
    stats: {
      brandKept,
      genericKept,
      competitorFiltered
    }
  }
}

/**
 * 白名单过滤（简化版，向后兼容）
 * @deprecated 建议使用 filterByWhitelist 获取完整结果
 */
export function filterByWhitelistSimple<T extends { keyword: string }>(
  keywords: T[],
  brandName: string
): T[] {
  return filterByWhitelist(keywords, brandName).filtered
}

// ============================================
// 智能过滤和排序
// ============================================

// 研究意图关键词标识（需要过滤）
const RESEARCH_INTENT_PATTERNS = [
  'review', 'reviews', 'vs', 'versus', 'comparison', 'compare',
  'alternative', 'alternatives', 'how to', 'what is', 'guide',
  'tutorial', 'reddit', 'forum', 'blog', 'article'
]

/**
 * 智能过滤
 *
 * - 搜索量过滤 (默认>500，可自适应降低)
 * - 研究意图过滤 (排除 review, vs, tutorial)
 *
 * 🆕 优化3 (2025-12-14): 搜索量阈值自适应
 * - 如果过滤后关键词不足15个，自动降低阈值重试
 * - 最低阈值为1（确保小众市场也能获得关键词）
 */
export function applySmartFilters(
  keywords: UnifiedKeywordData[],
  minSearchVolume: number = 500,
  minKeywordsTarget: number = 15  // 最小期望关键词数
): UnifiedKeywordData[] {
  let currentThreshold = minSearchVolume
  let filtered: UnifiedKeywordData[] = []
  let attempts = 0
  const maxAttempts = 4  // 最多尝试4次 (500 → 100 → 10 → 1)

  const thresholdLevels = [minSearchVolume, 100, 10, 1]

  while (attempts < maxAttempts) {
    currentThreshold = thresholdLevels[Math.min(attempts, thresholdLevels.length - 1)]

    let volumeFiltered = 0
    let intentFiltered = 0

    filtered = keywords.filter(kw => {
      // 搜索量过滤
      if (kw.searchVolume < currentThreshold) {
        volumeFiltered++
        return false
      }

      // 研究意图过滤
      const keywordLower = kw.keyword.toLowerCase()
      const hasResearchIntent = RESEARCH_INTENT_PATTERNS.some(pattern =>
        keywordLower.includes(pattern)
      )

      if (hasResearchIntent) {
        intentFiltered++
        return false
      }

      return true
    })

    // 如果结果足够或已达最低阈值，停止
    if (filtered.length >= minKeywordsTarget || currentThreshold <= 1) {
      console.log(`\n📊 智能过滤结果 (阈值=${currentThreshold}):`)
      console.log(`   过滤低搜索量(<${currentThreshold}): ${volumeFiltered}`)
      console.log(`   过滤研究意图词: ${intentFiltered}`)
      console.log(`   保留关键词: ${filtered.length}`)

      if (attempts > 0) {
        console.log(`   📉 阈值自适应: ${minSearchVolume} → ${currentThreshold} (第${attempts + 1}次尝试)`)
      }
      break
    }

    // 结果不足，降低阈值重试
    console.log(`   ⚠️ 关键词不足(${filtered.length}/${minKeywordsTarget})，降低阈值重试...`)
    attempts++
  }

  return filtered
}

/**
 * 智能匹配类型分配
 */
export function assignMatchTypes(
  keywords: UnifiedKeywordData[],
  brandName: string
): UnifiedKeywordData[] {
  const brandLower = brandName.toLowerCase()

  return keywords.map(kw => {
    const keywordLower = kw.keyword.toLowerCase()

    // 品牌词 → EXACT
    if (keywordLower.includes(brandLower)) {
      return { ...kw, matchType: 'EXACT' as const }
    }

    // 短关键词 (≤3 words) → PHRASE
    const wordCount = kw.keyword.split(/\s+/).length
    if (wordCount <= 3) {
      return { ...kw, matchType: 'PHRASE' as const }
    }

    // 长尾词 → BROAD
    return { ...kw, matchType: 'BROAD' as const }
  })
}

// ============================================
// 主服务函数
// ============================================

/**
 * 统一关键词数据获取服务 v2.0
 *
 * 流程：
 * 1. 构建智能种子词池
 * 2. Keyword Planner 查询（获取所有结果）
 * 3. 按搜索量降序排序
 * 4. 白名单过滤
 * 5. 智能过滤 + 匹配类型分配
 */
export async function getUnifiedKeywordData(params: KeywordServiceParams): Promise<UnifiedKeywordResult> {
  const {
    offer,
    country,
    language,
    customerId,
    refreshToken,
    accountId,
    userId,
    minSearchVolume = 500,
    maxKeywords = 500
  } = params

  console.log('\n' + '='.repeat(60))
  console.log('🔄 统一关键词服务 v2.0 启动')
  console.log('='.repeat(60))
  console.log(`品牌: ${offer.brand}`)
  console.log(`国家: ${country}, 语言: ${language}`)

  const results: UnifiedKeywordData[] = []
  const keywordMap = new Map<string, UnifiedKeywordData>()

  // ==========================================
  // Step 1: 构建智能种子词池
  // ==========================================
  console.log('\n📍 Step 1: 构建智能种子词池')
  const smartSeeds = buildSmartSeedPool(offer)

  if (smartSeeds.length === 0) {
    console.log('   ⚠️ 无法构建种子词池，返回空结果')
    return { keywords: [], competitorBrands: [] }
  }

  // ==========================================
  // Step 2: Keyword Planner 查询
  // ==========================================
  console.log('\n📍 Step 2: Keyword Planner 查询')

  if (customerId && refreshToken) {
    try {
      const keywordIdeas = await getKeywordIdeas({
        customerId,
        refreshToken,
        seedKeywords: smartSeeds,
        targetCountry: country,
        targetLanguage: language,
        accountId,
        userId,
      })

      console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)

      // 转换为统一格式
      keywordIdeas.forEach(idea => {
        const canonical = idea.text.toLowerCase().trim()
        if (!keywordMap.has(canonical)) {
          keywordMap.set(canonical, {
            keyword: idea.text,
            searchVolume: idea.avgMonthlySearches || 0,
            competition: idea.competition || 'UNKNOWN',
            competitionIndex: idea.competitionIndex || 0,
            lowTopPageBid: (idea.lowTopOfPageBidMicros || 0) / 1_000_000,
            highTopPageBid: (idea.highTopOfPageBidMicros || 0) / 1_000_000,
            source: 'EXPANSION',
            matchType: 'PHRASE'
          })
        }
      })
    } catch (error: any) {
      console.error(`   ❌ Keyword Planner 查询失败:`, error.message)
    }
  } else {
    console.log('   ⚠️ 缺少 Google Ads 凭证，跳过 Keyword Planner 查询')
  }

  // 添加种子词本身（确保品牌词被包含）
  for (const seed of smartSeeds) {
    const canonical = seed.toLowerCase().trim()
    if (!keywordMap.has(canonical)) {
      keywordMap.set(canonical, {
        keyword: seed,
        searchVolume: 0, // 稍后会通过 Historical Metrics 更新
        competition: 'UNKNOWN',
        competitionIndex: 0,
        lowTopPageBid: 0,
        highTopPageBid: 0,
        source: 'BRAND',
        matchType: 'EXACT'
      })
    }
  }

  // ==========================================
  // Step 2.5: 获取精确搜索量（Historical Metrics）
  // ==========================================
  console.log('\n📍 Step 2.5: 获取精确搜索量')

  const allKeywordTexts = Array.from(keywordMap.keys()).map(k =>
    keywordMap.get(k)!.keyword
  )

  try {
    const volumes = await getKeywordSearchVolumes(
      allKeywordTexts.slice(0, 1000), // API 限制
      country,
      language,
      userId
    )

    // 更新搜索量
    volumes.forEach(vol => {
      const canonical = vol.keyword.toLowerCase().trim()
      const existing = keywordMap.get(canonical)
      if (existing) {
        keywordMap.set(canonical, {
          ...existing,
          searchVolume: vol.avgMonthlySearches,
          competition: vol.competition,
          competitionIndex: vol.competitionIndex,
          lowTopPageBid: vol.lowTopPageBid,
          highTopPageBid: vol.highTopPageBid,
        })
      }
    })

    console.log(`   ✅ 更新 ${volumes.length} 个关键词的精确搜索量`)
  } catch (error: any) {
    console.error(`   ❌ 获取精确搜索量失败:`, error.message)
  }

  // ==========================================
  // Step 3: 品牌词优先 + 按搜索量降序排序
  // ==========================================
  console.log('\n📍 Step 3: 品牌词优先排序')

  let allKeywords = Array.from(keywordMap.values())
  const brandLower = offer.brand.toLowerCase()

  // 🆕 优化2: 品牌词优先排序
  // 排序规则：1. 品牌词优先 2. 按搜索量降序
  allKeywords.sort((a, b) => {
    const aIsBrand = a.keyword.toLowerCase().includes(brandLower) ? 1 : 0
    const bIsBrand = b.keyword.toLowerCase().includes(brandLower) ? 1 : 0

    // 品牌词优先
    if (aIsBrand !== bIsBrand) {
      return bIsBrand - aIsBrand
    }

    // 同类型内按搜索量降序
    return b.searchVolume - a.searchVolume
  })

  // 统计品牌词数量
  const brandKeywordCount = allKeywords.filter(kw =>
    kw.keyword.toLowerCase().includes(brandLower)
  ).length

  console.log(`   总关键词数: ${allKeywords.length}`)
  console.log(`   🏷️ 品牌词数量: ${brandKeywordCount}`)
  if (allKeywords.length > 0) {
    console.log(`   搜索量范围: ${allKeywords[allKeywords.length - 1].searchVolume} - ${allKeywords[0].searchVolume}`)
  }

  // ==========================================
  // Step 4: 白名单过滤
  // ==========================================
  console.log('\n📍 Step 4: 白名单过滤')

  // 🆕 P0-2优化：提取竞品品牌用于否定关键词
  const whitelistResult = filterByWhitelist(allKeywords, offer.brand)
  allKeywords = whitelistResult.filtered as UnifiedKeywordData[]
  const competitorBrands = whitelistResult.competitorBrands

  // ==========================================
  // Step 5: 智能过滤
  // ==========================================
  console.log('\n📍 Step 5: 智能过滤')

  allKeywords = applySmartFilters(allKeywords, minSearchVolume)

  // ==========================================
  // Step 6: 智能匹配类型分配
  // ==========================================
  console.log('\n📍 Step 6: 智能匹配类型分配')

  allKeywords = assignMatchTypes(allKeywords, offer.brand)

  // ==========================================
  // 最终结果
  // ==========================================
  const finalKeywords = allKeywords.slice(0, maxKeywords)

  console.log('\n' + '='.repeat(60))
  console.log('✅ 统一关键词服务完成')
  console.log('='.repeat(60))
  console.log(`最终关键词数: ${finalKeywords.length}`)

  // 打印 Top 10
  console.log('\n📊 Top 10 关键词:')
  finalKeywords.slice(0, 10).forEach((kw, i) => {
    console.log(`   ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月, ${kw.matchType})`)
  })

  // 统计匹配类型分布
  const matchTypeCounts = finalKeywords.reduce((acc, kw) => {
    acc[kw.matchType] = (acc[kw.matchType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  console.log('\n📊 匹配类型分布:')
  Object.entries(matchTypeCounts).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`)
  })

  // 🆕 P0-2优化：输出识别到的竞品品牌
  if (competitorBrands.length > 0) {
    console.log(`\n🏷️ 识别竞品品牌 (${competitorBrands.length}个，可用作否定关键词):`)
    competitorBrands.forEach(brand => {
      console.log(`   - ${brand}`)
    })
  }

  return {
    keywords: finalKeywords,
    competitorBrands
  }
}

// ============================================
// 向后兼容的多轮扩展函数
// ============================================

/**
 * 多轮扩展查询（保持向后兼容）
 *
 * @deprecated 建议使用 getUnifiedKeywordData 代替
 */
export async function getUnifiedKeywordDataWithMultiRounds(params: {
  baseKeywords: string[]
  country: string
  language: string
  customerId: string
  refreshToken: string
  accountId: number
  userId: number
  brandName: string
  roundSeeds: Array<{ round: number; name: string; seeds: string[] }>
}): Promise<UnifiedKeywordData[]> {
  console.log('⚠️ getUnifiedKeywordDataWithMultiRounds 已废弃，使用 getUnifiedKeywordData 代替')

  // 合并所有轮次的种子词
  const allSeeds = params.roundSeeds.flatMap(r => r.seeds)
  const uniqueSeeds = [...new Set([...params.baseKeywords, ...allSeeds])]

  // 构建简化的 offer 对象
  const offer: OfferData = {
    brand: params.brandName,
  }

  // 🆕 P0-2: 向后兼容，只返回关键词数组
  const result = await getUnifiedKeywordData({
    offer,
    country: params.country,
    language: params.language,
    customerId: params.customerId,
    refreshToken: params.refreshToken,
    accountId: params.accountId,
    userId: params.userId,
  })
  return result.keywords
}

// ============================================
// 向后兼容：获取现有关键词的搜索量
// ============================================

/**
 * 获取现有关键词列表的搜索量数据
 *
 * 用于 ad-creative-generator.ts 等场景，AI 已生成关键词列表，
 * 只需要获取这些关键词的搜索量数据。
 *
 * @param params.baseKeywords - 已有的关键词列表
 * @param params.country - 目标国家
 * @param params.language - 目标语言
 * @param params.userId - 用户ID
 * @param params.brandName - 品牌名（可选，用于匹配类型分配）
 */
export async function getKeywordVolumesForExisting(params: {
  baseKeywords: string[]
  country: string
  language: string
  userId?: number
  brandName?: string
  enableExpansion?: boolean  // 已废弃，忽略
}): Promise<UnifiedKeywordData[]> {
  const { baseKeywords, country, language, userId, brandName } = params

  if (!baseKeywords || baseKeywords.length === 0) {
    return []
  }

  console.log(`\n📊 获取 ${baseKeywords.length} 个关键词的搜索量数据`)

  try {
    // 直接使用 Historical Metrics API 获取精确搜索量
    const volumes = await getKeywordSearchVolumes(
      baseKeywords,
      country,
      language,
      userId
    )

    // 转换为 UnifiedKeywordData 格式
    const results: UnifiedKeywordData[] = volumes.map(vol => {
      const keywordLower = vol.keyword.toLowerCase()
      const brandLower = brandName?.toLowerCase() || ''

      // 智能分配匹配类型
      let matchType: 'EXACT' | 'PHRASE' | 'BROAD' = 'PHRASE'
      if (brandLower && keywordLower.includes(brandLower)) {
        matchType = 'EXACT'  // 品牌词用精准匹配
      } else if (vol.keyword.split(/\s+/).length <= 3) {
        matchType = 'PHRASE'  // 短词用词组匹配
      } else {
        matchType = 'BROAD'  // 长尾词用广泛匹配
      }

      return {
        keyword: vol.keyword,
        searchVolume: vol.avgMonthlySearches,
        competition: vol.competition,
        competitionIndex: vol.competitionIndex,
        lowTopPageBid: vol.lowTopPageBid,
        highTopPageBid: vol.highTopPageBid,
        source: 'BRAND' as const,
        matchType,
      }
    })

    console.log(`✅ 获取搜索量完成: ${results.length} 个关键词`)

    return results
  } catch (error: any) {
    console.error('❌ 获取关键词搜索量失败:', error.message)
    // 返回带默认搜索量的结果
    return baseKeywords.map(kw => ({
      keyword: kw,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source: 'BRAND' as const,
      matchType: 'PHRASE' as const,
    }))
  }
}

// ============================================
// 向后兼容：使用自定义种子词扩展关键词
// ============================================

/**
 * 使用自定义种子词扩展关键词
 *
 * 用于 ad-creative-generator.ts 多轮扩展场景，
 * 使用指定的种子词通过 Keyword Planner 获取扩展关键词。
 *
 * @param params.expansionSeeds - 种子关键词列表
 * @param params.country - 目标国家
 * @param params.language - 目标语言
 * @param params.userId - 用户ID
 * @param params.brandName - 品牌名（用于白名单过滤和匹配类型分配）
 */
export async function expandKeywordsWithSeeds(params: {
  expansionSeeds: string[]
  country: string
  language: string
  userId?: number
  brandName?: string
  customerId?: string
  refreshToken?: string
  accountId?: number
  clientId?: string
  clientSecret?: string
  developerToken?: string
  minSearchVolume?: number
  maxKeywords?: number
}): Promise<UnifiedKeywordData[]> {
  const {
    expansionSeeds,
    country,
    language,
    userId,
    brandName,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken,
    minSearchVolume = 500,
    maxKeywords = 100
  } = params

  if (!expansionSeeds || expansionSeeds.length === 0) {
    return []
  }

  console.log(`\n🔄 使用 ${expansionSeeds.length} 个种子词扩展关键词`)
  expansionSeeds.forEach((seed, i) => console.log(`   ${i + 1}. "${seed}"`))

  const keywordMap = new Map<string, UnifiedKeywordData>()

  try {
    // 1. 使用 Keyword Planner 获取扩展关键词
    if (customerId && refreshToken) {
      const keywordIdeas = await getKeywordIdeas({
        customerId,
        refreshToken,
        seedKeywords: expansionSeeds,
        targetCountry: country,
        targetLanguage: language,
        userId,
        accountId,
        clientId,
        clientSecret,
        developerToken,
      })

      console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)

      keywordIdeas.forEach(idea => {
        const canonical = idea.text.toLowerCase().trim()
        if (!keywordMap.has(canonical)) {
          keywordMap.set(canonical, {
            keyword: idea.text,
            searchVolume: idea.avgMonthlySearches || 0,
            competition: idea.competition || 'UNKNOWN',
            competitionIndex: idea.competitionIndex || 0,
            lowTopPageBid: (idea.lowTopOfPageBidMicros || 0) / 1_000_000,
            highTopPageBid: (idea.highTopOfPageBidMicros || 0) / 1_000_000,
            source: 'EXPANSION',
            matchType: 'PHRASE'
          })
        }
      })
    }

    // 2. 获取精确搜索量
    const allKeywordTexts = Array.from(keywordMap.keys()).map(k =>
      keywordMap.get(k)!.keyword
    )

    if (allKeywordTexts.length > 0) {
      const volumes = await getKeywordSearchVolumes(
        allKeywordTexts.slice(0, 1000),
        country,
        language,
        userId
      )

      volumes.forEach(vol => {
        const canonical = vol.keyword.toLowerCase().trim()
        const existing = keywordMap.get(canonical)
        if (existing) {
          keywordMap.set(canonical, {
            ...existing,
            searchVolume: vol.avgMonthlySearches,
            competition: vol.competition,
            competitionIndex: vol.competitionIndex,
            lowTopPageBid: vol.lowTopPageBid,
            highTopPageBid: vol.highTopPageBid,
          })
        }
      })
    }

    // 3. 排序和过滤
    let results = Array.from(keywordMap.values())

    // 按搜索量降序排序
    results.sort((a, b) => b.searchVolume - a.searchVolume)

    // 白名单过滤（如果有品牌名）
    if (brandName) {
      results = filterByWhitelistSimple(results, brandName)
    }

    // 搜索量过滤
    results = results.filter(kw => kw.searchVolume >= minSearchVolume)

    // 智能匹配类型分配
    if (brandName) {
      results = assignMatchTypes(results, brandName)
    }

    // 限制数量
    results = results.slice(0, maxKeywords)

    console.log(`✅ 扩展关键词完成: ${results.length} 个关键词`)

    return results
  } catch (error: any) {
    console.error('❌ 扩展关键词失败:', error.message)
    return []
  }
}
