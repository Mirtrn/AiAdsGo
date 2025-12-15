/**
 * Google Ads Keyword Planner API Service
 * 获取真实的关键词搜索量数据
 */
import { GoogleAdsApi, enums } from 'google-ads-api'
import { getDatabase } from './db'
import { getCachedKeywordVolume, cacheKeywordVolume, getBatchCachedVolumes, batchCacheVolumes } from './redis'
import { decrypt } from './crypto'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'
import { refreshAccessToken } from './google-ads-oauth'
import { getGoogleAdsLanguageIdString, getGoogleAdsGeoTargetId } from './language-country-codes'

interface KeywordVolume {
  keyword: string
  avgMonthlySearches: number
  competition: string
  competitionIndex: number
  lowTopPageBid: number
  highTopPageBid: number
}

interface KeywordPlannerConfig {
  clientId: string
  clientSecret: string
  developerToken: string
  refreshToken: string
  loginCustomerId: string
  customerId: string
}

// Helper: Read user configs from system_settings
async function readUserConfigs(db: any, userId: number): Promise<Record<string, string>> {
  const configs = await db.query(`
    SELECT key, value, encrypted_value
    FROM system_settings
    WHERE category = 'google_ads' AND user_id = ?
  `, [userId]) as Array<{ key: string; value: string | null; encrypted_value: string | null }>

  const configMap: Record<string, string> = {}
  for (const c of configs) {
    if (c.encrypted_value) {
      const decrypted = decrypt(c.encrypted_value)
      if (decrypted) configMap[c.key] = decrypted
    } else if (c.value) {
      configMap[c.key] = c.value
    }
  }
  return configMap
}

// Helper: Get refresh_token from google_ads_credentials table
async function getUserRefreshToken(db: any, userId: number): Promise<string> {
  const credentials = await db.queryOne(`
    SELECT refresh_token
    FROM google_ads_credentials
    WHERE user_id = ? AND CAST(is_active AS INTEGER) = 1
  `, [userId]) as { refresh_token: string } | undefined

  return credentials?.refresh_token || ''
}

// Helper: Get customer_id from google_ads_accounts table
// 只选择状态为ENABLED且非Manager账号的客户账号
async function getUserCustomerId(db: any, userId: number): Promise<string> {
  const account = await db.queryOne(`
    SELECT customer_id
    FROM google_ads_accounts
    WHERE user_id = ?
      AND CAST(is_active AS INTEGER) = 1
      AND status = 'ENABLED'
      AND CAST(is_manager_account AS INTEGER) = 0
    ORDER BY id ASC
    LIMIT 1
  `, [userId]) as { customer_id: string } | undefined

  return account?.customer_id || ''
}

// 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须配置自己的完整 OAuth 凭证
// Get Google Ads API config - requires user's own complete OAuth config
async function getGoogleAdsConfig(userId?: number): Promise<KeywordPlannerConfig | null> {
  try {
    if (!userId) {
      console.error('[KeywordPlanner] userId is required for independent account mode')
      return null
    }

    const db = await getDatabase()

    // 1. Read user's config
    const userConfigs = await readUserConfigs(db, userId)

    // 2. 独立账号模式 - 必须有完整的 OAuth 配置
    const clientId = userConfigs.client_id
    const clientSecret = userConfigs.client_secret
    const developerToken = userConfigs.developer_token

    if (!clientId || !clientSecret || !developerToken) {
      console.error(`[KeywordPlanner] User ${userId} has incomplete OAuth config. Please complete Google Ads API configuration in Settings.`)
      return null
    }

    console.log(`[KeywordPlanner] Using user ${userId}'s own OAuth config`)

    // 3. Get refresh token
    const refreshToken = await getUserRefreshToken(db, userId)
    if (!refreshToken) {
      console.error(`[KeywordPlanner] User ${userId} has no refresh_token. Please complete OAuth authorization.`)
      return null
    }

    // 4. login_customer_id: 必填项
    const loginCustomerId = userConfigs.login_customer_id || ''
    if (!loginCustomerId) {
      console.error(`[KeywordPlanner] User ${userId} has not configured login_customer_id (MCC ID). Please configure it in Settings page.`)
      return null
    }

    // 5. customer_id: 使用用户自己的账号
    let customerId = await getUserCustomerId(db, userId)
    if (!customerId) {
      console.warn(`[KeywordPlanner] User ${userId} has no Google Ads accounts. Using login_customer_id as fallback.`)
      customerId = loginCustomerId
    }

    return {
      clientId,
      clientSecret,
      developerToken,
      refreshToken,
      loginCustomerId,
      customerId,
    }
  } catch (error) {
    console.error('[KeywordPlanner] Config error:', error)
    return null
  }
}

// 使用全局统一映射代替硬编码（来自 language-country-codes.ts）
// LANGUAGE_CODES → getGoogleAdsLanguageIdString()
// GEO_TARGETS → getGoogleAdsGeoTargetId()

/**
 * 从Google Ads Keyword Planner获取关键词搜索量
 */
export async function getKeywordSearchVolumes(
  keywords: string[],
  country: string,
  language: string,
  userId?: number
): Promise<KeywordVolume[]> {
  if (!keywords.length) return []

  // 1. Check Redis cache first
  const cachedVolumes = await getBatchCachedVolumes(keywords, country, language)
  const uncachedKeywords = keywords.filter(kw => !cachedVolumes.has(kw.toLowerCase()))

  // If all cached, return from cache
  if (uncachedKeywords.length === 0) {
    return keywords.map(kw => ({
      keyword: kw,
      avgMonthlySearches: cachedVolumes.get(kw.toLowerCase()) || 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
    }))
  }

  // 2. Check global_keywords table
  const db = await getDatabase()
  const dbVolumes = new Map<string, number>()

  try {
    const placeholders = uncachedKeywords.map(() => '?').join(',')
    const rows = await db.query(`
      SELECT keyword, search_volume
      FROM global_keywords
      WHERE keyword IN (${placeholders})
        AND country = ? AND language = ?
        AND created_at > datetime('now', '-7 days')
    `, [...uncachedKeywords.map(k => k.toLowerCase()), country, language]) as Array<{ keyword: string; search_volume: number }>
    rows.forEach(row => dbVolumes.set(row.keyword, row.search_volume))
  } catch {
    // Table might not exist yet
  }

  // Keywords still needing API call
  const needApiKeywords = uncachedKeywords.filter(kw => !dbVolumes.has(kw.toLowerCase()))

  // 3. Call Keyword Planner API for remaining
  const apiVolumes = new Map<string, KeywordVolume>()

  if (needApiKeywords.length > 0) {
    // 🔧 修复(2025-12-12): 独立账号模式 - 必须传递 userId
    const config = await getGoogleAdsConfig(userId)

    if (config?.developerToken && config?.refreshToken && config?.customerId) {
      // Split keywords into batches of 20 (Google Ads API limit)
      const BATCH_SIZE = 20
      const keywordBatches: string[][] = []
      for (let i = 0; i < needApiKeywords.length; i += BATCH_SIZE) {
        keywordBatches.push(needApiKeywords.slice(i, i + BATCH_SIZE))
      }

      console.log(`[KeywordPlanner] Processing ${needApiKeywords.length} keywords in ${keywordBatches.length} batches`)

      // API追踪设置
      const apiStartTime = Date.now()
      let apiSuccess = false
      let apiErrorMessage: string | undefined
      let totalApiCalls = 0

      try {
        // 刷新 access token 以确保有效
        console.log('[KeywordPlanner] Refreshing access token...')
        try {
          await refreshAccessToken(userId || 1)
          console.log('[KeywordPlanner] Access token refreshed successfully')
        } catch (refreshError: any) {
          console.warn('[KeywordPlanner] Token refresh warning:', refreshError.message)
          // 继续执行，google-ads-api 库会使用 refresh_token 自动刷新
        }

        const client = new GoogleAdsApi({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          developer_token: config.developerToken,
        })

        const customer = client.Customer({
          customer_id: config.customerId,
          login_customer_id: config.loginCustomerId,
          refresh_token: config.refreshToken,
        })

        const geoTargetId = getGoogleAdsGeoTargetId(country)
        const languageId = getGoogleAdsLanguageIdString(language)

        // Process each batch with exponential backoff retry
        for (let batchIndex = 0; batchIndex < keywordBatches.length; batchIndex++) {
          const batch = keywordBatches[batchIndex]
          console.log(`[KeywordPlanner] Processing batch ${batchIndex + 1}/${keywordBatches.length} (${batch.length} keywords)`)

          let retries = 0
          const maxRetries = 3
          let success = false

          while (!success && retries <= maxRetries) {
            try {
              const response = await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics({
                customer_id: config.customerId,
                keywords: batch,
                language: `languageConstants/${languageId}`,
                geo_target_constants: [`geoTargetConstants/${geoTargetId}`],
                keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
              } as any)

              totalApiCalls++

              console.log(`[KeywordPlanner] API响应类型: ${typeof response}, 结构: ${Object.keys(response || {}).join(', ')}`)
              const results = (response as any).results || response || []
              console.log(`[KeywordPlanner] 解析结果数量: ${Array.isArray(results) ? results.length : 'N/A'}`)

              for (const result of results) {
                if (result.text && result.keyword_metrics) {
                  const metrics = result.keyword_metrics
                  apiVolumes.set(result.text.toLowerCase(), {
                    keyword: result.text,
                    avgMonthlySearches: Number(metrics.avg_monthly_searches) || 0,
                    competition: metrics.competition?.toString() || 'UNKNOWN',
                    competitionIndex: Number(metrics.competition_index) || 0,
                    lowTopPageBid: Number(metrics.low_top_of_page_bid_micros) / 1_000_000 || 0,
                    highTopPageBid: Number(metrics.high_top_of_page_bid_micros) / 1_000_000 || 0,
                  })
                }
              }

              success = true
            } catch (batchError: any) {
              const errorMsg = batchError.errors?.[0]?.message || batchError.message || ''
              if (errorMsg.includes('Too many requests')) {
                retries++
                const waitTime = Math.min(5000 * Math.pow(2, retries - 1), 30000) // 5s, 10s, 20s, max 30s
                console.log(`[KeywordPlanner] Rate limit hit, retry ${retries}/${maxRetries} after ${waitTime}ms`)
                await new Promise(resolve => setTimeout(resolve, waitTime))
              } else {
                throw batchError
              }
            }
          }

          // Delay between batches
          if (batchIndex < keywordBatches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }

        console.log(`[KeywordPlanner] Completed ${totalApiCalls} API calls, retrieved ${apiVolumes.size} keyword volumes`)

        // Save to database and cache
        const toCache: Array<{ keyword: string; volume: number }> = []
        for (const [kw, vol] of apiVolumes) {
          toCache.push({ keyword: kw, volume: vol.avgMonthlySearches })
          await saveToGlobalKeywords(kw, country, language, vol.avgMonthlySearches)
        }

        if (toCache.length) {
          await batchCacheVolumes(toCache, country, language)
        }

        apiSuccess = true
      } catch (error: any) {
        apiSuccess = false
        // 改进错误捕获：Google Ads API错误可能包含在不同位置
        apiErrorMessage = error.message
          || error.errors?.[0]?.message
          || error.error?.message
          || (typeof error === 'string' ? error : JSON.stringify(error))
        console.error('[KeywordPlanner] API error:', error)
      } finally {
        // 记录API使用（仅在有userId时追踪）
        if (userId) {
          trackApiUsage({
            userId,
            operationType: ApiOperationType.GET_KEYWORD_IDEAS, // Historical metrics use same quota
            endpoint: 'generateKeywordHistoricalMetrics',
            customerId: config.customerId,
            requestCount: totalApiCalls,
            responseTimeMs: Date.now() - apiStartTime,
            isSuccess: apiSuccess,
            errorMessage: apiErrorMessage
          })
        }
      }
    }
  }

  // 4. Combine all results
  return keywords.map(kw => {
    const kwLower = kw.toLowerCase()

    // Check API result first
    if (apiVolumes.has(kwLower)) {
      return apiVolumes.get(kwLower)!
    }

    // Then DB
    if (dbVolumes.has(kwLower)) {
      return {
        keyword: kw,
        avgMonthlySearches: dbVolumes.get(kwLower) || 0,
        competition: 'UNKNOWN',
        competitionIndex: 0,
        lowTopPageBid: 0,
        highTopPageBid: 0,
      }
    }

    // Then cache
    if (cachedVolumes.has(kwLower)) {
      return {
        keyword: kw,
        avgMonthlySearches: cachedVolumes.get(kwLower) || 0,
        competition: 'UNKNOWN',
        competitionIndex: 0,
        lowTopPageBid: 0,
        highTopPageBid: 0,
      }
    }

    // Default: 0
    return {
      keyword: kw,
      avgMonthlySearches: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
    }
  })
}

/**
 * 保存到全局关键词表
 *
 * 缓存策略：
 * - created_at: 首次缓存或搜索量变化时的时间，用于7天过期判断
 * - cached_at: 最后一次API调用时间，用于记录
 * - 如果搜索量变化，重置created_at开始新的7天计时
 * - 如果搜索量未变化，保持created_at不变，确保7天后会重新从API刷新
 */
async function saveToGlobalKeywords(
  keyword: string,
  country: string,
  language: string,
  volume: number
): Promise<void> {
  try {
    const db = await getDatabase()
    await db.exec(`
      INSERT INTO global_keywords (keyword, country, language, search_volume, cached_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(keyword, country, language)
      DO UPDATE SET
        search_volume = excluded.search_volume,
        cached_at = datetime('now'),
        created_at = CASE
          WHEN global_keywords.search_volume != excluded.search_volume
          THEN datetime('now')
          ELSE global_keywords.created_at
        END
    `, [keyword.toLowerCase(), country, language, volume])
  } catch {
    // Table might not exist yet
  }
}

/**
 * 获取单个关键词的搜索量（带缓存）
 */
export async function getKeywordVolume(
  keyword: string,
  country: string,
  language: string
): Promise<number> {
  // Check Redis first
  const cached = await getCachedKeywordVolume(keyword, country, language)
  if (cached) return cached.volume

  // Then API
  const results = await getKeywordSearchVolumes([keyword], country, language)
  return results[0]?.avgMonthlySearches || 0
}

/**
 * 获取关键词建议（基于种子关键词）
 * 🔧 修复(2025-12-12): 独立账号模式 - 添加 userId 参数
 */
export async function getKeywordSuggestions(
  seedKeywords: string[],
  country: string,
  language: string,
  maxResults: number = 50,
  userId?: number
): Promise<KeywordVolume[]> {
  const config = await getGoogleAdsConfig(userId)
  if (!config?.developerToken || !config?.refreshToken || !config?.customerId) {
    console.warn('[KeywordPlanner] No valid config for suggestions')
    return []
  }

  try {
    const client = new GoogleAdsApi({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      developer_token: config.developerToken,
    })

    const customer = client.Customer({
      customer_id: config.customerId,
      login_customer_id: config.loginCustomerId,
      refresh_token: config.refreshToken,
    })

    const geoTargetId = getGoogleAdsGeoTargetId(country)
    const languageId = getGoogleAdsLanguageIdString(language)

    const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
      customer_id: config.customerId,
      language: `languageConstants/${languageId}`,
      geo_target_constants: [`geoTargetConstants/${geoTargetId}`],
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      keyword_seed: { keywords: seedKeywords },
      include_adult_keywords: false,
      page_token: '',
      page_size: maxResults,
      keyword_annotation: [],
    } as any)

    const results: KeywordVolume[] = []
    const ideas = (response as any).results || response || []

    for (const idea of ideas) {
      if (results.length >= maxResults) break

      if (idea.text && idea.keyword_idea_metrics) {
        const metrics = idea.keyword_idea_metrics
        results.push({
          keyword: idea.text,
          avgMonthlySearches: Number(metrics.avg_monthly_searches) || 0,
          competition: metrics.competition?.toString() || 'UNKNOWN',
          competitionIndex: Number(metrics.competition_index) || 0,
          lowTopPageBid: Number(metrics.low_top_of_page_bid_micros) / 1_000_000 || 0,
          highTopPageBid: Number(metrics.high_top_of_page_bid_micros) / 1_000_000 || 0,
        })
      }
    }

    // Cache results
    const toCache = results.map(r => ({ keyword: r.keyword, volume: r.avgMonthlySearches }))
    if (toCache.length) {
      await batchCacheVolumes(toCache, country, language)

      // Also save to DB
      for (const r of results) {
        await saveToGlobalKeywords(r.keyword, country, language, r.avgMonthlySearches)
      }
    }

    return results
  } catch (error) {
    console.error('[KeywordPlanner] Suggestions error:', error)
    return []
  }
}
