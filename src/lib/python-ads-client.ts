/**
 * Python Google Ads Service 客户端
 * 用于服务账号模式的 Google Ads API 调用
 */
import axios from 'axios'
import { getServiceAccountConfig } from './google-ads-service-account'

const PYTHON_SERVICE_URL = process.env.PYTHON_ADS_SERVICE_URL || 'http://localhost:8001'

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
  const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)

  const response = await axios.post(`${PYTHON_SERVICE_URL}/api/keyword-planner/historical-metrics`, {
    service_account: serviceAccount,
    customer_id: params.customerId,
    keywords: params.keywords,
    language: params.language,
    geo_target_constants: params.geoTargetConstants,
  })

  return response.data
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
  const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)

  const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/query`, {
    service_account: serviceAccount,
    customer_id: params.customerId,
    query: params.query,
  })

  return response.data
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
