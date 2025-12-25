import { JWT } from 'google-auth-library'
import { getDatabase } from './db'
import { decrypt } from './crypto'
import { getGoogleAdsClient } from './google-ads-api'
import { GoogleAds, Customer } from '@htdangkhoa/google-ads'

interface ServiceAccountConfig {
  clientEmail: string
  privateKey: string
  mccCustomerId: string
  developerToken: string
}

interface AccessTokenCache {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, AccessTokenCache>()

/**
 * 获取服务账号配置（从数据库）
 */
export async function getServiceAccountConfig(userId: number, serviceAccountId?: string) {
  const db = await getDatabase()

  let query = `
    SELECT id, name, mcc_customer_id, developer_token, service_account_email, private_key, project_id
    FROM google_ads_service_accounts
    WHERE user_id = ? AND is_active = 1
  `
  const params: any[] = [userId]

  if (serviceAccountId) {
    query += ' AND id = ?'
    params.push(serviceAccountId)
  } else {
    query += ' ORDER BY created_at DESC LIMIT 1'
  }

  const account = await db.queryOne(query, params) as any

  if (!account) return null

  return {
    id: account.id,
    name: account.name,
    mccCustomerId: account.mcc_customer_id,
    developerToken: account.developer_token,
    serviceAccountEmail: account.service_account_email,
    privateKey: decrypt(account.private_key),
    projectId: account.project_id,
  }
}

/**
 * 列出用户的所有服务账号配置
 */
export async function listServiceAccounts(userId: number) {
  const db = await getDatabase()
  const accounts = await db.query(`
    SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at
    FROM google_ads_service_accounts
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [userId])

  return accounts
}

/**
 * 获取服务账号 Access Token（带缓存）
 */
export async function getServiceAccountAccessToken(
  config: ServiceAccountConfig
): Promise<string> {
  const cacheKey = config.clientEmail

  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 300000) {
    return cached.token
  }

  const jwtClient = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: ['https://www.googleapis.com/auth/adwords']
  })

  const tokens = await jwtClient.authorize()
  const accessToken = tokens.access_token

  if (!accessToken) {
    throw new Error('Failed to obtain access token from service account')
  }

  tokenCache.set(cacheKey, {
    token: accessToken,
    expiresAt: Date.now() + 3600000
  })

  return accessToken
}

export function parseServiceAccountJson(jsonContent: string) {
  const data = JSON.parse(jsonContent)

  if (!data.client_email || !data.private_key) {
    throw new Error('Invalid service account JSON: missing client_email or private_key')
  }

  return {
    clientEmail: data.client_email,
    privateKey: data.private_key,
    projectId: data.project_id
  }
}

/**
 * 🆕 创建服务账号客户端（使用 @htdangkhoa/google-ads）
 *
 * @description 用于服务账号认证模式，支持 JWT 认证
 *              注意：使用 GoogleAds 类而非 Customer 类，因为 Customer 没有 search 方法
 * @param config - 服务账号配置
 * @returns GoogleAds 实例（支持 search, mutate 等方法）
 */
export function createServiceAccountCustomer(config: {
  clientEmail: string
  privateKey: string
  developerToken: string
  customerId: string
  loginCustomerId?: string
}): GoogleAds {
  // 创建 JWT 客户端
  // 注意：不能使用 keyFile，因为我们的密钥来自数据库
  // 必须使用 email + key 的方式
  const authClient = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: ['https://www.googleapis.com/auth/adwords'],
  })

  // 使用 @htdangkhoa/google-ads 创建客户端
  // 使用 GoogleAds 类而非 Customer 类，因为 Customer 只有 listAccessibleCustomers 方法
  // 而 GoogleAds 有 search, mutate 等完整方法
  const customer = new GoogleAds({
    auth: authClient as any,  // 类型兼容性问题，运行时正常
    developer_token: config.developerToken,
  }, {
    customer_id: config.customerId,
    login_customer_id: config.loginCustomerId,
  })

  return customer
}

/**
 * 🆕 创建服务账号客户端用于获取可访问账户列表
 *
 * @description 用于调用 listAccessibleCustomers API
 *              注意：Customer 类只有 listAccessibleCustomers 方法，没有 search/mutate
 * @param config - 服务账号配置
 * @returns Customer 实例（仅用于 listAccessibleCustomers）
 */
export function createServiceAccountCustomerClient(config: {
  clientEmail: string
  privateKey: string
  developerToken: string
  customerId: string
  loginCustomerId?: string
}) {
  // 创建 JWT 客户端
  const authClient = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: ['https://www.googleapis.com/auth/adwords'],
  })

  // Customer 类用于 listAccessibleCustomers（获取账户列表）
  const customer = new Customer({
    auth: authClient as any,
    developer_token: config.developerToken,
    customer_id: config.customerId,
    login_customer_id: config.loginCustomerId,
  })

  return customer
}

/**
 * 认证类型
 */
export type AuthType = 'oauth' | 'service_account'

/**
 * 统一认证配置
 */
export interface UnifiedAuthConfig {
  authType: AuthType
  userId: number
  serviceAccountId?: string  // 当authType='service_account'时必填
}

/**
 * 获取统一的 Google Ads 客户端
 * 根据认证类型自动选择 OAuth 或服务账号认证
 *
 * 🔧 修复(2025-12-24): 服务账号模式使用 @htdangkhoa/google-ads 库
 * 原因: google-ads-api 库不支持服务账号（只支持 OAuth refresh_token）
 *
 * @returns 兼容两种认证模式的 Google Ads 客户端
 *   - OAuth 模式: 返回 google-ads-api 的 Customer 实例
 *   - 服务账号模式: 返回 @htdangkhoa/google-ads 的 GoogleAds 实例
 */
export async function getUnifiedGoogleAdsClient(config: {
  customerId: string
  credentials?: {
    client_id: string
    client_secret: string
    developer_token: string
  }
  authConfig: UnifiedAuthConfig
}): Promise<any> {
  const { authConfig, credentials } = config

  if (authConfig.authType === 'service_account') {
    // 🆕 服务账号认证：使用 @htdangkhoa/google-ads（支持 JWT）
    const serviceAccount = await getServiceAccountConfig(authConfig.userId, authConfig.serviceAccountId)
    if (!serviceAccount) {
      throw new Error('Service account configuration not found')
    }

    // 使用 @htdangkhoa/google-ads 的 GoogleAds 类（支持 JWT 认证）
    const { GoogleAds } = await import('@htdangkhoa/google-ads')

    const googleAds = new GoogleAds({
      auth: undefined as any,  // 稍后通过 hack 方式设置
      developer_token: serviceAccount.developerToken,
    }, {
      customer_id: config.customerId,
      login_customer_id: serviceAccount.mccCustomerId,
    })

    // 设置 JWT 认证
    const jwtClient = new JWT({
      email: serviceAccount.serviceAccountEmail,
      key: serviceAccount.privateKey || '',
      scopes: ['https://www.googleapis.com/auth/adwords'],
    })

    console.log(`[ServiceAccount] JWT配置: email=${serviceAccount.serviceAccountEmail}, scopes=adwords`)

    // 通过 hack 方式设置 auth 客户端和 developer_token
    // @htdangkhoa/google-ads 使用 auth.getRequestHeaders() 获取认证头
    ;(googleAds as any).options.auth = jwtClient as any
    // 🔧 修复(2025-12-25): 确保 developer_token 在 options 中
    ;(googleAds as any).options.developer_token = serviceAccount.developerToken

    // 🔍 验证JWT是否能获取token
    try {
      await jwtClient.authorize()
      console.log(`[ServiceAccount] JWT认证成功`)
    } catch (error: any) {
      console.error(`[ServiceAccount] JWT认证失败:`, error.message)
      throw error
    }

    return googleAds
  } else {
    // OAuth 认证 - 需要 credentials 和 refresh_token
    if (!credentials) {
      throw new Error('OAuth 认证需要提供 credentials 参数')
    }

    const { getGoogleAdsCredentials } = await import('./google-ads-oauth')
    const oauthCredentials = await getGoogleAdsCredentials(authConfig.userId)

    if (!oauthCredentials?.refresh_token) {
      throw new Error('OAuth refresh token not found')
    }

    const client = getGoogleAdsClient(credentials)
    return client.Customer({
      customer_id: config.customerId,
      refresh_token: oauthCredentials.refresh_token,
      login_customer_id: oauthCredentials.login_customer_id,
    })
  }
}

/**
 * 获取登录客户ID（MCC账户ID）
 */
export async function getLoginCustomerId(config: {
  authConfig: UnifiedAuthConfig
  oauthCredentials?: {
    login_customer_id: string
  }
}): Promise<string> {
  const { authConfig, oauthCredentials } = config

  if (authConfig.authType === 'service_account') {
    const serviceAccount = await getServiceAccountConfig(authConfig.userId, authConfig.serviceAccountId)
    if (!serviceAccount) {
      throw new Error('Service account configuration not found')
    }
    return serviceAccount.mccCustomerId
  } else {
    return oauthCredentials?.login_customer_id || ''
  }
}
