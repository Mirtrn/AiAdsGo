/**
 * 关键词池辅助函数
 * 🔥 2025-12-16新增：全量扩展、智能过滤、智能选择
 */

import type { PoolKeywordData } from './offer-keyword-pool'
import { expandKeywordsWithSeeds } from './unified-keyword-service'
import { getTrendsKeywords, getPopularSearchTerms } from './google-trends'
import { DEFAULTS } from './keyword-constants'
import { detectCountryInKeyword } from './google-suggestions'

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
// 全量扩展
// ============================================

/**
 * 全量关键词扩展（🔥 2025-12-24 新增：集成 Google Trends 数据源）
 *
 * 策略：
 * 1. Keyword Planner 扩展（主数据源）
 * 2. Google Trends 变体扩展（补充长尾词）
 * 3. 热门品类词补充
 */
export async function expandAllKeywords(
  initialKeywords: PoolKeywordData[],
  brandName: string,
  category: string,
  targetCountry: string,
  targetLanguage: string,
  userId?: number,
  customerId?: string,
  refreshToken?: string,
  accountId?: number,
  clientId?: string,
  clientSecret?: string,
  developerToken?: string
): Promise<PoolKeywordData[]> {
  console.log(`\n📋 全量关键词扩展策略 (🔥 v4.17 增强版):`)
  console.log(`   初始关键词数量: ${initialKeywords.length}`)

  const allKeywords = [...initialKeywords]
  const seedKeywords = initialKeywords.map(kw => kw.keyword)

  console.log(`   扩展种子词: ${seedKeywords.length}个`)

  try {
    // ========== 阶段1: Keyword Planner 扩展 ==========
    console.log(`\n   📊 阶段1: Keyword Planner 扩展`)
    const expandedResults = await expandKeywordsWithSeeds({
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

    // 合并结果（去重）
    expandedResults.forEach(kw => {
      if (!allKeywords.find(k => k.keyword === kw.keyword)) {
        allKeywords.push({
          keyword: kw.keyword,
          searchVolume: kw.searchVolume,
          competition: kw.competition,
          competitionIndex: kw.competitionIndex,
          lowTopPageBid: kw.lowTopPageBid,
          highTopPageBid: kw.highTopPageBid,
          source: 'EXPANDED',
          matchType: kw.matchType
        })
      }
    })

    console.log(`   Keyword Planner 扩展后: ${allKeywords.length} 个`)

    // ========== 阶段2: Google Trends 扩展（🔥 2025-12-24 新增） ==========
    console.log(`\n   📊 阶段2: Google Trends 变体扩展`)

    try {
      const trendsKeywords = await getTrendsKeywords(
        seedKeywords.slice(0, 10), // 限制种子词数量，避免过多变体
        brandName,
        category
      )

      // 合并 Trends 关键词
      let trendsAdded = 0
      trendsKeywords.forEach(kw => {
        if (!allKeywords.find(k => k.keyword.toLowerCase() === kw.keyword.toLowerCase())) {
          allKeywords.push(kw)
          trendsAdded++
        }
      })
      console.log(`   Google Trends 新增: ${trendsAdded} 个`)
    } catch (error: any) {
      console.warn(`   ⚠️ Google Trends 扩展失败: ${error.message}`)
    }

    // ========== 阶段3: 热门品类词补充（🔥 2025-12-24 新增） ==========
    console.log(`\n   📊 阶段3: 热门品类词补充`)

    const popularTerms = getPopularSearchTerms(category)
    let popularAdded = 0

    for (const term of popularTerms) {
      // 检查是否已存在
      const exists = allKeywords.some(k =>
        k.keyword.toLowerCase().includes(term.toLowerCase()) ||
        term.toLowerCase().includes(k.keyword.toLowerCase())
      )

      if (!exists) {
        allKeywords.push({
          keyword: `${brandName} ${term}`,
          searchVolume: 0,
          competition: 'MEDIUM',
          competitionIndex: 50,
          lowTopPageBid: 0,
          highTopPageBid: 0,
          source: 'POPULAR',
          matchType: 'BROAD'
        })
        popularAdded++
      }
    }

    console.log(`   热门品类词新增: ${popularAdded} 个`)

    console.log(`\n   📊 扩展后关键词数量: ${allKeywords.length}`)

    // 🔥 2025-12-22新增：应用增强去重算法
    // 从关键词列表中提取纯文本进行去重
    const keywordTexts = allKeywords.map(k => k.keyword)
    const deduplicatedTexts = deduplicateKeywords(keywordTexts, {
      // 示例品牌变体映射（实际使用时从配置获取）
      // 'brandinc': 'brand',
      // 'brandy': 'brand'
    })

    // 根据去重后的文本列表过滤PoolKeywordData
    const deduplicatedKeywords = allKeywords.filter(kw =>
      deduplicatedTexts.includes(kw.keyword.toLowerCase().trim())
    )

    console.log(`   去重后关键词数量: ${deduplicatedKeywords.length}`)
    console.log(`   去重率: ${((allKeywords.length - deduplicatedKeywords.length) / allKeywords.length * 100).toFixed(1)}%`)

    return deduplicatedKeywords
  } catch (error: any) {
    console.error(`   ⚠️ 关键词扩展失败: ${error.message}`)
    console.log(`   使用初始关键词继续`)
  }

  return allKeywords
}

// ============================================
// 智能过滤
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
    const isHighVolumeGeneric = !hasBrand && kw.searchVolume >= 10000

    if (!hasBrand && !isHighVolumeGeneric) {
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
  const highVolume = bucketKeywords
    .filter(kw => kw.searchVolume > 1000)
    .sort((a, b) => b.searchVolume - a.searchVolume)
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
