/**
 * 统一的关键词数据获取服务
 *
 * 问题背景：
 * - generateKeywordHistoricalMetrics：返回精确匹配的搜索量
 * - generateKeywordIdeas：返回相关建议的搜索量（可能包含广泛匹配）
 * - 同一关键词在两个API可能返回不同值，导致数据不一致
 *
 * 解决方案：
 * - 统一使用 Historical Metrics API 作为主数据源（精确匹配）
 * - Ideas API 仅用于关键词发现，其搜索量数据用 Historical Metrics 校准
 */

import { getKeywordSearchVolumes } from './keyword-planner'
import { getKeywordIdeas } from './google-ads-keyword-planner'

export interface UnifiedKeywordData {
  keyword: string
  searchVolume: number // 精确搜索量（来自Historical Metrics）
  competition: string
  competitionIndex: number
  source: 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED'
  matchType: 'EXACT' // 统一使用精确匹配
}

/**
 * 统一获取关键词数据（方案1实现）
 *
 * 流程：
 * 1. 基础关键词直接查询精确搜索量
 * 2. 扩展关键词先发现，再查询精确搜索量
 * 3. 合并时优先使用精确搜索量数据
 */
export async function getUnifiedKeywordData(params: {
  // 基础关键词（AI生成的关键词）
  baseKeywords: string[]
  // 是否启用关键词扩展
  enableExpansion: boolean
  // 扩展参数
  expansionSeeds?: string[]
  // 地理和语言定位
  country: string
  language: string
  // Google Ads账号信息
  customerId?: string
  refreshToken?: string
  accountId?: number
  userId?: number
  // 品牌名（用于过滤）
  brandName?: string
  // Google Ads API凭证（可选，不提供则使用环境变量）
  clientId?: string
  clientSecret?: string
  developerToken?: string
}): Promise<UnifiedKeywordData[]> {
  console.log('\n🔄 统一关键词数据获取服务启动')
  console.log(`   基础关键词: ${params.baseKeywords.length}个`)
  console.log(`   扩展模式: ${params.enableExpansion ? '启用' : '禁用'}`)

  const results: UnifiedKeywordData[] = []
  const keywordMap = new Map<string, UnifiedKeywordData>()

  // ==========================================
  // 第1步：获取基础关键词的精确搜索量
  // ==========================================
  console.log('\n📊 第1步：查询基础关键词精确搜索量 (Historical Metrics API)')
  try {
    const baseVolumes = await getKeywordSearchVolumes(
      params.baseKeywords,
      params.country,
      params.language,
      params.userId
    )

    baseVolumes.forEach(vol => {
      const canonical = vol.keyword.toLowerCase().trim()
      keywordMap.set(canonical, {
        keyword: vol.keyword,
        searchVolume: vol.avgMonthlySearches,
        competition: vol.competition,
        competitionIndex: vol.competitionIndex,
        source: 'AI_GENERATED',
        matchType: 'EXACT'
      })
    })

    console.log(`   ✅ 获取 ${baseVolumes.length} 个基础关键词的精确搜索量`)
  } catch (error: any) {
    console.error(`   ❌ 查询基础关键词失败:`, error.message)
    // 失败时使用默认值
    params.baseKeywords.forEach(kw => {
      const canonical = kw.toLowerCase().trim()
      keywordMap.set(canonical, {
        keyword: kw,
        searchVolume: 0,
        competition: 'UNKNOWN',
        competitionIndex: 0,
        source: 'AI_GENERATED',
        matchType: 'EXACT'
      })
    })
  }

  // ==========================================
  // 第2步：关键词扩展（如果启用）
  // ==========================================
  if (params.enableExpansion && params.customerId && params.refreshToken && params.expansionSeeds) {
    console.log('\n📊 第2步：关键词扩展发现 (Keyword Ideas API)')
    console.log(`   种子关键词: ${params.expansionSeeds.slice(0, 5).join(', ')}${params.expansionSeeds.length > 5 ? '...' : ''}`)

    try {
      // 2.1 通过Ideas API发现新关键词
      const keywordIdeas = await getKeywordIdeas({
        customerId: params.customerId,
        refreshToken: params.refreshToken,
        seedKeywords: params.expansionSeeds,
        targetCountry: params.country,
        targetLanguage: params.language,
        accountId: params.accountId,
        userId: params.userId,
        // 传递Google Ads API凭证
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        developerToken: params.developerToken
      })

      console.log(`   📋 Ideas API 返回 ${keywordIdeas.length} 个建议关键词`)

      // 2.2 过滤出新关键词（不在基础关键词中）
      const newKeywords = keywordIdeas
        .filter(idea => {
          const canonical = idea.text.toLowerCase().trim()
          return !keywordMap.has(canonical)
        })
        .filter(idea => idea.avgMonthlySearches > 500) // 过滤低搜索量

      console.log(`   🆕 发现 ${newKeywords.length} 个新关键词（搜索量>500）`)

      if (newKeywords.length > 0) {
        // 2.3 关键：使用Historical Metrics API获取这些新关键词的精确搜索量
        console.log(`   🔍 查询新关键词的精确搜索量 (Historical Metrics API)`)

        const newKeywordTexts = newKeywords.map(kw => kw.text)
        const exactVolumes = await getKeywordSearchVolumes(
          newKeywordTexts,
          params.country,
          params.language,
          params.userId
        )

        // 2.4 使用精确搜索量数据（覆盖Ideas API的估算值）
        exactVolumes.forEach(vol => {
          const canonical = vol.keyword.toLowerCase().trim()
          keywordMap.set(canonical, {
            keyword: vol.keyword,
            searchVolume: vol.avgMonthlySearches, // 使用精确值
            competition: vol.competition,
            competitionIndex: vol.competitionIndex,
            source: 'KEYWORD_EXPANSION',
            matchType: 'EXACT'
          })
        })

        console.log(`   ✅ 更新 ${exactVolumes.length} 个扩展关键词的精确搜索量`)

        // 2.5 记录数据差异（用于调试）
        let differenceCount = 0
        exactVolumes.forEach(exact => {
          const idea = newKeywords.find(kw => kw.text.toLowerCase() === exact.keyword.toLowerCase())
          if (idea && idea.avgMonthlySearches !== exact.avgMonthlySearches) {
            differenceCount++
            console.log(`   ⚠️  搜索量差异: "${exact.keyword}" Ideas=${idea.avgMonthlySearches} → Exact=${exact.avgMonthlySearches}`)
          }
        })

        if (differenceCount > 0) {
          console.log(`   📊 发现 ${differenceCount}/${exactVolumes.length} 个关键词的搜索量存在差异（已使用精确值）`)
        }
      }
    } catch (error: any) {
      console.error(`   ❌ 关键词扩展失败:`, error.message)
    }
  }

  // ==========================================
  // 第3步：过滤和排序
  // ==========================================
  console.log('\n📊 第3步：过滤和排序')

  const brandNameLower = params.brandName?.toLowerCase() || ''
  const allKeywords = Array.from(keywordMap.values())

  // 过滤规则：
  // 1. 保留品牌词（不管搜索量）
  // 2. 过滤掉搜索量 < 500 的非品牌词
  const filteredKeywords = allKeywords.filter(kw => {
    const keywordLower = kw.keyword.toLowerCase()
    const isBrandKeyword = brandNameLower && keywordLower.includes(brandNameLower)

    if (isBrandKeyword) {
      return true
    }

    if (kw.searchVolume < 500) {
      console.log(`   🔧 过滤低搜索量: "${kw.keyword}" (${kw.searchVolume}/月)`)
      return false
    }

    return true
  })

  // 按搜索量降序排序
  filteredKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  console.log(`   ✅ 最终关键词: ${filteredKeywords.length}/${allKeywords.length}`)
  console.log(`   📈 搜索量范围: ${filteredKeywords[filteredKeywords.length - 1]?.searchVolume || 0} - ${filteredKeywords[0]?.searchVolume || 0}/月`)

  return filteredKeywords
}

/**
 * 多轮扩展查询（保持向后兼容）
 *
 * 执行多轮关键词扩展，每轮使用不同的种子词
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
  // 多轮种子词
  roundSeeds: Array<{ round: number; name: string; seeds: string[] }>
}): Promise<UnifiedKeywordData[]> {
  console.log('\n🔄 多轮扩展模式启动')

  // 第1步：获取基础关键词数据
  let allKeywords = await getUnifiedKeywordData({
    baseKeywords: params.baseKeywords,
    enableExpansion: false,
    country: params.country,
    language: params.language,
    userId: params.userId,
    brandName: params.brandName
  })

  const existingKeywordsSet = new Set(allKeywords.map(kw => kw.keyword.toLowerCase()))
  const allNewHighVolumeKeywords: string[] = []

  // 第2步：执行多轮扩展
  for (let roundIndex = 0; roundIndex < params.roundSeeds.length; roundIndex++) {
    const roundInfo = params.roundSeeds[roundIndex]

    if (roundInfo.seeds.length === 0) {
      console.log(`\n📍 第 ${roundInfo.round} 轮 [${roundInfo.name}]: 跳过（无种子关键词）`)
      continue
    }

    console.log(`\n📍 第 ${roundInfo.round} 轮 [${roundInfo.name}]`)

    const roundKeywords = await getUnifiedKeywordData({
      baseKeywords: [],
      enableExpansion: true,
      expansionSeeds: roundInfo.seeds,
      country: params.country,
      language: params.language,
      customerId: params.customerId,
      refreshToken: params.refreshToken,
      accountId: params.accountId,
      userId: params.userId,
      brandName: params.brandName
    })

    // 过滤出新关键词
    const newKeywords = roundKeywords.filter(kw => {
      const canonical = kw.keyword.toLowerCase()
      return !existingKeywordsSet.has(canonical)
    })

    if (newKeywords.length > 0) {
      console.log(`   🆕 添加 ${newKeywords.length} 个新关键词`)
      newKeywords.slice(0, 10).forEach(kw => {
        console.log(`      - "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月)`)
      })
      if (newKeywords.length > 10) {
        console.log(`      ... 及其他 ${newKeywords.length - 10} 个关键词`)
      }

      // 添加到总列表
      allKeywords = [...allKeywords, ...newKeywords]
      newKeywords.forEach(kw => {
        existingKeywordsSet.add(kw.keyword.toLowerCase())
      })

      // 收集高搜索量关键词用于下一轮
      const highVolumeNew = newKeywords
        .filter(kw => kw.searchVolume > 1000)
        .map(kw => kw.keyword)
      allNewHighVolumeKeywords.push(...highVolumeNew)
    } else {
      console.log(`   ℹ️  未发现新关键词`)
    }
  }

  // 最终排序
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  console.log('\n✅ 多轮扩展完成')
  console.log(`   总关键词数: ${allKeywords.length}`)
  console.log(`   新增关键词: ${allKeywords.filter(kw => kw.source === 'KEYWORD_EXPANSION').length}`)

  return allKeywords
}
