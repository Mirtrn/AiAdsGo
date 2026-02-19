import {
  normalizeCampaignPublishRequestBody,
  normalizeClickFarmTaskRequestBody,
  normalizeOfferExtractRequestBody,
} from '@/lib/autoads-request-normalizers'

type PlainObject = Record<string, any>

type RoutePayloadPolicy = {
  method: string
  path: string
  canonicalKeys: readonly string[]
  requiredKeys?: readonly string[]
  requireAtLeastOneOf?: readonly string[]
  aliasMap?: Readonly<Record<string, string>>
  allowEmptyBody?: boolean
  normalize?: (params: { sourceBody: PlainObject; normalizedBody: PlainObject }) => PlainObject
}

type CompiledRoutePayloadPolicy = RoutePayloadPolicy & {
  method: string
  regex: RegExp
}

type RouteQueryPolicy = {
  method: string
  path: string
  canonicalKeys: readonly string[]
  requiredKeys?: readonly string[]
  aliasMap?: Readonly<Record<string, string>>
  allowEmptyQuery?: boolean
}

type CompiledRouteQueryPolicy = RouteQueryPolicy & {
  method: string
  regex: RegExp
}

export type OpenclawCommandPayloadPolicyDefinition = Readonly<{
  method: string
  path: string
  canonicalKeys: readonly string[]
  requiredKeys: readonly string[]
  requireAtLeastOneOf: readonly string[]
  allowEmptyBody: boolean
}>

export type OpenclawCommandQueryPolicyDefinition = Readonly<{
  method: string
  path: string
  canonicalKeys: readonly string[]
  requiredKeys: readonly string[]
  allowEmptyQuery: boolean
}>

function normalizePathPattern(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return trimmed
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return trimmed.slice(0, -1)
  }
  return trimmed
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePathPattern(pathPattern: string): RegExp {
  const normalizedPattern = normalizePathPattern(pathPattern)
  const segments = normalizedPattern.split('/').filter(Boolean)
  const source = segments
    .map((segment) => {
      if (segment.startsWith(':')) {
        return '[^/]+'
      }
      return escapeForRegex(segment)
    })
    .join('/')

  return new RegExp(`^/${source}$`)
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function getAliasesForCanonicalKey(aliasMap: Readonly<Record<string, string>>, key: string): string[] {
  return Object.keys(aliasMap).filter((alias) => aliasMap[alias] === key)
}

const PAYLOAD_POLICIES: RoutePayloadPolicy[] = [
  {
    method: 'POST',
    path: '/api/campaigns/publish',
    canonicalKeys: [
      'offerId',
      'adCreativeId',
      'googleAdsAccountId',
      'campaignConfig',
      'pauseOldCampaigns',
      'enableCampaignImmediately',
      'enableSmartOptimization',
      'variantCount',
      'forcePublish',
    ],
    requiredKeys: ['offerId', 'googleAdsAccountId', 'campaignConfig'],
    aliasMap: {
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
    },
    normalize: ({ sourceBody, normalizedBody }) => {
      const normalized = normalizeCampaignPublishRequestBody(sourceBody)
      return normalized || normalizedBody
    },
  },
  {
    method: 'POST',
    path: '/api/click-farm/tasks',
    canonicalKeys: [
      'offer_id',
      'daily_click_count',
      'start_time',
      'end_time',
      'duration_days',
      'scheduled_start_date',
      'hourly_distribution',
      'timezone',
      'referer_config',
    ],
    requiredKeys: ['offer_id', 'daily_click_count'],
    aliasMap: {
      offerId: 'offer_id',
      dailyClickCount: 'daily_click_count',
      startTime: 'start_time',
      endTime: 'end_time',
      durationDays: 'duration_days',
      scheduledStartDate: 'scheduled_start_date',
      hourlyDistribution: 'hourly_distribution',
      refererConfig: 'referer_config',
    },
    normalize: ({ sourceBody, normalizedBody }) => {
      const normalized = normalizeClickFarmTaskRequestBody(sourceBody)
      return normalized || normalizedBody
    },
  },
  {
    method: 'POST',
    path: '/api/offers/extract',
    canonicalKeys: [
      'affiliate_link',
      'target_country',
      'product_price',
      'commission_payout',
      'brand_name',
      'page_type',
      'store_product_links',
      'skipCache',
      'skipWarmup',
    ],
    requiredKeys: ['affiliate_link'],
    aliasMap: {
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
    },
    normalize: ({ sourceBody, normalizedBody }) => {
      const normalized = normalizeOfferExtractRequestBody(sourceBody, {
        numericCommissionMode: 'percent',
      })
      return normalized || normalizedBody
    },
  },
  {
    method: 'POST',
    path: '/api/offers/extract/stream',
    canonicalKeys: [
      'affiliate_link',
      'target_country',
      'product_price',
      'commission_payout',
      'brand_name',
      'page_type',
      'store_product_links',
      'skipCache',
      'skipWarmup',
    ],
    requiredKeys: ['affiliate_link'],
    aliasMap: {
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
    },
    normalize: ({ sourceBody, normalizedBody }) => {
      const normalized = normalizeOfferExtractRequestBody(sourceBody, {
        numericCommissionMode: 'percent',
      })
      return normalized || normalizedBody
    },
  },
  {
    method: 'PUT',
    path: '/api/offers/:id',
    canonicalKeys: [
      'url',
      'brand',
      'category',
      'target_country',
      'affiliate_link',
      'brand_description',
      'unique_selling_points',
      'product_highlights',
      'target_audience',
      'page_type',
      'store_product_links',
      'product_price',
      'commission_payout',
      'is_active',
    ],
    requireAtLeastOneOf: [
      'url',
      'brand',
      'category',
      'target_country',
      'affiliate_link',
      'brand_description',
      'unique_selling_points',
      'product_highlights',
      'target_audience',
      'page_type',
      'store_product_links',
      'product_price',
      'commission_payout',
      'is_active',
    ],
    aliasMap: {
      targetCountry: 'target_country',
      affiliateLink: 'affiliate_link',
      brandDescription: 'brand_description',
      uniqueSellingPoints: 'unique_selling_points',
      productHighlights: 'product_highlights',
      targetAudience: 'target_audience',
      pageType: 'page_type',
      storeProductLinks: 'store_product_links',
      productPrice: 'product_price',
      commissionPayout: 'commission_payout',
      isActive: 'is_active',
    },
  },
  {
    method: 'POST',
    path: '/api/offers/:id/rebuild',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/generate-creatives-queue',
    canonicalKeys: ['maxRetries', 'targetRating', 'synthetic', 'bucket'],
    aliasMap: {
      max_retries: 'maxRetries',
      target_rating: 'targetRating',
    },
  },
  {
    method: 'POST',
    path: '/api/offers/batch/generate-creatives-queue',
    canonicalKeys: ['offerIds'],
    requiredKeys: ['offerIds'],
    aliasMap: {
      offer_ids: 'offerIds',
    },
  },
  {
    method: 'POST',
    path: '/api/ad-creatives/:id/select',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/keyword-ideas',
    canonicalKeys: ['seedKeywords', 'useUrl', 'filterOptions'],
    aliasMap: {
      seed_keywords: 'seedKeywords',
      use_url: 'useUrl',
      filter_options: 'filterOptions',
    },
  },
  {
    method: 'POST',
    path: '/api/offers/:id/keyword-pool',
    canonicalKeys: ['forceRegenerate', 'keywords'],
    aliasMap: {
      force_regenerate: 'forceRegenerate',
    },
    allowEmptyBody: true,
  },
  {
    method: 'DELETE',
    path: '/api/offers/:id/keyword-pool',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'PUT',
    path: '/api/campaigns/:id/toggle-status',
    canonicalKeys: ['status'],
    requiredKeys: ['status'],
  },
  {
    method: 'PUT',
    path: '/api/campaigns/:id/update-cpc',
    canonicalKeys: ['newCpc'],
    requiredKeys: ['newCpc'],
    aliasMap: {
      new_cpc: 'newCpc',
    },
  },
  {
    method: 'POST',
    path: '/api/campaigns/:id/offline',
    canonicalKeys: [
      'blacklistOffer',
      'forceLocalOffline',
      'removeGoogleAdsCampaign',
      'pauseClickFarmTasks',
      'pauseUrlSwapTasks',
    ],
    aliasMap: {
      blacklist_offer: 'blacklistOffer',
      force_local_offline: 'forceLocalOffline',
      remove_google_ads_campaign: 'removeGoogleAdsCampaign',
      pause_click_farm_tasks: 'pauseClickFarmTasks',
      pause_url_swap_tasks: 'pauseUrlSwapTasks',
    },
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/unlink',
    canonicalKeys: ['accountId', 'removeGoogleAdsCampaigns'],
    requiredKeys: ['accountId'],
    aliasMap: {
      account_id: 'accountId',
      remove_google_ads_campaigns: 'removeGoogleAdsCampaigns',
    },
  },
  {
    method: 'POST',
    path: '/api/offers/:id/blacklist',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'DELETE',
    path: '/api/offers/:id/blacklist',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'DELETE',
    path: '/api/offers/:id',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/scrape',
    canonicalKeys: ['priority'],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/launch-ads',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/pause-campaigns',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/resolve-url',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/offers/:id/validate-url',
    canonicalKeys: ['url'],
    requiredKeys: ['url'],
    aliasMap: {
      final_url: 'url',
      finalUrl: 'url',
    },
  },
  {
    method: 'POST',
    path: '/api/offers/:id/launch-score',
    canonicalKeys: ['creativeId'],
    requiredKeys: ['creativeId'],
    aliasMap: {
      creative_id: 'creativeId',
    },
  },
  {
    method: 'POST',
    path: '/api/offers/:id/launch-score/compare',
    canonicalKeys: ['creativeIds'],
    requiredKeys: ['creativeIds'],
    aliasMap: {
      creative_ids: 'creativeIds',
    },
  },
  {
    method: 'POST',
    path: '/api/offers/batch/:batchId/cancel',
    canonicalKeys: ['reason'],
    allowEmptyBody: true,
  },
  {
    method: 'PUT',
    path: '/api/ad-creatives/:id',
    canonicalKeys: [
      'headlines',
      'descriptions',
      'keywords',
      'keywords_with_volume',
      'negative_keywords',
      'callouts',
      'sitelinks',
      'final_url',
      'final_url_suffix',
      'score',
      'score_breakdown',
      'ad_strength',
      'theme',
    ],
    requireAtLeastOneOf: [
      'headlines',
      'descriptions',
      'keywords',
      'keywords_with_volume',
      'negative_keywords',
      'callouts',
      'sitelinks',
      'final_url',
      'final_url_suffix',
      'score',
      'score_breakdown',
      'ad_strength',
      'theme',
    ],
    aliasMap: {
      keywordsWithVolume: 'keywords_with_volume',
      negativeKeywords: 'negative_keywords',
      finalUrl: 'final_url',
      finalUrlSuffix: 'final_url_suffix',
      scoreBreakdown: 'score_breakdown',
      adStrength: 'ad_strength',
    },
  },
  {
    method: 'DELETE',
    path: '/api/ad-creatives/:id',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/ad-creatives/:id/conversion-feedback',
    canonicalKeys: ['conversions', 'conversionValue', 'periodStart', 'periodEnd', 'feedbackNote'],
    requiredKeys: ['conversions', 'periodStart', 'periodEnd'],
    aliasMap: {
      conversion_value: 'conversionValue',
      period_start: 'periodStart',
      period_end: 'periodEnd',
      feedback_note: 'feedbackNote',
    },
  },
  {
    method: 'POST',
    path: '/api/campaigns',
    canonicalKeys: [
      'offerId',
      'googleAdsAccountId',
      'campaignName',
      'budgetAmount',
      'budgetType',
      'targetCpa',
      'maxCpc',
      'status',
      'startDate',
      'endDate',
    ],
    requiredKeys: ['offerId', 'googleAdsAccountId', 'campaignName', 'budgetAmount'],
    aliasMap: {
      offer_id: 'offerId',
      google_ads_account_id: 'googleAdsAccountId',
      campaign_name: 'campaignName',
      budget_amount: 'budgetAmount',
      budget_type: 'budgetType',
      target_cpa: 'targetCpa',
      max_cpc: 'maxCpc',
      start_date: 'startDate',
      end_date: 'endDate',
    },
  },
  {
    method: 'PUT',
    path: '/api/campaigns/:id',
    canonicalKeys: [
      'campaignName',
      'budgetAmount',
      'budgetType',
      'targetCpa',
      'maxCpc',
      'status',
      'startDate',
      'endDate',
    ],
    requireAtLeastOneOf: [
      'campaignName',
      'budgetAmount',
      'budgetType',
      'targetCpa',
      'maxCpc',
      'status',
      'startDate',
      'endDate',
    ],
    aliasMap: {
      campaign_name: 'campaignName',
      budget_amount: 'budgetAmount',
      budget_type: 'budgetType',
      target_cpa: 'targetCpa',
      max_cpc: 'maxCpc',
      start_date: 'startDate',
      end_date: 'endDate',
    },
  },
  {
    method: 'DELETE',
    path: '/api/campaigns/:id',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/campaigns/:id/sync',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/campaigns/circuit-break',
    canonicalKeys: ['accountId', 'googleAdsAccountId', 'reason', 'source', 'dryRun'],
    requireAtLeastOneOf: ['accountId', 'googleAdsAccountId'],
    aliasMap: {
      account_id: 'accountId',
      google_ads_account_id: 'googleAdsAccountId',
      dry_run: 'dryRun',
    },
  },
  {
    method: 'POST',
    path: '/api/url-swap/tasks',
    canonicalKeys: [
      'offer_id',
      'swap_interval_minutes',
      'duration_days',
      'google_customer_id',
      'google_campaign_id',
      'swap_mode',
      'manual_affiliate_links',
    ],
    requiredKeys: ['offer_id'],
    aliasMap: {
      offerId: 'offer_id',
      swapIntervalMinutes: 'swap_interval_minutes',
      durationDays: 'duration_days',
      googleCustomerId: 'google_customer_id',
      googleCampaignId: 'google_campaign_id',
      swapMode: 'swap_mode',
      manualAffiliateLinks: 'manual_affiliate_links',
    },
  },
  {
    method: 'PUT',
    path: '/api/url-swap/tasks/:id',
    canonicalKeys: [
      'offer_id',
      'swap_interval_minutes',
      'duration_days',
      'google_customer_id',
      'google_campaign_id',
      'swap_mode',
      'manual_affiliate_links',
    ],
    aliasMap: {
      offerId: 'offer_id',
      swapIntervalMinutes: 'swap_interval_minutes',
      durationDays: 'duration_days',
      googleCustomerId: 'google_customer_id',
      googleCampaignId: 'google_campaign_id',
      swapMode: 'swap_mode',
      manualAffiliateLinks: 'manual_affiliate_links',
    },
  },
  {
    method: 'DELETE',
    path: '/api/url-swap/tasks/:id',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/url-swap/tasks/:id/swap-now',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/url-swap/tasks/:id/disable',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/url-swap/tasks/:id/enable',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/url-swap/tasks/:id/targets/refresh',
    canonicalKeys: ['googleAdsAccountId'],
    aliasMap: {
      google_ads_account_id: 'googleAdsAccountId',
    },
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/products/sync/:platform',
    canonicalKeys: ['strategy'],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/products/:id/sync',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/products/:id/create-offer',
    canonicalKeys: ['targetCountry'],
    aliasMap: {
      target_country: 'targetCountry',
    },
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/products/:id/offline',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/products/:id/blacklist',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'DELETE',
    path: '/api/products/:id/blacklist',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/products/batch-offline',
    canonicalKeys: ['productIds'],
    requiredKeys: ['productIds'],
    aliasMap: {
      product_ids: 'productIds',
    },
  },
  {
    method: 'POST',
    path: '/api/products/batch-create-offers',
    canonicalKeys: ['items'],
    requiredKeys: ['items'],
  },
  {
    method: 'POST',
    path: '/api/products/clear',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'PUT',
    path: '/api/click-farm/tasks/:id',
    canonicalKeys: [
      'daily_click_count',
      'start_time',
      'end_time',
      'duration_days',
      'scheduled_start_date',
      'hourly_distribution',
      'timezone',
      'referer_config',
    ],
    requireAtLeastOneOf: [
      'daily_click_count',
      'start_time',
      'end_time',
      'duration_days',
      'scheduled_start_date',
      'hourly_distribution',
      'timezone',
      'referer_config',
    ],
    aliasMap: {
      dailyClickCount: 'daily_click_count',
      startTime: 'start_time',
      endTime: 'end_time',
      durationDays: 'duration_days',
      scheduledStartDate: 'scheduled_start_date',
      hourlyDistribution: 'hourly_distribution',
      refererConfig: 'referer_config',
    },
  },
  {
    method: 'DELETE',
    path: '/api/click-farm/tasks/:id',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/click-farm/tasks/:id/stop',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/click-farm/tasks/:id/restart',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/click-farm/tasks/:id/trigger',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/click-farm/distribution/generate',
    canonicalKeys: ['daily_click_count', 'start_time', 'end_time'],
    requiredKeys: ['daily_click_count', 'start_time', 'end_time'],
    aliasMap: {
      dailyClickCount: 'daily_click_count',
      startTime: 'start_time',
      endTime: 'end_time',
    },
  },
  {
    method: 'POST',
    path: '/api/click-farm/distribution/normalize',
    canonicalKeys: ['distribution', 'targetTotal'],
    requiredKeys: ['distribution', 'targetTotal'],
    aliasMap: {
      target_total: 'targetTotal',
    },
  },
  {
    method: 'POST',
    path: '/api/risk-alerts',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'PATCH',
    path: '/api/risk-alerts/:id',
    canonicalKeys: ['status', 'note'],
    requiredKeys: ['status'],
  },

  // Settings
  {
    method: 'PUT',
    path: '/api/settings',
    canonicalKeys: ['updates'],
    requiredKeys: ['updates'],
  },
  {
    method: 'DELETE',
    path: '/api/settings',
    canonicalKeys: ['category', 'target'],
    requiredKeys: ['category', 'target'],
  },
  {
    method: 'PUT',
    path: '/api/settings/:category/:key',
    canonicalKeys: ['value'],
    requiredKeys: ['value'],
  },
  {
    method: 'POST',
    path: '/api/settings/validate',
    canonicalKeys: ['category', 'config'],
    requiredKeys: ['category', 'config'],
  },
  {
    method: 'POST',
    path: '/api/settings/proxy/validate',
    canonicalKeys: ['proxy_url'],
    requiredKeys: ['proxy_url'],
    aliasMap: {
      proxyUrl: 'proxy_url',
    },
  },

  // Sync
  {
    method: 'PUT',
    path: '/api/sync/config',
    canonicalKeys: [
      'autoSyncEnabled',
      'syncIntervalHours',
      'maxRetryAttempts',
      'retryDelayMinutes',
      'notifyOnSuccess',
      'notifyOnFailure',
      'notificationEmail',
    ],
    requireAtLeastOneOf: [
      'autoSyncEnabled',
      'syncIntervalHours',
      'maxRetryAttempts',
      'retryDelayMinutes',
      'notifyOnSuccess',
      'notifyOnFailure',
      'notificationEmail',
    ],
    aliasMap: {
      auto_sync_enabled: 'autoSyncEnabled',
      sync_interval_hours: 'syncIntervalHours',
      max_retry_attempts: 'maxRetryAttempts',
      retry_delay_minutes: 'retryDelayMinutes',
      notify_on_success: 'notifyOnSuccess',
      notify_on_failure: 'notifyOnFailure',
      notification_email: 'notificationEmail',
    },
  },
  {
    method: 'POST',
    path: '/api/sync/scheduler',
    canonicalKeys: ['action'],
    requiredKeys: ['action'],
  },
  {
    method: 'POST',
    path: '/api/sync/trigger',
    canonicalKeys: [],
    allowEmptyBody: true,
  },

  // Google Ads credentials / service-account / test diagnose
  {
    method: 'POST',
    path: '/api/google-ads/credentials',
    canonicalKeys: [
      'client_id',
      'client_secret',
      'refresh_token',
      'developer_token',
      'login_customer_id',
      'access_token',
      'access_token_expires_at',
    ],
    requiredKeys: ['client_id', 'client_secret', 'refresh_token', 'developer_token'],
  },
  {
    method: 'DELETE',
    path: '/api/google-ads/credentials',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/google-ads/credentials/verify',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/google-ads/service-account',
    canonicalKeys: ['name', 'mccCustomerId', 'developerToken', 'serviceAccountJson'],
    requiredKeys: ['name', 'mccCustomerId', 'developerToken', 'serviceAccountJson'],
    aliasMap: {
      mcc_customer_id: 'mccCustomerId',
      developer_token: 'developerToken',
      service_account_json: 'serviceAccountJson',
    },
  },
  {
    method: 'DELETE',
    path: '/api/google-ads/service-account',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
  {
    method: 'POST',
    path: '/api/google-ads/test-mcc/diagnose',
    canonicalKeys: ['maxCustomers', 'probeCustomerId'],
    aliasMap: {
      max_customers: 'maxCustomers',
      probe_customer_id: 'probeCustomerId',
    },
  },

  // Google Ads accounts
  {
    method: 'POST',
    path: '/api/google-ads-accounts',
    canonicalKeys: [
      'customerId',
      'accountName',
      'currency',
      'timezone',
      'isManagerAccount',
      'accessToken',
      'refreshToken',
      'tokenExpiresAt',
    ],
    requiredKeys: ['customerId'],
    aliasMap: {
      customer_id: 'customerId',
      account_name: 'accountName',
      is_manager_account: 'isManagerAccount',
      access_token: 'accessToken',
      refresh_token: 'refreshToken',
      token_expires_at: 'tokenExpiresAt',
    },
  },
  {
    method: 'PUT',
    path: '/api/google-ads-accounts/:id',
    canonicalKeys: [
      'accountName',
      'currency',
      'timezone',
      'isActive',
      'accessToken',
      'refreshToken',
      'tokenExpiresAt',
      'lastSyncAt',
    ],
    requireAtLeastOneOf: [
      'accountName',
      'currency',
      'timezone',
      'isActive',
      'accessToken',
      'refreshToken',
      'tokenExpiresAt',
      'lastSyncAt',
    ],
    aliasMap: {
      account_name: 'accountName',
      is_active: 'isActive',
      access_token: 'accessToken',
      refresh_token: 'refreshToken',
      token_expires_at: 'tokenExpiresAt',
      last_sync_at: 'lastSyncAt',
    },
  },
  {
    method: 'DELETE',
    path: '/api/google-ads-accounts/:id',
    canonicalKeys: [],
    allowEmptyBody: true,
  },
]

export const OPENCLAW_COMMAND_PAYLOAD_POLICIES: readonly OpenclawCommandPayloadPolicyDefinition[] =
  Object.freeze(
    PAYLOAD_POLICIES.map((policy) => ({
      method: policy.method.toUpperCase(),
      path: normalizePathPattern(policy.path),
      canonicalKeys: [...policy.canonicalKeys],
      requiredKeys: [...(policy.requiredKeys || [])],
      requireAtLeastOneOf: [...(policy.requireAtLeastOneOf || [])],
      allowEmptyBody: Boolean(policy.allowEmptyBody),
    }))
  )

const QUERY_POLICIES: RouteQueryPolicy[] = [
  {
    method: 'DELETE',
    path: '/api/offers/:id',
    canonicalKeys: ['autoUnlink', 'removeGoogleAdsCampaigns'],
    aliasMap: {
      auto_unlink: 'autoUnlink',
      remove_google_ads_campaigns: 'removeGoogleAdsCampaigns',
    },
    allowEmptyQuery: true,
  },
]

export const OPENCLAW_COMMAND_QUERY_POLICIES: readonly OpenclawCommandQueryPolicyDefinition[] =
  Object.freeze(
    QUERY_POLICIES.map((policy) => ({
      method: policy.method.toUpperCase(),
      path: normalizePathPattern(policy.path),
      canonicalKeys: [...policy.canonicalKeys],
      requiredKeys: [...(policy.requiredKeys || [])],
      allowEmptyQuery: policy.allowEmptyQuery !== false,
    }))
  )

const COMPILED_PAYLOAD_POLICIES: CompiledRoutePayloadPolicy[] = PAYLOAD_POLICIES.map((policy) => ({
  ...policy,
  method: policy.method.toUpperCase(),
  regex: compilePathPattern(policy.path),
}))

const COMPILED_QUERY_POLICIES: CompiledRouteQueryPolicy[] = QUERY_POLICIES.map((policy) => ({
  ...policy,
  method: policy.method.toUpperCase(),
  regex: compilePathPattern(policy.path),
}))

function findPolicy(method: string, path: string): CompiledRoutePayloadPolicy | undefined {
  const normalizedMethod = method.toUpperCase()
  return COMPILED_PAYLOAD_POLICIES.find(
    (policy) => policy.method === normalizedMethod && policy.regex.test(path)
  )
}

function findQueryPolicy(method: string, path: string): CompiledRouteQueryPolicy | undefined {
  const normalizedMethod = method.toUpperCase()
  return COMPILED_QUERY_POLICIES.find(
    (policy) => policy.method === normalizedMethod && policy.regex.test(path)
  )
}

function normalizeBodyByPolicy(params: {
  method: string
  path: string
  body: unknown
  policy: RoutePayloadPolicy
}): unknown {
  if (params.body === undefined || params.body === null) {
    if (params.policy.allowEmptyBody) {
      return undefined
    }
    throw new Error(`Invalid payload: ${params.method} ${params.path} expects a JSON object body`)
  }

  if (!isPlainObject(params.body)) {
    throw new Error(`Invalid payload: ${params.method} ${params.path} expects a JSON object body`)
  }

  const sourceBody = params.body as PlainObject
  const aliasMap = params.policy.aliasMap || {}
  const allowedInputKeys = new Set([...params.policy.canonicalKeys, ...Object.keys(aliasMap)])

  const unknownKeys = Object.keys(sourceBody).filter((key) => !allowedInputKeys.has(key))
  if (unknownKeys.length > 0) {
    throw new Error(
      `Invalid payload: unsupported fields for ${params.method} ${params.path}: ${unknownKeys.join(', ')}`
    )
  }

  const normalizedBody: PlainObject = {}

  for (const canonicalKey of params.policy.canonicalKeys) {
    const aliases = getAliasesForCanonicalKey(aliasMap, canonicalKey)
    const candidateKeys = [canonicalKey, ...aliases]

    for (const key of candidateKeys) {
      if (sourceBody[key] !== undefined) {
        normalizedBody[canonicalKey] = sourceBody[key]
        break
      }
    }
  }

  const finalizedBody = params.policy.normalize
    ? params.policy.normalize({ sourceBody, normalizedBody })
    : normalizedBody

  const missingKeys = (params.policy.requiredKeys || []).filter((requiredKey) =>
    isMissingRequiredValue(finalizedBody[requiredKey])
  )

  if (missingKeys.length > 0) {
    throw new Error(
      `Invalid payload: missing required fields for ${params.method} ${params.path}: ${missingKeys.join(', ')}`
    )
  }

  if (params.policy.requireAtLeastOneOf && params.policy.requireAtLeastOneOf.length > 0) {
    const hasAny = params.policy.requireAtLeastOneOf.some(
      (key) => finalizedBody[key] !== undefined
    )

    if (!hasAny) {
      throw new Error(
        `Invalid payload: at least one field is required for ${params.method} ${params.path}: ${params.policy.requireAtLeastOneOf.join(', ')}`
      )
    }
  }

  if (params.policy.allowEmptyBody && Object.keys(finalizedBody).length === 0) {
    return undefined
  }

  return finalizedBody
}

export function normalizeOpenclawCommandPayload(params: {
  method: string
  path: string
  body: unknown
}): { body: unknown } {
  const method = params.method.toUpperCase()
  const policy = findPolicy(method, params.path)

  if (!policy) {
    throw new Error(`Invalid payload policy: missing route payload policy for ${method} ${params.path}`)
  }

  const normalizedBody = normalizeBodyByPolicy({
    method,
    path: params.path,
    body: params.body,
    policy,
  })

  return { body: normalizedBody }
}

export function normalizeOpenclawCommandQuery(params: {
  method: string
  path: string
  query: unknown
}): { query: Record<string, string | number | boolean | null | undefined> | undefined } {
  const method = params.method.toUpperCase()

  if (params.query === undefined || params.query === null) {
    return { query: undefined }
  }

  if (!isPlainObject(params.query)) {
    throw new Error(`Invalid query: ${method} ${params.path} expects an object query`)
  }

  const sourceQuery = params.query as PlainObject
  const policy = findQueryPolicy(method, params.path)
  const aliasMap = policy?.aliasMap || {}
  const canonicalKeys = policy?.canonicalKeys || []
  const requiredKeys = policy?.requiredKeys || []
  const allowEmptyQuery = policy?.allowEmptyQuery !== false

  const allowedInputKeys = new Set([...canonicalKeys, ...Object.keys(aliasMap)])
  const unknownKeys = Object.keys(sourceQuery).filter((key) => !allowedInputKeys.has(key))
  if (unknownKeys.length > 0) {
    throw new Error(
      `Invalid query: unsupported params for ${method} ${params.path}: ${unknownKeys.join(', ')}`
    )
  }

  const normalizedQuery: PlainObject = {}

  for (const canonicalKey of canonicalKeys) {
    const aliases = getAliasesForCanonicalKey(aliasMap, canonicalKey)
    const candidateKeys = [canonicalKey, ...aliases]

    for (const key of candidateKeys) {
      if (sourceQuery[key] !== undefined) {
        normalizedQuery[canonicalKey] = sourceQuery[key]
        break
      }
    }
  }

  const missingKeys = requiredKeys.filter((requiredKey) =>
    isMissingRequiredValue(normalizedQuery[requiredKey])
  )
  if (missingKeys.length > 0) {
    throw new Error(
      `Invalid query: missing required params for ${method} ${params.path}: ${missingKeys.join(', ')}`
    )
  }

  if (Object.keys(normalizedQuery).length === 0 && allowEmptyQuery) {
    return { query: undefined }
  }

  return { query: normalizedQuery }
}
