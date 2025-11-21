import { getDatabase } from './db'

/**
 * Google Ads OAuth凭证接口
 */
export interface GoogleAdsCredentials {
  id: number
  user_id: number
  client_id: string
  client_secret: string
  refresh_token: string
  access_token?: string
  developer_token: string
  login_customer_id?: string
  access_token_expires_at?: string
  is_active: number
  last_verified_at?: string
  created_at: string
  updated_at: string
}

/**
 * 保存或更新Google Ads凭证
 */
export function saveGoogleAdsCredentials(
  userId: number,
  credentials: {
    client_id: string
    client_secret: string
    refresh_token: string
    developer_token: string
    login_customer_id?: string
    access_token?: string
    access_token_expires_at?: string
  }
): GoogleAdsCredentials {
  const db = getDatabase()

  // 检查是否已存在
  const existing = db.prepare(`
    SELECT * FROM google_ads_credentials WHERE user_id = ?
  `).get(userId) as GoogleAdsCredentials | undefined

  if (existing) {
    // 更新现有记录
    db.prepare(`
      UPDATE google_ads_credentials
      SET client_id = ?,
          client_secret = ?,
          refresh_token = ?,
          developer_token = ?,
          login_customer_id = ?,
          access_token = ?,
          access_token_expires_at = ?,
          is_active = 1,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      credentials.client_id,
      credentials.client_secret,
      credentials.refresh_token,
      credentials.developer_token,
      credentials.login_customer_id || null,
      credentials.access_token || null,
      credentials.access_token_expires_at || null,
      userId
    )
  } else {
    // 插入新记录
    db.prepare(`
      INSERT INTO google_ads_credentials (
        user_id, client_id, client_secret, refresh_token,
        developer_token, login_customer_id, access_token, access_token_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      credentials.client_id,
      credentials.client_secret,
      credentials.refresh_token,
      credentials.developer_token,
      credentials.login_customer_id || null,
      credentials.access_token || null,
      credentials.access_token_expires_at || null
    )
  }

  const updated = getGoogleAdsCredentials(userId)
  if (!updated) {
    throw new Error('保存Google Ads凭证失败')
  }

  return updated
}

/**
 * 获取用户的Google Ads凭证
 */
export function getGoogleAdsCredentials(userId: number): GoogleAdsCredentials | null {
  const db = getDatabase()

  const credentials = db.prepare(`
    SELECT * FROM google_ads_credentials
    WHERE user_id = ? AND is_active = 1
  `).get(userId) as GoogleAdsCredentials | undefined

  return credentials || null
}

/**
 * 删除Google Ads凭证
 */
export function deleteGoogleAdsCredentials(userId: number): void {
  const db = getDatabase()

  db.prepare(`
    UPDATE google_ads_credentials
    SET is_active = 0, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId)
}

/**
 * 刷新Access Token
 */
export async function refreshAccessToken(userId: number): Promise<{
  access_token: string
  expires_at: string
}> {
  const credentials = getGoogleAdsCredentials(userId)
  if (!credentials) {
    throw new Error('Google Ads凭证不存在')
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`刷新Access Token失败: ${error}`)
  }

  const data = await tokenResponse.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  // 更新数据库
  const db = getDatabase()
  db.prepare(`
    UPDATE google_ads_credentials
    SET access_token = ?,
        access_token_expires_at = ?,
        updated_at = datetime('now')
    WHERE user_id = ?
  `).run(data.access_token, expiresAt, userId)

  return {
    access_token: data.access_token,
    expires_at: expiresAt,
  }
}

/**
 * 获取有效的Access Token（如果过期则自动刷新）
 */
export async function getValidAccessToken(userId: number): Promise<string> {
  const credentials = getGoogleAdsCredentials(userId)
  if (!credentials) {
    throw new Error('Google Ads凭证不存在')
  }

  // 检查是否需要刷新
  if (!credentials.access_token || !credentials.access_token_expires_at) {
    const refreshed = await refreshAccessToken(userId)
    return refreshed.access_token
  }

  const expiresAt = new Date(credentials.access_token_expires_at)
  const now = new Date()

  // 提前5分钟刷新
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(userId)
    return refreshed.access_token
  }

  return credentials.access_token
}

/**
 * 验证Google Ads凭证是否有效
 */
export async function verifyGoogleAdsCredentials(userId: number): Promise<{
  valid: boolean
  customer_id?: string
  error?: string
}> {
  try {
    const credentials = getGoogleAdsCredentials(userId)
    if (!credentials) {
      return { valid: false, error: '凭证不存在' }
    }

    if (!credentials.refresh_token) {
      return { valid: false, error: '缺少Refresh Token' }
    }

    // 使用 google-ads-api 库验证凭证
    const { getGoogleAdsClient } = await import('./google-ads-api')
    const client = getGoogleAdsClient()

    // 调用 listAccessibleCustomers 测试凭证
    const response = await client.listAccessibleCustomers(credentials.refresh_token)

    // listAccessibleCustomers 返回 { resource_names: ['customers/123', 'customers/456'] }
    const resourceNames = response.resource_names || []

    if (!resourceNames || resourceNames.length === 0) {
      return { valid: false, error: '无可访问的账户' }
    }

    // 从第一个 resource_name 中提取 customer ID (格式: "customers/1234567890")
    const firstCustomerId = resourceNames[0].split('/').pop() || ''

    // 更新验证时间
    const db = getDatabase()
    db.prepare(`
      UPDATE google_ads_credentials
      SET last_verified_at = datetime('now'),
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(userId)

    return {
      valid: true,
      customer_id: firstCustomerId // 返回第一个customer ID
    }

  } catch (error: any) {
    console.error('验证Google Ads凭证失败:', error)
    return {
      valid: false,
      error: error.message || '未知错误'
    }
  }
}

/**
 * 生成OAuth授权URL
 */
export function generateOAuthUrl(
  clientId: string,
  redirectUri: string,
  state?: string
): string {
  const scopes = 'https://www.googleapis.com/auth/adwords'

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent', // 强制显示同意屏幕以获取refresh_token
  })

  if (state) {
    params.append('state', state)
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * 使用授权码交换tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`交换tokens失败: ${error}`)
  }

  const data = await tokenResponse.json()

  if (!data.refresh_token) {
    throw new Error('未获取到refresh_token，请确保使用了access_type=offline和prompt=consent')
  }

  return data
}
