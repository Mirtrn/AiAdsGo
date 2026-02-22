import type { Task } from '@/lib/queue/types'
import { getDatabase } from '@/lib/db'
import { nowFunc } from '@/lib/db-helpers'
import { fetchAutoadsAsUser } from '@/lib/openclaw/autoads-client'
import { recordOpenclawAction } from '@/lib/openclaw/action-logs'
import { buildEffectiveCreative } from '@/lib/campaign-publish/effective-creative'
import {
  buildAlignedPublishCampaignConfig,
  evaluatePublishCampaignConfigOwnership,
  hasPublishCampaignConfigOwnershipViolation,
} from '@/lib/campaign-publish/aligned-campaign-config'
import { resolveTaskCampaignKeywords } from '@/lib/campaign-publish/task-keyword-fallback'
import { inferNegativeKeywordMatchType, normalizeMatchType } from '@/lib/campaign-publish/negative-keyword-match-type'
import { normalizeCampaignPublishCampaignConfig } from '@/lib/autoads-request-normalizers'
import { parseCommissionPayoutValue, parseMoneyValue } from '@/lib/offer-monetization'

export type OpenclawCommandTaskData = {
  runId: string
  userId: number
  trigger?: 'direct' | 'confirm' | 'retry'
}

type OpenclawExecutorDb = Awaited<ReturnType<typeof getDatabase>>

const MAX_BODY_LENGTH = 20000
const OPENCLAW_COMMAND_UPSTREAM_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(String(process.env.OPENCLAW_COMMAND_UPSTREAM_TIMEOUT_MS || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 120000
  return parsed
})()
const OPENCLAW_COMMAND_HEARTBEAT_MS = (() => {
  const parsed = Number.parseInt(String(process.env.OPENCLAW_COMMAND_HEARTBEAT_MS || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 15000
  return parsed
})()

class OpenclawCommandValidationError extends Error {
  status: number
  response: Record<string, any>

  constructor(status: number, response: Record<string, any>) {
    super(typeof response?.error === 'string' ? response.error : 'OpenClaw command validation failed')
    this.name = 'OpenclawCommandValidationError'
    this.status = status
    this.response = response
  }
}

function truncateBody(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length > MAX_BODY_LENGTH ? `${value.slice(0, MAX_BODY_LENGTH)}...` : value
}

function parseJsonObject(value: string | null | undefined): Record<string, any> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
  } catch {
    // ignore
  }
  return undefined
}

function parseJsonAny(value: string | null | undefined): any {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function formatCompactNumber(value: number): string {
  const rounded = roundTo2(value)
  if (Number.isInteger(rounded)) {
    return String(rounded)
  }
  return rounded.toFixed(2).replace(/\.?0+$/, '')
}

function toTrimmedString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function isOfferExtractPath(path: string): boolean {
  return path === '/api/offers/extract' || path === '/api/offers/extract/stream'
}

type OfferExtractCommissionSourceMatchType = 'exact_link' | 'yeahpromos_pid' | 'partnerboost_link_id'

function normalizeUrlForComparison(value: unknown): string | null {
  const raw = toTrimmedString(value)
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    const protocol = parsed.protocol.toLowerCase()
    const hostname = parsed.hostname.toLowerCase()
    const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/'
    const sortedQuery = Array
      .from(parsed.searchParams.entries())
      .map(([key, item]) => [String(key).trim().toLowerCase(), String(item).trim()] as const)
      .filter(([key, item]) => key.length > 0 && item.length > 0)
      .sort((a, b) => {
        if (a[0] !== b[0]) return a[0].localeCompare(b[0])
        return a[1].localeCompare(b[1])
      })
      .map(([key, item]) => `${key}=${item}`)
      .join('&')

    return `${protocol}//${hostname}${pathname}${sortedQuery ? `?${sortedQuery}` : ''}`
  } catch {
    return raw.toLowerCase()
  }
}

function extractCaseInsensitiveQueryParam(rawValue: unknown, keyName: string): string | null {
  const value = toTrimmedString(rawValue)
  const normalizedKeyName = toTrimmedString(keyName)?.toLowerCase()
  if (!value || !normalizedKeyName) return null

  const candidates = [value]
  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded && decoded !== value) {
        candidates.push(decoded)
      }
    } catch {
      // ignore malformed percent-encoding
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate)
      const key = Array.from(parsed.searchParams.keys())
        .find((item) => item.toLowerCase() === normalizedKeyName)
      if (key) {
        const matched = toTrimmedString(parsed.searchParams.get(key))
        if (matched) return matched
      }
    } catch {
      // ignore invalid url
    }

    const escapedKey = normalizedKeyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`[?&#]${escapedKey}=([^&#]+)`, 'i')
    const matched = candidate.match(regex)
    if (matched?.[1]) {
      const normalized = toTrimmedString(matched[1])
      if (normalized) return normalized
    }
  }

  return null
}

function extractYeahPromosPidFromLink(value: unknown): string | null {
  return extractCaseInsensitiveQueryParam(value, 'pid')
}

function extractPartnerboostLinkIdFromLink(value: unknown): string | null {
  return extractCaseInsensitiveQueryParam(value, 'aa_adgroupid')
}

const CLICK_FARM_PUBLISH_LOOKBACK_MS = 6 * 60 * 60 * 1000
const MAX_INT32 = 2147483647

const WEB_DEFAULT_DAILY_BUDGET_BY_CURRENCY: Record<string, number> = {
  USD: 10,
  CNY: 70,
  EUR: 10,
  GBP: 8,
  JPY: 1500,
  KRW: 13000,
  AUD: 15,
  CAD: 14,
  HKD: 78,
  TWD: 315,
  SGD: 13,
  INR: 830,
}

const WEB_DEFAULT_CPC_BY_CURRENCY: Record<string, number> = {
  USD: 0.17,
  CNY: 1.2,
  EUR: 0.16,
  GBP: 0.13,
  JPY: 25,
  KRW: 220,
  AUD: 0.26,
  CAD: 0.24,
  HKD: 1.3,
  TWD: 5.4,
  SGD: 0.23,
  INR: 14,
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : null
}

function toSafePositiveInt32(value: unknown): number | null {
  const normalized = toPositiveInteger(value)
  if (!normalized) return null
  return normalized <= MAX_INT32 ? normalized : null
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveNumber(value: unknown): boolean {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}

function normalizeCurrencyCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function getWebDefaultDailyBudget(currency: unknown): number {
  return WEB_DEFAULT_DAILY_BUDGET_BY_CURRENCY[normalizeCurrencyCode(currency)] || 10
}

function getWebDefaultCpc(currency: unknown): number {
  return WEB_DEFAULT_CPC_BY_CURRENCY[normalizeCurrencyCode(currency)] || 0.17
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        const candidate = typeof obj.text === 'string' ? obj.text : (typeof obj.keyword === 'string' ? obj.keyword : '')
        return candidate.trim()
      }
      return ''
    })
    .filter((item) => item.length > 0)
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildWebDefaultKeywords(params: {
  keywordsWithVolume: unknown
  keywords: unknown
}): Array<Record<string, any>> {
  const candidateKeywordsWithVolume = parseJsonArray(params.keywordsWithVolume)
  const candidateKeywords = parseJsonArray(params.keywords)
  const source = candidateKeywordsWithVolume.length > 0 ? candidateKeywordsWithVolume : candidateKeywords
  if (source.length === 0) return []

  const validMatchTypes = new Set(['EXACT', 'PHRASE', 'BROAD', 'BROAD_MATCH_MODIFIER'])
  const normalizedKeywords: Array<Record<string, any>> = []
  const dedupe = new Set<string>()

  source.forEach((entry, index) => {
    let text = ''
    let matchType = ''
    let searchVolume: unknown
    let lowTopPageBid: unknown
    let highTopPageBid: unknown

    if (typeof entry === 'string') {
      text = entry.trim()
    } else if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>
      const textCandidate = typeof obj.keyword === 'string' ? obj.keyword : (typeof obj.text === 'string' ? obj.text : '')
      text = textCandidate.trim()
      matchType = typeof obj.matchType === 'string' ? obj.matchType.trim().toUpperCase() : ''
      searchVolume = obj.searchVolume
      lowTopPageBid = obj.lowTopPageBid
      highTopPageBid = obj.highTopPageBid
    }

    if (!text) return
    const dedupeKey = text.toLowerCase()
    if (dedupe.has(dedupeKey)) return
    dedupe.add(dedupeKey)

    const normalizedMatchType = validMatchTypes.has(matchType) ? matchType : (index === 0 ? 'EXACT' : 'PHRASE')
    const normalizedEntry: Record<string, any> = {
      text,
      matchType: normalizedMatchType,
    }

    if (isPositiveNumber(searchVolume)) normalizedEntry.searchVolume = Number(searchVolume)
    if (isPositiveNumber(lowTopPageBid)) normalizedEntry.lowTopPageBid = Number(lowTopPageBid)
    if (isPositiveNumber(highTopPageBid)) normalizedEntry.highTopPageBid = Number(highTopPageBid)

    normalizedKeywords.push(normalizedEntry)
  })

  return normalizedKeywords
}

function buildWebDefaultNegativeKeywords(value: unknown): string[] {
  const dedupe = new Set<string>()
  const normalized: string[] = []

  for (const keyword of ensureStringArray(parseJsonArray(value))) {
    const key = keyword.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.add(key)
    normalized.push(keyword)
  }

  return normalized
}

function buildDefaultNegativeKeywordMatchTypeMap(keywords: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  keywords.forEach((keyword) => {
    map[keyword] = inferNegativeKeywordMatchType(keyword)
  })
  return map
}

function buildNormalizedNegativeKeywordMatchTypeMap(params: {
  keywords: string[]
  currentMap: unknown
}): Record<string, string> {
  const sourceMap = isPlainObject(params.currentMap)
    ? (params.currentMap as Record<string, unknown>)
    : {}

  const normalizedMap: Record<string, string> = {}
  params.keywords.forEach((keyword) => {
    const candidate = sourceMap[keyword]
      ?? sourceMap[keyword.toLowerCase()]
      ?? sourceMap[keyword.toUpperCase()]
    const normalized = normalizeMatchType(typeof candidate === 'string' ? candidate : null)
    normalizedMap[keyword] = normalized || inferNegativeKeywordMatchType(keyword)
  })

  return normalizedMap
}

async function resolvePublishOfferContext(params: {
  db: OpenclawExecutorDb
  userId: number
  offerId: number | null
}): Promise<{
  url: string
  finalUrl: string
  finalUrlSuffix: string
  targetCountry: string
  targetLanguage: string
} | null> {
  if (!params.offerId) return null

  const row = await params.db.queryOne<{
    url: string | null
    final_url: string | null
    final_url_suffix: string | null
    target_country: string | null
    target_language: string | null
  }>(
    `SELECT url, final_url, final_url_suffix, target_country, target_language
     FROM offers
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [params.offerId, params.userId]
  )

  if (!row) return null
  return {
    url: typeof row.url === 'string' ? row.url : '',
    finalUrl: typeof row.final_url === 'string' ? row.final_url : '',
    finalUrlSuffix: typeof row.final_url_suffix === 'string' ? row.final_url_suffix : '',
    targetCountry: typeof row.target_country === 'string' ? row.target_country : '',
    targetLanguage: typeof row.target_language === 'string' ? row.target_language : '',
  }
}

async function resolvePublishAccountCurrency(params: {
  db: OpenclawExecutorDb
  userId: number
  rawAccountId: unknown
}): Promise<string | null> {
  const raw = String(params.rawAccountId ?? '').trim().replace(/\s+/g, '')
  if (!raw) return null

  const accountId = toSafePositiveInt32(raw)
  const notDeletedCondition = params.db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  if (accountId) {
    const byId = await params.db.queryOne<{ currency: string | null }>(
      `SELECT currency
       FROM google_ads_accounts
       WHERE id = ? AND user_id = ? AND ${notDeletedCondition}
       LIMIT 1`,
      [accountId, params.userId]
    )
    if (byId?.currency) {
      return byId.currency
    }
  }

  const customerId = raw.replace(/-/g, '')
  if (!customerId) return null

  const byCustomerId = await params.db.queryOne<{ currency: string | null }>(
    `SELECT currency
     FROM google_ads_accounts
     WHERE customer_id = ? AND user_id = ? AND ${notDeletedCondition}
     LIMIT 1`,
    [customerId, params.userId]
  )

  return byCustomerId?.currency || null
}

function isCampaignPublishCommand(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' && path === '/api/campaigns/publish'
}

async function hydrateCampaignPublishRequestBody(params: {
  db: OpenclawExecutorDb
  userId: number
  method: string
  path: string
  body: unknown
}): Promise<{ body: unknown; hydrated: boolean }> {
  if (!isCampaignPublishCommand(params.method, params.path)) {
    return { body: params.body, hydrated: false }
  }

  if (!isPlainObject(params.body)) {
    return { body: params.body, hydrated: false }
  }

  const body = params.body as Record<string, any>
  const campaignConfigRaw = body.campaignConfig ?? body.campaign_config
  const normalizedCampaignConfig = normalizeCampaignPublishCampaignConfig(campaignConfigRaw)
  if (!normalizedCampaignConfig) {
    return { body: params.body, hydrated: false }
  }

  const campaignConfig = normalizedCampaignConfig
  const normalizedBody: Record<string, any> = {
    ...body,
    campaignConfig,
  }
  if (Object.prototype.hasOwnProperty.call(body, 'campaign_config')) {
    normalizedBody.campaign_config = campaignConfig
  }

  const offerId = toPositiveInteger(normalizedBody.offerId ?? normalizedBody.offer_id)
  const adCreativeId = toPositiveInteger(normalizedBody.adCreativeId ?? normalizedBody.ad_creative_id)
  const rawGoogleAdsAccountId = normalizedBody.googleAdsAccountId ?? normalizedBody.google_ads_account_id

  const [offerContext, accountCurrency] = await Promise.all([
    resolvePublishOfferContext({
      db: params.db,
      userId: params.userId,
      offerId,
    }),
    resolvePublishAccountCurrency({
      db: params.db,
      userId: params.userId,
      rawAccountId: rawGoogleAdsAccountId,
    }),
  ])

  const creative = (offerId && adCreativeId)
    ? await params.db.queryOne<{
        id: number
        keywords: unknown
        keywords_with_volume: unknown
        negative_keywords: unknown
        final_url: string | null
        final_url_suffix: string | null
      }>(
        `SELECT id, keywords, keywords_with_volume, negative_keywords, final_url, final_url_suffix
         FROM ad_creatives
         WHERE id = ? AND offer_id = ? AND user_id = ?
         LIMIT 1`,
        [adCreativeId, offerId, params.userId]
      )
    : null

  const ownershipCheck = evaluatePublishCampaignConfigOwnership({
    campaignConfig,
    creative: {
      finalUrl: creative?.final_url || null,
      finalUrlSuffix: creative?.final_url_suffix || null,
    },
    offer: {
      url: offerContext?.url || null,
      finalUrl: offerContext?.finalUrl || null,
      finalUrlSuffix: offerContext?.finalUrlSuffix || null,
    },
  })
  if (hasPublishCampaignConfigOwnershipViolation(ownershipCheck.violation)) {
    const violationHints: string[] = []
    if (ownershipCheck.violation.finalUrls) {
      violationHints.push(`finalUrls input=${ownershipCheck.violation.inputFinalUrl || '-'} expected=${ownershipCheck.violation.expectedFinalUrl || '-'}`)
    }
    if (ownershipCheck.violation.finalUrlSuffix) {
      violationHints.push(`finalUrlSuffix input=${ownershipCheck.violation.inputFinalUrlSuffix || '-'} expected=${ownershipCheck.violation.expectedFinalUrlSuffix || '-'}`)
    }
    throw new Error(`[OpenClawCommand] campaign.publish URL字段归属校验失败: ${violationHints.join('; ')}`)
  }

  let hydratedCampaignConfig: Record<string, any> = {
    ...campaignConfig,
  }

  if (!isPositiveNumber(hydratedCampaignConfig.budgetAmount)) {
    hydratedCampaignConfig.budgetAmount = getWebDefaultDailyBudget(accountCurrency)
  }

  if (!isNonEmptyString(hydratedCampaignConfig.budgetType)) {
    hydratedCampaignConfig.budgetType = 'DAILY'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.targetCountry)) {
    hydratedCampaignConfig.targetCountry = offerContext?.targetCountry || 'US'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.targetLanguage)) {
    hydratedCampaignConfig.targetLanguage = offerContext?.targetLanguage || 'en'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.biddingStrategy)) {
    hydratedCampaignConfig.biddingStrategy = 'MAXIMIZE_CLICKS'
  }

  if (!isNonEmptyString(hydratedCampaignConfig.marketingObjective)) {
    hydratedCampaignConfig.marketingObjective = 'WEB_TRAFFIC'
  }

  if (!isPositiveNumber(hydratedCampaignConfig.maxCpcBid)) {
    hydratedCampaignConfig.maxCpcBid = getWebDefaultCpc(accountCurrency)
  }

  const alignedCampaignConfig = buildAlignedPublishCampaignConfig({
    campaignConfig: hydratedCampaignConfig,
    creative: {
      finalUrl: creative?.final_url || null,
      finalUrlSuffix: creative?.final_url_suffix || null,
    },
    offer: {
      url: offerContext?.url || null,
      finalUrl: offerContext?.finalUrl || null,
      finalUrlSuffix: offerContext?.finalUrlSuffix || null,
    },
  })
  hydratedCampaignConfig = alignedCampaignConfig.campaignConfig

  if (process.env.NODE_ENV !== 'test' && (alignedCampaignConfig.overridden.finalUrls || alignedCampaignConfig.overridden.finalUrlSuffix)) {
    console.log(
      `[OpenClawCommand] campaign.publish URL字段按Web来源对齐: inputFinalUrl=${alignedCampaignConfig.overridden.inputFinalUrl || '-'} -> appliedFinalUrl=${alignedCampaignConfig.overridden.appliedFinalUrl || '-'}`
    )
  }

  const defaultKeywords = creative
    ? buildWebDefaultKeywords({
        keywordsWithVolume: creative.keywords_with_volume,
        keywords: creative.keywords,
      })
    : []
  const defaultNegativeKeywords = creative
    ? buildWebDefaultNegativeKeywords(creative.negative_keywords)
    : []

  const configuredNegativeKeywords =
    hydratedCampaignConfig.negativeKeywords !== undefined
      ? hydratedCampaignConfig.negativeKeywords
      : hydratedCampaignConfig.negative_keywords

  const effectiveCreative = buildEffectiveCreative({
    dbCreative: {
      headlines: [],
      descriptions: [],
      keywords: (creative?.keywords as any) || [],
      negativeKeywords: (creative?.negative_keywords as any) || [],
      callouts: [],
      sitelinks: [],
      finalUrl: creative?.final_url || offerContext?.finalUrl || offerContext?.url || '',
      finalUrlSuffix: creative?.final_url_suffix || null,
    },
    campaignConfig: hydratedCampaignConfig,
    offerUrlFallback: offerContext?.url || undefined,
  })

  const resolvedKeywordConfig = resolveTaskCampaignKeywords({
    configuredKeywords: hydratedCampaignConfig.keywords,
    configuredNegativeKeywords,
    fallbackKeywords: defaultKeywords.length > 0 ? defaultKeywords : effectiveCreative.keywords,
    fallbackNegativeKeywords: defaultNegativeKeywords.length > 0 ? defaultNegativeKeywords : effectiveCreative.negativeKeywords,
  })

  if (resolvedKeywordConfig.usedKeywordFallback) {
    hydratedCampaignConfig.keywords = resolvedKeywordConfig.keywords
  }

  if (resolvedKeywordConfig.usedNegativeKeywordFallback) {
    hydratedCampaignConfig.negativeKeywords = resolvedKeywordConfig.negativeKeywords
  }

  const normalizedNegativeKeywords = ensureStringArray(hydratedCampaignConfig.negativeKeywords)
  if (normalizedNegativeKeywords.length > 0) {
    hydratedCampaignConfig.negativeKeywords = normalizedNegativeKeywords
    hydratedCampaignConfig.negativeKeywordMatchType = buildNormalizedNegativeKeywordMatchTypeMap({
      keywords: normalizedNegativeKeywords,
      currentMap:
        hydratedCampaignConfig.negativeKeywordMatchType
        ?? hydratedCampaignConfig.negativeKeywordsMatchType
        ?? buildDefaultNegativeKeywordMatchTypeMap(normalizedNegativeKeywords),
    })
  }

  const hydratedBody: Record<string, any> = {
    ...normalizedBody,
    campaignConfig: hydratedCampaignConfig,
  }

  if (Object.prototype.hasOwnProperty.call(normalizedBody, 'campaign_config')) {
    hydratedBody.campaign_config = hydratedCampaignConfig
  }

  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[OpenClawCommand] 补齐campaign.publish默认参数: offerId=${offerId || '-'}, adCreativeId=${adCreativeId || '-'}, currency=${normalizeCurrencyCode(accountCurrency) || 'USD'}, keywords=${resolvedKeywordConfig.keywords.length}, negativeKeywords=${resolvedKeywordConfig.negativeKeywords.length}`
    )
  }

  return {
    body: hydratedBody,
    hydrated: true,
  }
}

async function queryOfferExtractCommissionSourceMatch(params: {
  db: OpenclawExecutorDb
  userId: number
  affiliateLink: string
}): Promise<{
  productId: number
  commissionRate: number
  matchedBy: OfferExtractCommissionSourceMatchType
} | null> {
  const affiliateLink = toTrimmedString(params.affiliateLink)
  if (!affiliateLink) return null

  const normalizedAffiliateLink = normalizeUrlForComparison(affiliateLink)
  const yesPromosPid = extractYeahPromosPidFromLink(affiliateLink)
  const partnerboostLinkId = extractPartnerboostLinkIdFromLink(affiliateLink)
  const matchClauses: string[] = []
  const matchParams: Array<number | string> = [params.userId]

  // 先用完整链接精确匹配（保留大小写不敏感匹配，兼容历史数据格式差异）。
  matchClauses.push('LOWER(TRIM(promo_link)) = LOWER(TRIM(?))')
  matchParams.push(affiliateLink)
  matchClauses.push('LOWER(TRIM(short_promo_link)) = LOWER(TRIM(?))')
  matchParams.push(affiliateLink)

  if (yesPromosPid) {
    const pattern = `%pid=${yesPromosPid}%`
    matchClauses.push("(platform = 'yeahpromos' AND (promo_link LIKE ? OR short_promo_link LIKE ?))")
    matchParams.push(pattern, pattern)
  }

  if (partnerboostLinkId) {
    const pattern = `%aa_adgroupid=${partnerboostLinkId}%`
    matchClauses.push("(platform = 'partnerboost' AND (promo_link LIKE ? OR short_promo_link LIKE ?))")
    matchParams.push(pattern, pattern)
  }

  if (matchClauses.length === 0) return null

  const notBlacklistedCondition = params.db.type === 'postgres'
    ? '(is_blacklisted = false OR is_blacklisted IS NULL)'
    : '(is_blacklisted = 0 OR is_blacklisted IS NULL)'

  let rows: Array<{
    id: number
    platform: string | null
    promo_link: string | null
    short_promo_link: string | null
    commission_rate: number | string | null
  }> = []
  try {
    rows = await params.db.query<{
      id: number
      platform: string | null
      promo_link: string | null
      short_promo_link: string | null
      commission_rate: number | string | null
    }>(
      `
        SELECT id, platform, promo_link, short_promo_link, commission_rate
        FROM affiliate_products
        WHERE user_id = ?
          AND commission_rate IS NOT NULL
          AND commission_rate > 0
          AND ${notBlacklistedCondition}
          AND (${matchClauses.join(' OR ')})
        ORDER BY updated_at DESC, id DESC
        LIMIT 30
      `,
      matchParams
    )
  } catch (error: any) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[OpenClawCommand] 查询 affiliate_products 佣金来源失败，跳过来源纠偏: ${error?.message || error}`
      )
    }
    return null
  }

  if (!rows || rows.length === 0) {
    return null
  }

  let bestMatch: {
    score: number
    productId: number
    commissionRate: number
    matchedBy: OfferExtractCommissionSourceMatchType
  } | null = null

  for (const row of rows) {
    const productId = Number(row.id)
    const rawRate = Number(row.commission_rate)
    if (!Number.isFinite(productId) || !Number.isFinite(rawRate) || rawRate <= 0) {
      continue
    }

    const promoLink = toTrimmedString(row.promo_link)
    const shortPromoLink = toTrimmedString(row.short_promo_link)
    const rowLinks = [promoLink, shortPromoLink].filter((item): item is string => Boolean(item))
    let matchedBy: OfferExtractCommissionSourceMatchType | null = null
    let score = 0

    if (normalizedAffiliateLink) {
      const hasExactMatch = rowLinks.some((candidate) => normalizeUrlForComparison(candidate) === normalizedAffiliateLink)
      if (hasExactMatch) {
        matchedBy = 'exact_link'
        score = 300
      }
    }

    if (yesPromosPid && score < 200) {
      const hasPidMatch = rowLinks.some((candidate) => extractYeahPromosPidFromLink(candidate) === yesPromosPid)
      if (hasPidMatch) {
        matchedBy = 'yeahpromos_pid'
        score = 200
      }
    }

    if (partnerboostLinkId && score < 200) {
      const hasPartnerboostLinkIdMatch = rowLinks.some(
        (candidate) => extractPartnerboostLinkIdFromLink(candidate) === partnerboostLinkId
      )
      if (hasPartnerboostLinkIdMatch) {
        matchedBy = 'partnerboost_link_id'
        score = 200
      }
    }

    if (!matchedBy || score <= 0) {
      continue
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        score,
        productId,
        commissionRate: roundTo2(rawRate),
        matchedBy,
      }
    }
  }

  if (!bestMatch) {
    return null
  }

  return {
    productId: bestMatch.productId,
    commissionRate: bestMatch.commissionRate,
    matchedBy: bestMatch.matchedBy,
  }
}

async function hydrateOfferExtractCommissionBySource(params: {
  db: OpenclawExecutorDb
  userId: number
  method: string
  path: string
  body: unknown
}): Promise<{ body: unknown; hydrated: boolean }> {
  if (params.method !== 'POST') {
    return { body: params.body, hydrated: false }
  }

  if (!isOfferExtractPath(params.path)) {
    return { body: params.body, hydrated: false }
  }

  if (!isPlainObject(params.body)) {
    return { body: params.body, hydrated: false }
  }

  const payload = params.body as Record<string, unknown>
  const affiliateLink = toTrimmedString(payload.affiliate_link ?? payload.affiliateLink)
  const commissionText = toTrimmedString(payload.commission_payout ?? payload.commissionPayout)
  if (!affiliateLink || !commissionText) {
    return { body: params.body, hydrated: false }
  }

  const targetCountry = toTrimmedString(payload.target_country ?? payload.targetCountry) || 'US'
  const incomingCommission = parseCommissionPayoutValue(commissionText, {
    targetCountry,
  })
  if (!incomingCommission || incomingCommission.mode !== 'percent') {
    return { body: params.body, hydrated: false }
  }

  const sourceMatch = await queryOfferExtractCommissionSourceMatch({
    db: params.db,
    userId: params.userId,
    affiliateLink,
  })
  if (!sourceMatch) {
    return { body: params.body, hydrated: false }
  }

  if (Math.abs(sourceMatch.commissionRate - incomingCommission.displayRate) <= 0.05) {
    return { body: params.body, hydrated: false }
  }

  const correctedCommission = `${formatCompactNumber(sourceMatch.commissionRate)}%`
  const hydratedBody: Record<string, unknown> = {
    ...payload,
    commission_payout: correctedCommission,
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'commissionPayout')) {
    hydratedBody.commissionPayout = correctedCommission
  }

  if (process.env.NODE_ENV !== 'test') {
    console.warn(
      `[OpenClawCommand] 来源纠偏佣金比例: offer.extract ${incomingCommission.displayRate}% -> ${correctedCommission} (productId=${sourceMatch.productId}, matchedBy=${sourceMatch.matchedBy})`
    )
  }

  return {
    body: hydratedBody,
    hydrated: true,
  }
}

async function hydrateOfferExtractCommissionByHistory(params: {
  db: OpenclawExecutorDb
  userId: number
  method: string
  path: string
  body: unknown
}): Promise<{ body: unknown; hydrated: boolean }> {
  if (params.method !== 'POST') {
    return { body: params.body, hydrated: false }
  }

  if (!isOfferExtractPath(params.path)) {
    return { body: params.body, hydrated: false }
  }

  if (!isPlainObject(params.body)) {
    return { body: params.body, hydrated: false }
  }

  const payload = params.body as Record<string, unknown>
  const affiliateLink = toTrimmedString(payload.affiliate_link ?? payload.affiliateLink)
  const commissionText = toTrimmedString(payload.commission_payout ?? payload.commissionPayout)
  const productPriceText = toTrimmedString(payload.product_price ?? payload.productPrice)
  if (!affiliateLink || !commissionText || !productPriceText) {
    return { body: params.body, hydrated: false }
  }

  const targetCountry = toTrimmedString(payload.target_country ?? payload.targetCountry) || 'US'
  const incomingCommission = parseCommissionPayoutValue(commissionText, {
    targetCountry,
  })
  if (!incomingCommission || incomingCommission.mode !== 'percent') {
    return { body: params.body, hydrated: false }
  }

  const incomingProductPrice = parseMoneyValue(productPriceText, {
    targetCountry,
  })
  if (!incomingProductPrice || incomingProductPrice.amount <= 0) {
    return { body: params.body, hydrated: false }
  }

  const historyRows = await params.db.query<{
    id: number
    product_price: string | null
    commission_payout: string | null
  }>(
    `
      SELECT id, product_price, commission_payout
      FROM offers
      WHERE user_id = ?
        AND affiliate_link = ?
        AND commission_payout IS NOT NULL
        AND product_price IS NOT NULL
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 20
    `,
    [params.userId, affiliateLink]
  )

  if (!historyRows || historyRows.length === 0) {
    return { body: params.body, hydrated: false }
  }

  for (const row of historyRows) {
    const historyCommissionText = toTrimmedString(row.commission_payout)
    const historyPriceText = toTrimmedString(row.product_price)
    if (!historyCommissionText || !historyPriceText) continue

    const historyCommission = parseCommissionPayoutValue(historyCommissionText, {
      targetCountry,
    })
    if (!historyCommission || historyCommission.mode !== 'percent') continue

    const historyPrice = parseMoneyValue(historyPriceText, {
      targetCountry,
    })
    if (!historyPrice || historyPrice.amount <= 0) continue

    if (Math.abs(historyPrice.amount - incomingProductPrice.amount) > 0.02) {
      continue
    }

    const expectedAmount = roundTo2(historyPrice.amount * (historyCommission.displayRate / 100))
    const isAmountDerivedPercent =
      Math.abs(expectedAmount - incomingCommission.displayRate) <= 0.02
      && Math.abs(historyCommission.displayRate - incomingCommission.displayRate) > 0.05

    if (!isAmountDerivedPercent) {
      continue
    }

    const correctedCommission = `${formatCompactNumber(historyCommission.displayRate)}%`
    const hydratedBody: Record<string, unknown> = {
      ...payload,
      commission_payout: correctedCommission,
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'commissionPayout')) {
      hydratedBody.commissionPayout = correctedCommission
    }

    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[OpenClawCommand] 自动修正佣金比例(疑似金额误写为百分比): offer.extract ${incomingCommission.displayRate}% -> ${correctedCommission} (offerId=${row.id})`
      )
    }

    return {
      body: hydratedBody,
      hydrated: true,
    }
  }

  return { body: params.body, hydrated: false }
}

function extractOfferIdFromClickFarmBody(body: unknown): number | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }

  const payload = body as Record<string, unknown>
  return toPositiveInteger(payload.offer_id ?? payload.offerId)
}

async function hasEnabledCampaignForOffer(params: {
  db: OpenclawExecutorDb
  userId: number
  offerId: number
}): Promise<boolean> {
  const notDeletedCondition = params.db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const row = await params.db.queryOne(
    `SELECT id
     FROM campaigns
     WHERE user_id = ?
       AND offer_id = ?
       AND status = 'ENABLED'
       AND ${notDeletedCondition}
     ORDER BY updated_at DESC
     LIMIT 1`,
    [params.userId, params.offerId]
  )

  return Boolean(row?.id)
}

async function hasRecentSuccessfulPublishForOffer(params: {
  db: OpenclawExecutorDb
  userId: number
  offerId: number
}): Promise<boolean> {
  const rows = await params.db.query(
    `SELECT request_body_json, completed_at
     FROM openclaw_command_runs
     WHERE user_id = ?
       AND request_method = 'POST'
       AND request_path = '/api/campaigns/publish'
       AND status = 'completed'
       AND response_status >= 200
       AND response_status < 300
     ORDER BY completed_at DESC
     LIMIT 30`,
    [params.userId]
  )

  const now = Date.now()
  for (const row of rows) {
    const completedAt = row.completed_at ? new Date(row.completed_at).getTime() : NaN
    if (!Number.isFinite(completedAt) || now - completedAt > CLICK_FARM_PUBLISH_LOOKBACK_MS) {
      continue
    }

    const requestBody = parseJsonAny(row.request_body_json || null)
    const publishOfferId = toPositiveInteger(requestBody?.offerId ?? requestBody?.offer_id)
    if (publishOfferId === params.offerId) {
      return true
    }
  }

  return false
}

async function assertClickFarmTaskPrerequisites(params: {
  db: OpenclawExecutorDb
  userId: number
  method: string
  path: string
  requestBody: unknown
}): Promise<void> {
  if (params.method !== 'POST' || params.path !== '/api/click-farm/tasks') {
    return
  }

  const offerId = extractOfferIdFromClickFarmBody(params.requestBody)
  if (!offerId) {
    throw new Error('click-farm.create 缺少 offer_id，无法校验发布前置条件')
  }

  const hasEnabledCampaign = await hasEnabledCampaignForOffer({
    db: params.db,
    userId: params.userId,
    offerId,
  })
  if (hasEnabledCampaign) {
    return
  }

  const hasRecentPublish = await hasRecentSuccessfulPublishForOffer({
    db: params.db,
    userId: params.userId,
    offerId,
  })
  if (hasRecentPublish) {
    return
  }

  throw new Error(`补点击前置校验失败：Offer ${offerId} 缺少可用Campaign，请先成功发布广告`)
}

function normalizeGoogleCampaignId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return /^\d+$/.test(raw) ? raw : null
}

function extractUpdateCpcCampaignId(path: string): string | null {
  const match = String(path || '').match(/^\/api\/campaigns\/(\d+)\/update-cpc$/)
  return match?.[1] || null
}

function extractLocalCampaignRoutePath(path: string): { campaignId: string; suffix: '' | '/toggle-status' | '/offline' | '/sync' } | null {
  const match = String(path || '').match(/^\/api\/campaigns\/(\d+)(?:\/(toggle-status|offline|sync))?$/)
  if (!match) return null
  const suffixRaw = match[2]
  if (!suffixRaw) return { campaignId: match[1], suffix: '' }
  if (suffixRaw === 'toggle-status') return { campaignId: match[1], suffix: '/toggle-status' }
  if (suffixRaw === 'offline') return { campaignId: match[1], suffix: '/offline' }
  if (suffixRaw === 'sync') return { campaignId: match[1], suffix: '/sync' }
  return null
}

function isLocalCampaignRoute(params: {
  method: string
  suffix: '' | '/toggle-status' | '/offline' | '/sync'
}): boolean {
  const method = params.method.toUpperCase()
  if (params.suffix === '') {
    return method === 'PUT' || method === 'DELETE'
  }
  if (params.suffix === '/toggle-status') return method === 'PUT'
  if (params.suffix === '/offline') return method === 'POST'
  if (params.suffix === '/sync') return method === 'POST'
  return false
}

async function assertLocalCampaignRouteIdSemantic(params: {
  db: OpenclawExecutorDb
  userId: number
  method: string
  path: string
}): Promise<void> {
  const parsed = extractLocalCampaignRoutePath(params.path)
  if (!parsed) return
  if (!isLocalCampaignRoute({ method: params.method, suffix: parsed.suffix })) return

  const localCampaignId = Number(parsed.campaignId)
  if (!Number.isFinite(localCampaignId)) return

  const localCampaign = await params.db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM campaigns
      WHERE user_id = ?
        AND id = ?
      LIMIT 1
    `,
    [params.userId, localCampaignId]
  )
  if (localCampaign?.id) return

  const linkedByGoogleCampaignId = await params.db.queryOne<{
    id: number
    campaign_id: string | null
    google_campaign_id: string | null
  }>(
    `
      SELECT id, campaign_id, google_campaign_id
      FROM campaigns
      WHERE user_id = ?
        AND status != 'REMOVED'
        AND google_campaign_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [params.userId, parsed.campaignId]
  )

  if (!linkedByGoogleCampaignId?.id) return

  throw new OpenclawCommandValidationError(422, {
    error: `路由参数语义错误：${params.path} 的 :id 必须是本地 campaign.id，收到 googleCampaignId=${parsed.campaignId}`,
    action: 'USE_LOCAL_CAMPAIGN_ID',
    localCampaignId: linkedByGoogleCampaignId.id,
    googleCampaignId: parsed.campaignId,
    expectedPath: `/api/campaigns/${linkedByGoogleCampaignId.id}${parsed.suffix}`,
  })
}

async function assertUpdateCpcRouteIdSemantic(params: {
  db: OpenclawExecutorDb
  userId: number
  method: string
  path: string
}): Promise<void> {
  if (params.method.toUpperCase() !== 'PUT') return

  const pathCampaignId = extractUpdateCpcCampaignId(params.path)
  if (!pathCampaignId) return

  const linkedByGoogleCampaignId = await params.db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM campaigns
      WHERE user_id = ?
        AND status != 'REMOVED'
        AND google_campaign_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [params.userId, pathCampaignId]
  )

  if (linkedByGoogleCampaignId?.id) return

  const localCampaignId = Number(pathCampaignId)
  if (!Number.isFinite(localCampaignId)) return

  const localCampaign = await params.db.queryOne<{
    id: number
    campaign_id: string | null
    google_campaign_id: string | null
    status: string | null
    is_deleted: any
  }>(
    `
      SELECT id, campaign_id, google_campaign_id, status, is_deleted
      FROM campaigns
      WHERE user_id = ?
        AND id = ?
      LIMIT 1
    `,
    [params.userId, localCampaignId]
  )

  if (!localCampaign) return

  const isRemoved = String(localCampaign.status || '').toUpperCase() === 'REMOVED'
    || localCampaign.is_deleted === true
    || localCampaign.is_deleted === 1
  if (isRemoved) {
    throw new OpenclawCommandValidationError(400, {
      error: '该广告系列已下线/删除，无法调整CPC',
    })
  }

  const expectedGoogleCampaignId =
    normalizeGoogleCampaignId(localCampaign.google_campaign_id)
    || normalizeGoogleCampaignId(localCampaign.campaign_id)

  if (!expectedGoogleCampaignId) {
    throw new OpenclawCommandValidationError(400, {
      error: '该广告系列尚未发布到Google Ads，无法调整CPC',
    })
  }

  if (expectedGoogleCampaignId !== pathCampaignId) {
    throw new OpenclawCommandValidationError(422, {
      error: `路由参数语义错误：update-cpc 的 :id 必须是 googleCampaignId，收到本地 campaign.id=${localCampaignId}`,
      action: 'USE_GOOGLE_CAMPAIGN_ID',
      localCampaignId,
      googleCampaignId: expectedGoogleCampaignId,
      expectedPath: `/api/campaigns/${expectedGoogleCampaignId}/update-cpc`,
    })
  }
}

function deriveTarget(path: string): { targetType?: string; targetId?: string } {
  const cleanPath = (path || '').split('?')[0]
  const parts = cleanPath.split('/').filter(Boolean)
  if (parts.length < 2 || parts[0] !== 'api') {
    return {}
  }

  return {
    targetType: parts[1],
    targetId: parts[2],
  }
}

function buildUpstreamError(status: number, body: string | null): Error {
  const text = body ? body.slice(0, 300) : 'unknown error'
  return new Error(`AutoAds API error (${status}): ${text}`)
}

export async function executeOpenclawCommandTask(task: Task<OpenclawCommandTaskData>) {
  const data = task.data
  if (!data?.runId || !data?.userId) {
    throw new Error('任务参数不完整')
  }

  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  const run = await db.queryOne<{
    id: string
    user_id: number
    channel: string | null
    sender_id: string | null
    request_method: string
    request_path: string
    request_query_json: string | null
    request_body_json: string | null
    risk_level: string
    status: string
    confirm_required: number | boolean
  }>(
    `SELECT
       id,
       user_id,
       channel,
       sender_id,
       request_method,
       request_path,
       request_query_json,
       request_body_json,
       risk_level,
       status,
       confirm_required
     FROM openclaw_command_runs
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [data.runId, data.userId]
  )

  if (!run) {
    throw new Error(`OpenClaw command run not found: ${data.runId}`)
  }

  if (run.status === 'completed' || run.status === 'canceled' || run.status === 'expired') {
    return {
      success: true,
      skipped: true,
      reason: run.status,
      runId: data.runId,
    }
  }

  await db.exec(
    `UPDATE openclaw_command_runs
     SET status = 'running',
         started_at = COALESCE(started_at, ${nowSql}),
         error_message = NULL,
         updated_at = ${nowSql}
     WHERE id = ? AND user_id = ?`,
    [data.runId, data.userId]
  )

  const requestQuery = parseJsonObject(run.request_query_json)
  let requestBody = parseJsonAny(run.request_body_json)
  let requestBodyForAudit = requestBody === undefined ? null : JSON.stringify(requestBody)
  let confirmStatus = (((run.confirm_required as any) === 1 || (run.confirm_required as any) === true) ? 'required' : 'not_required')

  const startedAt = Date.now()
  let responseStatus: number | null = null
  let responseBody: string | null = null
  let latencyMs = 0
  let heartbeatTimer: NodeJS.Timeout | null = null

  const action = `${run.request_method} ${run.request_path}`
  const { targetType, targetId } = deriveTarget(run.request_path)
  const updateRunHeartbeat = async () => {
    await db.exec(
      `UPDATE openclaw_command_runs
       SET updated_at = ${nowSql}
       WHERE id = ? AND user_id = ? AND status = 'running'`,
      [data.runId, data.userId]
    )
    await db.exec(
      `UPDATE openclaw_command_steps
       SET updated_at = ${nowSql}
       WHERE run_id = ? AND step_index = 0 AND status = 'running'`,
      [data.runId]
    )
  }

  try {
    const offerExtractBySourceHydrated = await hydrateOfferExtractCommissionBySource({
      db,
      userId: data.userId,
      method: run.request_method,
      path: run.request_path,
      body: requestBody,
    })
    requestBody = offerExtractBySourceHydrated.body

    const offerExtractByHistoryHydrated = await hydrateOfferExtractCommissionByHistory({
      db,
      userId: data.userId,
      method: run.request_method,
      path: run.request_path,
      body: requestBody,
    })
    requestBody = offerExtractByHistoryHydrated.body

    const publishHydrated = await hydrateCampaignPublishRequestBody({
      db,
      userId: data.userId,
      method: run.request_method,
      path: run.request_path,
      body: requestBody,
    })
    requestBody = publishHydrated.body
    requestBodyForAudit = requestBody === undefined ? null : JSON.stringify(requestBody)

    if (
      (offerExtractBySourceHydrated.hydrated || offerExtractByHistoryHydrated.hydrated || publishHydrated.hydrated)
      && requestBodyForAudit !== run.request_body_json
    ) {
      await db.exec(
        `UPDATE openclaw_command_runs
         SET request_body_json = ?,
             updated_at = ${nowSql}
         WHERE id = ? AND user_id = ?`,
        [requestBodyForAudit, data.runId, data.userId]
      )
    }

    const requestPayload = {
      method: run.request_method,
      path: run.request_path,
      query: requestQuery,
      body: requestBody,
    }

    await db.exec(
      `INSERT INTO openclaw_command_steps
       (run_id, step_index, action_type, request_json, status, created_at, updated_at)
       VALUES (?, 0, 'proxy', ?, 'running', ${nowSql}, ${nowSql})
       ON CONFLICT(run_id, step_index)
       DO UPDATE SET
         action_type = excluded.action_type,
         request_json = excluded.request_json,
         status = 'running',
         error_message = NULL,
         updated_at = ${nowSql}`,
      [data.runId, JSON.stringify(requestPayload)]
    )

    const confirm = await db.queryOne<{ status: string }>(
      'SELECT status FROM openclaw_command_confirms WHERE run_id = ? LIMIT 1',
      [data.runId]
    )
    if (confirm?.status) {
      confirmStatus = confirm.status
    }

    await updateRunHeartbeat()
    heartbeatTimer = setInterval(() => {
      void updateRunHeartbeat().catch((heartbeatError: any) => {
        console.warn(`⚠️ OpenClaw命令心跳更新失败: runId=${data.runId}: ${heartbeatError?.message || heartbeatError}`)
      })
    }, OPENCLAW_COMMAND_HEARTBEAT_MS)

    await assertClickFarmTaskPrerequisites({
      db,
      userId: data.userId,
      method: run.request_method,
      path: run.request_path,
      requestBody,
    })
    await assertLocalCampaignRouteIdSemantic({
      db,
      userId: data.userId,
      method: run.request_method,
      path: run.request_path,
    })
    await assertUpdateCpcRouteIdSemantic({
      db,
      userId: data.userId,
      method: run.request_method,
      path: run.request_path,
    })

    const upstream = await fetchAutoadsAsUser({
      userId: data.userId,
      path: run.request_path,
      method: run.request_method,
      query: requestQuery,
      body: requestBody,
      timeoutMs: OPENCLAW_COMMAND_UPSTREAM_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
      },
    })

    responseStatus = upstream.status
    responseBody = truncateBody(await upstream.text())
    latencyMs = Date.now() - startedAt

    if (!upstream.ok) {
      throw buildUpstreamError(upstream.status, responseBody)
    }

    await db.exec(
      `UPDATE openclaw_command_steps
       SET status = 'success',
           response_json = ?,
           latency_ms = ?,
           error_message = NULL,
           updated_at = ${nowSql}
       WHERE run_id = ? AND step_index = 0`,
      [responseBody, latencyMs, data.runId]
    )

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'completed',
           response_status = ?,
           response_body = ?,
           error_message = NULL,
           completed_at = ${nowSql},
           updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [responseStatus, responseBody, data.runId, data.userId]
    )

    await recordOpenclawAction({
      userId: data.userId,
      channel: run.channel,
      senderId: run.sender_id,
      action,
      targetType,
      targetId,
      requestBody: requestBodyForAudit,
      responseBody,
      status: 'success',
      runId: data.runId,
      riskLevel: run.risk_level,
      confirmStatus,
      latencyMs,
    })

    return {
      success: true,
      runId: data.runId,
      responseStatus,
      latencyMs,
    }
  } catch (error: any) {
    if (error instanceof OpenclawCommandValidationError) {
      responseStatus = error.status
      responseBody = truncateBody(JSON.stringify(error.response))
    }
    latencyMs = latencyMs || Date.now() - startedAt
    const message = error?.message || 'OpenClaw command execution failed'

    await db.exec(
      `UPDATE openclaw_command_steps
       SET status = 'failed',
           response_json = ?,
           latency_ms = ?,
           error_message = ?,
           updated_at = ${nowSql}
       WHERE run_id = ? AND step_index = 0`,
      [responseBody, latencyMs, message, data.runId]
    )

    await db.exec(
      `UPDATE openclaw_command_runs
       SET status = 'failed',
           response_status = ?,
           response_body = ?,
           error_message = ?,
           completed_at = ${nowSql},
           updated_at = ${nowSql}
       WHERE id = ? AND user_id = ?`,
      [responseStatus, responseBody, message, data.runId, data.userId]
    )

    await recordOpenclawAction({
      userId: data.userId,
      channel: run.channel,
      senderId: run.sender_id,
      action,
      targetType,
      targetId,
      requestBody: requestBodyForAudit,
      responseBody,
      status: 'error',
      errorMessage: message,
      runId: data.runId,
      riskLevel: run.risk_level,
      confirmStatus,
      latencyMs,
    })

    throw error
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}
