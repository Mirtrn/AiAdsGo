import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getGoogleAdsClient, getCustomer } from '@/lib/google-ads-api'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { decrypt } from '@/lib/crypto'
import { toNumber } from '@/lib/utils'

// 🔧 修复(2025-01-01): PostgreSQL布尔类型兼容性
// 注意：这些常量会在 db.ts 的 convertSqliteSyntax 中转换为实际的 SQL 条件
// PostgreSQL 使用 TRUE/FALSE 布尔值，SQLite 使用 0/1 整数
const IS_DELETED_TRUE = 'IS_DELETED_TRUE'
const IS_DELETED_FALSE = 'IS_DELETED_FALSE'

// Google Ads CustomerStatus 枚举值映射
// 参考: https://developers.google.com/google-ads/api/reference/rpc/latest/CustomerStatusEnum.CustomerStatus
const CustomerStatusMap: Record<number | string, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'ENABLED',
  3: 'CANCELED',
  4: 'SUSPENDED',
  5: 'CLOSED',
  'UNSPECIFIED': 'UNSPECIFIED',
  'UNKNOWN': 'UNKNOWN',
  'ENABLED': 'ENABLED',
  'CANCELED': 'CANCELED',
  'CANCELLED': 'CANCELED', // 兼容英式拼写
  'SUSPENDED': 'SUSPENDED',
  'CLOSED': 'CLOSED',
}

function parseStatus(status: any): string {
  if (status === undefined || status === null) {
    console.log('[DEBUG] parseStatus: status is undefined or null')
    return 'UNKNOWN'
  }

  // 如果是对象，尝试获取枚举值
  if (typeof status === 'object') {
    console.log('[DEBUG] parseStatus: status is object:', JSON.stringify(status))
    // Google Ads API 可能返回 { value: number, name: string } 格式
    if ('value' in status) {
      status = status.value
    } else if ('name' in status) {
      status = status.name
    }
  }

  console.log('[DEBUG] parseStatus: processing status:', status, 'type:', typeof status)

  // 尝试映射
  const mapped = CustomerStatusMap[status]
  if (mapped) {
    console.log('[DEBUG] parseStatus: mapped to:', mapped)
    return mapped
  }

  // 如果是字符串且已经是有效状态，直接返回
  const statusStr = String(status).toUpperCase()
  console.log('[DEBUG] parseStatus: fallback to string:', statusStr)
  return statusStr
}

interface CachedAccount {
  id: number
  customer_id: string
  account_name: string | null
  currency: string
  timezone: string
  is_manager_account: any
  is_active: any
  status: string | null
  test_account: any
  account_balance: number | null
  parent_mcc_id: string | null
  identity_verification_program_status: string | null
  identity_verification_start_deadline_time: string | null
  identity_verification_completion_deadline_time: string | null
  identity_verification_overdue: any
  identity_verification_checked_at: string | null
  last_sync_at: string | null
}

const GOOGLE_ADS_ACCOUNTS_CACHE_MAX_AGE_MS = 60 * 60 * 1000 // 1小时：避免发布流程使用到过期账号信息

// ==========================
// Async refresh state (memory)
// ==========================
// 用于“先返回缓存/部分结果、后台继续同步”的体验优化。
// 注意：这是进程内状态，适用于单实例或粘性会话；多实例场景需要改为DB/Redis存储。
type AccountSyncState = {
  status: 'running' | 'completed' | 'failed'
  startedAtMs: number
  updatedAtMs: number
  errorMessage?: string
}

const ACCOUNT_SYNC_STATE_TTL_MS = 10 * 60 * 1000

function formatErrorMessage(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  const maybeMessage = (value as any)?.message
  if (typeof maybeMessage === 'string') return maybeMessage
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getAccountSyncStateStore(): Map<string, AccountSyncState> {
  const g = globalThis as any
  if (!g.__googleAdsAccountSyncStates) {
    g.__googleAdsAccountSyncStates = new Map<string, AccountSyncState>()
  }
  return g.__googleAdsAccountSyncStates as Map<string, AccountSyncState>
}

function cleanupExpiredSyncStates(store: Map<string, AccountSyncState>) {
  const now = Date.now()
  for (const [key, state] of store.entries()) {
    const age = now - (state.updatedAtMs || state.startedAtMs)
    if (age > ACCOUNT_SYNC_STATE_TTL_MS) store.delete(key)
  }
}

function buildSyncKey(params: {
  userId: number
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string | null
}): string {
  return `${params.userId}:${params.authType}:${params.serviceAccountId || ''}`
}

function parseDbTimestampToMs(value: string | null | undefined) {
  if (!value) return NaN
  // SQLite datetime('now') 常见格式：'YYYY-MM-DD HH:mm:ss'（UTC，无时区标记）
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    return Date.parse(value.replace(' ', 'T') + 'Z')
  }
  return Date.parse(value)
}

function getLatestSyncAtMs(accounts: CachedAccount[]) {
  let latest = NaN
  for (const acc of accounts) {
    const ms = parseDbTimestampToMs(acc.last_sync_at)
    if (!Number.isNaN(ms) && (Number.isNaN(latest) || ms > latest)) latest = ms
  }
  return latest
}

/**
 * 从数据库获取缓存的账号列表
 */
async function getCachedAccounts(userId: number): Promise<CachedAccount[]> {
  const db = await getDatabase()
  return await db.query(`
    SELECT id, customer_id, account_name, currency, timezone,
           is_manager_account, is_active, status, test_account,
           account_balance, parent_mcc_id,
           identity_verification_program_status,
           identity_verification_start_deadline_time,
           identity_verification_completion_deadline_time,
           identity_verification_overdue,
           identity_verification_checked_at,
           last_sync_at
    FROM google_ads_accounts
    WHERE user_id = ?
    ORDER BY is_manager_account DESC, account_name ASC
  `, [userId]) as CachedAccount[]
}

/**
 * 保存或更新账号到数据库
 * 返回 { id: number, last_sync_at: string }
 */
async function upsertAccount(userId: number, account: {
  customer_id: string
  descriptive_name: string
  currency_code: string
  time_zone: string
  manager: boolean
  test_account: boolean
  status: string
  account_balance?: number | null
  parent_mcc?: string
  identity_verification_program_status?: string | null
  identity_verification_start_deadline_time?: string | null
  identity_verification_completion_deadline_time?: string | null
  identity_verification_overdue?: boolean
  identity_verification_checked_at?: string | null
}): Promise<{ id: number; last_sync_at: string }> {
  const db = await getDatabase()

  // 检查是否已存在
  const existing = await db.queryOne(`
    SELECT id, last_sync_at FROM google_ads_accounts
    WHERE user_id = ? AND customer_id = ?
  `, [userId, account.customer_id]) as { id: number; last_sync_at: string } | undefined

  if (existing) {
    // 更新
    await db.exec(`
      UPDATE google_ads_accounts
      SET account_name = ?,
          currency = ?,
          timezone = ?,
          is_manager_account = ?,
          test_account = ?,
          status = ?,
          account_balance = ?,
          parent_mcc_id = ?,
          identity_verification_program_status = ?,
          identity_verification_start_deadline_time = ?,
          identity_verification_completion_deadline_time = ?,
          identity_verification_overdue = ?,
          identity_verification_checked_at = ?,
          last_sync_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager,
      account.test_account,
      account.status,
      account.account_balance ?? null,
      account.parent_mcc || null,
      account.identity_verification_program_status ?? null,
      account.identity_verification_start_deadline_time ?? null,
      account.identity_verification_completion_deadline_time ?? null,
      Boolean(account.identity_verification_overdue),
      account.identity_verification_checked_at ?? null,
      existing.id
    ])
    return { id: existing.id, last_sync_at: new Date().toISOString() }
  } else {
    // 插入
    const result = await db.exec(`
      INSERT INTO google_ads_accounts (
        user_id, customer_id, account_name, currency, timezone,
        is_manager_account, test_account, status, account_balance, parent_mcc_id,
        identity_verification_program_status,
        identity_verification_start_deadline_time,
        identity_verification_completion_deadline_time,
        identity_verification_overdue,
        identity_verification_checked_at,
        last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      userId,
      account.customer_id,
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager,
      account.test_account,
      account.status,
      account.account_balance ?? null,
      account.parent_mcc || null,
      account.identity_verification_program_status ?? null,
      account.identity_verification_start_deadline_time ?? null,
      account.identity_verification_completion_deadline_time ?? null,
      Boolean(account.identity_verification_overdue),
      account.identity_verification_checked_at ?? null,
    ])
    const insertedId = getInsertedId(result, db.type)
    return { id: insertedId, last_sync_at: new Date().toISOString() }
  }
}

/**
 * 获取服务账号配置
 */
async function getServiceAccountConfig(userId: number, serviceAccountId: string) {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const account = await db.queryOne(`
    SELECT id, name, mcc_customer_id, developer_token, service_account_email, private_key, project_id
    FROM google_ads_service_accounts
    WHERE user_id = ? AND id = ? AND ${isActiveCondition}
  `, [userId, serviceAccountId]) as any

  if (!account) return null

  // 解密私钥
  const decryptedPrivateKey = decrypt(account.private_key)

  return {
    id: account.id,
    name: account.name,
    mccCustomerId: account.mcc_customer_id,
    developerToken: account.developer_token,
    serviceAccountEmail: account.service_account_email,
    privateKey: decryptedPrivateKey,
    projectId: account.project_id,
  }
}

/**
 * 提取搜索结果数组（处理不同库的返回结构）
 */
function extractSearchResults(searchResult: any): any[] {
  if (!searchResult) return []
  if (Array.isArray(searchResult)) return searchResult
  if (typeof searchResult === 'object') {
    if (Array.isArray(searchResult.results)) return searchResult.results
    if (Array.isArray(searchResult.data)) return searchResult.data
    const firstKey = Object.keys(searchResult)[0]
    if (firstKey && Array.isArray(searchResult[firstKey])) return searchResult[firstKey]
  }
  return []
}

type IdentityVerificationSnapshot = {
  programStatus: string | null
  verificationStartDeadlineTime: string | null
  verificationCompletionDeadlineTime: string | null
  overdue: boolean
}

function extractIdentityVerificationSnapshot(rawResponse: any): IdentityVerificationSnapshot {
  const identityVerificationList =
    rawResponse?.identity_verification ||
    rawResponse?.identityVerification ||
    rawResponse?.identity_verifications ||
    rawResponse?.identityVerifications ||
    []

  if (!Array.isArray(identityVerificationList) || identityVerificationList.length === 0) {
    return {
      programStatus: null,
      verificationStartDeadlineTime: null,
      verificationCompletionDeadlineTime: null,
      overdue: false,
    }
  }

  const advertiserIdentity = identityVerificationList.find((item: any) => {
    const program = item?.verification_program ?? item?.verificationProgram
    return program === 'ADVERTISER_IDENTITY_VERIFICATION' || program === 2 || program === '2'
  }) ?? identityVerificationList[0]

  const requirement = advertiserIdentity?.identity_verification_requirement ?? advertiserIdentity?.identityVerificationRequirement
  const progress = advertiserIdentity?.verification_progress ?? advertiserIdentity?.verificationProgress

  const programStatusRaw = progress?.program_status ?? progress?.programStatus ?? null
  const programStatus = programStatusRaw ? String(programStatusRaw).toUpperCase() : null

  const verificationStartDeadlineTime =
    requirement?.verification_start_deadline_time ??
    requirement?.verificationStartDeadlineTime ??
    null
  const verificationCompletionDeadlineTime =
    requirement?.verification_completion_deadline_time ??
    requirement?.verificationCompletionDeadlineTime ??
    null

  const completionDeadlineMs = verificationCompletionDeadlineTime ? Date.parse(String(verificationCompletionDeadlineTime)) : NaN
  const deadlinePassed = !Number.isNaN(completionDeadlineMs) && completionDeadlineMs < Date.now()

  const overdue =
    programStatus !== null &&
    programStatus !== 'SUCCESS' &&
    (programStatus === 'FAILURE' || deadlinePassed)

  return {
    programStatus,
    verificationStartDeadlineTime: verificationStartDeadlineTime ? String(verificationStartDeadlineTime) : null,
    verificationCompletionDeadlineTime: verificationCompletionDeadlineTime ? String(verificationCompletionDeadlineTime) : null,
    overdue,
  }
}

async function fetchIdentityVerificationSnapshot(params: {
  userId: number
  customerId: string
  customer?: any
  authType: 'oauth' | 'service_account'
  serviceAccountConfig?: any
}): Promise<IdentityVerificationSnapshot> {
  const startTime = Date.now()
  try {
    if (params.authType === 'service_account') {
      const { getIdentityVerificationPython } = await import('@/lib/python-ads-client')
      const resp = await getIdentityVerificationPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountConfig?.id?.toString(),
        customerId: params.customerId,
      })

      await trackApiUsage({
        userId: params.userId,
        operationType: ApiOperationType.SEARCH,
        endpoint: 'getIdentityVerification',
        customerId: params.customerId,
        requestCount: 1,
        responseTimeMs: Date.now() - startTime,
        isSuccess: true,
      })

      return extractIdentityVerificationSnapshot(resp)
    }

    const identityVerificationService =
      params.customer?.identityVerifications ||
      params.customer?.identityVerification ||
      params.customer?.identity_verifications ||
      params.customer?.identity_verification ||
      null

    const getIdentityVerificationFn = identityVerificationService?.getIdentityVerification

    if (typeof getIdentityVerificationFn !== 'function') {
      return {
        programStatus: null,
        verificationStartDeadlineTime: null,
        verificationCompletionDeadlineTime: null,
        overdue: false,
      }
    }

    const resp = await getIdentityVerificationFn.call(identityVerificationService, {
      customer_id: params.customerId,
    })

    await trackApiUsage({
      userId: params.userId,
      operationType: ApiOperationType.SEARCH,
      endpoint: 'getIdentityVerification',
      customerId: params.customerId,
      requestCount: 1,
      responseTimeMs: Date.now() - startTime,
      isSuccess: true,
    })

    return extractIdentityVerificationSnapshot(resp)
  } catch (error: any) {
    await trackApiUsage({
      userId: params.userId,
      operationType: ApiOperationType.SEARCH,
      endpoint: 'getIdentityVerification',
      customerId: params.customerId,
      requestCount: 1,
      responseTimeMs: Date.now() - startTime,
      isSuccess: false,
      errorMessage: error?.message || String(error),
    }).catch(() => {})

    return {
      programStatus: null,
      verificationStartDeadlineTime: null,
      verificationCompletionDeadlineTime: null,
      overdue: false,
    }
  }
}

/**
 * 从 Google Ads API 获取账号并同步到数据库
 */
async function syncAccountsFromAPI(
  userId: number,
  credentials: any,
  authType: 'oauth' | 'service_account' = 'oauth',
  serviceAccountConfig: any = null
): Promise<any[]> {
  console.log(`🔄 从 Google Ads API 同步账号...`)
  console.log(`   认证方式: ${authType}`)

  const isServiceAccount = authType === 'service_account' && serviceAccountConfig

  // 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须有自己的完整凭证
  // 不再回退到管理员配置，确保用户数据完全隔离
  const clientId = credentials.client_id
  const clientSecret = credentials.client_secret
  const developerToken = credentials.developer_token

  if (!clientId || !clientSecret || !developerToken) {
    throw new Error('缺少 Google Ads API 凭证配置，请在设置中完成配置')
  }

  // 创建客户端
  const client = getGoogleAdsClient({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  })

  // 🔧 修复(2025-12-26): 服务账号模式使用 Python 服务
  let resourceNames: string[]
  if (isServiceAccount) {
    // 服务账号模式：使用 Python 服务
    console.log(`   🔑 服务账号模式：使用 Python 服务进行认证`)

    try {
      const { listAccessibleCustomersPython } = await import('@/lib/python-ads-client')
      resourceNames = await listAccessibleCustomersPython({
        userId,
        serviceAccountId: serviceAccountConfig.id.toString(),
      })
      console.log(`   ✅ 服务账号认证成功，获取到 ${resourceNames.length} 个账户`)
    } catch (error: any) {
      console.error(`   ❌ 服务账号认证失败:`, error.message)
      throw new Error(
        `服务账号认证失败: ${error.message}。` +
        `请确保：1) 服务账号邮箱已被添加到 Google Ads MCC 的"访问权限和安全"中；` +
        `2) GCP 项目中已启用 Google Ads API。` +
        `服务账号邮箱: ${serviceAccountConfig.serviceAccountEmail}`
      )
    }
  } else {
    // OAuth 认证模式：使用 google-ads-api
    const response = await client.listAccessibleCustomers(credentials.refresh_token)
    resourceNames = response.resource_names || []
  }

  const customerIds = resourceNames.map((resourceName: string) => {
    const parts = resourceName.split('/')
    return parts[parts.length - 1]
  })

  console.log(`   🔍 API响应: ${resourceNames.length} 个账户`)
  console.log(`   🔍 Resource Names: ${resourceNames.join(', ')}`)
  console.log(`   ✅ 直接可访问账户 (${customerIds.length}个): ${customerIds.join(', ')}`)

  const mccCustomerId = isServiceAccount ? serviceAccountConfig.mccCustomerId : credentials.login_customer_id
  console.log(`   🔑 Login Customer ID (MCC): ${mccCustomerId || '未设置'}`)

  const allAccounts: any[] = []
  const processedIds = new Set<string>()

  for (const customerId of customerIds) {
    if (processedIds.has(customerId)) continue

    // API追踪设置
    const apiStartTime = Date.now()
    let apiSuccess = false
    let apiErrorMessage: string | undefined

    try {
      const basicAccountInfoQuery = `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.manager,
          customer.test_account
        FROM customer
        WHERE customer.id = ${customerId}
      `

      // 🔧 修复(2025-12-25): 服务账号模式自动降级login_customer_id
      // 策略：MCC ID → 子账户ID → null(省略login_customer_id)
      // 原因：根据Google Ads API文档，当直接访问账户(非通过管理账户)时，
      //       login_customer_id应该省略或设置为账户自己的ID
      const loginCustomerIds = isServiceAccount
        ? [serviceAccountConfig.mccCustomerId, customerId, null]  // MCC → 子账户 → null
        : [credentials.login_customer_id, customerId, null]

      let customer: any
      let preloadedAccountInfo: any[] | null = null
      let lastError: Error | null = null
      let successLoginCustomerId: string | null = null

      // 🔧 修复(2025-12-25): 尝试多个login_customer_id直到成功
      // 重点：每次尝试都需要重新创建客户端，因为@htdangkhoa/google-ads在实例化时固化了login_customer_id
      const loginAttempts: Array<{ loginCustomerId: string | null, error: string | null, success: boolean }> = []

      for (const lcId of loginCustomerIds) {
        const lcIdDisplay = lcId || 'null(省略)'
        console.log(`   🔍 尝试使用 login_customer_id: ${lcIdDisplay} 访问账户 ${customerId}`)

        try {
          if (isServiceAccount) {
            // 🔧 修复(2025-12-26): 使用 Python 服务执行 GAQL 查询
            const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
            const testQuery = `SELECT customer.id FROM customer WHERE customer.id = ${customerId} LIMIT 1`

            await executeGAQLQueryPython({
              userId,
              serviceAccountId: serviceAccountConfig.id.toString(),
              customerId: customerId,
              query: testQuery,
            })

            // 如果执行成功，创建一个占位customer对象（后续查询会继续使用Python服务）
            customer = { _isPythonProxy: true, _customerId: customerId }
          } else {
            // OAuth模式：仅创建Customer实例不代表可访问（login_customer_id 不正确时，真正的请求会 PERMISSION_DENIED）
            // 这里用一次轻量 GAQL 查询来验证访问性，并确保后续（含身份验证查询）使用正确的 login_customer_id
            const candidateCustomer = await getCustomer(
              customerId,
              credentials.refresh_token,
              lcId,
              {
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken,
              },
              userId,
              undefined,
              'oauth'
            )

            const searchResult = await candidateCustomer.query(basicAccountInfoQuery)
            const results = extractSearchResults(searchResult)
            if (!results || results.length === 0) {
              throw new Error('账户基本信息查询返回空结果')
            }

            customer = candidateCustomer
            preloadedAccountInfo = results
          }

          // 如果执行到这行代码没有抛出异常，说明成功
          successLoginCustomerId = lcId
          loginAttempts.push({ loginCustomerId: lcId, error: null, success: true })
          console.log(`   ✅ 使用 login_customer_id: ${lcIdDisplay} 成功访问账户 ${customerId}`)
          break
        } catch (error: any) {
          lastError = error
          loginAttempts.push({
            loginCustomerId: lcId,
            error: error.message || '未知错误',
            success: false
          })
          console.warn(`   ⚠️ 使用 login_customer_id: ${lcIdDisplay} 失败: ${error.message}`)

          // 🆕 检测是否为PERMISSION_DENIED错误
          if (error.message && error.message.includes('PERMISSION_DENIED')) {
            console.warn(`   🔍 检测到权限错误，记录详细信息用于前端提示`)
          }

          continue  // 尝试下一个login_customer_id
        }
      }

      // 如果所有login_customer_id都失败，构建详细的错误信息
      if (!customer) {
        const hasPermissionDenied = loginAttempts.some(attempt =>
          attempt.error && attempt.error.includes('PERMISSION_DENIED')
        )

        // 🆕 构建用户友好的错误信息
        let friendlyErrorMessage = '无法访问该账户。'

        if (hasPermissionDenied && isServiceAccount) {
          const mccId = isServiceAccount ? serviceAccountConfig.mccCustomerId : credentials.login_customer_id
          friendlyErrorMessage = `服务账号权限不足。\n\n` +
            `问题诊断：\n` +
            `1. 尝试使用MCC账户(${mccId})访问失败 - PERMISSION_DENIED\n` +
            `2. 尝试直接访问子账户(${customerId})也失败\n\n` +
            `可能的原因：\n` +
            `• 服务账号只被添加到子账户，但未添加到MCC账户\n` +
            `• 服务账号在MCC账户中权限不足（需要"标准访问"或"管理员"）\n\n` +
            `解决方案：\n` +
            `1. 登录 Google Ads UI (https://ads.google.com)\n` +
            `2. 切换到MCC账户 ${mccId}\n` +
            `3. 进入"管理" → "访问权限和安全"\n` +
            `4. 添加服务账号邮箱: ${serviceAccountConfig.serviceAccountEmail}\n` +
            `5. 选择权限级别："标准访问"或"管理员"\n` +
            `6. 保存后等待几分钟，然后刷新此页面`
        }

        const enhancedError = new Error(friendlyErrorMessage)
        ;(enhancedError as any).loginAttempts = loginAttempts
        ;(enhancedError as any).isPermissionError = hasPermissionDenied
        ;(enhancedError as any).serviceAccountEmail = isServiceAccount ? serviceAccountConfig.serviceAccountEmail : null
        ;(enhancedError as any).mccCustomerId = isServiceAccount ? serviceAccountConfig.mccCustomerId : credentials.login_customer_id

        throw enhancedError
      }

      // 将成功的login_customer_id传下去（用于后续子账户查询）
      const effectiveLoginCustomerId = successLoginCustomerId

      // 🔧 修复(2025-12-25): 分步查询，先查基本信息，再查 status
      // 有些账户的 status 字段可能有权限问题导致 field_violations 错误
      // 🔧 修复(2025-12-25): 增加详细的错误捕获，处理 field_violations 等解析错误
      // 🔧 修复(2025-12-25): @htdangkhoa/google-ads库的search方法返回结构可能是 { results: [...] }
      let accountInfo: any[]
      let rawStatus: any = 'UNKNOWN'

      try {
        // 先查询基本信息（不包含 status，避免权限问题）
        // 🔧 修复(2025-12-26): 服务账号模式调用Python服务，OAuth模式使用query()
        if (!isServiceAccount && preloadedAccountInfo) {
          accountInfo = preloadedAccountInfo
        } else {
          let searchResult
          if (isServiceAccount) {
            const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
            searchResult = await executeGAQLQueryPython({
              userId,
              serviceAccountId: undefined,
              customerId: customerId,
              query: basicAccountInfoQuery
            })
          } else {
            searchResult = await customer.query(basicAccountInfoQuery)
          }

          accountInfo = extractSearchResults(searchResult)
        }

        if (accountInfo && accountInfo.length > 0) {
          // 尝试单独查询 status（如果失败也不影响基本信息）
          try {
            const statusQuery = `
              SELECT customer.status
              FROM customer
              WHERE customer.id = ${customerId}
            `
            let statusResult
            if (isServiceAccount) {
              const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
              statusResult = await executeGAQLQueryPython({
                userId,
                serviceAccountId: undefined,
                customerId: customerId,
                query: statusQuery
              })
            } else {
              statusResult = await customer.query(statusQuery)
            }
            const statusInfo = extractSearchResults(statusResult)
            if (statusInfo && statusInfo.length > 0) {
              rawStatus = statusInfo[0].customer?.status
            }
          } catch (statusError: any) {
            console.warn(`   ⚠️ 账户 ${customerId} status 字段查询失败（权限不足或账户状态异常），使用默认值 UNKNOWN`)
          }
        }

        apiSuccess = true // Account query succeeded
      } catch (searchError: any) {
        // 捕获 "No data type found for field_violations.description" 等库解析错误
        console.warn(`   ⚠️ 账户 ${customerId} 基本信息查询失败（可能是账户状态异常或API版本问题）`)
        console.warn(`      原始错误: ${searchError.message}`)

        // 抛出错误让外层 catch 处理，保存为UNKNOWN状态
        throw new Error(`账户查询失败: ${searchError.message || '未知错误'}`)
      }

      if (accountInfo && accountInfo.length > 0) {
        const account = accountInfo[0]
        // rawStatus 已经在上面的 try-catch 中查询并赋值了
        console.log(`[DEBUG] Account ${customerId} raw status:`, rawStatus, 'type:', typeof rawStatus)
        const parsedStatus = parseStatus(rawStatus)
        console.log(`[DEBUG] Account ${customerId} parsed status:`, parsedStatus)

        // 查询账户预算信息获取余额
        let accountBalance: number | null = null
        try {
          const budgetQuery = `
            SELECT
              account_budget.amount_served_micros,
              account_budget.approved_spending_limit_micros,
              account_budget.proposed_spending_limit_micros
            FROM account_budget
            WHERE account_budget.status = 'APPROVED'
            ORDER BY account_budget.id DESC
            LIMIT 1
          `
          // 🔧 修复(2025-12-26): 服务账号模式使用 executeGAQLQueryPython，而不是错误的 customer.search()
          const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
          const budgetResult = isServiceAccount
            ? await executeGAQLQueryPython({ userId, serviceAccountId: undefined, customerId, query: budgetQuery })
            : await customer.query(budgetQuery)
          const budgetInfo = extractSearchResults(budgetResult)
          if (budgetInfo && budgetInfo.length > 0) {
            const budget = budgetInfo[0].account_budget
            const amountServed = Number(budget?.amount_served_micros || 0)
            const spendingLimit = Number(budget?.approved_spending_limit_micros || budget?.proposed_spending_limit_micros || 0)
            // 余额 = 预算 - 已使用
            accountBalance = spendingLimit > 0 ? spendingLimit - amountServed : null
            console.log(`   💰 ${customerId} 余额: ${accountBalance ? parseFloat((accountBalance / 1000000).toFixed(2)) : 'N/A'}`)
          }
        } catch (budgetError) {
          console.log(`   ⚠️ ${customerId} 无法获取预算信息（可能账户无预算设置）`)
        }

        // 🔧 修复(2025-12-18): 计算parent_mcc字段
        // 子账户的parent_mcc是登录的MCC账户ID，MCC账户的parent_mcc为null
        const isManagerAccount = account.customer?.manager || false
        const parentMcc = isManagerAccount ? null : (isServiceAccount ? serviceAccountConfig.mccCustomerId : credentials.login_customer_id)

        // 🆕 身份验证（广告主验证）状态：用于识别“因未完成验证导致暂停但 customer.status 仍为 ENABLED”的情况
        const identityVerification = (!isManagerAccount && parsedStatus === 'ENABLED')
          ? await fetchIdentityVerificationSnapshot({
            userId,
            customerId,
            customer: isServiceAccount ? undefined : customer,
            authType: isServiceAccount ? 'service_account' : 'oauth',
            serviceAccountConfig,
          })
          : {
            programStatus: null,
            verificationStartDeadlineTime: null,
            verificationCompletionDeadlineTime: null,
            overdue: false,
          }

        const effectiveStatus = (parsedStatus === 'ENABLED' && identityVerification.overdue) ? 'SUSPENDED' : parsedStatus
        const identityVerificationCheckedAt = (!isManagerAccount && parsedStatus === 'ENABLED') ? new Date().toISOString() : null

        const accountData = {
          customer_id: customerId,
          descriptive_name: account.customer?.descriptive_name || `客户 ${customerId}`,
          currency_code: account.customer?.currency_code || 'USD',
          time_zone: account.customer?.time_zone || 'UTC',
          manager: isManagerAccount,
          test_account: account.customer?.test_account || false,
          status: effectiveStatus,
          account_balance: accountBalance,
          parent_mcc: parentMcc,  // 🆕 设置parent_mcc：子账户的parent_mcc是MCC账户ID，MCC账户的parent_mcc为null
          identity_verification_program_status: identityVerification.programStatus,
          identity_verification_start_deadline_time: identityVerification.verificationStartDeadlineTime,
          identity_verification_completion_deadline_time: identityVerification.verificationCompletionDeadlineTime,
          identity_verification_overdue: identityVerification.overdue,
          identity_verification_checked_at: identityVerificationCheckedAt,
        }

        // 保存到数据库
        const { id: dbId, last_sync_at } = await upsertAccount(userId, accountData)
        allAccounts.push({ ...accountData, db_account_id: dbId, last_sync_at })
        processedIds.add(customerId)

        console.log(`   ✓ ${customerId}: ${accountData.descriptive_name} (MCC: ${accountData.manager})`)

        // 如果是MCC账户，查询其管理的子账户
        if (accountData.manager) {
          console.log(`   🔍 查询MCC ${customerId} 的子账户...`)

          const childAccountsQuery = `
            SELECT
              customer_client.id,
              customer_client.descriptive_name,
              customer_client.currency_code,
              customer_client.time_zone,
              customer_client.manager,
              customer_client.test_account,
              customer_client.status
            FROM customer_client
          `

          // MCC子账户查询追踪
          const mccApiStartTime = Date.now()
          let mccApiSuccess = false
          let mccApiErrorMessage: string | undefined

          try {
            const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
            const childAccounts = extractSearchResults(isServiceAccount
              ? await executeGAQLQueryPython({ userId, serviceAccountId: undefined, customerId, query: childAccountsQuery })
              : await customer.query(childAccountsQuery))
            mccApiSuccess = true

            for (const child of childAccounts) {
              const childId = child.customer_client?.id?.toString()

              if (childId && !processedIds.has(childId)) {
                const rawChildStatus = child.customer_client?.status
                console.log(`[DEBUG] Child Account ${childId} raw status:`, rawChildStatus, 'type:', typeof rawChildStatus)
                const parsedChildStatus = parseStatus(rawChildStatus)
                console.log(`[DEBUG] Child Account ${childId} parsed status:`, parsedChildStatus)

                const isChildManager = child.customer_client?.manager || false

                // OAuth模式：必须在子账户 customer 上下文内查询身份验证信息
                // 否则可能会误用MCC customer上下文，导致身份验证状态为空，从而被错误标记为“可投放”
                let childCustomer: any | null = null
                if (!isServiceAccount && !isChildManager) {
                  try {
                    childCustomer = await getCustomer(
                      childId,
                      credentials.refresh_token,
                      credentials.login_customer_id,
                      {
                        client_id: clientId,
                        client_secret: clientSecret,
                        developer_token: developerToken,
                      },
                      userId,
                      undefined,
                      'oauth'
                    )
                  } catch {
                    childCustomer = null
                  }
                }

                const identityVerification = (!isChildManager && parsedChildStatus === 'ENABLED')
                  ? await fetchIdentityVerificationSnapshot({
                    userId,
                    customerId: childId,
                    customer: isServiceAccount ? undefined : (childCustomer ?? customer),
                    authType: isServiceAccount ? 'service_account' : 'oauth',
                    serviceAccountConfig,
                  })
                  : {
                    programStatus: null,
                    verificationStartDeadlineTime: null,
                    verificationCompletionDeadlineTime: null,
                    overdue: false,
                  }

                const effectiveChildStatus = (parsedChildStatus === 'ENABLED' && identityVerification.overdue)
                  ? 'SUSPENDED'
                  : parsedChildStatus
                const identityVerificationCheckedAt = (!isChildManager && parsedChildStatus === 'ENABLED') ? new Date().toISOString() : null

                // 查询子账户预算信息获取余额
                let childBalance: number | null = null
                if (!isChildManager) {
                  try {
                    const childBudgetQuery = `
                      SELECT
                        account_budget.amount_served_micros,
                        account_budget.approved_spending_limit_micros,
                        account_budget.proposed_spending_limit_micros
                      FROM account_budget
                      WHERE account_budget.status = 'APPROVED'
                      ORDER BY account_budget.id DESC
                      LIMIT 1
                    `

                    let childBudgetInfo
                    if (isServiceAccount) {
                      // 🔧 修复(2025-12-26): 使用 Python 服务执行 GAQL 查询
                      const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
                      const result = await executeGAQLQueryPython({
                        userId,
                        serviceAccountId: serviceAccountConfig.id.toString(),
                        customerId: childId,
                        query: childBudgetQuery,
                      })
                      childBudgetInfo = result.results || []
                    } else {
                      childBudgetInfo = childCustomer
                        ? extractSearchResults(await childCustomer.query(childBudgetQuery))
                        : []
                    }

                    if (childBudgetInfo && childBudgetInfo.length > 0) {
                      const budget = childBudgetInfo[0].account_budget
                      const amountServed = Number(budget?.amount_served_micros || 0)
                      const spendingLimit = Number(budget?.approved_spending_limit_micros || budget?.proposed_spending_limit_micros || 0)
                      childBalance = spendingLimit > 0 ? spendingLimit - amountServed : null
                      console.log(`      💰 ${childId} 余额: ${childBalance ? parseFloat((childBalance / 1000000).toFixed(2)) : 'N/A'}`)
                    }
                  } catch (budgetError: any) {
                    // 🔧 修复(2025-12-26): 减少日志噪音，账户状态异常时不需要警告
                    const errorMsg = budgetError?.message || String(budgetError)
                    const isExpectedError = errorMsg.includes('CUSTOMER_NOT_ENABLED') ||
                      errorMsg.includes('PERMISSION_DENIED') ||
                      errorMsg.includes('not yet enabled')
                    if (!isExpectedError) {
                      console.log(`      ⚠️ ${childId} 无法获取预算信息: ${budgetError?.message || budgetError}`)
                    }
                  }
                }

                const childData = {
                  customer_id: childId,
                  descriptive_name: child.customer_client?.descriptive_name || `客户 ${childId}`,
                  currency_code: child.customer_client?.currency_code || 'USD',
                  time_zone: child.customer_client?.time_zone || 'UTC',
                  manager: isChildManager,
                  test_account: child.customer_client?.test_account || false,
                  status: effectiveChildStatus,
                  account_balance: childBalance,
                  parent_mcc: customerId,
                  identity_verification_program_status: identityVerification.programStatus,
                  identity_verification_start_deadline_time: identityVerification.verificationStartDeadlineTime,
                  identity_verification_completion_deadline_time: identityVerification.verificationCompletionDeadlineTime,
                  identity_verification_overdue: identityVerification.overdue,
                  identity_verification_checked_at: identityVerificationCheckedAt,
                }

                const { id: dbId, last_sync_at } = await upsertAccount(userId, childData)
                allAccounts.push({ ...childData, db_account_id: dbId, last_sync_at })
                processedIds.add(childId)

                console.log(`      ↳ ${childId}: ${childData.descriptive_name}`)
              }
            }

            console.log(`   ✓ MCC ${customerId} 共有 ${childAccounts.length} 个子账户`)
          } catch (childError: any) {
            mccApiSuccess = false
            mccApiErrorMessage = childError.message
            console.warn(`   ⚠️ 查询MCC ${customerId} 子账户失败: ${childError.message}`)
          } finally {
            // 记录MCC子账户查询API使用
            trackApiUsage({
              userId,
              operationType: ApiOperationType.SEARCH,
              endpoint: 'getMccChildAccounts',
              customerId,
              requestCount: 1,
              responseTimeMs: Date.now() - mccApiStartTime,
              isSuccess: mccApiSuccess,
              errorMessage: mccApiErrorMessage
            })
          }
        }
      }
    } catch (accountError: any) {
      apiSuccess = false
      apiErrorMessage = accountError.message || JSON.stringify(accountError)
      console.warn(`   ⚠️ 获取账户 ${customerId} 信息失败:`)
      console.warn(`      错误类型: ${accountError.constructor?.name || typeof accountError}`)
      console.warn(`      错误信息: ${accountError.message || 'No message'}`)
      console.warn(`      错误代码: ${accountError.code || accountError.error_code || 'No code'}`)
      if (accountError.errors && Array.isArray(accountError.errors)) {
        console.warn(`      详细错误 (${accountError.errors.length}个):`)
        accountError.errors.forEach((err: any, idx: number) => {
          console.warn(`        [${idx + 1}] ${err.message || JSON.stringify(err)}`)
        })
      }
      if (accountError.stack) {
        console.warn(`      堆栈: ${accountError.stack.split('\n').slice(0, 3).join('\n      ')}`)
      }

      const fallbackData = {
        customer_id: customerId,
        descriptive_name: `客户 ${customerId}`,
        currency_code: 'USD',
        time_zone: 'UTC',
        manager: false,
        test_account: false,
        status: 'UNKNOWN',
      }
      const { id: dbId, last_sync_at } = await upsertAccount(userId, fallbackData)
      allAccounts.push({ ...fallbackData, db_account_id: dbId, last_sync_at })
      processedIds.add(customerId)
    } finally {
      // 记录账户查询API使用
      trackApiUsage({
        userId,
        operationType: ApiOperationType.SEARCH,
        endpoint: 'getAccountInfo',
        customerId,
        requestCount: 1,
        responseTimeMs: Date.now() - apiStartTime,
        isSuccess: apiSuccess,
        errorMessage: apiErrorMessage
      })
    }
  }

  console.log(`✅ 同步完成，共 ${allAccounts.length} 个账户`)
  return allAccounts
}

/**
 * GET /api/google-ads/credentials/accounts
 * 获取用户可访问的Google Ads账户列表
 *
 * Query params:
 * - refresh=true: 强制从 API 刷新
 * - offerId=number: 当前Offer ID（用于计算账号优先级）
 * - auth_type=oauth|service_account: 认证方式（默认oauth）
 * - service_account_id=string: 服务账号ID（当auth_type=service_account时必需）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === 'true'
    const asyncRefresh = searchParams.get('async') === 'true'
    const offerId = searchParams.get('offerId') ? parseInt(searchParams.get('offerId')!, 10) : null
    const authType = (searchParams.get('auth_type') as 'oauth' | 'service_account') || 'oauth'
    const serviceAccountId = searchParams.get('service_account_id')

    console.log(`🔍 [GET /api/google-ads/credentials/accounts] forceRefresh=${forceRefresh}, asyncRefresh=${asyncRefresh}, offerId=${offerId}, authType=${authType}`)

    let credentials: any = null
    let serviceAccountConfig: any = null
    let loginCustomerId: string | null = null

    if (authType === 'service_account') {
      // 服务账号认证模式
      if (!serviceAccountId) {
        return NextResponse.json({
          error: '缺少服务账号ID',
          message: '使用服务账号认证时必须指定 service_account_id 参数'
        }, { status: 400 })
      }

      serviceAccountConfig = await getServiceAccountConfig(userId, serviceAccountId)
      if (!serviceAccountConfig) {
        return NextResponse.json({
          error: '服务账号配置不存在或已禁用',
          message: '请先在设置页面配置服务账号'
        }, { status: 404 })
      }

      loginCustomerId = serviceAccountConfig.mccCustomerId

      // 🔧 修复(2025-12-24): 服务账号模式也需要基本的client_id/client_secret用于创建API客户端
      // 但实际认证使用JWT，如果用户没有OAuth凭证，使用占位值（服务账号认证不需要这些）
      const oauthCredentials = await getGoogleAdsCredentials(userId)
      if (oauthCredentials) {
        credentials = {
          client_id: oauthCredentials.client_id,
          client_secret: oauthCredentials.client_secret,
          developer_token: serviceAccountConfig.developerToken,
        }
      } else {
        // 服务账号认证模式下，如果没有OAuth凭证，使用占位值
        // client_id和client_secret仅用于创建API客户端，实际认证使用JWT
        credentials = {
          client_id: 'placeholder-client-id',
          client_secret: 'placeholder-client-secret',
          developer_token: serviceAccountConfig.developerToken,
        }
        console.log(`⚠️ 未配置OAuth凭证，使用占位值创建API客户端（服务账号认证不需要OAuth）`)
      }
    } else {
      // OAuth 认证模式
      credentials = await getGoogleAdsCredentials(userId)

      if (!credentials) {
        return NextResponse.json({
          error: '未配置 Google Ads 凭证',
          message: '请在设置页面完成 Google Ads API 配置并完成 OAuth 授权',
          code: 'CREDENTIALS_NOT_CONFIGURED'
        }, { status: 404 })
      }

      if (!credentials.refresh_token) {
        return NextResponse.json({ error: '未找到Refresh Token，请先完成OAuth授权' }, { status: 401 })
      }

      loginCustomerId = credentials.login_customer_id
    }

    // 校验: login_customer_id 必须存在（MCC账户ID是调用Google Ads API的必填项）
    if (!loginCustomerId) {
      return NextResponse.json({
        error: '缺少 Login Customer ID (MCC账户ID)',
        message: '请先在设置页面配置 Login Customer ID，这是使用 Google Ads API 的必填项'
      }, { status: 400 })
    }

    let allAccounts: any[]

    const syncStore = getAccountSyncStateStore()
    cleanupExpiredSyncStates(syncStore)
    const syncKey = buildSyncKey({ userId, authType, serviceAccountId })
    const syncState = syncStore.get(syncKey)
    const refreshInProgress = syncState?.status === 'running'

    // 检查缓存
    const cachedAccounts = await getCachedAccounts(userId)
    const latestSyncAtMs = getLatestSyncAtMs(cachedAccounts)
    const cacheAgeMs = Number.isNaN(latestSyncAtMs) ? Number.POSITIVE_INFINITY : Date.now() - latestSyncAtMs
    const cacheStaleBeforeRefresh = cacheAgeMs > GOOGLE_ADS_ACCOUNTS_CACHE_MAX_AGE_MS
    console.log(`📦 缓存中有 ${cachedAccounts.length} 个账号`)

	    const mapCachedAccounts = () => cachedAccounts.map(acc => {
	      const identityVerificationOverdue = toNumber(acc.identity_verification_overdue, 0) === 1
	      const status = acc.status || 'UNKNOWN'

	      return {
	        customer_id: acc.customer_id,
	        descriptive_name: acc.account_name || `客户 ${acc.customer_id}`,
	        currency_code: acc.currency,
	        time_zone: acc.timezone,
	        manager: toNumber(acc.is_manager_account, 0) === 1,
	        test_account: toNumber(acc.test_account, 0) === 1,
	        status,
	        account_balance: acc.account_balance,
	        parent_mcc: acc.parent_mcc_id,
	        identity_verification_program_status: acc.identity_verification_program_status,
	        identity_verification_start_deadline_time: acc.identity_verification_start_deadline_time,
	        identity_verification_completion_deadline_time: acc.identity_verification_completion_deadline_time,
	        identity_verification_overdue: identityVerificationOverdue,
	        identity_verification_checked_at: acc.identity_verification_checked_at,
	        db_account_id: acc.id,
	        last_sync_at: acc.last_sync_at,
	      }
	    })

    let usedCache = false
    let refreshFailed = false
    let effectiveLastSyncAtIso: string | null = Number.isNaN(latestSyncAtMs) ? null : new Date(latestSyncAtMs).toISOString()

    if (forceRefresh && asyncRefresh) {
      // 异步刷新：立即返回缓存（或空列表），后台继续同步，前端可通过轮询拿到逐步写入的账号数据
      usedCache = true
      allAccounts = cachedAccounts.length > 0 ? mapCachedAccounts() : []

      if (!refreshInProgress) {
        syncStore.set(syncKey, {
          status: 'running',
          startedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        })

        void (async () => {
          try {
            await syncAccountsFromAPI(userId, credentials, authType, serviceAccountConfig)
            syncStore.set(syncKey, {
              status: 'completed',
              startedAtMs: syncStore.get(syncKey)?.startedAtMs || Date.now(),
              updatedAtMs: Date.now(),
            })
          } catch (err: any) {
            syncStore.set(syncKey, {
              status: 'failed',
              startedAtMs: syncStore.get(syncKey)?.startedAtMs || Date.now(),
              updatedAtMs: Date.now(),
              errorMessage: formatErrorMessage(err) || '同步失败',
            })
          }
        })()
      }
    } else if (!forceRefresh && cachedAccounts.length > 0) {
      // 使用缓存数据（即使缓存已过期也先返回，避免请求阻塞/网关超时；由 refresh=true 显式触发同步）
      usedCache = true
      console.log(`✅ 使用缓存的 ${cachedAccounts.length} 个账号 (ageMs=${cacheAgeMs})`)
      allAccounts = mapCachedAccounts()
    } else {
      // 从 API 获取并同步（仅在 refresh=true 或无缓存时执行）
      console.log(`🔄 从 Google Ads API 同步账号... (forceRefresh=${forceRefresh}, cacheStale=${cacheStaleBeforeRefresh})`)
      try {
        allAccounts = await syncAccountsFromAPI(userId, credentials, authType, serviceAccountConfig)
        console.log(`✅ 同步完成，获取到 ${allAccounts.length} 个账号`)
        effectiveLastSyncAtIso = new Date().toISOString()
      } catch (err) {
        // 降级：如果刷新失败但有缓存，允许继续使用缓存（避免发布流程完全阻塞）
        if (cachedAccounts.length > 0) {
          refreshFailed = true
          usedCache = true
          console.warn(`⚠️ 同步账号失败，回退使用缓存账号列表:`, err)
          allAccounts = mapCachedAccounts()
        } else {
          throw err
        }
      }
    }

    // 查询关联的 Offer 信息
    const db = await getDatabase()

    // 🔓 KISS优化(2025-12-12): 获取当前Offer的品牌名（用于同品牌优先级计算）
    let currentOfferBrand: string | null = null
    if (offerId) {
      const currentOffer = await db.queryOne(`
        SELECT brand FROM offers WHERE id = ? AND user_id = ?
      `, [offerId, userId]) as { brand: string } | undefined
      currentOfferBrand = currentOffer?.brand || null
    }

    const accountsWithOffers = await Promise.all(allAccounts.map(async (account) => {
      const dbAccountId = account.db_account_id
      if (!dbAccountId) {
        // 🔧 修复(2025-12-11): 转换snake_case为camelCase，保持API响应一致性
        return {
          customerId: account.customer_id,
          descriptiveName: account.descriptive_name,
          currencyCode: account.currency_code,
          timeZone: account.time_zone,
          manager: account.manager,
          testAccount: account.test_account,
          status: account.status,
          accountBalance: account.account_balance,
          parentMcc: account.parent_mcc,
          identityVerification: {
            programStatus: account.identity_verification_program_status ?? null,
            startDeadlineTime: account.identity_verification_start_deadline_time ?? null,
            completionDeadlineTime: account.identity_verification_completion_deadline_time ?? null,
            overdue: Boolean(account.identity_verification_overdue),
            checkedAt: account.identity_verification_checked_at ?? null,
          },
          dbAccountId: account.db_account_id,
          lastSyncAt: account.last_sync_at,
          linkedOffers: [],
          // 🔓 KISS优化(2025-12-12): 优先级标识
          priority: 'none' as const,
          priorityScore: 0
        }
      }

      const linkedOffers = await db.query(`
        SELECT DISTINCT
          o.id,
          o.offer_name,
          o.brand,
          o.target_country,
          CASE WHEN o.is_deleted = IS_DELETED_TRUE THEN 0 ELSE 1 END as is_active,
          COUNT(DISTINCT c.id) as campaign_count
        FROM offers o
        INNER JOIN campaigns c ON o.id = c.offer_id
        WHERE c.google_ads_account_id = ?
          AND c.user_id = ?
          AND o.is_deleted = IS_DELETED_FALSE
          AND c.status != 'REMOVED'
        GROUP BY o.id, o.offer_name, o.brand, o.target_country, o.is_deleted
      `, [dbAccountId, userId])

      // 🔧 修复(2025-12-11): 转换snake_case为camelCase，保持API响应一致性
      const linkedOffersMapped = linkedOffers.map((offer: any) => ({
        id: offer.id,
        offerName: offer.offer_name,
        brand: offer.brand,
        targetCountry: offer.target_country,
        isActive: offer.is_active === 1,
        campaignCount: offer.campaign_count
      }))

      // 🔓 KISS优化(2025-12-12): 计算账号优先级
      // priority: 'current' = 当前Offer已用过 | 'same-brand' = 同品牌Offer用过 | 'none' = 未使用
      // priorityScore: 用于排序 (2=current, 1=same-brand, 0=none)
      let priority: 'current' | 'same-brand' | 'none' = 'none'
      let priorityScore = 0

      if (offerId && linkedOffersMapped.length > 0) {
        // 检查是否被当前Offer使用过
        const usedByCurrentOffer = linkedOffersMapped.some((o: any) => o.id === offerId)
        if (usedByCurrentOffer) {
          priority = 'current'
          priorityScore = 2
        } else if (currentOfferBrand) {
          // 检查是否被同品牌Offer使用过
          const usedBySameBrand = linkedOffersMapped.some((o: any) => o.brand === currentOfferBrand)
          if (usedBySameBrand) {
            priority = 'same-brand'
            priorityScore = 1
          }
        }
      }

	      return {
	        customerId: account.customer_id,
	        descriptiveName: account.descriptive_name,
	        currencyCode: account.currency_code,
        timeZone: account.time_zone,
        manager: account.manager,
        testAccount: account.test_account,
        status: account.status,
        accountBalance: account.account_balance,
        parentMcc: account.parent_mcc,
	        identityVerification: {
	          programStatus: account.identity_verification_program_status ?? null,
	          startDeadlineTime: account.identity_verification_start_deadline_time ?? null,
	          completionDeadlineTime: account.identity_verification_completion_deadline_time ?? null,
	          overdue: Boolean(account.identity_verification_overdue),
	          checkedAt: account.identity_verification_checked_at ?? null,
	        },
	        dbAccountId: account.db_account_id,
	        lastSyncAt: account.last_sync_at,
	        linkedOffers: linkedOffersMapped,
	        // 🔓 KISS优化(2025-12-12): 优先级标识
	        priority,
	        priorityScore
	      }
	    }))

	    // 🔓 KISS优化(2025-12-12): 按优先级排序
	    // 排序规则: priorityScore DESC > is_manager_account DESC > account_name ASC
	    accountsWithOffers.sort((a, b) => {
	      // 1. 优先级分数高的在前
	      if (b.priorityScore !== a.priorityScore) {
	        return b.priorityScore - a.priorityScore
	      }
      // 2. MCC账号在前（用于展示层级结构）
      if (a.manager !== b.manager) {
        return a.manager ? -1 : 1
      }
      // 3. 按名称字母排序
      return (a.descriptiveName || '').localeCompare(b.descriptiveName || '')
    })

    // 🔧 修复(2025-12-12): 简化响应，移除共享配置相关信息
    const finalSyncState = syncStore.get(syncKey)
    return NextResponse.json({
      success: true,
      data: {
        total: accountsWithOffers.length,
        accounts: accountsWithOffers,
        cached: usedCache,
        cacheStale: usedCache ? cacheStaleBeforeRefresh : false,
        refreshFailed,
        refreshInProgress: finalSyncState?.status === 'running',
        refreshError: finalSyncState?.status === 'failed' ? (finalSyncState.errorMessage || null) : null,
        refreshStartedAt: finalSyncState?.startedAtMs ? new Date(finalSyncState.startedAtMs).toISOString() : null,
        lastSyncAt: effectiveLastSyncAtIso,
        loginCustomerId: loginCustomerId,
        authType: authType,
      },
    })

  } catch (error: any) {
    console.error('获取Google Ads账户失败:', error)

    // 🔧 修复(2025-12-24): 根据错误类型返回合适的 HTTP 状态码
    let statusCode = 500
    let errorCode = 'UNKNOWN_ERROR'

    // 🆕 检测权限错误并构建详细响应
    if (error.isPermissionError && error.serviceAccountEmail && error.mccCustomerId) {
      statusCode = 403
      errorCode = 'SERVICE_ACCOUNT_PERMISSION_DENIED'

      return NextResponse.json({
        error: '服务账号权限不足',
        code: errorCode,
        message: error.message,
        details: {
          serviceAccountEmail: error.serviceAccountEmail,
          mccCustomerId: error.mccCustomerId,
          loginAttempts: error.loginAttempts,
          solution: {
            title: '如何修复权限问题',
            steps: [
              '登录 Google Ads UI: https://ads.google.com',
              `切换到MCC账户: ${error.mccCustomerId}`,
              '进入"管理" → "访问权限和安全"',
              `添加服务账号: ${error.serviceAccountEmail}`,
              '选择权限级别: "标准访问"或"管理员"',
              '保存后等待几分钟，然后刷新此页面'
            ],
            docsUrl: '/docs/service-account-setup'
          }
        }
      }, { status: statusCode })
    }

    // 🔧 修复(2026-01-04): 检测 OAuth refresh token 过期错误
    if (error.message?.includes('invalid_grant')) {
      statusCode = 401
      errorCode = 'OAUTH_TOKEN_EXPIRED'

      return NextResponse.json({
        error: 'OAuth 授权已过期',
        code: errorCode,
        message: 'Google OAuth refresh token 已过期或失效，请重新授权',
        needsReauth: true
      }, { status: statusCode })
    }

    if (error.message?.includes('invalid_client')) {
      statusCode = 401  // 未授权
      errorCode = 'INVALID_CLIENT'
    } else if (error.message?.includes('没有访问权限') || error.message?.includes('permission')) {
      statusCode = 403  // 禁止访问
      errorCode = 'PERMISSION_DENIED'
    } else if (error.message?.includes('找不到') || error.message?.includes('not found')) {
      statusCode = 404
      errorCode = 'NOT_FOUND'
    } else if (error.message?.includes('凭证') || error.message?.includes('credentials')) {
      statusCode = 400
      errorCode = 'CREDENTIALS_ERROR'
    }

    return NextResponse.json(
      {
        error: '获取Google Ads账户失败',
        message: error.message || '未知错误',
        code: errorCode
      },
      { status: statusCode }
    )
  }
}
