type PlainObject = Record<string, any>

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') {
    return true
  }

  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true'
  }

  return false
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true
  }

  if (typeof value === 'string') {
    return value.trim().length === 0
  }

  return false
}

function toSafeNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function applyAliasMap(params: {
  source: PlainObject
  normalized: PlainObject
  aliasMap: Readonly<Record<string, string>>
}) {
  const { source, normalized, aliasMap } = params
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    if (normalized[canonical] === undefined && source[alias] !== undefined) {
      normalized[canonical] = source[alias]
    }
    if (alias !== canonical) {
      delete normalized[alias]
    }
  }
}

const PUBLISH_CAMPAIGN_CONFIG_ALIAS_MAP: Readonly<Record<string, string>> = {
  campaign_name: 'campaignName',
  ad_group_name: 'adGroupName',
  ad_name: 'adName',
  budget_amount: 'budgetAmount',
  budget_type: 'budgetType',
  target_country: 'targetCountry',
  target_language: 'targetLanguage',
  bidding_strategy: 'biddingStrategy',
  marketing_objective: 'marketingObjective',
  final_url_suffix: 'finalUrlSuffix',
  final_urls: 'finalUrls',
  max_cpc_bid: 'maxCpcBid',
  negative_keywords: 'negativeKeywords',
  negative_keywords_match_type: 'negativeKeywordMatchType',
  negative_keyword_match_type: 'negativeKeywordMatchType',
}

const SUPPORTED_KEYWORD_MATCH_TYPES = new Set(['EXACT', 'PHRASE', 'BROAD'])

function normalizePublishKeywordEntries(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  const normalizedEntries = value
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = entry.trim()
        return text ? text : null
      }

      if (!isPlainObject(entry)) {
        return null
      }

      const normalizedEntry: PlainObject = { ...entry }
      const textCandidate = typeof normalizedEntry.text === 'string'
        ? normalizedEntry.text
        : (typeof normalizedEntry.keyword === 'string' ? normalizedEntry.keyword : '')
      const normalizedText = textCandidate.trim()
      if (!normalizedText) {
        return null
      }

      normalizedEntry.text = normalizedText
      delete normalizedEntry.keyword

      const normalizedMatchType = typeof normalizedEntry.matchType === 'string'
        ? normalizedEntry.matchType.trim().toUpperCase()
        : ''
      if (normalizedMatchType && SUPPORTED_KEYWORD_MATCH_TYPES.has(normalizedMatchType)) {
        normalizedEntry.matchType = normalizedMatchType
      }

      return normalizedEntry
    })
    .filter((entry) => entry !== null)

  return normalizedEntries
}

function normalizePublishNegativeKeywords(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const entry of value) {
    let text = ''
    if (typeof entry === 'string') {
      text = entry.trim()
    } else if (isPlainObject(entry)) {
      const candidate = typeof entry.text === 'string'
        ? entry.text
        : (typeof entry.keyword === 'string' ? entry.keyword : '')
      text = candidate.trim()
    }

    if (!text) continue

    const dedupeKey = text.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    normalized.push(text)
  }

  return normalized
}

function normalizePublishFinalUrls(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

export function normalizeCampaignPublishCampaignConfig(value: unknown): PlainObject | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const source = value as PlainObject
  const normalized: PlainObject = {
    ...source,
  }

  applyAliasMap({
    source,
    normalized,
    aliasMap: PUBLISH_CAMPAIGN_CONFIG_ALIAS_MAP,
  })

  normalized.keywords = normalizePublishKeywordEntries(normalized.keywords)
  normalized.negativeKeywords = normalizePublishNegativeKeywords(normalized.negativeKeywords)
  normalized.finalUrls = normalizePublishFinalUrls(normalized.finalUrls)

  return normalized
}

const PUBLISH_TOP_LEVEL_ALIAS_MAP: Readonly<Record<string, string>> = {
  offer_id: 'offerId',
  ad_creative_id: 'adCreativeId',
  google_ads_account_id: 'googleAdsAccountId',
  campaign_config: 'campaignConfig',
  pause_old_campaigns: 'pauseOldCampaigns',
  enable_campaign_immediately: 'enableCampaignImmediately',
  enable_smart_optimization: 'enableSmartOptimization',
  variant_count: 'variantCount',
  force_publish: 'forcePublish',
  forceLaunch: 'forcePublish',
  force_launch: 'forcePublish',
  skipLaunchScore: 'forcePublish',
  skip_launch_score: 'forcePublish',
}

const PUBLISH_FORCE_KEYS = [
  'forcePublish',
  'force_publish',
  'forceLaunch',
  'force_launch',
  'skipLaunchScore',
  'skip_launch_score',
]

export function normalizeCampaignPublishRequestBody(value: unknown): PlainObject | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const source = value as PlainObject
  const normalized: PlainObject = {
    ...source,
  }

  applyAliasMap({
    source,
    normalized,
    aliasMap: PUBLISH_TOP_LEVEL_ALIAS_MAP,
  })

  const hasForce = PUBLISH_FORCE_KEYS.some((key) => source[key] !== undefined)
  if (hasForce) {
    normalized.forcePublish = PUBLISH_FORCE_KEYS.some((key) => isTruthyFlag(source[key]))
  }

  if (normalized.pauseOldCampaigns === undefined) {
    normalized.pauseOldCampaigns = false
  } else {
    normalized.pauseOldCampaigns = isTruthyFlag(normalized.pauseOldCampaigns)
  }

  if (normalized.enableCampaignImmediately === undefined) {
    normalized.enableCampaignImmediately = false
  } else {
    normalized.enableCampaignImmediately = isTruthyFlag(normalized.enableCampaignImmediately)
  }

  if (normalized.enableSmartOptimization === undefined) {
    normalized.enableSmartOptimization = false
  } else {
    normalized.enableSmartOptimization = isTruthyFlag(normalized.enableSmartOptimization)
  }

  const normalizedVariantCount = toSafeNumber(normalized.variantCount)
  if (normalizedVariantCount === undefined) {
    normalized.variantCount = 3
  } else {
    normalized.variantCount = Math.floor(normalizedVariantCount)
  }

  const normalizedCampaignConfig = normalizeCampaignPublishCampaignConfig(normalized.campaignConfig)
  if (normalizedCampaignConfig) {
    normalized.campaignConfig = normalizedCampaignConfig
  }

  return normalized
}

const CLICK_FARM_ALIAS_MAP: Readonly<Record<string, string>> = {
  offerId: 'offer_id',
  dailyClickCount: 'daily_click_count',
  startTime: 'start_time',
  endTime: 'end_time',
  durationDays: 'duration_days',
  scheduledStartDate: 'scheduled_start_date',
  hourlyDistribution: 'hourly_distribution',
  refererConfig: 'referer_config',
}

export function normalizeClickFarmTaskRequestBody(value: unknown): PlainObject | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const source = value as PlainObject
  const normalized: PlainObject = {
    ...source,
  }

  applyAliasMap({
    source,
    normalized,
    aliasMap: CLICK_FARM_ALIAS_MAP,
  })

  const normalizedDailyClicks = toSafeNumber(normalized.daily_click_count)
  normalized.daily_click_count = normalizedDailyClicks && normalizedDailyClicks > 0
    ? Math.floor(normalizedDailyClicks)
    : 216

  if (!isMissingRequiredValue(normalized.start_time)) {
    normalized.start_time = String(normalized.start_time).trim()
  } else {
    normalized.start_time = '06:00'
  }

  if (!isMissingRequiredValue(normalized.end_time)) {
    normalized.end_time = String(normalized.end_time).trim()
  } else {
    normalized.end_time = '24:00'
  }

  const normalizedDuration = toSafeNumber(normalized.duration_days)
  normalized.duration_days = normalizedDuration !== undefined
    ? Math.floor(normalizedDuration)
    : 14

  if (!isPlainObject(normalized.referer_config)) {
    normalized.referer_config = { type: 'none' }
  }

  return normalized
}

const OFFER_EXTRACT_ALIAS_MAP: Readonly<Record<string, string>> = {
  affiliateLink: 'affiliate_link',
  url: 'affiliate_link',
  targetCountry: 'target_country',
  productPrice: 'product_price',
  commissionPayout: 'commission_payout',
  brandName: 'brand_name',
  brand: 'brand_name',
  pageType: 'page_type',
  storeProductLinks: 'store_product_links',
  skip_cache: 'skipCache',
  skip_warmup: 'skipWarmup',
}

export function normalizeOfferExtractRequestBody(value: unknown): PlainObject | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const source = value as PlainObject
  const normalized: PlainObject = {
    ...source,
  }

  applyAliasMap({
    source,
    normalized,
    aliasMap: OFFER_EXTRACT_ALIAS_MAP,
  })

  if (isMissingRequiredValue(normalized.target_country)) {
    normalized.target_country = 'US'
  }

  if (isMissingRequiredValue(normalized.page_type)) {
    normalized.page_type = 'product'
  }

  normalized.skipCache = normalized.skipCache !== undefined
    ? isTruthyFlag(normalized.skipCache)
    : false
  normalized.skipWarmup = normalized.skipWarmup !== undefined
    ? isTruthyFlag(normalized.skipWarmup)
    : false

  return normalized
}
