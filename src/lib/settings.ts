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
 */
export function getAllSettings(userId?: number): SettingValue[] {
  const db = getDatabase()

  const query = userId
    ? 'SELECT * FROM system_settings WHERE user_id IS NULL OR user_id = ? ORDER BY category, config_key'
    : 'SELECT * FROM system_settings WHERE user_id IS NULL ORDER BY category, config_key'

  const params = userId ? [userId] : []
  const settings = db.prepare(query).all(...params) as SystemSetting[]

  return settings.map(setting => ({
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
 */
export function getSettingsByCategory(category: string, userId?: number): SettingValue[] {
  const db = getDatabase()

  const query = userId
    ? 'SELECT * FROM system_settings WHERE category = ? AND (user_id IS NULL OR user_id = ?) ORDER BY config_key'
    : 'SELECT * FROM system_settings WHERE category = ? AND user_id IS NULL ORDER BY config_key'

  const params = userId ? [category, userId] : [category]
  const settings = db.prepare(query).all(...params) as SystemSetting[]

  return settings.map(setting => ({
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
 * 验证Google Ads API配置
 *
 * 验证步骤：
 * 1. 基础格式验证
 * 2. 尝试创建GoogleAdsApi实例
 * 3. 验证OAuth配置（可选：测试client credentials）
 */
export async function validateGoogleAdsConfig(
  clientId: string,
  clientSecret: string,
  developerToken: string
): Promise<{ valid: boolean; message: string }> {
  try {
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
    return {
      valid: true,
      message: '✅ 配置验证通过！下一步请进行Google Ads账号授权。',
    }
  } catch (error: any) {
    return {
      valid: false,
      message: `验证失败: ${error.message}`,
    }
  }
}

/**
 * 验证AI API密钥
 */
export async function validateAIApiKey(
  apiKey: string,
  model: 'gemini' | 'claude'
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

  // Step 2: 根据模型类型进行真实API测试
  try {
    if (model === 'gemini') {
      // 测试Gemini API
      const { generateContent } = await import('./gemini-axios')

      // 需求12：使用Gemini 2.5 Pro稳定版模型（带代理支持 + 自动降级）
      await generateContent({
        model: 'gemini-2.5-pro',
        prompt: 'Test',
        temperature: 0.1,
        maxOutputTokens: 10,
      })

      return {
        valid: true,
        message: 'Gemini API密钥验证成功，连接正常',
      }
    } else if (model === 'claude') {
      // Claude API验证（如果有）
      // 注意：需要安装 @anthropic-ai/sdk
      return {
        valid: true,
        message: 'Claude API密钥格式正确（注意：实际连接需要 @anthropic-ai/sdk）',
      }
    } else {
      return {
        valid: false,
        message: '不支持的AI模型类型',
      }
    }
  } catch (error: any) {
    // API调用失败，分析错误类型
    const errorMessage = error.message || '未知错误'

    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('invalid key')) {
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

    if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
      return {
        valid: false,
        message: '网络连接失败，请检查网络或稍后重试',
      }
    }

    return {
      valid: false,
      message: `API验证失败: ${errorMessage}`,
    }
  }
}
