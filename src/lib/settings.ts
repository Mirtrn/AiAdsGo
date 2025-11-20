import { getDatabase } from './db'
import { encrypt, decrypt } from './crypto'

export interface SystemSetting {
  id: number
  user_id: number | null
  category: string
  config_key: string
  config_value: string | null
  encrypted_value: string | null
  data_type: string
  is_sensitive: number
  is_required: number
  validation_status: string | null
  validation_message: string | null
  last_validated_at: string | null
  default_value: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface SettingValue {
  category: string
  key: string
  value: string | null
  dataType: string
  isSensitive: boolean
  isRequired: boolean
  validationStatus?: string | null
  validationMessage?: string | null
  lastValidatedAt?: string | null
  description?: string | null
}

/**
 * 获取所有系统配置（包括全局和用户级）
 * 优先级：用户配置 > 全局配置
 */
export function getAllSettings(userId?: number): SettingValue[] {
  const db = getDatabase()

  const query = userId
    ? 'SELECT * FROM system_settings WHERE user_id IS NULL OR user_id = ? ORDER BY category, config_key'
    : 'SELECT * FROM system_settings WHERE user_id IS NULL ORDER BY category, config_key'

  const params = userId ? [userId] : []
  const settings = db.prepare(query).all(...params) as SystemSetting[]

  // 去重：对于同一个 (category, config_key) 组合，优先使用用户配置
  const settingsMap = new Map<string, SystemSetting>()
  for (const setting of settings) {
    const key = `${setting.category}:${setting.config_key}`
    const existing = settingsMap.get(key)

    // 如果不存在，或者当前是用户配置（优先级更高），则更新
    if (!existing || setting.user_id !== null) {
      settingsMap.set(key, setting)
    }
  }

  // 转换为返回格式
  return Array.from(settingsMap.values()).map(setting => ({
    category: setting.category,
    key: setting.config_key,
    value: setting.is_sensitive && setting.encrypted_value
      ? decrypt(setting.encrypted_value)
      : setting.config_value,
    dataType: setting.data_type,
    isSensitive: setting.is_sensitive === 1,
    isRequired: setting.is_required === 1,
    validationStatus: setting.validation_status,
    validationMessage: setting.validation_message,
    lastValidatedAt: setting.last_validated_at,
    description: setting.description,
  }))
}

/**
 * 获取指定分类的配置
 * 优先级：用户配置 > 全局配置
 */
export function getSettingsByCategory(category: string, userId?: number): SettingValue[] {
  const db = getDatabase()

  const query = userId
    ? 'SELECT * FROM system_settings WHERE category = ? AND (user_id IS NULL OR user_id = ?) ORDER BY config_key'
    : 'SELECT * FROM system_settings WHERE category = ? AND user_id IS NULL ORDER BY config_key'

  const params = userId ? [category, userId] : [category]
  const settings = db.prepare(query).all(...params) as SystemSetting[]

  // 去重：对于同一个 config_key，优先使用用户配置
  const settingsMap = new Map<string, SystemSetting>()
  for (const setting of settings) {
    const existing = settingsMap.get(setting.config_key)

    // 如果不存在，或者当前是用户配置（优先级更高），则更新
    if (!existing || setting.user_id !== null) {
      settingsMap.set(setting.config_key, setting)
    }
  }

  // 转换为返回格式
  return Array.from(settingsMap.values()).map(setting => ({
    category: setting.category,
    key: setting.config_key,
    value: setting.is_sensitive && setting.encrypted_value
      ? decrypt(setting.encrypted_value)
      : setting.config_value,
    dataType: setting.data_type,
    isSensitive: setting.is_sensitive === 1,
    isRequired: setting.is_required === 1,
    validationStatus: setting.validation_status,
    validationMessage: setting.validation_message,
    lastValidatedAt: setting.last_validated_at,
    description: setting.description,
  }))
}

/**
 * 获取单个配置项
 */
export function getSetting(category: string, key: string, userId?: number): SettingValue | null {
  const db = getDatabase()

  const query = userId
    ? 'SELECT * FROM system_settings WHERE category = ? AND config_key = ? AND (user_id IS NULL OR user_id = ?) ORDER BY user_id DESC LIMIT 1'
    : 'SELECT * FROM system_settings WHERE category = ? AND config_key = ? AND user_id IS NULL LIMIT 1'

  const params = userId ? [category, key, userId] : [category, key]
  const setting = db.prepare(query).get(...params) as SystemSetting | undefined

  if (!setting) return null

  return {
    category: setting.category,
    key: setting.config_key,
    value: setting.is_sensitive && setting.encrypted_value
      ? decrypt(setting.encrypted_value)
      : setting.config_value,
    dataType: setting.data_type,
    isSensitive: setting.is_sensitive === 1,
    isRequired: setting.is_required === 1,
    validationStatus: setting.validation_status,
    validationMessage: setting.validation_message,
    lastValidatedAt: setting.last_validated_at,
    description: setting.description,
  }
}

/**
 * 更新配置项
 */
export function updateSetting(
  category: string,
  key: string,
  value: string,
  userId?: number
): void {
  const db = getDatabase()

  // 获取配置元数据
  const metadata = db.prepare(`
    SELECT * FROM system_settings
    WHERE category = ? AND config_key = ? AND user_id IS NULL
    LIMIT 1
  `).get(category, key) as SystemSetting | undefined

  if (!metadata) {
    throw new Error(`配置项不存在: ${category}.${key}`)
  }

  // 确定是否需要加密
  const isSensitive = metadata.is_sensitive === 1
  const configValue = isSensitive ? null : value
  const encryptedValue = isSensitive ? encrypt(value) : null

  // 检查是否已存在用户级配置
  if (userId) {
    const userSetting = db.prepare(`
      SELECT id FROM system_settings
      WHERE category = ? AND config_key = ? AND user_id = ?
    `).get(category, key, userId) as { id: number } | undefined

    if (userSetting) {
      // 更新现有用户配置
      db.prepare(`
        UPDATE system_settings
        SET config_value = ?, encrypted_value = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(configValue, encryptedValue, userSetting.id)
    } else {
      // 创建新的用户配置
      db.prepare(`
        INSERT INTO system_settings (
          user_id, category, config_key, config_value, encrypted_value,
          data_type, is_sensitive, is_required, description
        )
        SELECT ?, category, config_key, ?, ?, data_type, is_sensitive, is_required, description
        FROM system_settings
        WHERE category = ? AND config_key = ? AND user_id IS NULL
      `).run(userId, configValue, encryptedValue, category, key)
    }
  } else {
    // 更新全局配置
    db.prepare(`
      UPDATE system_settings
      SET config_value = ?, encrypted_value = ?, updated_at = datetime('now')
      WHERE category = ? AND config_key = ? AND user_id IS NULL
    `).run(configValue, encryptedValue, category, key)
  }
}

/**
 * 批量更新配置
 */
export function updateSettings(
  updates: Array<{ category: string; key: string; value: string }>,
  userId?: number
): void {
  const db = getDatabase()

  const transaction = db.transaction(() => {
    for (const update of updates) {
      updateSetting(update.category, update.key, update.value, userId)
    }
  })

  transaction()
}

/**
 * 更新配置验证状态
 */
export function updateValidationStatus(
  category: string,
  key: string,
  status: 'valid' | 'invalid' | 'pending',
  message?: string,
  userId?: number
): void {
  const db = getDatabase()

  const query = userId
    ? `UPDATE system_settings
       SET validation_status = ?, validation_message = ?, last_validated_at = datetime('now'), updated_at = datetime('now')
       WHERE category = ? AND config_key = ? AND user_id = ?`
    : `UPDATE system_settings
       SET validation_status = ?, validation_message = ?, last_validated_at = datetime('now'), updated_at = datetime('now')
       WHERE category = ? AND config_key = ? AND user_id IS NULL`

  const params = userId
    ? [status, message || null, category, key, userId]
    : [status, message || null, category, key]

  db.prepare(query).run(...params)
}

/**
 * 验证结果缓存
 * 结构: Map<credentialsHash, { result, timestamp }>
 */
interface ValidationCacheEntry {
  result: { valid: boolean; message: string }
  timestamp: number
}

const validationCache = new Map<string, ValidationCacheEntry>()
const CACHE_TTL = 15 * 60 * 1000 // 15分钟缓存

/**
 * 生成credentials的哈希key（用于缓存）
 */
function generateCredentialsHash(
  clientId: string,
  clientSecret: string,
  developerToken: string
): string {
  // 简单的哈希：使用前10个字符避免完整存储敏感信息
  const hash = `${clientId.substring(0, 20)}_${clientSecret.substring(0, 10)}_${developerToken.substring(0, 10)}`
  return hash
}

/**
 * 清理过期的缓存条目
 */
function cleanExpiredCache(): void {
  const now = Date.now()
  for (const [key, entry] of validationCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      validationCache.delete(key)
    }
  }
}

/**
 * 验证Google Ads API配置
 *
 * 验证步骤：
 * 1. 检查缓存
 * 2. 基础格式验证
 * 3. 尝试创建GoogleAdsApi实例
 * 4. 验证OAuth配置（可选：测试client credentials）
 * 5. 缓存成功结果
 */
export async function validateGoogleAdsConfig(
  clientId: string,
  clientSecret: string,
  developerToken: string
): Promise<{ valid: boolean; message: string }> {
  try {
    // 清理过期缓存
    cleanExpiredCache()

    // 检查缓存
    const cacheKey = generateCredentialsHash(clientId, clientSecret, developerToken)
    const cached = validationCache.get(cacheKey)
    if (cached) {
      const age = Date.now() - cached.timestamp
      if (age < CACHE_TTL) {
        console.log(`[Google Ads验证] 使用缓存结果 (缓存时间: ${Math.floor(age / 1000)}秒前)`)
        return cached.result
      }
    }

    // Step 1: 基础验证
    if (!clientId || !clientSecret || !developerToken) {
      return {
        valid: false,
        message: '所有字段都是必填的',
      }
    }

    // Step 2: 格式验证
    // Client ID格式: xxx.apps.googleusercontent.com
    if (!clientId.includes('.apps.googleusercontent.com')) {
      return {
        valid: false,
        message: 'Client ID格式不正确，应包含 .apps.googleusercontent.com',
      }
    }

    // Client Secret格式验证
    if (clientSecret.length < 20) {
      return {
        valid: false,
        message: 'Client Secret格式不正确，长度过短',
      }
    }

    // Developer Token格式验证（通常是32位字符，可能包含-）
    if (developerToken.length < 20) {
      return {
        valid: false,
        message: 'Developer Token格式不正确，长度过短',
      }
    }

    // Step 3: 尝试创建GoogleAdsApi实例（验证配置能否被库接受）
    try {
      const { GoogleAdsApi } = await import('google-ads-api')

      const testClient = new GoogleAdsApi({
        client_id: clientId,
        client_secret: clientSecret,
        developer_token: developerToken,
      })

      // 如果能成功创建实例，说明配置格式被google-ads-api库接受
      if (!testClient) {
        return {
          valid: false,
          message: '无法创建Google Ads API客户端',
        }
      }
    } catch (error: any) {
      return {
        valid: false,
        message: `Google Ads API客户端创建失败: ${error.message}`,
      }
    }

    // Step 4: 验证OAuth URL能否正确生成
    try {
      const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-ads/callback`

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/adwords',
        access_type: 'offline',
        prompt: 'consent',
      })

      const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

      // 验证URL格式
      new URL(oauthUrl)
    } catch (error: any) {
      return {
        valid: false,
        message: `OAuth URL生成失败: ${error.message}`,
      }
    }

    // Step 5: 可选 - 验证client credentials（测试client_id和client_secret是否有效）
    // 注意：这个步骤会实际调用Google OAuth服务器
    try {
      const testTokenEndpoint = 'https://oauth2.googleapis.com/token'

      // 使用无效的授权码尝试，如果client_id/client_secret无效，会返回特定错误
      const testResponse = await fetch(testTokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: 'invalid_code_for_testing',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-ads/callback`,
          grant_type: 'authorization_code',
        }),
      })

      const testResult = await testResponse.json()

      // 分析错误类型
      if (testResult.error === 'invalid_client') {
        return {
          valid: false,
          message: 'Client ID或Client Secret无效，请检查配置',
        }
      }

      // 其他错误（如invalid_grant）说明client凭证是有效的
      // 只是授权码无效，这是预期行为
    } catch (error: any) {
      // 网络错误或其他问题，不影响验证结果
      console.warn('OAuth服务器测试失败（不影响验证）:', error.message)
    }

    // 所有验证通过
    const successResult = {
      valid: true,
      message: '✅ 配置验证通过！下一步请进行Google Ads账号授权。',
    }

    // 缓存成功结果
    validationCache.set(cacheKey, {
      result: successResult,
      timestamp: Date.now(),
    })
    console.log(`[Google Ads验证] 验证成功，结果已缓存 (TTL: ${CACHE_TTL / 1000}秒)`)

    return successResult
  } catch (error: any) {
    return {
      valid: false,
      message: `验证失败: ${error.message}`,
    }
  }
}

/**
 * 验证Gemini API密钥和模型（直接API模式）
 */
export async function validateGeminiConfig(
  apiKey: string,
  model: string = 'gemini-2.5-pro'
): Promise<{ valid: boolean; message: string }> {
  // Step 1: 基础验证
  if (!apiKey) {
    return {
      valid: false,
      message: 'API密钥不能为空',
    }
  }

  if (apiKey.length < 20) {
    return {
      valid: false,
      message: 'API密钥格式不正确',
    }
  }

  // Step 2: 验证模型名称
  const validModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3-pro-preview-11-2025']
  if (!validModels.includes(model)) {
    return {
      valid: false,
      message: `不支持的模型: ${model}。支持的模型: ${validModels.join(', ')}`,
    }
  }

  // Step 3: 实际API测试
  try {
    const { generateContent } = await import('./gemini-axios')

    // 使用选择的模型进行测试
    // 注意：Gemini 2.5 模型有"思考"功能，需要更多tokens
    await generateContent({
      model: model,
      prompt: 'Say "OK" if you can hear me.',
      temperature: 0.1,
      maxOutputTokens: 200, // Gemini 2.5 模型的思考过程需要更多tokens
    })

    return {
      valid: true,
      message: `✅ ${model} 模型验证成功（直接API模式），连接正常`,
    }
  } catch (error: any) {
    // API调用失败，分析错误类型
    const errorMessage = error.message || '未知错误'

    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('invalid key') || errorMessage.includes('400')) {
      return {
        valid: false,
        message: 'API密钥无效，请检查密钥是否正确',
      }
    }

    if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      return {
        valid: false,
        message: 'API密钥配额已用尽或达到速率限制',
      }
    }

    if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      return {
        valid: false,
        message: '网络连接失败，请检查代理配置或稍后重试',
      }
    }

    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return {
        valid: false,
        message: `模型 ${model} 不可用或不存在`,
      }
    }

    return {
      valid: false,
      message: `API验证失败: ${errorMessage}`,
    }
  }
}

/**
 * 验证Vertex AI配置
 */
export async function validateVertexAIConfig(
  gcpProjectId: string,
  gcpLocation: string,
  gcpServiceAccountJson: string
): Promise<{ valid: boolean; message: string }> {
  // Step 1: 基础验证
  if (!gcpProjectId || !gcpServiceAccountJson) {
    return {
      valid: false,
      message: 'GCP项目ID和Service Account JSON不能为空',
    }
  }

  // Step 2: 验证Service Account JSON格式
  try {
    const serviceAccount = JSON.parse(gcpServiceAccountJson)

    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
      return {
        valid: false,
        message: 'Service Account JSON格式不正确，缺少必要字段',
      }
    }

    // 验证项目ID是否匹配
    if (serviceAccount.project_id !== gcpProjectId) {
      return {
        valid: false,
        message: `项目ID不匹配。JSON中的项目ID: ${serviceAccount.project_id}`,
      }
    }
  } catch (error) {
    return {
      valid: false,
      message: 'Service Account JSON格式无效，请检查JSON格式',
    }
  }

  // Step 3: 实际API测试
  try {
    // 临时设置环境变量进行测试
    const originalProjectId = process.env.GCP_PROJECT_ID
    const originalLocation = process.env.GCP_LOCATION
    const originalCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS

    process.env.GCP_PROJECT_ID = gcpProjectId
    process.env.GCP_LOCATION = gcpLocation || 'us-central1'

    // 写入临时凭证文件
    const fs = await import('fs')
    const path = await import('path')
    const os = await import('os')

    const tempDir = os.tmpdir()
    const credentialsPath = path.join(tempDir, `gcp-sa-test-${Date.now()}.json`)

    fs.writeFileSync(credentialsPath, gcpServiceAccountJson, 'utf8')
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath

    try {
      // 清除模块缓存，确保使用新的环境变量
      const modulePath = require.resolve('./gemini-vertex')
      delete require.cache[modulePath]

      const { checkVertexAIConnection } = await import('./gemini-vertex')

      const connected = await checkVertexAIConnection()

      // 恢复原始环境变量
      if (originalProjectId) process.env.GCP_PROJECT_ID = originalProjectId
      if (originalLocation) process.env.GCP_LOCATION = originalLocation
      if (originalCredentials) process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentials

      // 删除临时文件
      try {
        fs.unlinkSync(credentialsPath)
      } catch (e) {
        // 忽略删除错误
      }

      if (connected) {
        return {
          valid: true,
          message: `✅ Vertex AI配置验证成功，连接正常`,
        }
      } else {
        return {
          valid: false,
          message: 'Vertex AI连接失败，请检查配置',
        }
      }
    } catch (testError: any) {
      // 恢复原始环境变量
      if (originalProjectId) process.env.GCP_PROJECT_ID = originalProjectId
      if (originalLocation) process.env.GCP_LOCATION = originalLocation
      if (originalCredentials) process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentials

      // 删除临时文件
      try {
        fs.unlinkSync(credentialsPath)
      } catch (e) {
        // 忽略删除错误
      }

      throw testError
    }
  } catch (error: any) {
    const errorMessage = error.message || '未知错误'

    if (errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('permission')) {
      return {
        valid: false,
        message: 'Service Account权限不足，请确保有Vertex AI访问权限',
      }
    }

    if (errorMessage.includes('INVALID_ARGUMENT') || errorMessage.includes('invalid')) {
      return {
        valid: false,
        message: 'Vertex AI配置参数无效，请检查项目ID和区域设置',
      }
    }

    if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      return {
        valid: false,
        message: 'Vertex AI配额已用尽或达到速率限制',
      }
    }

    return {
      valid: false,
      message: `Vertex AI验证失败: ${errorMessage}`,
    }
  }
}

// 代理URL配置项接口
interface ProxyUrlConfig {
  country: string
  url: string
}

/**
 * 获取指定国家的代理URL
 * 如果没有找到对应国家的代理，返回第一个配置的URL作为兜底
 *
 * @param targetCountry - 目标国家代码 (如 'US', 'UK', 'DE' 等)
 * @param userId - 用户ID
 * @returns 代理URL或undefined（如果未配置代理）
 */
export function getProxyUrlForCountry(targetCountry: string, userId?: number): string | undefined {
  const setting = getSetting('proxy', 'urls', userId)

  if (!setting?.value) {
    return undefined
  }

  try {
    const proxyUrls: ProxyUrlConfig[] = JSON.parse(setting.value)

    if (!Array.isArray(proxyUrls) || proxyUrls.length === 0) {
      return undefined
    }

    // 查找匹配的国家
    const countryUpper = targetCountry.toUpperCase()
    const matched = proxyUrls.find(item =>
      item.country.toUpperCase() === countryUpper
    )

    if (matched) {
      return matched.url
    }

    // 没有找到匹配的国家，返回第一个作为兜底
    return proxyUrls[0].url
  } catch {
    return undefined
  }
}

/**
 * 检查是否启用了代理
 * 只要配置了有效的代理URL即代表启用
 *
 * @param userId - 用户ID
 * @returns 是否启用代理
 */
export function isProxyEnabled(userId?: number): boolean {
  const setting = getSetting('proxy', 'urls', userId)

  if (!setting?.value) {
    return false
  }

  try {
    const proxyUrls: ProxyUrlConfig[] = JSON.parse(setting.value)
    return Array.isArray(proxyUrls) && proxyUrls.length > 0 && proxyUrls.some(item => item.url.trim() !== '')
  } catch {
    return false
  }
}

/**
 * 获取所有配置的代理URL列表
 *
 * @param userId - 用户ID
 * @returns 代理URL配置列表
 */
export function getAllProxyUrls(userId?: number): ProxyUrlConfig[] {
  const setting = getSetting('proxy', 'urls', userId)

  if (!setting?.value) {
    return []
  }

  try {
    const proxyUrls: ProxyUrlConfig[] = JSON.parse(setting.value)
    return Array.isArray(proxyUrls) ? proxyUrls : []
  } catch {
    return []
  }
}
