/**
 * 关键词池辅助函数
 * 🔥 2025-12-16新增：全量扩展、智能过滤、智能选择
 */

import type { PoolKeywordData } from './offer-keyword-pool'
import { expandKeywordsWithSeeds } from './unified-keyword-service'
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
 * 全量关键词扩展（替换3轮品牌种子词策略）
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
  console.log(`\n📋 全量关键词扩展策略:`)
  console.log(`   初始关键词数量: ${initialKeywords.length}`)

  const allKeywords = [...initialKeywords]
  const seedKeywords = initialKeywords.map(kw => kw.keyword)

  console.log(`   扩展种子词: ${seedKeywords.length}个`)

  try {
    // 批量调用 Keyword Planner（利用Redis缓存）
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
      maxKeywords: DEFAULTS.maxKeywords,  // 🔥 修复(2025-12-17): 使用常量避免硬编码
      minSearchVolume: DEFAULTS.minSearchVolume  // 🔥 降低搜索量门槛，保留更多有价值关键词
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

    console.log(`   扩展后关键词数量: ${allKeywords.length}`)
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
    if (hasSearchVolumeData && kw.searchVolume < 1) return false  // 动态阈值由上层处理

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
