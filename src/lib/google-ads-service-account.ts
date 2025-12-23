import { JWT } from 'google-auth-library'
import { getDatabase } from './db'
import { decrypt } from './crypto'
import { getGoogleAdsClient } from './google-ads-api'

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
 */
export async function getUnifiedGoogleAdsClient(config: {
  customerId: string
  credentials: {
    client_id: string
    client_secret: string
    developer_token: string
  }
  authConfig: UnifiedAuthConfig
}): Promise<any> {
  const { authConfig, credentials } = config

  if (authConfig.authType === 'service_account') {
    // 服务账号认证
    const serviceAccount = await getServiceAccountConfig(authConfig.userId, authConfig.serviceAccountId)
    if (!serviceAccount) {
      throw new Error('Service account configuration not found')
    }

    const accessToken = await getServiceAccountAccessToken({
      clientEmail: serviceAccount.serviceAccountEmail,
      privateKey: serviceAccount.privateKey || '',
      mccCustomerId: serviceAccount.mccCustomerId,
      developerToken: serviceAccount.developerToken
    })

    const client = getGoogleAdsClient(credentials)
    return client.Customer({
      customer_id: config.customerId,
      refresh_token: accessToken,
      login_customer_id: serviceAccount.mccCustomerId,
    })
  } else {
    // OAuth 认证 - 从数据库获取完整的OAuth凭证
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
