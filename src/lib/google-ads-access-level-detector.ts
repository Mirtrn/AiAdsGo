/**
 * Google Ads API 访问级别检测器
 * 通过实际调用API来检测Developer Token的访问级别
 */

import { getDatabase } from './db'
import { getGoogleAdsClient } from './google-ads-api'

export type ApiAccessLevel = 'test' | 'explorer' | 'basic' | 'standard'

interface AccessLevelDetectionResult {
  level: ApiAccessLevel
  detectedAt: string
  method: 'api_call' | 'error_pattern' | 'default'
  details?: string
}

/**
 * 从错误消息中检测访问级别
 */
function detectLevelFromError(errorMessage: string): ApiAccessLevel | null {
  const msg = errorMessage.toLowerCase()

  // Test access: 只能访问测试账号
  if (
    msg.includes('only approved for use with test accounts') ||
    msg.includes('developer token is only approved for test') ||
    (msg.includes('developer token') && msg.includes('test') && msg.includes('not approved'))
  ) {
    return 'test'
  }

  // 如果明确提到需要申请Basic或Standard，说明当前是Explorer或Test
  if (msg.includes('apply for basic') || msg.includes('apply for standard')) {
    // 如果同时提到test account，则是test级别
    if (msg.includes('test account')) {
      return 'test'
    }
    // 否则可能是explorer
    return 'explorer'
  }

  return null
}

/**
 * 通过API调用检测访问级别
 * 策略：尝试调用一个简单的API，根据响应判断访问级别
 */
export async function detectApiAccessLevel(userId: number): Promise<AccessLevelDetectionResult> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  // 先读取数据库中已存储的访问级别，避免自动检测降级覆盖用户手动设置的更高权限
  let storedLevel: ApiAccessLevel | null = null
  try {
    const credRow = await db.queryOne<{ api_access_level?: string }>(
      `SELECT api_access_level FROM google_ads_credentials WHERE user_id = ? LIMIT 1`,
      [userId]
    )
    if (credRow?.api_access_level) {
      storedLevel = credRow.api_access_level as ApiAccessLevel
    } else {
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
      const saRow = await db.queryOne<{ api_access_level?: string }>(
        `SELECT api_access_level FROM google_ads_service_accounts WHERE user_id = ? AND ${isActiveCondition} LIMIT 1`,
        [userId]
      )
      if (saRow?.api_access_level) {
        storedLevel = saRow.api_access_level as ApiAccessLevel
      }
    }
  } catch (_) {
    // 忽略读取错误，继续检测
  }

  // 如果已存储 basic 或 standard，API 成功调用时不降级
  const isHigherThanExplorer = storedLevel === 'basic' || storedLevel === 'standard'

  try {
    // 获取用户的 Google Ads 凭证
    const credentials = await db.queryOne<{
      client_id: string
      client_secret: string
      developer_token: string
      refresh_token: string
    }>(`
      SELECT client_id, client_secret, developer_token, refresh_token
      FROM google_ads_credentials
      WHERE user_id = ?
    `, [userId])

    if (!credentials) {
      throw new Error('未找到 Google Ads 凭证')
    }

    // 获取Google Ads客户端
    const client = getGoogleAdsClient({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token
    })

    // 尝试获取可访问的客户账户列表
    // 这是一个轻量级的API调用，用于检测权限
    try {
      const response = await client.listAccessibleCustomers(credentials.refresh_token)

      // listAccessibleCustomers 返回 { resource_names: ['customers/123', ...] }
      const resourceNames = response.resource_names || []

      // API 调用成功说明至少有 Explorer 权限。
      // 注意：无法从该 API 响应直接区分 Explorer / Basic / Standard。
      // 若已存储更高权限（basic / standard），保持原值不降级。
      const level: ApiAccessLevel = isHigherThanExplorer ? (storedLevel as ApiAccessLevel) : 'explorer'

      return {
        level,
        detectedAt: now,
        method: 'api_call',
        details: `Successfully listed ${resourceNames.length} accessible customers`
      }
    } catch (apiError: any) {
      // 从错误消息中检测访问级别
      const errorMessage = apiError.message || String(apiError)
      const detectedLevel = detectLevelFromError(errorMessage)

      if (detectedLevel) {
        return {
          level: detectedLevel,
          detectedAt: now,
          method: 'error_pattern',
          details: errorMessage
        }
      }

      // 如果无法从错误中检测，保留已存储的级别或默认 explorer
      const fallbackLevel: ApiAccessLevel = isHigherThanExplorer ? (storedLevel as ApiAccessLevel) : 'explorer'
      console.warn('无法从API错误中检测访问级别，使用当前存储值:', fallbackLevel, '| 原始错误:', errorMessage)
      return {
        level: fallbackLevel,
        detectedAt: now,
        method: 'default',
        details: 'Could not detect from error, using stored/default'
      }
    }
  } catch (error: any) {
    console.error('检测API访问级别失败:', error)

    // 尝试从错误中检测
    const errorMessage = error.message || String(error)
    const detectedLevel = detectLevelFromError(errorMessage)

    if (detectedLevel) {
      return {
        level: detectedLevel,
        detectedAt: now,
        method: 'error_pattern',
        details: errorMessage
      }
    }

    // 保留已存储的级别或默认 explorer
    const fallbackLevel: ApiAccessLevel = isHigherThanExplorer ? (storedLevel as ApiAccessLevel) : 'explorer'
    return {
      level: fallbackLevel,
      detectedAt: now,
      method: 'default',
      details: 'Detection failed, using stored/default'
    }
  }
}

/**
 * API访问级别权重（用于比较高低）
 */
const ACCESS_LEVEL_WEIGHT: Record<ApiAccessLevel, number> = {
  test: 0,
  explorer: 1,
  basic: 2,
  standard: 3,
}

/**
 * 更新用户的API访问级别
 * 🔒 不降级保护：只有新级别 >= 当前存储级别时才更新，防止自动检测将手动设置的高权限覆盖为低权限
 */
export async function updateApiAccessLevel(
  userId: number,
  level: ApiAccessLevel,
  authType: 'oauth' | 'service_account'
): Promise<void> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  // 先读取当前存储的级别，防止降级
  let currentLevel: ApiAccessLevel | null = null
  try {
    if (authType === 'oauth') {
      const row = await db.queryOne<{ api_access_level?: string }>(
        `SELECT api_access_level FROM google_ads_credentials WHERE user_id = ? LIMIT 1`,
        [userId]
      )
      if (row?.api_access_level) {
        currentLevel = row.api_access_level as ApiAccessLevel
      }
    } else {
      const row = await db.queryOne<{ api_access_level?: string }>(
        `SELECT api_access_level FROM google_ads_service_accounts WHERE user_id = ? AND ${isActiveCondition} LIMIT 1`,
        [userId]
      )
      if (row?.api_access_level) {
        currentLevel = row.api_access_level as ApiAccessLevel
      }
    }
  } catch (_) {
    // 读取失败则忽略，继续写入
  }

  // 🔒 不降级检查：如果当前已经是更高级别，不允许降级
  if (currentLevel && ACCESS_LEVEL_WEIGHT[currentLevel] > ACCESS_LEVEL_WEIGHT[level]) {
    console.log(`⚠️ 拒绝降级用户 ${userId} 的API访问级别: ${currentLevel} → ${level}（保持 ${currentLevel}）`)
    return
  }

  if (authType === 'oauth') {
    await db.exec(`
      UPDATE google_ads_credentials
      SET api_access_level = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [level, userId])
  } else {
    await db.exec(`
      UPDATE google_ads_service_accounts
      SET api_access_level = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND ${isActiveCondition}
    `, [level, userId])
  }

  console.log(`✅ 已更新用户 ${userId} 的API访问级别: ${currentLevel ?? 'null'} → ${level}`)
}

/**
 * 自动检测并更新API访问级别
 * 在验证凭证或API调用失败时调用
 */
export async function autoDetectAndUpdateAccessLevel(
  userId: number,
  authType: 'oauth' | 'service_account'
): Promise<ApiAccessLevel> {
  const result = await detectApiAccessLevel(userId)
  await updateApiAccessLevel(userId, result.level, authType)

  console.log(`🔍 自动检测API访问级别:`, {
    userId,
    level: result.level,
    method: result.method,
    details: result.details
  })

  return result.level
}

/**
 * 从错误消息中检测并更新访问级别
 * 用于在API调用失败时快速更新
 */
export async function detectAndUpdateFromError(
  userId: number,
  authType: 'oauth' | 'service_account',
  errorMessage: string
): Promise<ApiAccessLevel | null> {
  const level = detectLevelFromError(errorMessage)

  if (level) {
    await updateApiAccessLevel(userId, level, authType)
    console.log(`🔍 从错误消息检测到API访问级别: ${level}`)
    return level
  }

  return null
}
