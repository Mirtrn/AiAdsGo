import { GoogleAdsApi, Customer, enums } from 'google-ads-api'
import { updateGoogleAdsAccount } from './google-ads-accounts'
import { withRetry } from './retry'
import { gadsApiCache, generateGadsApiCacheKey } from './cache'

/**
 * Google Ads API客户端单例
 */
let client: GoogleAdsApi | null = null

/**
 * 获取Google Ads API客户端实例
 */
export function getGoogleAdsClient(): GoogleAdsApi {
  if (!client) {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN

    if (!clientId || !clientSecret || !developerToken) {
      throw new Error('缺少Google Ads API配置：CLIENT_ID, CLIENT_SECRET, DEVELOPER_TOKEN')
    }

    client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    })
  }

  return client
}

/**
 * 生成OAuth授权URL
 */
export function getOAuthUrl(state?: string): string {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-ads/callback`

  if (!clientId) {
    throw new Error('缺少GOOGLE_ADS_CLIENT_ID配置')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords',
    access_type: 'offline',
    prompt: 'consent',
  })

  if (state) {
    params.append('state', state)
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * 交换authorization code获取tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-ads/callback`

  if (!clientId || !clientSecret) {
    throw new Error('缺少OAuth配置')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OAuth token exchange failed: ${error}`)
  }

  const tokens = await response.json()
  return tokens
}

/**
 * 刷新access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  expires_in: number
}> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('缺少OAuth配置')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token refresh failed: ${error}`)
  }

  const tokens = await response.json()
  return tokens
}

/**
 * 获取Google Ads Customer实例
 * 自动处理token刷新
 */
export async function getCustomer(
  customerId: string,
  refreshToken: string,
  accountId?: number,
  userId?: number
): Promise<Customer> {
  const client = getGoogleAdsClient()

  try {
    // 尝试使用refresh token获取新的access token（带重试）
    const tokens = await withRetry(
      () => refreshAccessToken(refreshToken),
      {
        maxRetries: 2,
        initialDelay: 500,
        operationName: 'Refresh Google Ads Token'
      }
    )

    // 更新数据库中的token
    if (accountId && userId) {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      updateGoogleAdsAccount(accountId, userId, {
        accessToken: tokens.access_token,
        tokenExpiresAt: expiresAt,
      })
    }

    // 创建customer实例
    const customer = client.Customer({
      customer_id: customerId,
      refresh_token: refreshToken,
      login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    })

    return customer
  } catch (error: any) {
    throw new Error(`获取Google Ads Customer失败: ${error.message}`)
  }
}

/**
 * 国家代码到Geo Target Constant ID的映射
 * 参考: https://developers.google.com/google-ads/api/reference/data/geotargets
 */
function getGeoTargetConstantId(countryCode: string): number | null {
  const geoTargetMap: Record<string, number> = {
    'US': 2840,   // United States
    'GB': 2826,   // United Kingdom
    'CA': 2124,   // Canada
    'AU': 2036,   // Australia
    'DE': 2276,   // Germany
    'FR': 2250,   // France
    'JP': 2392,   // Japan
    'CN': 2156,   // China
    'IN': 2356,   // India
    'BR': 2076,   // Brazil
    'MX': 2484,   // Mexico
    'ES': 2724,   // Spain
    'IT': 2380,   // Italy
    'KR': 2410,   // South Korea
    'RU': 2643,   // Russia
    'SG': 2702,   // Singapore
    'HK': 2344,   // Hong Kong
    'TW': 2158,   // Taiwan
  }

  return geoTargetMap[countryCode.toUpperCase()] || null
}

/**
 * 语言代码到Language Constant ID的映射
 * 参考: https://developers.google.com/google-ads/api/reference/data/codes-formats
 */
function getLanguageConstantId(languageCode: string): number | null {
  const languageMap: Record<string, number> = {
    'en': 1000,      // English
    'zh': 1017,      // Chinese (Simplified)
    'zh-CN': 1017,   // Chinese (Simplified)
    'zh-TW': 1018,   // Chinese (Traditional)
    'ja': 1005,      // Japanese
    'de': 1001,      // German
    'fr': 1002,      // French
    'es': 1003,      // Spanish
    'it': 1004,      // Italian
    'ko': 1012,      // Korean
    'ru': 1031,      // Russian
    'pt': 1014,      // Portuguese
    'ar': 1019,      // Arabic
    'hi': 1023,      // Hindi
  }

  return languageMap[languageCode.toLowerCase()] || null
}

/**
 * 创建Google Ads广告系列
 */
export async function createGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  status: 'ENABLED' | 'PAUSED'
  biddingStrategy?: string
  cpcBidCeilingMicros?: number
  targetCountry?: string
  targetLanguage?: string
  finalUrlSuffix?: string
  startDate?: string
  endDate?: string
  accountId?: number
  userId?: number
}): Promise<{ campaignId: string; resourceName: string }> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  // 1. 创建预算
  const budgetResourceName = await createCampaignBudget(customer, {
    name: `${params.campaignName} Budget`,
    amount: params.budgetAmount,
    deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
  })

  // 2. 创建广告系列（遵循Google Ads API官方最佳实践）
  const campaign: any = {
    name: params.campaignName,
    // 官方推荐：创建时使用PAUSED状态，添加完定位和广告后再启用
    status: enums.CampaignStatus.PAUSED,
    advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
    campaign_budget: budgetResourceName,
    network_settings: {
      target_google_search: true,
      target_search_network: true,
      // 启用Display Expansion (官方推荐)
      target_content_network: true,
      target_partner_search_network: false,
    },
  }

  // 设置出价策略 - Maximize Clicks (TARGET_SPEND)
  // 根据业务规范：Bidding Strategy = Maximize Clicks，CPC Bid = 0.17 USD
  // 注意：Maximize Clicks在API中的枚举值是TARGET_SPEND
  campaign.bidding_strategy_type = enums.BiddingStrategyType.TARGET_SPEND
  campaign.target_spend = {
    cpc_bid_ceiling_micros: params.cpcBidCeilingMicros || 170000  // 默认0.17 USD
  }

  // 必填字段：EU政治广告状态声明
  // 大多数Campaign不包含政治广告，设置为DOES_NOT_CONTAIN
  campaign.contains_eu_political_advertising = enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING

  // 添加Final URL Suffix（如果提供）
  // 从推广链接重定向访问后提取的Final URL suffix
  if (params.finalUrlSuffix) {
    campaign.final_url_suffix = params.finalUrlSuffix
  }

  // 3. 添加日期设置
  if (params.startDate) {
    const startDateObj = new Date(params.startDate)
    ;(campaign as any).start_date = startDateObj.toISOString().split('T')[0].replace(/-/g, '')
  }

  if (params.endDate) {
    const endDateObj = new Date(params.endDate)
    ;(campaign as any).end_date = endDateObj.toISOString().split('T')[0].replace(/-/g, '')
  }

  // 🐛 DEBUG: 打印完整的Campaign对象用于调试
  console.log('📋 创建Campaign的完整配置:', JSON.stringify(campaign, null, 2))
  console.log('📋 Bidding Strategy Type (直接读取):', campaign.bidding_strategy_type)
  console.log('📋 Target Spend:', campaign.target_spend)
  console.log('📋 Customer ID:', params.customerId)
  console.log('📋 Target Country:', params.targetCountry)
  console.log('📋 Target Language:', params.targetLanguage)

  let response
  try {
    response = await withRetry(
      () => customer.campaigns.create([campaign]),
      {
        maxRetries: 3,
        initialDelay: 1000,
        operationName: `Create Campaign: ${params.campaignName}`
      }
    )
  } catch (error: any) {
    // 打印详细的错误信息，特别是location字段
    console.error('🐛 Campaign创建失败 - 详细错误信息:')
    console.error('📋 错误对象:', JSON.stringify(error, null, 2))

    if (error.errors && Array.isArray(error.errors)) {
      console.error('📋 错误详情:')
      error.errors.forEach((err: any, index: number) => {
        console.error(`  错误 ${index + 1}:`)
        console.error(`    - message: ${err.message}`)
        console.error(`    - error_code: ${JSON.stringify(err.error_code)}`)

        // location字段可能包含缺失字段的信息
        if (err.location) {
          console.error(`    - location:`, JSON.stringify(err.location, null, 2))
        }
      })
    }

    throw error
  }

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建广告系列失败：无响应')
  }

  const result = response.results[0]
  const campaignId = result.resource_name?.split('/').pop() || ''
  const campaignResourceName = result.resource_name || ''

  console.log(`✅ Campaign创建成功! ID: ${campaignId}, Resource: ${campaignResourceName}`)

  // 4. 添加地理位置和语言定位条件（必需）
  // 参考: https://developers.google.com/google-ads/api/docs/campaigns/search-campaigns/getting-started
  const criteriaOperations: any[] = []

  // 添加地理位置定位
  if (params.targetCountry) {
    const geoTargetConstantId = getGeoTargetConstantId(params.targetCountry)
    if (geoTargetConstantId) {
      criteriaOperations.push({
        campaign: campaignResourceName,
        location: {
          geo_target_constant: `geoTargetConstants/${geoTargetConstantId}`
        }
      })
      console.log(`📍 添加地理位置定位: ${params.targetCountry} (${geoTargetConstantId})`)
    }
  }

  // 添加语言定位
  if (params.targetLanguage) {
    const languageConstantId = getLanguageConstantId(params.targetLanguage)
    if (languageConstantId) {
      criteriaOperations.push({
        campaign: campaignResourceName,
        language: {
          language_constant: `languageConstants/${languageConstantId}`
        }
      })
      console.log(`🌐 添加语言定位: ${params.targetLanguage} (${languageConstantId})`)
    }
  }

  // 批量创建定位条件
  if (criteriaOperations.length > 0) {
    try {
      await withRetry(
        () => customer.campaignCriteria.create(criteriaOperations),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Create Campaign Criteria for ${params.campaignName}`
        }
      )
      console.log(`✅ 成功添加${criteriaOperations.length}个定位条件`)
    } catch (error: any) {
      console.error('❌ 添加定位条件失败:', error.message)
      // 如果定位条件创建失败，删除已创建的Campaign以保持数据一致性
      try {
        await customer.campaigns.remove([campaignResourceName])
        console.log(`🗑️ 已删除Campaign ${campaignId}（因定位条件创建失败）`)
      } catch (rollbackError) {
        console.error('⚠️ Campaign删除失败:', rollbackError)
      }
      throw new Error(`Campaign定位条件创建失败: ${error.message}`)
    }
  } else {
    console.warn('⚠️ 未提供地理位置或语言定位，Campaign可能无法正常投放')
  }

  // 清除Campaigns列表缓存（创建新Campaign后）
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaigns列表缓存: ${params.customerId}`)

  return {
    campaignId,
    resourceName: campaignResourceName,
  }
}

/**
 * 创建广告系列预算
 */
async function createCampaignBudget(
  customer: Customer,
  params: {
    name: string
    amount: number
    deliveryMethod: 'STANDARD' | 'ACCELERATED'
  }
): Promise<string> {
  const budget = {
    name: params.name,
    amount_micros: params.amount * 1000000, // 转换为micros (1 USD = 1,000,000 micros)
    delivery_method:
      params.deliveryMethod === 'STANDARD'
        ? enums.BudgetDeliveryMethod.STANDARD
        : enums.BudgetDeliveryMethod.ACCELERATED,
  }

  const response = await withRetry(
    () => customer.campaignBudgets.create([budget]),
    {
      maxRetries: 3,
      initialDelay: 1000,
      operationName: `Create Budget: ${params.name}`
    }
  )

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建预算失败')
  }

  return response.results[0].resource_name || ''
}

/**
 * 更新Google Ads广告系列状态
 */
export async function updateGoogleAdsCampaignStatus(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  accountId?: number
  userId?: number
}): Promise<void> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

  await withRetry(
    () => customer.campaigns.update([{
      resource_name: resourceName,
      status: enums.CampaignStatus[params.status],
    }]),
    {
      maxRetries: 3,
      initialDelay: 1000,
      operationName: `Update Campaign Status: ${params.campaignId} -> ${params.status}`
    }
  )

  // 清除相关缓存（更新状态后）
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaign缓存: ${params.campaignId}`)
}

/**
 * 更新Google Ads广告系列预算
 */
export async function updateGoogleAdsCampaignBudget(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  accountId?: number
  userId?: number
}): Promise<void> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  // 1. 创建新的预算
  const budgetResourceName = await createCampaignBudget(customer, {
    name: `Budget ${params.campaignId} - ${Date.now()}`,
    amount: params.budgetAmount,
    deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
  })

  // 2. 更新Campaign指向新预算
  const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

  await withRetry(
    () => customer.campaigns.update([{
      resource_name: resourceName,
      campaign_budget: budgetResourceName,
    }]),
    {
      maxRetries: 3,
      initialDelay: 1000,
      operationName: `Update Campaign Budget: ${params.campaignId} -> ${params.budgetAmount}`
    }
  )

  // 清除相关缓存
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  console.log(`🗑️ 已清除Campaign预算缓存: ${params.campaignId}`)
}

/**
 * 获取Google Ads广告系列详情
 */
export async function getGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  accountId?: number
  userId?: number
  skipCache?: boolean
}): Promise<any> {
  // 生成缓存键
  const cacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })

  // 检查缓存（除非显式跳过）
  if (!params.skipCache) {
    const cached = gadsApiCache.get(cacheKey)
    if (cached) {
      console.log(`✅ 使用缓存的Campaign数据: ${params.campaignId}`)
      return cached
    }
  }

  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions
    FROM campaign
    WHERE campaign.id = ${params.campaignId}
  `

  const results = await customer.query(query)
  const result = results[0] || null

  // 缓存结果（30分钟TTL）
  if (result) {
    gadsApiCache.set(cacheKey, result)
    console.log(`💾 已缓存Campaign数据: ${params.campaignId}`)
  }

  return result
}

/**
 * 列出Google Ads账号下的所有广告系列
 */
export async function listGoogleAdsCampaigns(params: {
  customerId: string
  refreshToken: string
  accountId?: number
  userId?: number
  skipCache?: boolean
}): Promise<any[]> {
  // 生成缓存键
  const cacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId)

  // 检查缓存（除非显式跳过）
  if (!params.skipCache) {
    const cached = gadsApiCache.get(cacheKey)
    if (cached) {
      console.log(`✅ 使用缓存的Campaigns列表: ${params.customerId}`)
      return cached
    }
  }

  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.name
  `

  const results = await customer.query(query)

  // 缓存结果（30分钟TTL）
  gadsApiCache.set(cacheKey, results)
  console.log(`💾 已缓存Campaigns列表: ${params.customerId} (${results.length}个)`)

  return results
}

/**
 * 创建Google Ads Ad Group
 */
export async function createGoogleAdsAdGroup(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  adGroupName: string
  cpcBidMicros?: number
  status: 'ENABLED' | 'PAUSED'
  accountId?: number
  userId?: number
}): Promise<{ adGroupId: string; resourceName: string }> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  const adGroup = {
    name: params.adGroupName,
    campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
    status: enums.AdGroupStatus[params.status],
    type: enums.AdGroupType.SEARCH_STANDARD,
  }

  // 如果提供了CPC出价，设置手动CPC
  if (params.cpcBidMicros) {
    ;(adGroup as any).cpc_bid_micros = params.cpcBidMicros
  }

  const response = await customer.adGroups.create([adGroup])

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建Ad Group失败：无响应')
  }

  const result = response.results[0]
  const adGroupId = result.resource_name?.split('/').pop() || ''

  return {
    adGroupId,
    resourceName: result.resource_name || '',
  }
}

/**
 * 创建Google Ads Keyword
 */
export async function createGoogleAdsKeyword(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywordText: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  status: 'ENABLED' | 'PAUSED'
  finalUrl?: string
  isNegative?: boolean
  accountId?: number
  userId?: number
}): Promise<{ keywordId: string; resourceName: string }> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  if (params.isNegative) {
    // 创建否定关键词
    const negativeKeyword = {
      ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
      keyword: {
        text: params.keywordText,
        match_type: enums.KeywordMatchType[params.matchType],
      },
    }

    const response = await customer.adGroupCriteria.create([
      {
        ...negativeKeyword,
        negative: true,
      },
    ])

    if (!response || !response.results || response.results.length === 0) {
      throw new Error('创建否定关键词失败')
    }

    const result = response.results[0]
    const keywordId = result.resource_name?.split('/').pop() || ''

    return {
      keywordId,
      resourceName: result.resource_name || '',
    }
  } else {
    // 创建普通关键词
    const keyword = {
      ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
      status: enums.AdGroupCriterionStatus[params.status],
      keyword: {
        text: params.keywordText,
        match_type: enums.KeywordMatchType[params.matchType],
      },
    }

    // 如果提供了final URL，添加到关键词配置
    if (params.finalUrl) {
      ;(keyword as any).final_urls = [params.finalUrl]
    }

    const response = await customer.adGroupCriteria.create([keyword])

    if (!response || !response.results || response.results.length === 0) {
      throw new Error('创建关键词失败')
    }

    const result = response.results[0]
    const keywordId = result.resource_name?.split('/').pop() || ''

    return {
      keywordId,
      resourceName: result.resource_name || '',
    }
  }
}

/**
 * 批量创建Google Ads Keywords
 */
export async function createGoogleAdsKeywordsBatch(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywords: Array<{
    keywordText: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    status: 'ENABLED' | 'PAUSED'
    finalUrl?: string
    isNegative?: boolean
  }>
  accountId?: number
  userId?: number
}): Promise<Array<{ keywordId: string; resourceName: string; keywordText: string }>> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  const results: Array<{ keywordId: string; resourceName: string; keywordText: string }> = []

  // 分批处理（每批最多100个）
  const batchSize = 100
  for (let i = 0; i < params.keywords.length; i += batchSize) {
    const batch = params.keywords.slice(i, i + batchSize)

    const keywordOperations = batch.map(kw => {
      const operation = {
        ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
        keyword: {
          text: kw.keywordText,
          match_type: enums.KeywordMatchType[kw.matchType],
        },
      }

      if (kw.isNegative) {
        ;(operation as any).negative = true
      } else {
        ;(operation as any).status = enums.AdGroupCriterionStatus[kw.status]
        if (kw.finalUrl) {
          ;(operation as any).final_urls = [kw.finalUrl]
        }
      }

      return operation
    })

    const response = await customer.adGroupCriteria.create(keywordOperations)

    if (response && response.results && response.results.length > 0) {
      response.results.forEach((result, index) => {
        const keywordId = result.resource_name?.split('/').pop() || ''
        results.push({
          keywordId,
          resourceName: result.resource_name || '',
          keywordText: batch[index].keywordText,
        })
      })
    }
  }

  return results
}

/**
 * 创建Google Ads Responsive Search Ad
 */
export async function createGoogleAdsResponsiveSearchAd(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  headlines: string[] // Max 15 headlines
  descriptions: string[] // Max 4 descriptions
  finalUrls: string[]
  finalUrlSuffix?: string  // 查询参数后缀（用于tracking）
  path1?: string
  path2?: string
  accountId?: number
  userId?: number
}): Promise<{ adId: string; resourceName: string }> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  // Validate headlines (必须正好15个)
  // 根据业务规范：Headlines必须配置15个，如果从广告创意中获得的标题数量不足，则报错
  if (params.headlines.length !== 15) {
    throw new Error(`Headlines必须正好15个，当前提供了${params.headlines.length}个。如果从广告创意中获得的标题数量不足，请报错。`)
  }

  // Validate descriptions (必须正好4个)
  // 根据业务规范：Descriptions必须配置4个，如果从广告创意中获得的描述数量不足，则报错
  if (params.descriptions.length !== 4) {
    throw new Error(`Descriptions必须正好4个，当前提供了${params.descriptions.length}个。如果从广告创意中获得的描述数量不足，请报错。`)
  }

  // Validate headline length (max 30 characters each)
  params.headlines.forEach((headline, index) => {
    if (headline.length > 30) {
      throw new Error(`标题${index + 1}超过30字符限制: "${headline}" (${headline.length}字符)`)
    }
  })

  // Validate description length (max 90 characters each)
  params.descriptions.forEach((desc, index) => {
    if (desc.length > 90) {
      throw new Error(`描述${index + 1}超过90字符限制: "${desc}" (${desc.length}字符)`)
    }
  })

  // Create ad structure
  const ad: any = {
    ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
    status: enums.AdGroupAdStatus.ENABLED,
    ad: {
      final_urls: params.finalUrls,
      responsive_search_ad: {
        headlines: params.headlines.map(text => ({ text })),
        descriptions: params.descriptions.map(text => ({ text })),
      },
    },
  }

  // Add Final URL Suffix if provided (for tracking parameters)
  if (params.finalUrlSuffix) {
    ad.ad.final_url_suffix = params.finalUrlSuffix
  }

  // Add display path fields if provided
  if (params.path1) {
    ad.ad.responsive_search_ad.path1 = params.path1
  }
  if (params.path2) {
    ad.ad.responsive_search_ad.path2 = params.path2
  }

  const response = await customer.adGroupAds.create([ad])

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建Responsive Search Ad失败：无响应')
  }

  const result = response.results[0]
  const adId = result.resource_name?.split('/').pop() || ''

  return {
    adId,
    resourceName: result.resource_name || '',
  }
}

// ==================== Performance Reporting ====================

/**
 * 获取Campaign表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignId - Google Ads Campaign ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID（用于token刷新）
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getCampaignPerformance(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
}): Promise<Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>> {
  const customer = await getCustomer(params.customerId, params.refreshToken, params.accountId, params.userId)

  // Google Ads Query Language (GAQL) query
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE campaign.id = ${params.campaignId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const response = await customer.query(query)

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000), // Convert to micros
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    console.error('获取Campaign表现数据失败:', error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 获取Ad Group表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.adGroupId - Google Ads Ad Group ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getAdGroupPerformance(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
}): Promise<Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>> {
  const customer = await getCustomer(params.customerId, params.refreshToken, params.accountId, params.userId)

  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM ad_group
    WHERE ad_group.id = ${params.adGroupId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const response = await customer.query(query)

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    console.error('获取Ad Group表现数据失败:', error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 获取Ad表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.adId - Google Ads Ad ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getAdPerformance(params: {
  customerId: string
  refreshToken: string
  adId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
}): Promise<Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>> {
  const customer = await getCustomer(params.customerId, params.refreshToken, params.accountId, params.userId)

  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM ad_group_ad
    WHERE ad_group_ad.ad.id = ${params.adId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const response = await customer.query(query)

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    console.error('获取Ad表现数据失败:', error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 批量获取多个Campaign的表现数据（汇总）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignIds - Google Ads Campaign IDs数组
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Campaign ID到表现数据的映射
 */
export async function getBatchCampaignPerformance(params: {
  customerId: string
  refreshToken: string
  campaignIds: string[]
  startDate: string
  endDate: string
  accountId: number
  userId: number
}): Promise<Record<string, Array<{
  date: string
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  ctr: number
  cpc_micros: number
  conversion_rate: number
}>>> {
  const customer = await getCustomer(params.customerId, params.refreshToken, params.accountId, params.userId)

  // Construct IN clause for multiple campaign IDs
  const campaignIdList = params.campaignIds.join(',')

  const query = `
    SELECT
      campaign.id,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE campaign.id IN (${campaignIdList})
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY campaign.id, segments.date DESC
  `

  try {
    const response = await customer.query(query)

    // Group by campaign ID
    const performanceByCampaign: Record<string, any[]> = {}

    response.forEach((row: any) => {
      const campaignId = row.campaign?.id?.toString() || ''

      if (!performanceByCampaign[campaignId]) {
        performanceByCampaign[campaignId] = []
      }

      performanceByCampaign[campaignId].push({
        date: row.segments?.date || '',
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        conversions: row.metrics?.conversions || 0,
        cost_micros: row.metrics?.cost_micros || 0,
        ctr: row.metrics?.ctr || 0,
        cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
        conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
      })
    })

    return performanceByCampaign
  } catch (error: any) {
    console.error('批量获取Campaign表现数据失败:', error)
    throw new Error(`批量获取表现数据失败: ${error.message}`)
  }
}
