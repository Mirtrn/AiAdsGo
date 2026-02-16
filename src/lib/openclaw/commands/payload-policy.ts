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
      const normalized = normalizeOfferExtractRequestBody(sourceBody)
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
      const normalized = normalizeOfferExtractRequestBody(sourceBody)
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

const COMPILED_PAYLOAD_POLICIES: CompiledRoutePayloadPolicy[] = PAYLOAD_POLICIES.map((policy) => ({
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
    return { body: params.body }
  }

  const normalizedBody = normalizeBodyByPolicy({
    method,
    path: params.path,
    body: params.body,
    policy,
  })

  return { body: normalizedBody }
}
