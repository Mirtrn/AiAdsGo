/**
 * Google Ads Keyword Planner API Service
 * 获取真实的关键词搜索量数据
 */
import { GoogleAdsApi, enums } from 'google-ads-api'
import { getDatabase } from './db'
import { getCachedKeywordVolume, cacheKeywordVolume, getBatchCachedVolumes, batchCacheVolumes } from './redis'
import { decrypt } from './crypto'

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
function readUserConfigs(db: any, userId: number): Record<string, string> {
  const configs = db.prepare(`
    SELECT config_key, config_value, encrypted_value
    FROM system_settings
    WHERE category = 'google_ads' AND user_id = ?
  `).all(userId) as Array<{ config_key: string; config_value: string | null; encrypted_value: string | null }>

  const configMap: Record<string, string> = {}
  for (const c of configs) {
    if (c.encrypted_value) {
      const decrypted = decrypt(c.encrypted_value)
      if (decrypted) configMap[c.config_key] = decrypted
    } else if (c.config_value) {
      configMap[c.config_key] = c.config_value
    }
  }
  return configMap
}

// Helper: Get refresh_token from google_ads_credentials table
function getUserRefreshToken(db: any, userId: number): string {
  const credentials = db.prepare(`
    SELECT refresh_token
    FROM google_ads_credentials
    WHERE user_id = ? AND is_active = 1
  `).get(userId) as { refresh_token: string } | undefined

  return credentials?.refresh_token || ''
}

// Helper: Get customer_id from google_ads_accounts table
function getUserCustomerId(db: any, userId: number): string {
  const account = db.prepare(`
    SELECT customer_id
    FROM google_ads_accounts
    WHERE user_id = ? AND is_active = 1
    LIMIT 1
  `).get(userId) as { customer_id: string } | undefined

  return account?.customer_id || ''
}

// Get Google Ads API config with hybrid mode support
// - If user has complete OAuth config (client_id, client_secret, developer_token): use user's config
// - If not: share autoads user's OAuth config, but use user's login_customer_id and customer_id
function getGoogleAdsConfig(userId?: number): KeywordPlannerConfig | null {
  try {
    const db = getDatabase()
    const autoadsUserId = 1
    const targetUserId = userId || autoadsUserId

    // 1. Read target user's config
    const userConfigs = readUserConfigs(db, targetUserId)

    // 2. Check if user has complete OAuth config
    const hasFullOAuthConfig = !!(
      userConfigs.client_id &&
      userConfigs.client_secret &&
      userConfigs.developer_token
    )

    let clientId: string
    let clientSecret: string
    let developerToken: string
    let refreshToken: string

    if (hasFullOAuthConfig) {
      // User has complete OAuth config - use user's own credentials
      console.log(`[KeywordPlanner] Using user ${targetUserId}'s own OAuth config`)
      clientId = userConfigs.client_id
      clientSecret = userConfigs.client_secret
      developerToken = userConfigs.developer_token
      refreshToken = getUserRefreshToken(db, targetUserId)

      // If user hasn't completed OAuth yet, show warning
      if (!refreshToken) {
        console.warn(`[KeywordPlanner] User ${targetUserId} has OAuth config but no refresh_token. Please complete OAuth authorization.`)
      }
    } else {
      // User doesn't have complete OAuth config - share autoads config
      console.log(`[KeywordPlanner] Sharing autoads OAuth config for user ${targetUserId}`)
      const autoadsConfigs = readUserConfigs(db, autoadsUserId)
      clientId = autoadsConfigs.client_id || process.env.GOOGLE_ADS_CLIENT_ID || ''
      clientSecret = autoadsConfigs.client_secret || process.env.GOOGLE_ADS_CLIENT_SECRET || ''
      developerToken = autoadsConfigs.developer_token || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''
      refreshToken = getUserRefreshToken(db, autoadsUserId) || process.env.GOOGLE_ADS_REFRESH_TOKEN || ''
    }

    // 3. login_customer_id: Always use user's own (required field)
    const loginCustomerId = userConfigs.login_customer_id || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || ''

    // 4. customer_id: Always use user's own
    let customerId = getUserCustomerId(db, targetUserId)
    if (!customerId) {
      // Fallback to env if user has no accounts
      customerId = process.env.GOOGLE_ADS_CUSTOMER_IDS?.split(',')[0] || ''
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

// Language code to Google Ads language ID mapping
const LANGUAGE_CODES: Record<string, string> = {
  en: '1000', // English
  zh: '1017', // Chinese
  es: '1003', // Spanish
  fr: '1002', // French
  de: '1001', // German
  ja: '1005', // Japanese
  ko: '1012', // Korean
  pt: '1014', // Portuguese
  it: '1004', // Italian
  ru: '1031', // Russian
}

// Country code to Google Ads geo target ID
const GEO_TARGETS: Record<string, string> = {
  US: '2840', // United States
  UK: '2826', // United Kingdom
  GB: '2826',
  CA: '2124', // Canada
  AU: '2036', // Australia
  DE: '2276', // Germany
  FR: '2250', // France
  JP: '2392', // Japan
  CN: '2156', // China
  KR: '2410', // South Korea
  BR: '2076', // Brazil
  IN: '2356', // India
  MX: '2484', // Mexico
  ES: '2724', // Spain
  IT: '2380', // Italy
}

/**
 * 从Google Ads Keyword Planner获取关键词搜索量
 */
export async function getKeywordSearchVolumes(
  keywords: string[],
  country: string,
  language: string
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
  const db = getDatabase()
  const dbVolumes = new Map<string, number>()

  try {
    const placeholders = uncachedKeywords.map(() => '?').join(',')
    const stmt = db.prepare(`
      SELECT keyword, search_volume
      FROM global_keywords
      WHERE keyword IN (${placeholders})
        AND country = ? AND language = ?
        AND cached_at > datetime('now', '-7 days')
    `)
    const rows = stmt.all(...uncachedKeywords.map(k => k.toLowerCase()), country, language) as Array<{ keyword: string; search_volume: number }>
    rows.forEach(row => dbVolumes.set(row.keyword, row.search_volume))
  } catch {
    // Table might not exist yet
  }

  // Keywords still needing API call
  const needApiKeywords = uncachedKeywords.filter(kw => !dbVolumes.has(kw.toLowerCase()))

  // 3. Call Keyword Planner API for remaining
  const apiVolumes = new Map<string, KeywordVolume>()

  if (needApiKeywords.length > 0) {
    const config = getGoogleAdsConfig()

    if (config?.developerToken && config?.refreshToken && config?.customerId) {
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

        const geoTargetId = GEO_TARGETS[country.toUpperCase()] || GEO_TARGETS.US
        const languageId = LANGUAGE_CODES[language.toLowerCase()] || LANGUAGE_CODES.en

        // Use generateKeywordIdeas to get volume metrics
        const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
          customer_id: config.customerId,
          language: `languageConstants/${languageId}`,
          geo_target_constants: [`geoTargetConstants/${geoTargetId}`],
          keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
          keyword_seed: { keywords: needApiKeywords },
          include_adult_keywords: false,
          page_token: '',
          page_size: 100,
          keyword_annotation: [],
        } as any)

        const ideas = (response as any).results || response || []
        for (const idea of ideas) {
          if (idea.text && idea.keyword_idea_metrics) {
            const metrics = idea.keyword_idea_metrics
            apiVolumes.set(idea.text.toLowerCase(), {
              keyword: idea.text,
              avgMonthlySearches: Number(metrics.avg_monthly_searches) || 0,
              competition: metrics.competition?.toString() || 'UNKNOWN',
              competitionIndex: Number(metrics.competition_index) || 0,
              lowTopPageBid: Number(metrics.low_top_of_page_bid_micros) / 1_000_000 || 0,
              highTopPageBid: Number(metrics.high_top_of_page_bid_micros) / 1_000_000 || 0,
            })
          }
        }

        // Save to database and cache
        const toCache: Array<{ keyword: string; volume: number }> = []
        for (const [kw, vol] of apiVolumes) {
          toCache.push({ keyword: kw, volume: vol.avgMonthlySearches })
          saveToGlobalKeywords(kw, country, language, vol.avgMonthlySearches)
        }

        if (toCache.length) {
          await batchCacheVolumes(toCache, country, language)
        }
      } catch (error) {
        console.error('[KeywordPlanner] API error:', error)
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
 */
function saveToGlobalKeywords(
  keyword: string,
  country: string,
  language: string,
  volume: number
): void {
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO global_keywords (keyword, country, language, search_volume, cached_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(keyword, country, language)
      DO UPDATE SET search_volume = ?, cached_at = datetime('now')
    `).run(keyword.toLowerCase(), country, language, volume, volume)
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
 */
export async function getKeywordSuggestions(
  seedKeywords: string[],
  country: string,
  language: string,
  maxResults: number = 50
): Promise<KeywordVolume[]> {
  const config = getGoogleAdsConfig()
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

    const geoTargetId = GEO_TARGETS[country.toUpperCase()] || GEO_TARGETS.US
    const languageId = LANGUAGE_CODES[language.toLowerCase()] || LANGUAGE_CODES.en

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
        saveToGlobalKeywords(r.keyword, country, language, r.avgMonthlySearches)
      }
    }

    return results
  } catch (error) {
    console.error('[KeywordPlanner] Suggestions error:', error)
    return []
  }
}
