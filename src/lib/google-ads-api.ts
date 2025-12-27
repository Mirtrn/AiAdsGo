import { GoogleAdsApi, Customer, enums } from 'google-ads-api'
import { updateGoogleAdsAccount } from './google-ads-accounts'
import { withRetry } from './retry'
import { gadsApiCache, generateGadsApiCacheKey } from './cache'
import { getUserOnlySetting } from './settings'

/**
 * 从数据库获取用户的Google Ads凭证
 *
 * 🆕 新增(2025-12-22): 统一的凭证获取函数,确保所有API调用都从数据库读取
 *
 * @param userId - 用户ID
 * @returns Google Ads凭证对象
 * @throws Error 如果配置缺失
 */
export async function getGoogleAdsCredentialsFromDB(userId: number): Promise<{
  client_id: string
  client_secret: string
  developer_token: string
  login_customer_id: string
  useServiceAccount: boolean
}> {
  const [clientIdSetting, clientSecretSetting, developerTokenSetting, loginCustomerIdSetting, useServiceAccountSetting] = await Promise.all([
    getUserOnlySetting('google_ads', 'client_id', userId),
    getUserOnlySetting('google_ads', 'client_secret', userId),
    getUserOnlySetting('google_ads', 'developer_token', userId),
    getUserOnlySetting('google_ads', 'login_customer_id', userId),
    getUserOnlySetting('google_ads', 'use_service_account', userId),
  ])

  const useServiceAccount = String(useServiceAccountSetting?.value ?? '').toLowerCase() === 'true'

  // 🔧 修复(2025-12-25): 服务账号模式不需要login_customer_id
  if (!clientIdSetting?.value || !clientSecretSetting?.value || !developerTokenSetting?.value) {
    throw new Error(`用户(ID=${userId})未配置完整的 Google Ads 凭证。请在设置页面配置所有必需参数。`)
  }

  if (!useServiceAccount && !loginCustomerIdSetting?.value) {
    throw new Error(`用户(ID=${userId})未配置 login_customer_id。OAuth模式需要此参数。`)
  }

  return {
    client_id: clientIdSetting.value,
    client_secret: clientSecretSetting.value,
    developer_token: developerTokenSetting.value,
    login_customer_id: loginCustomerIdSetting?.value || '',
    useServiceAccount,
  }
}

/**
 * 抑制 Google Ads API 的 MetadataLookupWarning
 * 这是 google-ads-api 包的已知问题，不影响功能
 * 🚀 优化(2025-12-18): 更全面的抑制机制
 */
if (typeof process !== 'undefined') {
  // 1. 抑制 process.emitWarning
  if (process.emitWarning) {
    const originalEmitWarning = process.emitWarning
    process.emitWarning = (warning: any, ...args: any[]) => {
      // 过滤掉 MetadataLookupWarning
      if (typeof warning === 'string' && warning.includes('MetadataLookupWarning')) {
        return
      }
      if (typeof warning === 'object' && warning?.name === 'MetadataLookupWarning') {
        return
      }
      return originalEmitWarning.call(process, warning, ...args)
    }
  }

  // 2. 抑制 console.warn（如果存在）
  if (typeof console !== 'undefined' && console.warn) {
    const originalWarn = console.warn
    console.warn = (...args: any[]) => {
      const message = args.join(' ')
      if (message.includes('MetadataLookupWarning') || message.includes('All promises were rejected')) {
        return
      }
      return originalWarn.apply(console, args)
    }
  }

  // 3. 抑制 stderr 写入（Node.js环境）
  if (typeof process.stderr?.write === 'function') {
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: any, ...args: any[]) => {
      const message = typeof chunk === 'string' ? chunk : chunk?.toString?.() || ''
      if (message.includes('MetadataLookupWarning') || message.includes('All promises were rejected')) {
        return true
      }
      return originalWrite(chunk, ...args)
    }
  }
}

/**
 * 获取Google Ads API客户端实例
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,强制要求传入credentials
 * 所有配置必须从数据库读取,支持用户级隔离
 *
 * @param credentials - 必需的用户凭证(从数据库读取)
 * @throws Error 如果未提供凭证
 */
export function getGoogleAdsClient(credentials: {
  client_id: string
  client_secret: string
  developer_token: string
}): GoogleAdsApi {
  if (!credentials) {
    throw new Error('Google Ads API 配置缺失：必须从数据库提供 credentials 参数,不再支持环境变量')
  }

  // 每次都创建新的客户端实例,支持多用户隔离
  return new GoogleAdsApi({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    developer_token: credentials.developer_token,
  })
}

/**
 * 生成OAuth授权URL
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,从参数获取clientId
 *
 * @param clientId - 用户的Google Ads Client ID(从数据库读取)
 * @param state - OAuth state参数
 * @throws Error 如果未提供clientId
 */
export function getOAuthUrl(clientId: string, state?: string): string {
  if (!clientId) {
    throw new Error('缺少 Client ID 配置,必须从数据库提供')
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-ads/callback`

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
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,从参数获取credentials
 *
 * @param code - OAuth authorization code
 * @param credentials - 用户的Google Ads凭证(从数据库读取)
 * @throws Error 如果未提供凭证
 */
export async function exchangeCodeForTokens(
  code: string,
  credentials: {
    client_id: string
    client_secret: string
  }
): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  if (!credentials?.client_id || !credentials?.client_secret) {
    throw new Error('缺少OAuth配置,必须从数据库提供 client_id 和 client_secret')
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-ads/callback`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
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
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,credentials参数改为必需
 *
 * @param refreshToken - Refresh token
 * @param credentials - 必需的用户凭证(从数据库读取)
 * @throws Error 如果未提供凭证
 */
export async function refreshAccessToken(
  refreshToken: string,
  credentials: {
    client_id: string
    client_secret: string
  }
): Promise<{
  access_token: string
  expires_in: number
}> {
  if (!credentials?.client_id || !credentials?.client_secret) {
    throw new Error('缺少OAuth配置,必须从数据库提供 client_id 和 client_secret')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
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
 * 自动处理token刷新，支持OAuth和服务账号两种认证方式
 *
 * 🔧 修复(2025-12-22): 移除环境变量依赖,强制要求传入credentials和loginCustomerId
 * 🆕 新增(2025-12-23): 支持服务账号认证
 *
 * @param customerId - Customer ID
 * @param refreshToken - Refresh token (OAuth模式)
 * @param loginCustomerId - 必需的MCC账户ID(从数据库读取)
 * @param credentials - 必需的用户凭证(从数据库读取)
 * @param accountId - 可选的账户ID用于更新token
 * @param userId - 可选的用户ID用于更新token
 * @param authType - 认证类型: 'oauth' | 'service_account'
 * @param serviceAccountConfig - 服务账号配置(服务账号模式必需)
 * @throws Error 如果未提供必需参数
 */
export async function getCustomer(
  customerId: string,
  refreshToken: string,
  loginCustomerId: string,
  credentials: {
    client_id: string
    client_secret: string
    developer_token: string
  },
  userId: number,
  accountId?: number,
  authType?: 'oauth' | 'service_account',
  serviceAccountConfig?: {
    clientEmail: string
    privateKey: string
    mccCustomerId: string
  }
): Promise<Customer> {
  if (!credentials) {
    throw new Error('缺少Google Ads凭证,必须从数据库提供 credentials 参数')
  }

  if (!loginCustomerId) {
    throw new Error('缺少 Login Customer ID(MCC账户ID),必须从数据库提供')
  }

  const client = getGoogleAdsClient(credentials)

  // OAuth认证模式（原有逻辑）
  try {
    // 尝试使用refresh token获取新的access token（带重试）
    const tokens = await withRetry(
      () => refreshAccessToken(refreshToken, {
        client_id: credentials.client_id,
        client_secret: credentials.client_secret
      }),
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
      login_customer_id: loginCustomerId,
    })

    return customer
  } catch (error: any) {
    throw new Error(`获取Google Ads Customer失败: ${error.message}`)
  }
}

/**
 * 辅助函数：从数据库获取凭证并创建Customer实例
 * 简化调用者代码，避免每次都手动获取credentials
 * 支持OAuth和服务账号两种认证方式
 *
 * 🔧 修复(2025-12-24): 服务账号模式下不需要 client_id/client_secret
 */
export async function getCustomerWithCredentials(params: {
  customerId: string
  refreshToken?: string  // OAuth模式需要
  accountId?: number
  userId: number
  loginCustomerId?: string
  credentials?: {
    client_id: string
    client_secret: string
    developer_token: string
  }
  // 服务账号认证参数
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Customer> {
  if (!params.userId) {
    throw new Error('userId is required to fetch Google Ads credentials')
  }

  const authType = params.authType || 'oauth'

  if (authType === 'service_account') {
    // 服务账号认证模式：使用 @htdangkhoa/google-ads，不需要 client_id/client_secret
    const { getUnifiedGoogleAdsClient } = await import('./google-ads-service-account')

    return getUnifiedGoogleAdsClient({
      customerId: params.customerId,
      // 服务账号模式下不需要 credentials（使用 JWT 认证）
      authConfig: {
        authType: 'service_account',
        userId: params.userId,
        serviceAccountId: params.serviceAccountId
      }
    })
  } else {
    // OAuth认证模式
    if (!params.refreshToken) {
      throw new Error('refreshToken is required for OAuth authentication')
    }

    // 从数据库获取凭证
    const creds = await getGoogleAdsCredentialsFromDB(params.userId)

    // 使用loginCustomerId参数，或从数据库获取
    const loginCustomerId = params.loginCustomerId || creds.login_customer_id

    return getCustomer(
      params.customerId,
      params.refreshToken,
      loginCustomerId,
      {
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        developer_token: creds.developer_token,
      },
      params.userId,
      params.accountId
    )
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
 * 语言代码/名称到Language Constant ID的映射
 * 参考: https://developers.google.com/google-ads/api/reference/data/codes-formats
 *
 * 支持两种输入格式：
 * 1. 语言代码：'en', 'zh', 'es' 等
 * 2. 语言名称：'English', 'Chinese', 'Spanish' 等
 */
function getLanguageConstantId(input: string): number | null {
  // 语言代码到Constant ID的映射
  const languageCodeMap: Record<string, number> = {
    'en': 1000,      // English
    'zh': 1017,      // Chinese (Simplified)
    'zh-cn': 1017,   // Chinese (Simplified)
    'zh-tw': 1018,   // Chinese (Traditional)
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

  // 语言名称到语言代码的映射
  const languageNameMap: Record<string, string> = {
    'english': 'en',
    'chinese (simplified)': 'zh-cn',
    'chinese (traditional)': 'zh-tw',
    'chinese': 'zh',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'japanese': 'ja',
    'korean': 'ko',
    'portuguese': 'pt',
    'italian': 'it',
    'russian': 'ru',
    'arabic': 'ar',
    'hindi': 'hi',
  }

  const normalized = input.toLowerCase().trim()

  // 先尝试直接匹配语言代码
  if (languageCodeMap[normalized]) {
    return languageCodeMap[normalized]
  }

  // 再尝试匹配语言名称
  const code = languageNameMap[normalized]
  if (code && languageCodeMap[code]) {
    return languageCodeMap[code]
  }

  return null
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
  userId: number  // 改为必填
  loginCustomerId?: string  // 🔥 经理账号ID（用于访问客户账号）
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ campaignId: string; resourceName: string }> {
  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const {
      createCampaignBudgetPython,
      createCampaignPython,
    } = await import('./python-ads-client')

    // 1. 创建预算
    const budgetResourceName = await createCampaignBudgetPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      name: `${params.campaignName} Budget ${Date.now()}`,
      amountMicros: params.budgetAmount * 1000000,
      deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
    })

    // 2. 创建广告系列
    const campaignResourceName = await createCampaignPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      name: params.campaignName,
      budgetResourceName,
      status: 'PAUSED',
      biddingStrategyType: 'TARGET_SPEND',
      cpcBidCeilingMicros: params.cpcBidCeilingMicros || 170000,
      targetCountry: params.targetCountry,
      targetLanguage: params.targetLanguage,
      startDate: params.startDate,
      endDate: params.endDate,
      finalUrlSuffix: params.finalUrlSuffix,
    })

    const campaignId = campaignResourceName.split('/').pop() || ''
    return { campaignId, resourceName: campaignResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

  // 1. 创建预算（添加时间戳避免重复名称）
  const budgetResourceName = await createCampaignBudget(customer, {
    name: `${params.campaignName} Budget ${Date.now()}`,
    amount: params.budgetAmount,
    deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
  })

  // 2. 创建广告系列（遵循Google Ads API官方最佳实践）
  const campaign: any = {
    name: params.campaignName,
    // 官方推荐：创建时使用PAUSED状态，添加完定位和广告后再启用
    status: enums.CampaignStatus.PAUSED,
    advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
    // 🚀 修复(2025-12-18): 移除SEARCH_STANDARD子类型
    // SEARCH_STANDARD不是有效的枚举值，标准搜索广告不需要设置子类型
    // advertising_channel_sub_type会默认为标准搜索广告
    campaign_budget: budgetResourceName,
    network_settings: {
      target_google_search: true,
      target_search_network: true,
      // 禁用Display Expansion（只投放搜索网络）
      target_content_network: false,
      target_partner_search_network: false,
    },
  }

  // 🎯 营销目标说明
  // Google Ads UI中的"营销目标"是引导性UI元素，在API层面：
  // 1. 搜索广告系列通过advertising_channel_type=SEARCH自动关联"网站流量"目标
  // 2. goal_config_settings是只读字段，不能在创建时设置
  // 3. 营销目标会在广告系列创建后由Google Ads自动推断
  // 参考：https://developers.google.com/google-ads/api/reference/rpc/v21/Campaign

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

  // 地理位置选项设置：PRESENCE = 所在地（只定位实际位于该地理位置的用户）
  // PRESENCE_OR_INTEREST = 所在地或兴趣（定位在该地或对该地感兴趣的用户）
  // 参考：https://developers.google.com/google-ads/api/reference/rpc/latest/PositiveGeoTargetTypeEnum.PositiveGeoTargetType
  campaign.geo_target_type_setting = {
    positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE
  }

  // 添加Final URL Suffix（始终设置，即使为空）
  // Final URL Suffix用于在所有广告的最终URL后附加跟踪参数
  // 从推广链接重定向访问后提取的Final URL suffix
  // 即使为空也设置字段，确保在Google Ads界面中显示配置状态
  campaign.final_url_suffix = params.finalUrlSuffix && params.finalUrlSuffix.trim() !== ''
    ? params.finalUrlSuffix
    : ''

  if (campaign.final_url_suffix) {
    console.log('✅ Campaign Final URL Suffix配置:', campaign.final_url_suffix)
  } else {
    console.log('ℹ️ Campaign Final URL Suffix未设置（空字符串）')
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

  // 🚀 优化(2025-12-18): 简化日志输出，减少噪音
  // DEBUG: 完整的Campaign对象（仅在开发环境打印）
  if (process.env.NODE_ENV === 'development') {
    console.log('📋 Campaign配置:', {
      name: campaign.name,
      strategy: campaign.bidding_strategy_type,
      budget: campaign.target_spend,
      country: params.targetCountry
    })
  }

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
    } else {
      console.warn(`⚠️ 警告: 未找到语言 "${params.targetLanguage}" 对应的常量ID，语言定位可能被跳过`)
    }
  } else {
    console.warn(`⚠️ 警告: 未提供targetLanguage参数，将使用默认语言设置`)
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
  userId: number
  loginCustomerId?: string
  // 🔧 修复(2025-12-25): 支持服务账号认证
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<void> {
  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { updateCampaignStatusPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignStatusPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      status: params.status as 'ENABLED' | 'PAUSED',
    })
  } else {
    const customer = await getCustomerWithCredentials({
      ...params,
      authType: params.authType,
      serviceAccountId: params.serviceAccountId,
    })

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
  }

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
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<void> {
  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { updateCampaignBudgetPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignBudgetPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      budgetAmountMicros: params.budgetAmount * 1000000,
    })
  } else {
    const customer = await getCustomerWithCredentials(params)

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
  }

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
  userId: number
  skipCache?: boolean
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<any> {
  const cacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, {
    campaignId: params.campaignId
  })

  if (!params.skipCache) {
    const cached = gadsApiCache.get(cacheKey)
    if (cached) {
      console.log(`✅ 使用缓存的Campaign数据: ${params.campaignId}`)
      return cached
    }
  }

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

  const authType = params.authType || 'oauth'
  let results: any[]

  if (authType === 'service_account') {
    const { executeGAQLQueryPython } = await import('./python-ads-client')
    const result = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query,
    })
    results = result.results || []
  } else {
    const customer = await getCustomerWithCredentials(params)
    results = await customer.query(query)
  }

  const result = results[0] || null

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
  userId: number
  skipCache?: boolean
  loginCustomerId?: string
  // 🔧 修复(2025-12-25): 支持服务账号认证
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
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

  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { executeGAQLQueryPython } = await import('./python-ads-client')
    const { getServiceAccountConfig } = await import('./google-ads-service-account')
    const saConfig = await getServiceAccountConfig(params.userId, params.serviceAccountId)

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

    const response = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query
    })

    const results = response.results || []

    // 缓存结果（30分钟TTL）
    gadsApiCache.set(cacheKey, results)
    console.log(`💾 已缓存Campaigns列表: ${params.customerId} (${results.length}个)`)

    return results
  }

  // OAuth模式
  const customer = await getCustomerWithCredentials({
    ...params,
    authType: params.authType,
    serviceAccountId: params.serviceAccountId,
  })

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
  userId: number
  loginCustomerId?: string  // 🔥 经理账号ID
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ adGroupId: string; resourceName: string }> {
  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createAdGroupPython } = await import('./python-ads-client')

    const campaignResourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    const adGroupResourceName = await createAdGroupPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName,
      name: params.adGroupName,
      status: params.status,
      cpcBidMicros: params.cpcBidMicros,
    })

    const adGroupId = adGroupResourceName.split('/').pop() || ''
    return { adGroupId, resourceName: adGroupResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

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
 * 批量创建Google Ads Keywords
 */
export async function createGoogleAdsKeywordsBatch(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  keywords: Array<{
    keywordText: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    negativeKeywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT'  // ← 新增：负向词的匹配类型
    status: 'ENABLED' | 'PAUSED'
    finalUrl?: string
    isNegative?: boolean
  }>
  accountId?: number
  userId: number
  loginCustomerId?: string  // 🔧 添加MCC权限参数
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<Array<{ keywordId: string; resourceName: string; keywordText: string }>> {
  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createKeywordsPython } = await import('./python-ads-client')

    const adGroupResourceName = `customers/${params.customerId}/adGroups/${params.adGroupId}`
    const resourceNames = await createKeywordsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      adGroupResourceName,
      keywords: params.keywords.map(kw => ({
        text: kw.keywordText,
        matchType: kw.matchType,
        status: kw.status,
        finalUrl: kw.finalUrl,
        isNegative: kw.isNegative,
        negativeKeywordMatchType: kw.negativeKeywordMatchType,
      })),
    })

    return resourceNames.map((resourceName, index) => ({
      keywordId: resourceName.split('/').pop() || '',
      resourceName,
      keywordText: params.keywords[index].keywordText,
    }))
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

  const results: Array<{ keywordId: string; resourceName: string; keywordText: string }> = []

  // 分批处理（每批最多100个）
  const batchSize = 100
  for (let i = 0; i < params.keywords.length; i += batchSize) {
    const batch = params.keywords.slice(i, i + batchSize)

    const keywordOperations = batch.map(kw => {
      // ← 关键修改：为负向词选择正确的匹配类型
      const effectiveMatchType = kw.isNegative
        ? (kw.negativeKeywordMatchType || 'EXACT')  // 负向词默认用 EXACT 匹配，防止误伤
        : kw.matchType  // 正向词用提供的 matchType

      const operation = {
        ad_group: `customers/${params.customerId}/adGroups/${params.adGroupId}`,
        keyword: {
          text: kw.keywordText,
          match_type: enums.KeywordMatchType[effectiveMatchType],
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
  userId: number
  loginCustomerId?: string  // 🔥 经理账号ID
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ adId: string; resourceName: string }> {
  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createResponsiveSearchAdPython } = await import('./python-ads-client')

    const adGroupResourceName = `customers/${params.customerId}/adGroups/${params.adGroupId}`
    const adResourceName = await createResponsiveSearchAdPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      adGroupResourceName,
      headlines: params.headlines,
      descriptions: params.descriptions,
      finalUrls: params.finalUrls,
      finalUrlSuffix: params.finalUrlSuffix,
      path1: params.path1,
      path2: params.path2,
    })

    const adId = adResourceName.split('/').pop() || ''
    return { adId, resourceName: adResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(params)

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
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
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
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await customer.query(query)
    }

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
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
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
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await customer.query(query)
    }

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
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
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
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await customer.query(query)
    }

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
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
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
    const authType = params.authType || 'oauth'
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('./python-ads-client')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(params)
      response = await customer.query(query)
    }

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

/**
 * 创建Callout扩展（现在称为Callout Assets）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignId - Campaign ID to attach callouts to
 * @param params.callouts - Array of callout texts (max 25 characters each)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Array of created asset IDs
 */
export async function createGoogleAdsCalloutExtensions(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  callouts: string[]
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ assetIds: string[] }> {
  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { createCalloutExtensionsPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    const assetResourceNames = await createCalloutExtensionsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      calloutTexts: params.callouts,
    })
    return { assetIds: assetResourceNames.map(rn => rn.split('/').pop() || '') }
  }

  const customer = await getCustomerWithCredentials(params)

  const assetIds: string[] = []

  try {
    // 🔧 修复(2025-12-26): 确保所有calloutText都是字符串
    const validCallouts = params.callouts.filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    if (validCallouts.length === 0) {
      throw new Error('没有有效的Callout文本，无法创建Callout扩展')
    }

    // Step 1: Create Callout Assets
    const assetOperations = validCallouts.map(calloutText => ({
      callout_asset: {
        callout_text: calloutText.substring(0, 25) // Google Ads限制：最多25个字符
      }
    }))

    console.log(`📢 创建${params.callouts.length}个Callout Assets...`)
    const assetResponse = await customer.assets.create(assetOperations)

    if (assetResponse && assetResponse.results) {
      assetResponse.results.forEach((result: any) => {
        const assetId = result.resource_name?.split('/').pop() || ''
        assetIds.push(assetId)
      })
      console.log(`✅ Callout Assets创建成功: ${assetIds.length}个`)
    }

    // Step 2: Link Assets to Campaign
    const campaignAssetOperations = assetIds.map(assetId => ({
      campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
      asset: `customers/${params.customerId}/assets/${assetId}`,
      field_type: enums.AssetFieldType.CALLOUT
    }))

    console.log(`🔗 关联Callout Assets到Campaign ${params.campaignId}...`)
    await customer.campaignAssets.create(campaignAssetOperations)
    console.log(`✅ Callout Assets关联成功`)

    return { assetIds }
  } catch (error: any) {
    console.error('❌ 创建Callout扩展失败:', error.message)
    throw new Error(`创建Callout扩展失败: ${error.message}`)
  }
}

/**
 * 创建Sitelink扩展（现在称为Sitelink Assets）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignId - Campaign ID to attach sitelinks to
 * @param params.sitelinks - Array of sitelink objects
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Array of created asset IDs
 */
export async function createGoogleAdsSitelinkExtensions(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  sitelinks: Array<{
    text: string
    url: string
    description1?: string
    description2?: string
  }>
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
}): Promise<{ assetIds: string[] }> {
  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (params.authType === 'service_account') {
    const { createSitelinkExtensionsPython } = await import('./python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    const assetResourceNames = await createSitelinkExtensionsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      sitelinks: params.sitelinks.map(sl => ({
        linkText: sl.text,
        finalUrl: sl.url,
        description1: sl.description1,
        description2: sl.description2,
      })),
    })
    return { assetIds: assetResourceNames.map(rn => rn.split('/').pop() || '') }
  }

  const customer = await getCustomerWithCredentials(params)

  const assetIds: string[] = []

  try {
    // Step 1: Create Sitelink Assets
    const assetOperations = params.sitelinks.map(sitelink => {
      console.log(`🔍 处理Sitelink: text="${sitelink.text}", url="${sitelink.url}", desc1="${sitelink.description1}"`)

      const sitelinkAsset: any = {
        link_text: sitelink.text.substring(0, 25) // 最多25个字符
      }

      // description1 和 description2 必须要么都存在，要么都不存在
      if (sitelink.description1 && sitelink.description1.trim()) {
        sitelinkAsset.description1 = sitelink.description1.substring(0, 35)
        sitelinkAsset.description2 = sitelink.description2?.substring(0, 35) || sitelink.description1.substring(0, 35)
      }

      // 关键修复：final_urls必须在Asset层级，不是sitelink_asset内部
      const assetObj = {
        sitelink_asset: sitelinkAsset,
        final_urls: [sitelink.url] // final_urls在Asset层级
      }

      console.log(`✅ 生成的Asset:`, JSON.stringify(assetObj, null, 2))

      return assetObj
    })

    console.log(`🔗 创建${params.sitelinks.length}个Sitelink Assets...`)
    console.log(`📋 Sitelink数据:`, JSON.stringify(assetOperations, null, 2))
    const assetResponse = await customer.assets.create(assetOperations)

    if (assetResponse && assetResponse.results) {
      assetResponse.results.forEach((result: any) => {
        const assetId = result.resource_name?.split('/').pop() || ''
        assetIds.push(assetId)
      })
      console.log(`✅ Sitelink Assets创建成功: ${assetIds.length}个`)
    }

    // Step 2: Link Assets to Campaign
    const campaignAssetOperations = assetIds.map(assetId => ({
      campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
      asset: `customers/${params.customerId}/assets/${assetId}`,
      field_type: enums.AssetFieldType.SITELINK
    }))

    console.log(`🔗 关联Sitelink Assets到Campaign ${params.campaignId}...`)
    await customer.campaignAssets.create(campaignAssetOperations)
    console.log(`✅ Sitelink Assets关联成功`)

    return { assetIds }
  } catch (error: any) {
    console.error('❌ 创建Sitelink扩展失败:', error.message)
    console.error('❌ 错误详情:', JSON.stringify(error, null, 2))
    throw new Error(`创建Sitelink扩展失败: ${error.message}`)
  }
}


// ==================== Conversion Goal Functions Removed ====================
//
// 🔧 移除说明 (2025-12-26):
// - MarketingObjective类型及其相关函数已移除
// - setCampaignMarketingObjective: 设置Campaign营销目标（不稳定，已尝试8+次修复）
// - ensureAccountConversionGoal: 确保账号转化目标配置（同样的问题）
// - 相关辅助函数: createConversionAction, setCustomerConversionGoal, queryConversionActions
//
// 原因: Google Ads会自动推断营销目标（基于转化操作），无需手动设置
// 这些功能的失败不会阻断广告发布流程，移除以简化代码
//
// 历史记录:
// - 2025-12-19: 首次添加setCampaignMarketingObjective
// - 2025-12-20: 多次修复，自动创建转化操作
// - 2025-12-25: 关键修复，添加CustomerConversionGoal设置
// - 2025-12-26: 决定移除（方案A），经过8+次修复仍不稳定

// ==================== Headline Optimization ====================

/**
 * 确保标题中包含热门关键词
 *
 * 🔧 新增(2025-12-20): 解决Google Ads广告效力"未在标题中包含热门关键词"问题
 *
 * Google Ads 会检测广告标题是否包含投放的关键词，如果标题中没有关键词，
 * 广告效力评分会降低。此函数确保 Top N 热门关键词至少出现在标题中。
 *
 * @param headlines - 原始标题数组（15个）
 * @param keywords - 关键词数组（按优先级排序）
 * @param brandName - 品牌名称
 * @param maxKeywordsToEnsure - 需要确保覆盖的关键词数量（默认3个）
 * @returns 优化后的标题数组
 */
export function ensureKeywordsInHeadlines(
  headlines: string[],
  keywords: string[],
  brandName: string,
  maxKeywordsToEnsure: number = 3
): string[] {
  if (!headlines || headlines.length === 0) {
    console.log(`[HeadlineOptimizer] ⚠️ 没有标题可优化`)
    return headlines
  }

  if (!keywords || keywords.length === 0) {
    console.log(`[HeadlineOptimizer] ⚠️ 没有关键词可用于优化`)
    return headlines
  }

  const result = [...headlines]
  const headlinesLower = result.map(h => h.toLowerCase())

  // 获取需要确保覆盖的 Top N 关键词
  const topKeywords = keywords
    .slice(0, maxKeywordsToEnsure)
    .map(k => typeof k === 'string' ? k : (k as any).text || (k as any).keyword || '')
    .filter(k => k.length > 0)

  console.log(`[HeadlineOptimizer] 🔍 检查 Top ${topKeywords.length} 关键词覆盖情况`)
  console.log(`[HeadlineOptimizer]    关键词: ${topKeywords.join(', ')}`)

  // 找出未被标题覆盖的关键词
  const uncoveredKeywords: string[] = []
  topKeywords.forEach(kw => {
    const kwLower = kw.toLowerCase()
    const isCovered = headlinesLower.some(h => h.includes(kwLower))
    if (!isCovered) {
      uncoveredKeywords.push(kw)
      console.log(`[HeadlineOptimizer]    ❌ 未覆盖: "${kw}"`)
    } else {
      console.log(`[HeadlineOptimizer]    ✅ 已覆盖: "${kw}"`)
    }
  })

  if (uncoveredKeywords.length === 0) {
    console.log(`[HeadlineOptimizer] ✅ 所有热门关键词已被标题覆盖，无需优化`)
    return result
  }

  console.log(`[HeadlineOptimizer] 🔧 需要为 ${uncoveredKeywords.length} 个关键词生成新标题`)

  // 去重未覆盖的关键词，避免生成重复标题
  const uniqueUncoveredKeywords = Array.from(new Set(uncoveredKeywords))
  console.log(`[HeadlineOptimizer] 去重后需要为 ${uniqueUncoveredKeywords.length} 个唯一关键词生成新标题`)

  // 生成包含关键词的新标题模板
  const generateKeywordHeadline = (keyword: string, brand: string): string => {
    // 多种模板，确保多样性
    const templates = [
      `${keyword} - ${brand}`,           // "smart ring - Ringconn"
      `Shop ${keyword} Now`,             // "Shop smart ring Now"
      `${keyword} | Official Store`,     // "smart ring | Official Store"
      `Best ${keyword} Deals`,           // "Best smart ring Deals"
      `${brand} ${keyword}`,             // "Ringconn smart ring"
    ]

    // 选择一个不超过30字符的模板
    for (const template of templates) {
      if (template.length <= 30) {
        return template
      }
    }

    // 如果所有模板都太长，直接使用关键词
    return keyword.length <= 30 ? keyword : keyword.substring(0, 30)
  }

  // 替换最后几个标题为包含未覆盖关键词的版本
  uniqueUncoveredKeywords.forEach((kw, i) => {
    // 从倒数第二个开始替换（保留最后一个作为CTA）
    const replaceIndex = result.length - 2 - i
    if (replaceIndex >= 0 && replaceIndex < result.length) {
      const oldHeadline = result[replaceIndex]
      const newHeadline = generateKeywordHeadline(kw, brandName)

      // 检查生成的标题是否与已有标题重复
      const isDuplicate = result.some((h, idx) =>
        idx !== replaceIndex && h.toLowerCase() === newHeadline.toLowerCase()
      )

      if (!isDuplicate) {
        result[replaceIndex] = newHeadline
        console.log(`[HeadlineOptimizer]    替换标题[${replaceIndex}]: "${oldHeadline}" → "${newHeadline}"`)
      } else {
        console.log(`[HeadlineOptimizer]    跳过标题[${replaceIndex}]：新标题"${newHeadline}"与已有标题重复`)
      }
    }
  })

  console.log(`[HeadlineOptimizer] ✅ 标题优化完成，替换了 ${uniqueUncoveredKeywords.length} 个标题`)

  return result
}

// ==================== Re-exports ====================

// 重新导出 enums 和 GoogleAdsApi 供其他模块使用，统一入口
export { enums, GoogleAdsApi } from 'google-ads-api'

