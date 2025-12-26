/**
 * Python Google Ads Service 客户端
 * 用于服务账号模式的 Google Ads API 调用
 */
import axios from 'axios'
import { getServiceAccountConfig } from './google-ads-service-account'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'

const PYTHON_SERVICE_URL = process.env.PYTHON_ADS_SERVICE_URL || 'http://localhost:8001'

/**
 * 包装 Python API 调用并自动统计
 */
async function withTracking<T>(
  userId: number,
  customerId: string,
  operationType: ApiOperationType,
  endpoint: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()
  try {
    const result = await fn()
    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: true,
    })
    return result
  } catch (error: any) {
    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: false,
      errorMessage: error.message,
    })
    throw error
  }
}

interface ServiceAccountAuth {
  email: string
  private_key: string
  developer_token: string
  login_customer_id: string
}

/**
 * 获取服务账号认证配置
 */
async function getServiceAccountAuth(userId: number, serviceAccountId?: string): Promise<ServiceAccountAuth> {
  const sa = await getServiceAccountConfig(userId, serviceAccountId)
  if (!sa) {
    throw new Error('Service account not found')
  }

  return {
    email: sa.serviceAccountEmail,
    private_key: sa.privateKey || '',
    developer_token: sa.developerToken,
    login_customer_id: sa.mccCustomerId,
  }
}

/**
 * 查询关键词历史数据（服务账号模式）
 */
export async function getKeywordHistoricalMetricsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  keywords: string[]
  language: string
  geoTargetConstants: string[]
}): Promise<any> {
  return withTracking(params.userId, params.customerId, ApiOperationType.GET_KEYWORD_IDEAS, '/api/keyword-planner/historical-metrics', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/keyword-planner/historical-metrics`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      keywords: params.keywords,
      language: params.language,
      geo_target_constants: params.geoTargetConstants,
    })
    return response.data
  })
}

/**
 * 生成关键词建议（服务账号模式）
 */
export async function getKeywordIdeasPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  keywords: string[]
  language: string
  geoTargetConstants: string[]
  pageUrl?: string
}): Promise<any> {
  return withTracking(params.userId, params.customerId, ApiOperationType.GET_KEYWORD_IDEAS, '/api/keyword-planner/ideas', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/keyword-planner/ideas`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      keywords: params.keywords,
      language: params.language,
      geo_target_constants: params.geoTargetConstants,
      page_url: params.pageUrl,
    })
    return response.data
  })
}

/**
 * 执行 GAQL 查询（服务账号模式）
 */
export async function executeGAQLQueryPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  query: string
}): Promise<any> {
  return withTracking(params.userId, params.customerId, ApiOperationType.SEARCH, '/api/google-ads/query', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/query`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      query: params.query,
    })
    return response.data
  })
}

/**
 * 获取可访问的客户账户列表（服务账号模式）
 */
export async function listAccessibleCustomersPython(params: {
  userId: number
  serviceAccountId?: string
}): Promise<string[]> {
  const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)

  const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/list-accessible-customers`, {
    service_account: serviceAccount,
  })

  return response.data.resource_names
}

/**
 * 创建广告系列预算（服务账号模式）
 */
export async function createCampaignBudgetPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  name: string
  amountMicros: number
  deliveryMethod: 'STANDARD' | 'ACCELERATED'
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign-budget/create', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign-budget/create`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      name: params.name,
      amount_micros: params.amountMicros,
      delivery_method: params.deliveryMethod,
    })
    return response.data.resource_name
  })
}

/**
 * 创建广告系列（服务账号模式）
 */
export async function createCampaignPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  name: string
  budgetResourceName: string
  status: 'ENABLED' | 'PAUSED'
  biddingStrategyType: string
  cpcBidCeilingMicros?: number
  targetCountry?: string
  targetLanguage?: string
  startDate?: string
  endDate?: string
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/create', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/create`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      name: params.name,
      budget_resource_name: params.budgetResourceName,
      status: params.status,
      bidding_strategy_type: params.biddingStrategyType,
      cpc_bid_ceiling_micros: params.cpcBidCeilingMicros,
      target_country: params.targetCountry,
      target_language: params.targetLanguage,
      start_date: params.startDate,
      end_date: params.endDate,
    })
    return response.data.resource_name
  })
}

/**
 * 创建广告组（服务账号模式）
 */
export async function createAdGroupPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  name: string
  status: 'ENABLED' | 'PAUSED'
  cpcBidMicros?: number
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/ad-group/create', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/ad-group/create`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      name: params.name,
      status: params.status,
      cpc_bid_micros: params.cpcBidMicros,
    })
    return response.data.resource_name
  })
}

/**
 * 批量创建关键词（服务账号模式）
 */
export async function createKeywordsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  adGroupResourceName: string
  keywords: Array<{
    text: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    status: 'ENABLED' | 'PAUSED'
    finalUrl?: string
    isNegative?: boolean
  }>
}): Promise<string[]> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE_BATCH, '/api/google-ads/keywords/create', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/keywords/create`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      ad_group_resource_name: params.adGroupResourceName,
      keywords: params.keywords.map(kw => ({
        text: kw.text,
        match_type: kw.matchType,
        status: kw.status,
        final_url: kw.finalUrl,
        is_negative: kw.isNegative || false,
      })),
    })
    return response.data.results.map((r: any) => r.resource_name)
  })
}

/**
 * 创建响应式搜索广告（服务账号模式）
 */
export async function createResponsiveSearchAdPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  adGroupResourceName: string
  headlines: string[]
  descriptions: string[]
  finalUrls: string[]
  path1?: string
  path2?: string
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/responsive-search-ad/create', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/responsive-search-ad/create`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      ad_group_resource_name: params.adGroupResourceName,
      headlines: params.headlines,
      descriptions: params.descriptions,
      final_urls: params.finalUrls,
      path1: params.path1,
      path2: params.path2,
    })
    return response.data.resource_name
  })
}

/**
 * 更新广告系列状态（服务账号模式）
 */
export async function updateCampaignStatusPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  status: 'ENABLED' | 'PAUSED'
}): Promise<void> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/update-status', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/update-status`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      status: params.status,
    })
  })
}

/**
 * 更新广告系列预算（服务账号模式）
 */
export async function updateCampaignBudgetPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  budgetAmountMicros: number
}): Promise<void> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/update-budget', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/update-budget`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      budget_amount_micros: params.budgetAmountMicros,
    })
  })
}

/**
 * 创建附加宣传信息（服务账号模式）
 */
export async function createCalloutExtensionsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  calloutTexts: string[]
}): Promise<string[]> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE_BATCH, '/api/google-ads/callout-extensions/create', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/callout-extensions/create`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      callout_texts: params.calloutTexts,
    })
    return response.data.asset_resource_names
  })
}

/**
 * 创建附加链接（服务账号模式）
 */
export async function createSitelinkExtensionsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  sitelinks: Array<{
    linkText: string
    finalUrl: string
    description1?: string
    description2?: string
  }>
}): Promise<string[]> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE_BATCH, '/api/google-ads/sitelink-extensions/create', async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/sitelink-extensions/create`, {
      service_account: serviceAccount,
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      sitelinks: params.sitelinks.map(sl => ({
        link_text: sl.linkText,
        final_url: sl.finalUrl,
        description1: sl.description1,
        description2: sl.description2,
      })),
    })
    return response.data.asset_resource_names
  })
}

// ==================== Conversion Goal Functions Removed ====================
//
// 🔧 移除说明 (2025-12-26):
// - ensureConversionGoalPython: 确保转化目标存在（服务账号模式）
// - updateCampaignConversionGoalPython: 更新CampaignConversionGoal的biddable状态
//
// 原因: 对应的Node.js函数ensureAccountConversionGoal已移除，这些函数不再使用

