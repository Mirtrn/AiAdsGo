import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getGoogleAdsClient, getCustomer } from '@/lib/google-ads-api'
import { getDatabase, getSQLiteDatabase } from '@/lib/db'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'

// Google Ads CustomerStatus 枚举值映射
// 参考: https://developers.google.com/google-ads/api/reference/rpc/latest/CustomerStatusEnum.CustomerStatus
const CustomerStatusMap: Record<number | string, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'ENABLED',
  3: 'DISABLED',   // 账号已禁用
  4: 'REMOVED',    // 账号已删除
  'UNSPECIFIED': 'UNSPECIFIED',
  'UNKNOWN': 'UNKNOWN',
  'ENABLED': 'ENABLED',
  'DISABLED': 'DISABLED',
  'REMOVED': 'REMOVED',
  // 兼容旧的错误映射
  'CANCELED': 'DISABLED',
  'CANCELLED': 'DISABLED',
  'SUSPENDED': 'DISABLED',
  'CLOSED': 'REMOVED',
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
  is_manager_account: number
  is_active: number
  status: string | null
  test_account: number
  parent_mcc_id: string | null
  last_sync_at: string | null
}

/**
 * 从数据库获取缓存的账号列表
 */
function getCachedAccounts(userId: number): CachedAccount[] {
  const db = getSQLiteDatabase()
  return db.prepare(`
    SELECT id, customer_id, account_name, currency, timezone,
           is_manager_account, is_active, status, test_account,
           parent_mcc_id, last_sync_at
    FROM google_ads_accounts
    WHERE user_id = ?
    ORDER BY is_manager_account DESC, account_name ASC
  `).all(userId) as CachedAccount[]
}

/**
 * 保存或更新账号到数据库
 */
function upsertAccount(userId: number, account: {
  customer_id: string
  descriptive_name: string
  currency_code: string
  time_zone: string
  manager: boolean
  test_account: boolean
  status: string
  parent_mcc?: string
}): number {
  const db = getSQLiteDatabase()

  // 检查是否已存在
  const existing = db.prepare(`
    SELECT id FROM google_ads_accounts
    WHERE user_id = ? AND customer_id = ?
  `).get(userId, account.customer_id) as { id: number } | undefined

  if (existing) {
    // 更新
    db.prepare(`
      UPDATE google_ads_accounts
      SET account_name = ?,
          currency = ?,
          timezone = ?,
          is_manager_account = ?,
          test_account = ?,
          status = ?,
          parent_mcc_id = ?,
          last_sync_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager ? 1 : 0,
      account.test_account ? 1 : 0,
      account.status,
      account.parent_mcc || null,
      existing.id
    )
    return existing.id
  } else {
    // 插入
    const result = db.prepare(`
      INSERT INTO google_ads_accounts (
        user_id, customer_id, account_name, currency, timezone,
        is_manager_account, test_account, status, parent_mcc_id, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      userId,
      account.customer_id,
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager ? 1 : 0,
      account.test_account ? 1 : 0,
      account.status,
      account.parent_mcc || null
    )
    return result.lastInsertRowid as number
  }
}

/**
 * 从 Google Ads API 获取账号并同步到数据库
 */
async function syncAccountsFromAPI(userId: number, credentials: any): Promise<any[]> {
  console.log(`🔄 从 Google Ads API 同步账号...`)

  const client = getGoogleAdsClient()
  const response = await client.listAccessibleCustomers(credentials.refresh_token)
  const resourceNames = response.resource_names || []
  const customerIds = resourceNames.map((resourceName: string) => {
    const parts = resourceName.split('/')
    return parts[parts.length - 1]
  })

  console.log(`   直接可访问账户: ${customerIds.join(', ')}`)

  const allAccounts: any[] = []
  const processedIds = new Set<string>()

  for (const customerId of customerIds) {
    if (processedIds.has(customerId)) continue

    // API追踪设置
    const apiStartTime = Date.now()
    let apiSuccess = false
    let apiErrorMessage: string | undefined

    try {
      const customer = await getCustomer(
        customerId,
        credentials.refresh_token,
        undefined,
        undefined,
        credentials.login_customer_id
      )
      const accountInfoQuery = `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.manager,
          customer.test_account,
          customer.status
        FROM customer
        WHERE customer.id = ${customerId}
      `

      const accountInfo = await customer.query(accountInfoQuery)
      apiSuccess = true // Account query succeeded

      if (accountInfo && accountInfo.length > 0) {
        const account = accountInfo[0]
        const rawStatus = account.customer?.status
        console.log(`[DEBUG] Account ${customerId} raw status:`, rawStatus, 'type:', typeof rawStatus)
        const parsedStatus = parseStatus(rawStatus)
        console.log(`[DEBUG] Account ${customerId} parsed status:`, parsedStatus)

        const accountData = {
          customer_id: customerId,
          descriptive_name: account.customer?.descriptive_name || `客户 ${customerId}`,
          currency_code: account.customer?.currency_code || 'USD',
          time_zone: account.customer?.time_zone || 'UTC',
          manager: account.customer?.manager || false,
          test_account: account.customer?.test_account || false,
          status: parsedStatus,
        }

        // 保存到数据库
        const dbId = upsertAccount(userId, accountData)
        allAccounts.push({ ...accountData, db_account_id: dbId })
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
            const childAccounts = await customer.query(childAccountsQuery)
            mccApiSuccess = true

            for (const child of childAccounts) {
              const childId = child.customer_client?.id?.toString()

              if (childId && !processedIds.has(childId)) {
                const rawChildStatus = child.customer_client?.status
                console.log(`[DEBUG] Child Account ${childId} raw status:`, rawChildStatus, 'type:', typeof rawChildStatus)
                const parsedChildStatus = parseStatus(rawChildStatus)
                console.log(`[DEBUG] Child Account ${childId} parsed status:`, parsedChildStatus)

                const childData = {
                  customer_id: childId,
                  descriptive_name: child.customer_client?.descriptive_name || `客户 ${childId}`,
                  currency_code: child.customer_client?.currency_code || 'USD',
                  time_zone: child.customer_client?.time_zone || 'UTC',
                  manager: child.customer_client?.manager || false,
                  test_account: child.customer_client?.test_account || false,
                  status: parsedChildStatus,
                  parent_mcc: customerId,
                }

                const dbId = upsertAccount(userId, childData)
                allAccounts.push({ ...childData, db_account_id: dbId })
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
      apiErrorMessage = accountError.message
      console.warn(`   ⚠️ 获取账户 ${customerId} 信息失败: ${accountError.message}`)

      const fallbackData = {
        customer_id: customerId,
        descriptive_name: `客户 ${customerId}`,
        currency_code: 'USD',
        time_zone: 'UTC',
        manager: false,
        test_account: false,
        status: 'UNKNOWN',
      }
      const dbId = upsertAccount(userId, fallbackData)
      allAccounts.push({ ...fallbackData, db_account_id: dbId })
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
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const credentials = getGoogleAdsCredentials(authResult.user.userId)
    if (!credentials) {
      return NextResponse.json({ error: '未配置Google Ads凭证' }, { status: 404 })
    }

    if (!credentials.refresh_token) {
      return NextResponse.json({ error: '未找到Refresh Token，请先完成OAuth授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === 'true'
    console.log(`🔍 [GET /api/google-ads/credentials/accounts] forceRefresh=${forceRefresh}`)

    let allAccounts: any[]

    // 检查缓存
    const cachedAccounts = getCachedAccounts(authResult.user.userId)
    console.log(`📦 缓存中有 ${cachedAccounts.length} 个账号`)

    if (!forceRefresh && cachedAccounts.length > 0) {
      // 使用缓存数据
      console.log(`✅ 使用缓存的 ${cachedAccounts.length} 个账号`)
      allAccounts = cachedAccounts.map(acc => ({
        customer_id: acc.customer_id,
        descriptive_name: acc.account_name || `客户 ${acc.customer_id}`,
        currency_code: acc.currency,
        time_zone: acc.timezone,
        manager: acc.is_manager_account === 1,
        test_account: acc.test_account === 1,
        status: acc.status || 'UNKNOWN',
        parent_mcc: acc.parent_mcc_id,
        db_account_id: acc.id,
        last_sync_at: acc.last_sync_at,
      }))
    } else {
      // 从 API 获取并同步
      console.log(`🔄 强制刷新: 从 Google Ads API 同步账号...`)
      allAccounts = await syncAccountsFromAPI(authResult.user.userId, credentials)
      console.log(`✅ 同步完成，获取到 ${allAccounts.length} 个账号`)
    }

    // 查询关联的 Offer 信息
    const db = getSQLiteDatabase()
    const accountsWithOffers = allAccounts.map(account => {
      const dbAccountId = account.db_account_id
      if (!dbAccountId) {
        return { ...account, linked_offers: [] }
      }

      const linkedOffers = db.prepare(`
        SELECT DISTINCT
          o.id,
          o.offer_name,
          o.brand,
          o.target_country,
          o.is_active,
          COUNT(DISTINCT c.id) as campaign_count
        FROM offers o
        INNER JOIN campaigns c ON o.id = c.offer_id
        WHERE c.google_ads_account_id = ?
          AND c.user_id = ?
          AND (o.is_deleted = 0 OR o.is_deleted IS NULL)
          AND c.status != 'REMOVED'
        GROUP BY o.id, o.offer_name, o.brand, o.target_country, o.is_active
      `).all(dbAccountId, authResult.user!.userId)

      return { ...account, linked_offers: linkedOffers }
    })

    return NextResponse.json({
      success: true,
      data: {
        total: accountsWithOffers.length,
        accounts: accountsWithOffers,
        cached: !forceRefresh && cachedAccounts.length > 0,
      },
    })

  } catch (error: any) {
    console.error('获取Google Ads账户失败:', error)
    return NextResponse.json(
      { error: '获取Google Ads账户失败', message: error.message || '未知错误' },
      { status: 500 }
    )
  }
}
