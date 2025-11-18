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
 */
export async function validateGoogleAdsConfig(
  clientId: string,
  clientSecret: string,
  developerToken: string
): Promise<{ valid: boolean; message: string }> {
  // TODO: 实现真实的Google Ads API验证
  // 这里应该调用Google Ads API进行测试连接
  // 暂时返回简单验证
  if (!clientId || !clientSecret || !developerToken) {
    return {
      valid: false,
      message: '所有字段都是必填的',
    }
  }

  // 简单格式验证
  if (clientId.length < 10 || clientSecret.length < 10 || developerToken.length < 10) {
    return {
      valid: false,
      message: '配置格式不正确',
    }
  }

  return {
    valid: true,
    message: '配置验证通过（注意：需要实际API测试）',
  }
}

/**
 * 验证AI API密钥
 */
export async function validateAIApiKey(
  apiKey: string,
  model: 'gemini' | 'claude'
): Promise<{ valid: boolean; message: string }> {
  // TODO: 实现真实的AI API验证
  // 这里应该调用Gemini或Claude API进行测试
  // 暂时返回简单验证
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

  return {
    valid: true,
    message: `${model} API密钥验证通过（注意：需要实际API测试）`,
  }
}
