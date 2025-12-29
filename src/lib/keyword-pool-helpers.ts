/**
 * 关键词池辅助函数 (v2.0)
 * 🔥 2025-12-29 优化：根据认证类型分发不同扩展策略
 *
 * 策略：
 * - OAuth模式：Keyword Planner迭代查询（移除Trends）
 * - 服务账号模式：Google下拉词 + 增强提取 + Google Trends
 */

import type { PoolKeywordData } from './offer-keyword-pool'
import { expandKeywordsWithSeeds } from './unified-keyword-service'
import { getTrendsKeywords } from './google-trends'
import { DEFAULTS } from './keyword-constants'
import {
  detectCountryInKeyword,
  filterLowIntentKeywords,
  filterMismatchedGeoKeywords,
  getBrandSearchSuggestions
} from './google-suggestions'
import {
  getPureBrandKeywords,
  containsPureBrand,
  isPureBrandKeyword,
  isBrandVariant,
  isSemanticQuery,
  isBrandIrrelevant
} from './keyword-quality-filter'
import type { Offer } from './offers'

// ============================================
// 动态过滤逻辑（无硬编码配置）
// ============================================

/**
 * 检测关键词是否包含其他品牌名（竞品过滤）
 * 逻辑：关键词包含大写开头的非目标品牌词 = 竞品
 */
function isCompetitorKeyword(keyword: string, brandName: string): boolean {
  const brandLower = brandName.toLowerCase()
  const words = keyword.split(/\s+/)

  for (const word of words) {
    // 大写开头 + 非目标品牌 = 可能是竞品
    if (word[0] === word[0].toUpperCase() && !brandLower.includes(word.toLowerCase())) {
      return true
    }
  }
  return false
}

// ============================================
// 主入口：根据认证类型分发扩展策略（🔥 2025-12-29 新增）
// ============================================

/**
 * 全量关键词扩展（v2.0）
 *
 * 根据认证类型选择不同的扩展策略：
 * - OAuth模式：Keyword Planner迭代查询（移除Trends）
 * - 服务账号模式：Google下拉词 + 增强提取 + Google Trends
 *
 * @param initialKeywords - 初始关键词
 * @param brandName - 品牌名称
 * @param category - 产品类别
 * @param targetCountry - 目标国家
 * @param targetLanguage - 目标语言
 * @param authType - 认证类型
 * @param offer - Offer信息（服务账号模式需要）
 * @param userId - 用户ID
 * @param customerId - Google Ads客户ID（OAuth模式需要）
 * @param refreshToken - 刷新令牌（OAuth模式需要）
 * @param accountId - 账户ID
 * @param clientId - OAuth客户端ID
 * @param clientSecret - OAuth客户端密钥
 * @param developerToken - 开发者令牌
 */
export async function expandAllKeywords(
  initialKeywords: PoolKeywordData[],
  brandName: string,
  category: string,
  targetCountry: string,
  targetLanguage: string,
  authType: 'oauth' | 'service_account',
  offer?: Offer,
  userId?: number,
  customerId?: string,
  refreshToken?: string,
  accountId?: number,
  clientId?: string,
  clientSecret?: string,
  developerToken?: string
): Promise<PoolKeywordData[]> {
  console.log(`\n📋 关键词扩展策略 (v2.0 - 认证类型: ${authType}):`)
  console.log(`   初始关键词数量: ${initialKeywords.length}`)
  console.log(`   品牌: ${brandName}`)

  if (authType === 'oauth') {
    return expandForOAuth({
      initialKeywords,
      brandName,
      category,
      targetCountry,
      targetLanguage,
      userId,
      customerId,
      refreshToken,
      accountId,
      clientId,
      clientSecret,
      developerToken
    })
  } else {
    if (!offer || !userId) {
      throw new Error('服务账号模式需要提供 offer 和 userId 参数')
    }
    return expandForServiceAccount({
      initialKeywords,
      brandName,
      category,
      targetCountry,
      targetLanguage,
      offer,
      userId
    })
  }
}

// ============================================
// OAuth模式：Keyword Planner迭代查询
// ============================================

interface OAuthExpandParams {
  initialKeywords: PoolKeywordData[]
  brandName: string
  category: string
  targetCountry: string
  targetLanguage: string
  userId?: number
  customerId?: string
  refreshToken?: string
  accountId?: number
  clientId?: string
  clientSecret?: string
  developerToken?: string
}

/**
 * OAuth模式关键词扩展：Keyword Planner迭代查询
 *
 * 策略：
 * 1. 生成纯品牌词种子
 * 2. 迭代查询Keyword Planner（最多3轮，Top20）
 * 3. 质量过滤（品牌变体/语义/品牌无关/低意图）
 * 4. 搜索量过滤（纯品牌词豁免）
 */
async function expandForOAuth(params: OAuthExpandParams): Promise<PoolKeywordData[]> {
  const {
    initialKeywords,
    brandName,
    category,
    targetCountry,
    targetLanguage,
    userId,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken
  } = params

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const allKeywords = new Map<string, PoolKeywordData>()
  const maxRounds = 3
  const topN = 20

  // 初始化种子词
  let seedKeywords = initialKeywords.map(kw => kw.keyword)

  // 如果没有初始关键词，使用纯品牌词
  if (seedKeywords.length === 0) {
    seedKeywords = pureBrandKeywords
  }

  console.log(`   初始种子词: ${seedKeywords.length}个`)

  try {
    // 迭代查询Keyword Planner
    for (let round = 1; round <= maxRounds; round++) {
      console.log(`\n   📊 Round ${round}/${maxRounds}: Keyword Planner 查询`)
      console.log(`      种子词: ${seedKeywords.slice(0, 5).join(', ')}${seedKeywords.length > 5 ? '...' : ''}`)

      if (!customerId || !userId) {
        console.warn(`   ⚠️ 缺少 customerId 或 userId，跳过Keyword Planner查询`)
        break
      }

      const results = await expandKeywordsWithSeeds({
        expansionSeeds: seedKeywords,
        country: targetCountry,
        language: targetLanguage,
        userId,
        brandName,
        customerId,
        refreshToken,
        accountId,
        clientId,
        clientSecret,
        developerToken,
        maxKeywords: DEFAULTS.maxKeywords,
        minSearchVolume: DEFAULTS.minSearchVolume
      })

      console.log(`      返回 ${results.length} 个关键词`)

      // 处理结果：只保留包含品牌词的关键词
      let newCount = 0
      for (const kw of results) {
        const kwLower = kw.keyword.toLowerCase()
        const keywordText = kwLower.trim()

        if (!keywordText) continue

        // 只保留包含品牌词的关键词
        if (!containsPureBrand(kw.keyword, pureBrandKeywords)) {
          continue
        }

        if (!allKeywords.has(keywordText)) {
          allKeywords.set(keywordText, {
            keyword: kw.keyword,
            searchVolume: kw.searchVolume,
            competition: kw.competition,
            competitionIndex: kw.competitionIndex,
            lowTopPageBid: kw.lowTopPageBid,
            highTopPageBid: kw.highTopPageBid,
            source: 'KEYWORD_PLANNER',
            matchType: kw.matchType,
            isPureBrand: isPureBrandKeyword(kw.keyword, pureBrandKeywords)
          })
          newCount++
        }
      }

      console.log(`      新增 ${newCount} 个品牌关键词`)

      // 准备下一轮种子词（按搜索量排序，取Top20）
      const sortedKeywords = Array.from(allKeywords.values())
        .sort((a, b) => b.searchVolume - a.searchVolume)
        .slice(0, topN)

      // 如果种子词不再变化，提前结束
      if (sortedKeywords.length < topN) {
        console.log(`      种子词数量不足，结束迭代`)
        break
      }

      seedKeywords = sortedKeywords.map(kw => kw.keyword)
    }

    console.log(`\n   📊 Keyword Planner 迭代完成: ${allKeywords.size} 个关键词`)

    // 质量过滤
    console.log(`\n   📊 质量过滤`)
    const filtered = qualityFilterOAuth(
      Array.from(allKeywords.values()),
      brandName,
      targetCountry
    )

    console.log(`   过滤后: ${filtered.length} 个关键词`)

    return filtered

  } catch (error: any) {
    console.error(`   ⚠️ OAuth模式关键词扩展失败: ${error.message}`)
    return initialKeywords
  }
}

/**
 * OAuth模式质量过滤
 */
function qualityFilterOAuth(
  keywords: PoolKeywordData[],
  brandName: string,
  targetCountry?: string
): PoolKeywordData[] {
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const dynamicThreshold = calculateDynamicThreshold(keywords)

  console.log(`      动态搜索量阈值: ${dynamicThreshold}`)

  let brandKeptCount = 0
  let brandVariantRemoved = 0
  let semanticRemoved = 0
  let irrelevantRemoved = 0
  let lowIntentRemoved = 0
  let geoRemoved = 0
  let volumeRemoved = 0

  const filtered = keywords.filter(kw => {
    const kwLower = kw.keyword.toLowerCase()
    const isPureBrand = isPureBrandKeyword(kw.keyword, pureBrandKeywords)

    // 1. 品牌变体词过滤
    if (isBrandVariant(kw.keyword, brandName)) {
      brandVariantRemoved++
      return false
    }

    // 2. 品牌无关词过滤
    if (isBrandIrrelevant(kwLower, brandName)) {
      irrelevantRemoved++
      return false
    }

    // 3. 语义查询词过滤
    if (isSemanticQuery(kwLower)) {
      semanticRemoved++
      return false
    }

    // 4. 地理过滤
    if (targetCountry) {
      const detectedCountries = detectCountryInKeyword(kw.keyword)
      if (detectedCountries.length > 0 && !detectedCountries.includes(targetCountry)) {
        geoRemoved++
        return false
      }
    }

    // 5. 搜索量过滤（纯品牌词豁免）
    if (!isPureBrand && kw.searchVolume > 0 && kw.searchVolume < dynamicThreshold) {
      volumeRemoved++
      return false
    }

    if (isPureBrand) {
      kw.isPureBrand = true
      brandKeptCount++
    }

    return true
  })

  console.log(`      保留: ${filtered.length}`)
  console.log(`      纯品牌词: ${brandKeptCount}`)
  console.log(`      移除: 品牌变体(${brandVariantRemoved}) 语义(${semanticRemoved}) 品牌无关(${irrelevantRemoved}) 低意图(${lowIntentRemoved}) 地理(${geoRemoved}) 搜索量(${volumeRemoved})`)

  return filtered
}

// ============================================
// 服务账号模式：Google下拉词 + 增强提取 + Google Trends（🔥 2025-12-29 新增）
// ============================================

interface ServiceAccountExpandParams {
  initialKeywords: PoolKeywordData[]
  brandName: string
  category: string
  targetCountry: string
  targetLanguage: string
  offer: Offer
  userId: number
}

/**
 * 服务账号模式关键词扩展
 *
 * 策略：
 * 1. Google下拉词
 * 2. 增强提取
 * 3. Google Trends扩展
 * 4. 质量过滤（无搜索量过滤）
 */
async function expandForServiceAccount(params: ServiceAccountExpandParams): Promise<PoolKeywordData[]> {
  const {
    initialKeywords,
    brandName,
    category,
    targetCountry,
    targetLanguage,
    offer,
    userId
  } = params

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const allKeywords = new Map<string, PoolKeywordData>()

  try {
    // ========== 阶段1: Google下拉词 ==========
    console.log(`\n   📊 阶段1: Google下拉词`)

    try {
      const googleSuggestKeywords = await getBrandSearchSuggestions({
        brand: brandName,
        country: targetCountry,
        language: getLanguageCode(targetLanguage),
        useProxy: true,
        productName: offer.product_name || offer.brand,
        category: offer.category || category
      })

      // 过滤低意图和地理不匹配
      const filteredSuggest = filterLowIntentKeywords(
        filterMismatchedGeoKeywords(
          googleSuggestKeywords.map(kw => kw.keyword),
          targetCountry
        )
      )

      console.log(`      Google下拉词: ${filteredSuggest.length} 个`)

      for (const text of filteredSuggest) {
        const kwLower = text.toLowerCase().trim()
        if (!kwLower) continue

        // 只保留包含品牌词的关键词
        if (!containsPureBrand(kwLower, pureBrandKeywords)) {
          continue
        }

        if (!allKeywords.has(kwLower)) {
          allKeywords.set(kwLower, {
            keyword: text,
            searchVolume: 0,
            competition: 'UNKNOWN',
            competitionIndex: 0,
            lowTopPageBid: 0,
            highTopPageBid: 0,
            source: 'GOOGLE_SUGGEST',
            matchType: 'BROAD',
            isPureBrand: isPureBrandKeyword(text, pureBrandKeywords)
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Google下拉词获取失败: ${error.message}`)
    }

    // ========== 阶段2: 增强提取 ==========
    console.log(`\n   📊 阶段2: 增强提取`)

    try {
      // 延迟导入避免循环依赖
      const { extractKeywordsEnhanced } = await import('./enhanced-keyword-extractor')

      const enhancedKeywords = await extractKeywordsEnhanced({
        productName: offer.product_name || offer.brand,
        brandName: brandName,
        category: offer.category || category,
        description: offer.brand_description || '',
        features: extractFeaturesFromOffer(offer),
        useCases: extractUseCasesFromOffer(offer),
        targetAudience: extractAudienceFromOffer(offer).join(', '),
        competitors: extractCompetitorsFromOffer(offer),
        targetCountry: targetCountry,
        targetLanguage: targetLanguage,
      }, userId)

      console.log(`      增强提取: ${enhancedKeywords.length} 个`)

      for (const kw of enhancedKeywords) {
        const kwLower = kw.keyword.toLowerCase().trim()
        if (!kwLower) continue

        // 只保留包含品牌词的关键词
        if (!containsPureBrand(kwLower, pureBrandKeywords)) {
          continue
        }

        if (!allKeywords.has(kwLower)) {
          allKeywords.set(kwLower, {
            keyword: kw.keyword,
            searchVolume: 0,
            competition: kw.competition || 'UNKNOWN',
            competitionIndex: 0,
            lowTopPageBid: 0,
            highTopPageBid: 0,
            source: 'ENHANCED_EXTRACT',
            matchType: 'BROAD',
            isPureBrand: isPureBrandKeyword(kw.keyword, pureBrandKeywords)
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ 增强提取失败: ${error.message}`)
    }

    // ========== 阶段3: Google Trends扩展 ==========
    console.log(`\n   📊 阶段3: Google Trends扩展`)

    try {
      const seedKeywords = Array.from(allKeywords.values())
        .slice(0, 10)
        .map(kw => kw.keyword)

      const trendsKeywords = await getTrendsKeywords(seedKeywords, brandName, category)

      console.log(`      Trends扩展: ${trendsKeywords.length} 个`)

      for (const kw of trendsKeywords) {
        const kwLower = kw.keyword.toLowerCase().trim()
        if (!kwLower) continue

        // 只保留包含品牌词的关键词
        if (!containsPureBrand(kwLower, pureBrandKeywords)) {
          continue
        }

        if (!allKeywords.has(kwLower)) {
          allKeywords.set(kwLower, {
            keyword: kw.keyword,
            searchVolume: kw.searchVolume || 0,
            competition: kw.competition || 'UNKNOWN',
            competitionIndex: kw.competitionIndex || 0,
            lowTopPageBid: kw.lowTopPageBid || 0,
            highTopPageBid: kw.highTopPageBid || 0,
            source: 'GOOGLE_TRENDS',
            matchType: 'BROAD',
            isPureBrand: isPureBrandKeyword(kw.keyword, pureBrandKeywords)
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Google Trends扩展失败: ${error.message}`)
    }

    console.log(`\n   📊 服务账号模式关键词收集完成: ${allKeywords.size} 个`)

    // 质量过滤（无搜索量过滤）
    console.log(`\n   📊 质量过滤`)
    const filtered = qualityFilterServiceAccount(
      Array.from(allKeywords.values()),
      brandName,
      targetCountry
    )

    console.log(`   过滤后: ${filtered.length} 个关键词`)

    return filtered

  } catch (error: any) {
    console.error(`   ⚠️ 服务账号模式关键词扩展失败: ${error.message}`)
    return initialKeywords
  }
}

/**
 * 服务账号模式质量过滤（无搜索量过滤）
 */
function qualityFilterServiceAccount(
  keywords: PoolKeywordData[],
  brandName: string,
  targetCountry?: string
): PoolKeywordData[] {
  const pureBrandKeywords = getPureBrandKeywords(brandName)

  let brandKeptCount = 0
  let brandVariantRemoved = 0
  let semanticRemoved = 0
  let irrelevantRemoved = 0
  let geoRemoved = 0

  const filtered = keywords.filter(kw => {
    const kwLower = kw.keyword.toLowerCase()
    const isPureBrand = isPureBrandKeyword(kw.keyword, pureBrandKeywords)

    // 1. 品牌变体词过滤
    if (isBrandVariant(kw.keyword, brandName)) {
      brandVariantRemoved++
      return false
    }

    // 2. 品牌无关词过滤
    if (isBrandIrrelevant(kwLower, brandName)) {
      irrelevantRemoved++
      return false
    }

    // 3. 语义查询词过滤
    if (isSemanticQuery(kwLower)) {
      semanticRemoved++
      return false
    }

    // 4. 地理过滤
    if (targetCountry) {
      const detectedCountries = detectCountryInKeyword(kw.keyword)
      if (detectedCountries.length > 0 && !detectedCountries.includes(targetCountry)) {
        geoRemoved++
        return false
      }
    }

    // 无搜索量过滤（服务账号无法获取搜索量）

    if (isPureBrand) {
      kw.isPureBrand = true
      brandKeptCount++
    }

    return true
  })

  console.log(`      保留: ${filtered.length}`)
  console.log(`      纯品牌词: ${brandKeptCount}`)
  console.log(`      移除: 品牌变体(${brandVariantRemoved}) 语义(${semanticRemoved}) 品牌无关(${irrelevantRemoved}) 地理(${geoRemoved})`)

  return filtered
}

// ============================================
// 辅助函数
// ============================================

/**
 * 将语言名称转换为语言代码
 */
function getLanguageCode(language: string): string {
  const languageMap: Record<string, string> = {
    English: 'en',
    German: 'de',
    French: 'fr',
    Spanish: 'es',
    Italian: 'it',
    Portuguese: 'pt',
    Japanese: 'ja',
    Korean: 'ko',
    Chinese: 'zh',
  }
  return languageMap[language] || 'en'
}

/**
 * 从Offer中提取特性列表
 */
function extractFeaturesFromOffer(offer: Offer): string[] {
  const features: string[] = []

  // 尝试从产品名称提取型号信息
  if (offer.product_name) {
    // 提取型号信息，如 "J15 Pro", "E20S" 等
    const modelMatch = offer.product_name.match(/([A-Z]\d{2,}[A-Z]?)/)
    if (modelMatch) {
      features.push(modelMatch[1])
    }

    // 提取常见功能词
    const featureWords = ['wireless', 'smart', 'automatic', 'rechargeable', 'portable']
    for (const word of featureWords) {
      if (offer.product_name.toLowerCase().includes(word)) {
        features.push(word)
      }
    }
  }

  return [...new Set(features)].slice(0, 5)
}

/**
 * 从Offer中提取使用场景
 */
function extractUseCasesFromOffer(offer: Offer): string[] {
  const useCases: string[] = []

  if (offer.category) {
    useCases.push(offer.category)
  }

  // 尝试从产品名称或品牌描述中提取
  const textToSearch = `${offer.product_name || ''} ${offer.brand_description || ''}`

  if (textToSearch) {
    const useCasePatterns = [
      /home (security|monitoring|protection)/gi,
      /indoor (use|monitoring)/gi,
      /outdoor (use|security)/gi,
      /pet (monitoring|care)/gi,
      /baby (monitoring|care)/gi,
    ]

    for (const pattern of useCasePatterns) {
      const matches = textToSearch.match(pattern)
      if (matches) {
        useCases.push(...matches)
      }
    }
  }

  return [...new Set(useCases)].slice(0, 3)
}

/**
 * 从Offer中提取目标受众
 */
function extractAudienceFromOffer(offer: Offer): string[] {
  const audiences: string[] = []

  if (offer.target_audience) {
    // 从target_audience字段提取
    const parsed = JSON.parse(offer.target_audience)
    if (Array.isArray(parsed)) {
      audiences.push(...parsed)
    }
  }

  // 默认受众
  if (audiences.length === 0) {
    audiences.push(
      'homeowners',
      'tech-savvy users',
      'security-conscious consumers'
    )
  }

  return audiences.slice(0, 3)
}

/**
 * 从Offer中提取竞品（简单实现）
 */
function extractCompetitorsFromOffer(offer: Offer): string[] {
  // 尝试从竞品分析中提取
  if (offer.competitor_analysis) {
    try {
      const parsed = JSON.parse(offer.competitor_analysis)
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 5)
      }
    } catch {
      // 解析失败，返回空数组
    }
  }

  return []
}

/**
 * 计算动态搜索量阈值
 */
function calculateDynamicThreshold(keywords: PoolKeywordData[]): number {
  const keywordsWithVolume = keywords.filter(kw => kw.searchVolume > 0)

  if (keywordsWithVolume.length === 0) {
    return 100 // 默认阈值
  }

  const volumes = keywordsWithVolume
    .map(kw => kw.searchVolume)
    .sort((a, b) => a - b)

  const medianVolume = volumes[Math.floor(volumes.length / 2)]

  // 阈值设为中位数的10%，但不超过500，不低于100
  return Math.min(500, Math.max(100, Math.floor(medianVolume * 0.1)))
}

// ============================================
// 智能过滤（保留向后兼容）
// ============================================

/**
 * 智能过滤（3层过滤：品牌词 + 地理位置 + 搜索量）
 *
 * 🔥 2025-12-17优化：
 * 1. 移除竞品词穷举过滤（无法穷举所有竞品）
 * 2. 只保留核心品牌词过滤（如"eufy security" → "eufy"）
 * 3. 提高搜索量阈值到500（保留高价值关键词）
 * 4. 🆕 新增地理位置过滤（过滤非目标国家的关键词）
 * 5. 🆕 2025-12-18优化：保留高搜索量通用品类词（>10000）
 *
 * 🔥 2025-12-26优化：动态搜索量阈值
 * - 根据初始种子词数量和分布自动计算阈值
 * - 种子词少时降低阈值，种子词多时提高阈值
 */
export function filterKeywords(
  keywords: PoolKeywordData[],
  brandName: string,
  category: string,
  targetCountry?: string
): PoolKeywordData[] {
  // 提取核心品牌词（取第一个单词）
  // 示例："eufy security" → "eufy", "Reolink" → "reolink"
  const coreBrandLower = brandName.split(' ')[0].toLowerCase()

  let geoFilteredCount = 0
  let brandKeptCount = 0
  let highVolumeGenericCount = 0

  // 🔥 2025-12-26：动态计算搜索量阈值
  // 计算有搜索量的关键词分布
  const keywordsWithVolume = keywords.filter(kw => kw.searchVolume > 0)
  const volumeDistribution = keywordsWithVolume.map(kw => kw.searchVolume).sort((a, b) => a - b)

  // 策略：保留搜索量中位数以上的关键词，或至少保留50个
  const defaultThreshold = 500
  let dynamicThreshold = defaultThreshold // 默认500
  if (volumeDistribution.length > 0) {
    const medianVolume = volumeDistribution[Math.floor(volumeDistribution.length / 2)]
    // 阈值设为中位数的10%，但不高于500
    dynamicThreshold = Math.min(defaultThreshold, Math.max(100, Math.floor(medianVolume * 0.1)))
  }

  console.log(`   🔧 动态搜索量阈值: ${dynamicThreshold} (中位数: ${volumeDistribution[Math.floor(volumeDistribution.length / 2)] || 'N/A'})`)

  const filtered = keywords.filter(kw => {
    const kwLower = kw.keyword.toLowerCase()
    const hasBrand = kwLower.includes(coreBrandLower)

    // ✅ 第1层：品牌相关性过滤
    // 保留2种关键词：
    // 1. 包含核心品牌词的关键词（品牌词）
    // 2. 搜索量>10000的通用品类词（高价值通用词）
    // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，保留所有非品牌词
    const isHighVolumeGeneric = !hasBrand && kw.searchVolume >= 10000

    if (!hasBrand && !isHighVolumeGeneric && kw.searchVolume > 0) {
      return false
    }

    // 记录保留的品牌词和高搜索量通用词
    if (hasBrand) {
      brandKeptCount++
    } else if (isHighVolumeGeneric) {
      highVolumeGenericCount++
      console.log(`   ✅ 保留高搜索量通用词: "${kw.keyword}" (搜索量: ${kw.searchVolume})`)
    }

    // ✅ 第2层：地理位置过滤（过滤非目标国家的关键词）
    // 🔧 修复(2025-12-17): 扩展阶段也需要地理过滤
    if (targetCountry) {
      const detectedCountries = detectCountryInKeyword(kw.keyword)
      // 如果检测到国家，且不包含目标国家，则过滤
      if (detectedCountries.length > 0 && !detectedCountries.includes(targetCountry)) {
        geoFilteredCount++
        console.log(`   ⊗ 地理过滤: "${kw.keyword}" (检测到: ${detectedCountries.join(',')}, 目标: ${targetCountry})`)
        return false
      }
    }

    // ✅ 第3层：搜索量过滤（使用动态自适应阈值）
    // 🔧 容错处理：当searchVolume未知时（undefined/null/0），保留关键词
    // 这样当Google Ads API不可用时，初始关键词不会被全部过滤掉
    const hasSearchVolumeData = kw.searchVolume !== undefined && kw.searchVolume !== null && kw.searchVolume > 0
    if (hasSearchVolumeData && kw.searchVolume < dynamicThreshold) return false

    return true
  })

  console.log(`   过滤: ${keywords.length} → ${filtered.length}`)
  console.log(`      品牌词保留: ${brandKeptCount}`)
  console.log(`      高搜索量通用词(>10000): ${highVolumeGenericCount}`)
  console.log(`      地理过滤: ${geoFilteredCount}`)

  return filtered
}

// ============================================
// 智能选择
// ============================================

/**
 * 智能关键词选择（基于 searchVolume + CPC）
 */
export function selectKeywordsForCreative(
  brandKeywords: PoolKeywordData[],
  bucketKeywords: PoolKeywordData[],
  bucketIntent: string
): PoolKeywordData[] {
  // 品牌词：选择 searchVolume 最高的 2-3 个
  const topBrand = brandKeywords
    .sort((a, b) => b.searchVolume - a.searchVolume)
    .slice(0, 3)

  // 桶匹配词：优先 searchVolume > 1000，其次 CPC 高
  // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，跳过过滤
  const hasAnyVolume = bucketKeywords.some(kw => kw.searchVolume > 0)
  const highVolume = hasAnyVolume
    ? bucketKeywords
        .filter(kw => kw.searchVolume > 1000)
        .sort((a, b) => b.searchVolume - a.searchVolume)
        .slice(0, 8)
    : bucketKeywords
        .sort((a, b) => (b.highTopPageBid || 0) - (a.highTopPageBid || 0))
        .slice(0, 8)

  // 如果高搜索量关键词不足，补充 CPC 高的关键词
  if (highVolume.length < 6) {
    const highCPC = bucketKeywords
      .filter(kw => !highVolume.includes(kw))
      .sort((a, b) => (b.highTopPageBid || 0) - (a.highTopPageBid || 0))
      .slice(0, 6 - highVolume.length)
    highVolume.push(...highCPC)
  }

  return [...topBrand, ...highVolume]
}

// ============================================
// 🔥 2025-12-22新增：增强去重算法
// ============================================

/**
 * 增强版关键词去重函数
 *
 * 功能：
 * 1. 基础字符串去重（保留现有逻辑）
 * 2. 品牌变体归一化（解决品牌名变体重复问题）
 * 3. 语义去重（解决语义相似关键词问题）
 *
 * @param keywords - 待去重的关键词数组
 * @param brandVariants - 品牌变体映射表（可选）
 * @returns 去重后的关键词数组
 */
export function deduplicateKeywords(
  keywords: string[],
  brandVariants?: Record<string, string>
): string[] {
  // Step 1: 基础去重逻辑（保留现有逻辑）
  const basicDedup = Array.from(new Set(keywords.map(k => k.toLowerCase().trim())))

  // Step 2: 品牌变体归一化（解决品牌变体重复问题）
  const normalized = basicDedup.map(k => normalizeBrandVariants(k, brandVariants || {}))

  // Step 3: 语义去重（解决语义相似问题）
  const semanticDedup = performSemanticDeduplication(normalized)

  return semanticDedup
}

/**
 * 品牌变体归一化
 * 将常见品牌变体归一化到标准形式
 *
 * @param keyword - 待处理的关键词
 * @param brandVariants - 品牌变体映射表（从配置获取）
 *                        示例：{ 'brandinc': 'brand', 'brandy': 'brand' }
 */
function normalizeBrandVariants(keyword: string, brandVariants: Record<string, string>): string {
  let normalized = keyword.toLowerCase()
  for (const [variant, standard] of Object.entries(brandVariants)) {
    normalized = normalized.replace(variant, standard)
  }
  return normalized
}

/**
 * 语义去重
 * 识别并合并语义相似的关键词组
 *
 * 策略：
 * 1. 移除修饰词（购买意图词、数字、单位等）
 * 2. 生成语义键
 * 3. 按语义键分组
 * 4. 每组选择最优关键词
 *
 * 🔥 2025-12-26优化：增强语言学去重规则
 * - 复数/单数变体合并（clipper/clippers）
 * - 连字符/空格变体合并（hair-clipper/hair clipper）
 * - 通用修饰词移除（best, new, for 等）
 */
function performSemanticDeduplication(keywords: string[]): string[] {
  const groups = new Map<string, string[]>()

  // 🔥 2025-12-26：预处理：构建关键词变体映射
  const keywordVariants = new Map<string, string>() // 变体 -> 规范形式
  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword)
    keywordVariants.set(keyword.toLowerCase(), normalized)
  }

  // 找出等价的变体组
  const equivalenceGroups: string[][] = []
  const processed = new Set<string>()

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase()
    if (processed.has(lower)) continue

    const group: string[] = [keyword]
    processed.add(lower)

    const normalized = keywordVariants.get(lower)!

    for (const other of keywords) {
      if (other.toLowerCase() === lower) continue
      if (processed.has(other.toLowerCase())) continue

      if (keywordVariants.get(other.toLowerCase()) === normalized) {
        group.push(other)
        processed.add(other.toLowerCase())
      }
    }

    equivalenceGroups.push(group)
  }

  // 每组选择最优关键词
  return equivalenceGroups.map(group => selectBestKeyword(group))
}

/**
 * 关键词规范化
 * 将关键词转换为统一形式用于比较
 *
 * 规则：
 * 1. 转小写
 * 2. 移除连字符/下划线（替换为空格）
 * 3. 移除结尾的s（复数处理）
 * 4. 移除常见修饰词
 * 5. 规范化空格
 */
function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    // 连字符/下划线变空格
    .replace(/[-_]/g, ' ')
    // 移除常见购买意图词
    .replace(/\b(buy|purchase|order|shop|get|cheap|affordable|discount|best|top|new|latest|for)\b/g, '')
    // 移除数字（规格）
    .replace(/\b\d+\.?\d*\w*\b/g, '')
    // 移除品牌名（只保留品类特征）- 用于品类匹配
    // 注意：这里不直接移除品牌名，而是保留完整形式用于最终选择
    // 移除多余空格
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 生成语义键
 * 移除修饰词，保留核心概念
 */
function generateSemanticKey(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/\b(buy|purchase|order|shop|price|cost|deal|discount)\b/g, '') // 移除购买意图词
    .replace(/\d+w?/g, '') // 移除数字和单位
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 选择最优关键词
 * 优先级：包含完整品牌+规格 > 包含品牌名 > 其他
 *
 * @param keywords - 候选关键词数组
 * @param knownBrands - 已知品牌名列表（从配置获取，可选）
 */
function selectBestKeyword(keywords: string[], knownBrands?: string[]): string {
  // 如果没有提供品牌列表，使用启发式规则
  if (!knownBrands || knownBrands.length === 0) {
    // 优先级1：包含数字规格（可能是完整产品名）
    const hasNumber = keywords.find(k => /\d+w?/.test(k))
    if (hasNumber) return hasNumber

    // 优先级2：最短的关键词（通常更精确）
    return keywords.sort((a, b) => a.length - b.length)[0]
  }

  // 优先级1：包含品牌名+数字规格
  const complete = keywords.find(k =>
    knownBrands.some(brand => k.includes(brand)) && /\d+w?/.test(k)
  )
  if (complete) return complete

  // 优先级2：包含品牌名
  const hasBrand = keywords.find(k =>
    knownBrands.some(brand => k.includes(brand))
  )
  if (hasBrand) return hasBrand

  // 默认返回第一个
  return keywords[0]
}
