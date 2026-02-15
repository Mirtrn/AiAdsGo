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
import { getDatabase } from './db'
import { getKeywordSearchVolumes } from './keyword-planner'
import { getTrendsKeywords } from './google-trends'
import { DEFAULTS } from './keyword-constants'
import { getKeywordPlannerUrlSeedForOffer } from './keyword-planner-site-filter'
import { normalizeCountryCode, normalizeLanguageCode } from './language-country-codes'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
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
  isBrandIrrelevant,
  isBrandConcatenation,
  detectPlatformsInKeyword,
  extractPlatformFromUrl
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

function buildPlannerBrandKeywords(brandName: string, _category: string): string[] {
  const normalizedFull = normalizeGoogleAdsKeyword(brandName)
  if (normalizedFull) return [normalizedFull]
  return getPureBrandKeywords(brandName)
}

function buildBrandLikePattern(brand: string): string | null {
  const normalized = normalizeGoogleAdsKeyword(brand)
  if (!normalized) return null
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  return `%${tokens.join('%')}%`
}

async function getGlobalKeywordCandidates(params: {
  brandName: string
  targetCountry: string
  targetLanguage: string
  limit?: number
}): Promise<PoolKeywordData[]> {
  const { brandName, targetCountry, targetLanguage, limit = DEFAULTS.maxKeywords } = params
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  if (!targetCountry || pureBrandKeywords.length === 0) return []

  const language = normalizeLanguageCode(targetLanguage || 'en')
  const normalizedCountry = normalizeCountryCode(targetCountry)
  const countryCandidates = Array.from(
    new Set(
      [normalizedCountry, targetCountry, targetCountry?.toUpperCase?.()]
        .filter((value): value is string => Boolean(value && value.trim()))
        .map(value => value.trim().toUpperCase())
    )
  )
  if (countryCandidates.length === 0) return []

  const patterns = pureBrandKeywords
    .map(buildBrandLikePattern)
    .filter((p): p is string => Boolean(p))

  if (patterns.length === 0) return []

  const db = await getDatabase()
  const countryPlaceholders = countryCandidates.map(() => '?').join(', ')
  const clauses = patterns.map(() => 'LOWER(keyword) LIKE ?').join(' OR ')

  try {
    const rows = await db.query(
      `SELECT keyword, search_volume, competition_level, avg_cpc_micros
       FROM global_keywords
       WHERE country IN (${countryPlaceholders}) AND language = ? AND (${clauses})
       ORDER BY search_volume DESC
       LIMIT ?`,
      [...countryCandidates, language, ...patterns, limit]
    ) as Array<{
      keyword: string
      search_volume: number | string | null
      competition_level?: string | null
      avg_cpc_micros?: number | string | null
    }>

    const candidates = new Map<string, PoolKeywordData>()
    for (const row of rows) {
      const canonical = normalizeGoogleAdsKeyword(row.keyword)
      if (!canonical) continue

      const searchVolume = Number(row.search_volume) || 0
      const isConcatenatedBrand = searchVolume > 0 && isBrandConcatenation(canonical, brandName)
      if (!containsPureBrand(canonical, pureBrandKeywords) && !isConcatenatedBrand) continue

      const avgCpcMicros = Number(row.avg_cpc_micros) || 0
      const isPureBrand = isPureBrandKeyword(canonical, pureBrandKeywords)
      const matchType = isPureBrand ? 'EXACT' : 'PHRASE'

      const existing = candidates.get(canonical)
      if (!existing || searchVolume > existing.searchVolume) {
        candidates.set(canonical, {
          keyword: canonical,
          searchVolume,
          competition: row.competition_level || 'UNKNOWN',
          competitionIndex: 0,
          lowTopPageBid: avgCpcMicros / 1_000_000,
          highTopPageBid: avgCpcMicros / 1_000_000,
          source: 'GLOBAL_KEYWORDS',
          matchType,
          isPureBrand
        })
      }
    }

    if (candidates.size > 0) {
      console.log(`   📦 全局关键词库命中: ${candidates.size} 个`)
    }

    return Array.from(candidates.values())
  } catch (error: any) {
    console.warn(`   ⚠️ 全局关键词库查询失败: ${error.message}`)
    return []
  }
}

function mergeGlobalCandidates(params: {
  allKeywords: Map<string, PoolKeywordData>
  candidates: PoolKeywordData[]
  pureBrandKeywords: string[]
  brandName: string
}): { added: number; updated: number } {
  const { allKeywords, candidates, pureBrandKeywords, brandName } = params
  let added = 0
  let updated = 0

  for (const kw of candidates) {
    const canonical = normalizeGoogleAdsKeyword(kw.keyword)
    if (!canonical) continue
    const isConcatenatedBrand = (kw.searchVolume || 0) > 0 && isBrandConcatenation(canonical, brandName)
    if (!containsPureBrand(canonical, pureBrandKeywords) && !isConcatenatedBrand) continue

    const existing = allKeywords.get(canonical)
    const isPureBrand = isPureBrandKeyword(canonical, pureBrandKeywords)
    const matchType = isPureBrand ? 'EXACT' : 'PHRASE'
    const candidate = {
      ...kw,
      keyword: canonical,
      matchType: kw.matchType || matchType,
      isPureBrand: kw.isPureBrand ?? isPureBrand,
      source: kw.source || 'GLOBAL_KEYWORDS'
    }

    if (!existing) {
      allKeywords.set(canonical, candidate)
      added++
      continue
    }

    if ((existing.searchVolume || 0) === 0 && (candidate.searchVolume || 0) > 0) {
      allKeywords.set(canonical, {
        ...existing,
        ...candidate,
        source: existing.source || candidate.source
      })
      updated++
    }
  }

  return { added, updated }
}

function resolveCountryCodeSet(country?: string): Set<string> {
  if (!country) return new Set()
  const normalized = normalizeCountryCode(country)
  return new Set(
    [country, country.toUpperCase?.(), normalized]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map(value => value.trim().toUpperCase())
  )
}

function isGeoMismatch(keyword: string, targetCountry?: string): boolean {
  if (!targetCountry) return false
  const detectedCountries = detectCountryInKeyword(keyword)
  if (detectedCountries.length === 0) return false

  const targetCodes = resolveCountryCodeSet(targetCountry)
  if (targetCodes.size === 0) return false

  const normalizedDetectedCodes = new Set(
    detectedCountries
      .map(code => normalizeCountryCode(code))
      .filter(Boolean)
      .map(code => code.toUpperCase())
  )

  for (const code of targetCodes) {
    if (normalizedDetectedCodes.has(code)) {
      return false
    }
  }

  return true
}

function shouldFilterSemanticKeyword(keyword: string, productUrl?: string): boolean {
  if (!isSemanticQuery(keyword)) return false

  const urlPlatform = productUrl ? extractPlatformFromUrl(productUrl) : null
  if (!urlPlatform) return true

  const keywordPlatforms = detectPlatformsInKeyword(keyword)
  if (keywordPlatforms.length === 0) return true

  return !keywordPlatforms.includes(urlPlatform)
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
  developerToken?: string,
  progress?: (info: { phase?: 'seed-volume' | 'expand-round' | 'volume-batch' | 'service-step' | 'filter' | 'cluster' | 'save'; message: string; current?: number; total?: number }) => Promise<void> | void,
  plannerMinSearchVolume?: number,
  allowNonBrandFromPlanner?: boolean,
  plannerDecision?: { allowNonBrandFromPlanner?: boolean }
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
      pageUrl: offer ? getKeywordPlannerUrlSeedForOffer(offer, { allowMarketplaceProductUrl: true }) : undefined,
      offer,
      userId,
      customerId,
      refreshToken,
      accountId,
      clientId,
      clientSecret,
      developerToken,
      minSearchVolume: plannerMinSearchVolume ?? DEFAULTS.minSearchVolume,
      allowNonBrandFromPlanner,
      plannerDecision,
      progress
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
      userId,
      progress
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
  pageUrl?: string
  offer?: Offer
  userId?: number
  customerId?: string
  refreshToken?: string
  accountId?: number
  clientId?: string
  clientSecret?: string
  developerToken?: string
  minSearchVolume?: number
  allowNonBrandFromPlanner?: boolean
  plannerDecision?: { allowNonBrandFromPlanner?: boolean }
  progress?: (info: { phase?: 'seed-volume' | 'expand-round' | 'volume-batch' | 'service-step' | 'filter' | 'cluster' | 'save'; message: string; current?: number; total?: number }) => Promise<void> | void
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
    pageUrl,
    offer,
    userId,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken,
    minSearchVolume,
    allowNonBrandFromPlanner,
    plannerDecision,
    progress
  } = params

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const plannerBrandKeywords = buildPlannerBrandKeywords(brandName, category)
  const fullBrand = normalizeGoogleAdsKeyword(brandName)
  const fullBrandKeywords = fullBrand ? [fullBrand] : []
  const minFullBrandCount = DEFAULTS.minKeywordsTarget
  let allowNonBrand = allowNonBrandFromPlanner ?? false
  const allKeywords = new Map<string, PoolKeywordData>()
  const maxRounds = 3
  const topN = 20
  let keywordPlannerReturned = false
  let usedNoSiteFilterSupplement = false

  const fallbackKeywords: PoolKeywordData[] = (() => {
    if (initialKeywords.length > 0) return initialKeywords
    if (pureBrandKeywords.length > 0) {
      return pureBrandKeywords.map(keyword => ({
        keyword,
        searchVolume: 0,
        source: 'PROVIDED',
        matchType: 'BROAD',
        isPureBrand: true,
      }))
    }
    return []
  })()

  const expandFallback = async (): Promise<PoolKeywordData[]> => {
    if (offer && userId) {
      return expandForServiceAccount({
        initialKeywords,
        brandName,
        category,
        targetCountry,
        targetLanguage,
        offer,
        userId,
        progress
      })
    }
    return fallbackKeywords
  }

  // ✅ Always seed with the canonical pure-brand keyword to avoid empty brand bucket
  // when Keyword Planner doesn't return the seed itself (e.g. "Dr. Mercola" → "dr mercola").
  for (const token of pureBrandKeywords) {
    const canonical = normalizeGoogleAdsKeyword(token)
    if (!canonical) continue
    if (allKeywords.has(canonical)) continue
    allKeywords.set(canonical, {
      keyword: canonical,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source: 'BRAND_SEED',
      matchType: 'EXACT',
      isPureBrand: true,
    })
  }

  // 🔧 兜底：缺少 OAuth 必要信息时，不生成“空关键词池”
  if (!customerId || !userId) {
    console.warn(`   ⚠️ 缺少 customerId 或 userId，跳过Keyword Planner查询，回退到初始关键词(${fallbackKeywords.length}个)`)
    return expandFallback()
  }

  // 初始化种子词：强制包含纯品牌词，避免种子漂移到通用品类词
  const initialBrandSeeds = initialKeywords
    .map(kw => normalizeGoogleAdsKeyword(kw.keyword))
    .filter(Boolean)
    .filter(kw => containsPureBrand(kw, pureBrandKeywords))
  const seedKeywordsSet = new Set<string>([...plannerBrandKeywords, ...initialBrandSeeds])
  let seedKeywords = Array.from(seedKeywordsSet)

  console.log(`   初始种子词: ${seedKeywords.length}个`)

  try {
    // 迭代查询Keyword Planner
    for (let round = 1; round <= maxRounds; round++) {
      await progress?.({
        phase: 'expand-round',
        current: round,
        total: maxRounds,
        message: `关键词池扩展 Round ${round}/${maxRounds}`
      })
      console.log(`\n   📊 Round ${round}/${maxRounds}: Keyword Planner 查询`)
      console.log(`      种子词: ${seedKeywords.slice(0, 5).join(', ')}${seedKeywords.length > 5 ? '...' : ''}`)

      const primaryResults = await expandKeywordsWithSeeds({
        expansionSeeds: seedKeywords,
        country: targetCountry,
        language: targetLanguage,
        userId,
        brandName,
        pageUrl,
        customerId,
        refreshToken,
        accountId,
        clientId,
        clientSecret,
        developerToken,
        maxKeywords: DEFAULTS.maxKeywords,
        minSearchVolume: minSearchVolume ?? DEFAULTS.minSearchVolume,
        onProgress: progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'volume-batch',
                current: info.current,
                total: info.total,
                message: `关键词池搜索量 Round ${round}/${maxRounds} · ${info.message}`
              })
          : undefined
      })

      let results = primaryResults

      const brandCountFromSiteFilter = fullBrandKeywords.length > 0
        ? primaryResults.filter(kw => containsPureBrand(kw.keyword, fullBrandKeywords)).length
        : 0

      if (!usedNoSiteFilterSupplement && pageUrl && fullBrandKeywords.length > 0 && brandCountFromSiteFilter < minFullBrandCount) {
        console.log(`      ⚠️ 站点过滤命中品牌词较少(${brandCountFromSiteFilter}/${minFullBrandCount})，补充无站点过滤查询`)
        const supplementalResults = await expandKeywordsWithSeeds({
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
          minSearchVolume: minSearchVolume ?? DEFAULTS.minSearchVolume,
          onProgress: progress
            ? (info: { message: string; current?: number; total?: number }) =>
                progress({
                  phase: 'volume-batch',
                  current: info.current,
                  total: info.total,
                  message: `关键词池搜索量 Round ${round}/${maxRounds} · ${info.message}`
                })
            : undefined
        })

        const merged = new Map<string, typeof supplementalResults[number]>()
        for (const kw of primaryResults) {
          merged.set(kw.keyword.toLowerCase(), kw)
        }
        for (const kw of supplementalResults) {
          const key = kw.keyword.toLowerCase()
          const existing = merged.get(key)
          if (!existing || (kw.searchVolume || 0) > (existing.searchVolume || 0)) {
            merged.set(key, kw)
          }
        }
        results = Array.from(merged.values())
        usedNoSiteFilterSupplement = true
        allowNonBrand = true
        if (plannerDecision) {
          plannerDecision.allowNonBrandFromPlanner = true
        }
      }

      console.log(`      返回 ${results.length} 个关键词`)
      if (results.length > 0) {
        keywordPlannerReturned = true
      }

      if (!allowNonBrand && fullBrandKeywords.length > 0) {
        const fullBrandCount = results.filter(kw => containsPureBrand(kw.keyword, fullBrandKeywords)).length
        if (fullBrandCount < minFullBrandCount) {
          allowNonBrand = true
          if (plannerDecision) {
            plannerDecision.allowNonBrandFromPlanner = true
          }
          console.log(`      ⚠️ 完整品牌词命中较少(${fullBrandCount}/${minFullBrandCount})，允许保留 Keyword Planner 非品牌词`)
        }
      }

      // 处理结果：只保留包含“纯品牌词”的关键词（不拼接造词）
      let newCount = 0
      let updatedCount = 0
      let brandRelatedAdded = 0
      let genericSkipped = 0
      for (const kw of results) {
        const keywordText = normalizeGoogleAdsKeyword(kw.keyword)

        if (!keywordText) continue

        const isBrandRelated = containsPureBrand(keywordText, pureBrandKeywords) || allowNonBrand
        if (!isBrandRelated) {
          genericSkipped++
          continue
        }

        const existing = allKeywords.get(keywordText)
        const isPureBrand = isPureBrandKeyword(keywordText, pureBrandKeywords)
        const matchType = isPureBrand ? 'EXACT' : 'PHRASE'

        if (!existing) {
          allKeywords.set(keywordText, {
            keyword: keywordText,
            searchVolume: kw.searchVolume,
            competition: kw.competition,
            competitionIndex: kw.competitionIndex,
            lowTopPageBid: kw.lowTopPageBid,
            highTopPageBid: kw.highTopPageBid,
            source: 'KEYWORD_PLANNER',
            matchType,
            isPureBrand
          })
          newCount++
          brandRelatedAdded++
        } else if (kw.searchVolume > (existing.searchVolume || 0)) {
          allKeywords.set(keywordText, {
            ...existing,
            searchVolume: kw.searchVolume,
            competition: kw.competition,
            competitionIndex: kw.competitionIndex,
            lowTopPageBid: kw.lowTopPageBid,
            highTopPageBid: kw.highTopPageBid,
            matchType,
            isPureBrand,
            source: existing.source === 'BRAND_SEED' ? 'KEYWORD_PLANNER' : existing.source
          })
          updatedCount++
        }
      }

      console.log(`      新增 ${newCount} 个关键词 (品牌相关: ${brandRelatedAdded}, 跳过非品牌: ${genericSkipped}, 更新: ${updatedCount})`)

      if (newCount === 0) {
        console.log(`      本轮未新增关键词，结束迭代`)
        break
      }

      // 准备下一轮种子词：始终包含纯品牌词，并优先使用高搜索量的品牌相关词
      const brandCandidates = Array.from(allKeywords.values())
        .filter(kw => containsPureBrand(kw.keyword, pureBrandKeywords))
        .sort((a, b) => b.searchVolume - a.searchVolume)

      const nextSeedSet = new Set<string>()
      for (const token of plannerBrandKeywords) {
        if (nextSeedSet.size >= topN) break
        nextSeedSet.add(token)
      }
      for (const kw of brandCandidates) {
        if (nextSeedSet.size >= topN) break
        nextSeedSet.add(kw.keyword)
      }

      const nextSeeds = Array.from(nextSeedSet)
      if (nextSeeds.length === 0) {
        console.log(`      种子词为空，结束迭代`)
        break
      }

      const currentSeedSet = new Set(seedKeywords)
      const seedsUnchanged =
        currentSeedSet.size === nextSeedSet.size &&
        nextSeeds.every(s => currentSeedSet.has(s))

      seedKeywords = nextSeeds

      if (seedsUnchanged) {
        console.log(`      种子词未变化，结束迭代`)
        break
      }
    }

    console.log(`\n   📊 Keyword Planner 迭代完成: ${allKeywords.size} 个关键词`)

    // 🔧 修复(2026-01-22): 查询品牌词的真实搜索量
    // 品牌词以 BRAND_SEED 来源初始化时 searchVolume=0，需要查询真实搜索量
    const brandSeedKeywords = Array.from(allKeywords.values())
      .filter(kw => kw.source === 'BRAND_SEED' && kw.searchVolume === 0)

    if (brandSeedKeywords.length > 0 && userId) {
      console.log(`\n   📊 查询 ${brandSeedKeywords.length} 个品牌词的真实搜索量...`)
      try {
        const brandVolumes = await getKeywordSearchVolumes(
          brandSeedKeywords.map(kw => kw.keyword),
          targetCountry,
          targetLanguage,
          userId,
          undefined,
          undefined,
          progress
            ? (info: { message: string; current?: number; total?: number }) =>
                progress({
                  phase: 'seed-volume',
                  current: info.current,
                  total: info.total,
                  message: `品牌词搜索量 ${info.current ?? 0}/${info.total ?? 0}`
                })
            : undefined
        )

        // 更新品牌词搜索量
        let updatedCount = 0
        for (const vol of brandVolumes) {
          const canonical = normalizeGoogleAdsKeyword(vol.keyword)
          if (canonical && allKeywords.has(canonical)) {
            const existing = allKeywords.get(canonical)!
            if (vol.avgMonthlySearches > 0) {
              allKeywords.set(canonical, {
                ...existing,
                searchVolume: vol.avgMonthlySearches,
                competition: vol.competition || existing.competition,
                competitionIndex: vol.competitionIndex || existing.competitionIndex,
                lowTopPageBid: vol.lowTopPageBid || existing.lowTopPageBid,
                highTopPageBid: vol.highTopPageBid || existing.highTopPageBid,
              })
              updatedCount++
            }
          }
        }
        console.log(`      ✅ 更新了 ${updatedCount}/${brandSeedKeywords.length} 个品牌词的搜索量`)
      } catch (error: any) {
        console.warn(`      ⚠️ 品牌词搜索量查询失败: ${error.message}`)
      }
    }

    if (!keywordPlannerReturned) {
      const fallbackExpanded = await expandFallback()
      if (fallbackExpanded.length > 0) {
        for (const kw of fallbackExpanded) {
          const canonical = normalizeGoogleAdsKeyword(kw.keyword)
          if (!canonical || allKeywords.has(canonical)) continue
          allKeywords.set(canonical, {
            ...kw,
            keyword: canonical,
          })
        }
      }
    }

    const globalCandidates = await getGlobalKeywordCandidates({
      brandName,
      targetCountry,
      targetLanguage
    })

    if (globalCandidates.length > 0) {
      const merged = mergeGlobalCandidates({
        allKeywords,
        candidates: globalCandidates,
        pureBrandKeywords,
        brandName
      })
      console.log(`      📦 全局关键词库补充: 新增 ${merged.added}, 更新 ${merged.updated}`)
    }

    if (allKeywords.size === 0) {
      console.warn(`   ⚠️ Keyword Planner 未返回可用关键词，回退到初始关键词(${fallbackKeywords.length}个)`)
      return fallbackKeywords
    }

    // 质量过滤
    console.log(`\n   📊 质量过滤`)
    const filtered = qualityFilterOAuth(
      Array.from(allKeywords.values()),
      brandName,
      targetCountry,
      pageUrl
    )

    console.log(`   过滤后: ${filtered.length} 个关键词`)

    return filtered.length > 0 ? filtered : fallbackKeywords

  } catch (error: any) {
    console.error(`   ⚠️ OAuth模式关键词扩展失败: ${error.message}`)
    return expandFallback()
  }
}

/**
 * OAuth模式质量过滤
 */
function qualityFilterOAuth(
  keywords: PoolKeywordData[],
  brandName: string,
  targetCountry?: string,
  productUrl?: string
): PoolKeywordData[] {
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const dynamicThreshold = calculateDynamicThreshold(keywords)
  const hasAnyVolume = keywords.some(kw => kw.searchVolume > 0)

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
    const isConcatenatedBrandWithVolume = (kw.searchVolume || 0) > 0 && isBrandConcatenation(kw.keyword, brandName)

    // 1. 品牌变体词过滤
    if (isBrandVariant(kw.keyword, brandName) && !isConcatenatedBrandWithVolume) {
      brandVariantRemoved++
      return false
    }

    // 2. 品牌无关词过滤
    if (isBrandIrrelevant(kwLower, brandName)) {
      irrelevantRemoved++
      return false
    }

    // 3. 语义查询词过滤
    if (shouldFilterSemanticKeyword(kwLower, productUrl)) {
      semanticRemoved++
      return false
    }

    // 4. 地理过滤
    if (isGeoMismatch(kw.keyword, targetCountry)) {
      geoRemoved++
      return false
    }

    // 5. 搜索量过滤（纯品牌词豁免）
    if (hasAnyVolume && !isPureBrand && kw.searchVolume < dynamicThreshold) {
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
  progress?: (info: { phase?: 'seed-volume' | 'expand-round' | 'volume-batch' | 'service-step' | 'filter' | 'cluster' | 'save'; message: string; current?: number; total?: number }) => Promise<void> | void
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
    userId,
    progress
  } = params

  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const allKeywords = new Map<string, PoolKeywordData>()

  try {
    // ✅ Seed pure-brand keywords (avoid empty brand bucket)
    for (const token of pureBrandKeywords) {
      const canonical = normalizeGoogleAdsKeyword(token)
      if (!canonical) continue
      if (allKeywords.has(canonical)) continue
      allKeywords.set(canonical, {
        keyword: canonical,
        searchVolume: 0,
        competition: 'UNKNOWN',
        competitionIndex: 0,
        lowTopPageBid: 0,
        highTopPageBid: 0,
        source: 'BRAND_SEED',
        matchType: 'EXACT',
        isPureBrand: true,
      })
    }

    for (const kw of initialKeywords) {
      const canonical = normalizeGoogleAdsKeyword(kw.keyword)
      if (!canonical) continue
      if (!containsPureBrand(canonical, pureBrandKeywords)) continue
      if (!allKeywords.has(canonical)) {
        allKeywords.set(canonical, {
          ...kw,
          keyword: canonical,
          source: kw.source || 'PROVIDED',
          matchType: kw.matchType || 'PHRASE',
          isPureBrand: kw.isPureBrand || isPureBrandKeyword(canonical, pureBrandKeywords)
        })
      }
    }

    // ========== 阶段1: Google下拉词 ==========
    await progress?.({
      phase: 'service-step',
      current: 1,
      total: 3,
      message: '关键词池扩展：Google下拉词 (1/3)'
    })
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
        const canonical = normalizeGoogleAdsKeyword(text)
        if (!canonical) continue
        if (!containsPureBrand(canonical, pureBrandKeywords)) continue

        if (!allKeywords.has(canonical)) {
          allKeywords.set(canonical, {
            keyword: canonical,
            searchVolume: 0,
            competition: 'UNKNOWN',
            competitionIndex: 0,
            lowTopPageBid: 0,
            highTopPageBid: 0,
            source: 'GOOGLE_SUGGEST',
            matchType: 'BROAD',
            isPureBrand: isPureBrandKeyword(canonical, pureBrandKeywords)
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Google下拉词获取失败: ${error.message}`)
    }

    // ========== 阶段2: 增强提取 ==========
    await progress?.({
      phase: 'service-step',
      current: 2,
      total: 3,
      message: '关键词池扩展：增强提取 (2/3)'
    })
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
        const canonical = normalizeGoogleAdsKeyword(kw.keyword)
        if (!canonical) continue
        if (!containsPureBrand(canonical, pureBrandKeywords)) continue

        if (!allKeywords.has(canonical)) {
          allKeywords.set(canonical, {
            keyword: canonical,
            searchVolume: 0,
            competition: kw.competition || 'UNKNOWN',
            competitionIndex: 0,
            lowTopPageBid: 0,
            highTopPageBid: 0,
            source: 'ENHANCED_EXTRACT',
            matchType: 'BROAD',
            isPureBrand: isPureBrandKeyword(canonical, pureBrandKeywords)
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ 增强提取失败: ${error.message}`)
    }

    // ========== 阶段3: Google Trends扩展 ==========
    await progress?.({
      phase: 'service-step',
      current: 3,
      total: 3,
      message: '关键词池扩展：Google Trends (3/3)'
    })
    console.log(`\n   📊 阶段3: Google Trends扩展`)

    try {
      const seedKeywords = Array.from(allKeywords.values())
        .slice(0, 10)
        .map(kw => kw.keyword)

      const trendsKeywords = await getTrendsKeywords(seedKeywords, brandName, category)

      console.log(`      Trends扩展: ${trendsKeywords.length} 个`)

      for (const kw of trendsKeywords) {
        const canonical = normalizeGoogleAdsKeyword(kw.keyword)
        if (!canonical) continue
        if (!containsPureBrand(canonical, pureBrandKeywords)) continue

        if (!allKeywords.has(canonical)) {
          allKeywords.set(canonical, {
            keyword: canonical,
            searchVolume: kw.searchVolume || 0,
            competition: kw.competition || 'UNKNOWN',
            competitionIndex: kw.competitionIndex || 0,
            lowTopPageBid: kw.lowTopPageBid || 0,
            highTopPageBid: kw.highTopPageBid || 0,
            source: 'GOOGLE_TRENDS',
            matchType: 'BROAD',
            isPureBrand: isPureBrandKeyword(canonical, pureBrandKeywords)
          })
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Google Trends扩展失败: ${error.message}`)
    }

    const globalCandidates = await getGlobalKeywordCandidates({
      brandName,
      targetCountry,
      targetLanguage
    })

    if (globalCandidates.length > 0) {
      const merged = mergeGlobalCandidates({
        allKeywords,
        candidates: globalCandidates,
        pureBrandKeywords,
        brandName
      })
      console.log(`      📦 全局关键词库补充: 新增 ${merged.added}, 更新 ${merged.updated}`)
    }

    console.log(`\n   📊 服务账号模式关键词收集完成: ${allKeywords.size} 个`)

    // 质量过滤（无搜索量过滤）
    console.log(`\n   📊 质量过滤`)
    const filtered = qualityFilterServiceAccount(
      Array.from(allKeywords.values()),
      brandName,
      targetCountry,
      offer.final_url || offer.url || undefined
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
  targetCountry?: string,
  productUrl?: string
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
    const isConcatenatedBrandWithVolume = (kw.searchVolume || 0) > 0 && isBrandConcatenation(kw.keyword, brandName)

    // 1. 品牌变体词过滤
    if (isBrandVariant(kw.keyword, brandName) && !isConcatenatedBrandWithVolume) {
      brandVariantRemoved++
      return false
    }

    // 2. 品牌无关词过滤
    if (isBrandIrrelevant(kwLower, brandName)) {
      irrelevantRemoved++
      return false
    }

    // 3. 语义查询词过滤
    if (shouldFilterSemanticKeyword(kwLower, productUrl)) {
      semanticRemoved++
      return false
    }

    // 4. 地理过滤
    if (isGeoMismatch(kw.keyword, targetCountry)) {
      geoRemoved++
      return false
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
  return normalizeLanguageCode(language)
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
 * 智能过滤（2层过滤：地理位置 + 分层搜索量）
 *
 * 🔥 2025-12-17优化：
 * 1. 移除竞品词穷举过滤（无法穷举所有竞品）
 * 2. 新增地理位置过滤（过滤非目标国家的关键词）
 *
 * 🔥 2026-01-02优化：策略A（保守）- 品牌词为主 + 少量高搜索量品类词
 * - 纯品牌词：100%豁免所有过滤（无搜索量要求）
 * - 品牌相关词：保留所有有效搜索量（≥10）
 * - 品类词：只保留头部词（≥10000），用于品牌曝光
 * - 理由：品牌词高购买意图、高转化率、低CPC；品类词ROI不确定
 */
export function filterKeywords(
  keywords: PoolKeywordData[],
  brandName: string,
  category: string,
  targetCountry?: string,
  productName?: string | null,
  options?: {
    allowNonBrandFromPlanner?: boolean
    // KISS: 允许上层关闭重复品牌门禁，交给统一质量过滤器处理
    applyBrandGate?: boolean
  }
): PoolKeywordData[] {
  void category
  void productName

  // 获取纯品牌词列表
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const allowNonBrandFromPlanner = options?.allowNonBrandFromPlanner ?? false
  const applyBrandGate = options?.applyBrandGate ?? true

  let geoFilteredCount = 0
  let nonBrandRemovedCount = 0
  let concatenatedBrandKept = 0
  let plannerNonBrandKept = 0

  const kept: PoolKeywordData[] = []

  for (const kw of keywords) {
    if (applyBrandGate) {
      // 🔒 全量强制：只保留包含“纯品牌词”的关键词（不拼接造词）
      // 🆕 例外：店铺页允许 Keyword Planner 返回的非品牌词进入后续流程
      if (!containsPureBrand(kw.keyword, pureBrandKeywords)) {
        const isConcatenatedBrandWithVolume = (kw.searchVolume || 0) > 0 && isBrandConcatenation(kw.keyword, brandName)
        const isPlannerSource = typeof kw.source === 'string' && kw.source.toUpperCase().startsWith('KEYWORD_PLANNER')
        if (!isConcatenatedBrandWithVolume && !(allowNonBrandFromPlanner && isPlannerSource)) {
          nonBrandRemovedCount++
          continue
        }
        if (isConcatenatedBrandWithVolume) {
          concatenatedBrandKept++
        } else if (allowNonBrandFromPlanner && isPlannerSource) {
          plannerNonBrandKept++
        }
      }
    }

    // ✅ 地理位置过滤（过滤非目标国家的关键词）
    if (isGeoMismatch(kw.keyword, targetCountry)) {
      geoFilteredCount++
      continue
    }

    kept.push(kw)
  }

  console.log(`   过滤: ${keywords.length} → ${kept.length}`)
  console.log(`      移除非品牌: ${nonBrandRemovedCount}`)
  console.log(`      拼接品牌保留(有量): ${concatenatedBrandKept}`)
  if (plannerNonBrandKept > 0) {
    console.log(`      Keyword Planner 非品牌保留: ${plannerNonBrandKept}`)
  }
  console.log(`      地理过滤: ${geoFilteredCount}`)
  const strategyLabel = !applyBrandGate
    ? '仅地理预过滤（品牌门禁后置到统一质量过滤）'
    : (allowNonBrandFromPlanner ? '品牌包含 + Keyword Planner 例外' : '100%品牌包含')
  console.log(`      策略: ${strategyLabel}`)

  return kept
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
