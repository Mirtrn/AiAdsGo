/**
 * 关键词池辅助函数
 * 🔥 2025-12-16新增：全量扩展、智能过滤、智能选择
 */

import type { PoolKeywordData } from './offer-keyword-pool'
import { expandKeywordsWithSeeds } from './unified-keyword-service'

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
      maxKeywords: 5000,  // 🔥 修复(2025-12-17): 大幅增加关键词上限，避免过早截断
      minSearchVolume: 100  // 🔥 降低搜索量门槛，保留更多有价值关键词
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
 * 智能过滤（2层过滤，无硬编码配置）
 */
export function filterKeywords(
  keywords: PoolKeywordData[],
  brandName: string,
  category: string
): PoolKeywordData[] {
  const brandLower = brandName.toLowerCase()
  const coreBrandLower = brandName.split(' ')[0].toLowerCase()

  const filtered = keywords.filter(kw => {
    const kwLower = kw.keyword.toLowerCase()

    // 第1层：竞品过滤（动态检测大写品牌词）
    if (isCompetitorKeyword(kw.keyword, brandName)) return false

    // 第2层：品牌相关性（必须包含品牌名）
    const hasBrand = kwLower.includes(brandLower) || kwLower.includes(coreBrandLower)
    if (!hasBrand) return false

    // 第3层：搜索量过滤
    // 🔧 容错处理：当searchVolume未知时（undefined/null/0），保留关键词
    // 这样当Google Ads API不可用时，初始关键词不会被全部过滤掉
    const hasSearchVolumeData = kw.searchVolume !== undefined && kw.searchVolume !== null && kw.searchVolume > 0
    if (hasSearchVolumeData && kw.searchVolume < 100) return false

    return true
  })

  console.log(`   过滤: ${keywords.length} → ${filtered.length}`)

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
