import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getGoogleAdsClient, getCustomer } from '@/lib/google-ads-api'
import { getDatabase } from '@/lib/db'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { getUserOnlySetting } from '@/lib/settings'

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
  account_balance: number | null
  parent_mcc_id: string | null
  last_sync_at: string | null
}

/**
 * 从数据库获取缓存的账号列表
 */
async function getCachedAccounts(userId: number): Promise<CachedAccount[]> {
  const db = await getDatabase()
  return await db.query(`
    SELECT id, customer_id, account_name, currency, timezone,
           is_manager_account, is_active, status, test_account,
           account_balance, parent_mcc_id, last_sync_at
    FROM google_ads_accounts
    WHERE user_id = ?
    ORDER BY is_manager_account DESC, account_name ASC
  `, [userId]) as CachedAccount[]
}

/**
 * 保存或更新账号到数据库
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
}): Promise<number> {
  const db = await getDatabase()

  // 检查是否已存在
  const existing = await db.queryOne(`
    SELECT id FROM google_ads_accounts
    WHERE user_id = ? AND customer_id = ?
  `, [userId, account.customer_id]) as { id: number } | undefined

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
          last_sync_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager ? 1 : 0,
      account.test_account ? 1 : 0,
      account.status,
      account.account_balance ?? null,
      account.parent_mcc || null,
      existing.id
    ])
    return existing.id
  } else {
    // 插入
    const result = await db.exec(`
      INSERT INTO google_ads_accounts (
        user_id, customer_id, account_name, currency, timezone,
        is_manager_account, test_account, status, account_balance, parent_mcc_id, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      userId,
      account.customer_id,
      account.descriptive_name,
      account.currency_code,
      account.time_zone,
      account.manager ? 1 : 0,
      account.test_account ? 1 : 0,
      account.status,
      account.account_balance ?? null,
      account.parent_mcc || null
    ])
    return result.lastInsertRowid as number
  }
}

/**
 * 从 Google Ads API 获取账号并同步到数据库
 */
async function syncAccountsFromAPI(userId: number, credentials: any): Promise<any[]> {
  console.log(`🔄 从 Google Ads API 同步账号...`)

  // 获取凭证配置（用户配置优先，否则回退到管理员配置）
  let clientId = credentials.client_id
  let clientSecret = credentials.client_secret
  let developerToken = credentials.developer_token

  // 如果用户未配置这3个参数，从数据库获取管理员配置
  if (!clientId || !clientSecret || !developerToken) {
    const { getSetting } = await import('@/lib/settings')
    const autoadsUserId = 1 // 管理员用户ID

    if (!clientId) {
      clientId = (await getSetting('google_ads', 'client_id', autoadsUserId))?.value
    }
    if (!clientSecret) {
      clientSecret = (await getSetting('google_ads', 'client_secret', autoadsUserId))?.value
    }
    if (!developerToken) {
      developerToken = (await getSetting('google_ads', 'developer_token', autoadsUserId))?.value
    }

    console.log(`   使用管理员配置: client_id=${!!clientId}, client_secret=${!!clientSecret}, developer_token=${!!developerToken}`)
  } else {
    console.log(`   使用用户自己的配置`)
  }

  // 创建客户端
  const client = getGoogleAdsClient({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  })

  const response = await client.listAccessibleCustomers(credentials.refresh_token)
  const resourceNames = response.resource_names || []
  const customerIds = resourceNames.map((resourceName: string) => {
    const parts = resourceName.split('/')
    return parts[parts.length - 1]
  })

  console.log(`   🔍 API响应: ${JSON.stringify(response, null, 2)}`)
  console.log(`   🔍 Resource Names: ${resourceNames.join(', ')}`)
  console.log(`   ✅ 直接可访问账户 (${customerIds.length}个): ${customerIds.join(', ')}`)
  console.log(`   🔑 Login Customer ID: ${credentials.login_customer_id || '未设置'}`)

  const allAccounts: any[] = []
  const processedIds = new Set<string>()

  for (const customerId of customerIds) {
    if (processedIds.has(customerId)) continue

    // API追踪设置
    const apiStartTime = Date.now()
    let apiSuccess = false
    let apiErrorMessage: string | undefined

    try {
      // 🔧 修复：确保login_customer_id正确传递（MCC账户必需）
      const loginCustomerId = credentials.login_customer_id || customerId
      console.log(`   🔍 请求账户 ${customerId} 信息，使用 login_customer_id: ${loginCustomerId}`)

      const customer = await getCustomer(
        customerId,
        credentials.refresh_token,
        undefined,
        undefined,
        loginCustomerId,
        {
          client_id: clientId,
          client_secret: clientSecret,
          developer_token: developerToken,
        }
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
          const budgetInfo = await customer.query(budgetQuery)
          if (budgetInfo && budgetInfo.length > 0) {
            const budget = budgetInfo[0].account_budget
            const amountServed = Number(budget?.amount_served_micros || 0)
            const spendingLimit = Number(budget?.approved_spending_limit_micros || budget?.proposed_spending_limit_micros || 0)
            // 余额 = 预算 - 已使用
            accountBalance = spendingLimit > 0 ? spendingLimit - amountServed : null
            console.log(`   💰 ${customerId} 余额: ${accountBalance ? (accountBalance / 1000000).toFixed(2) : 'N/A'}`)
          }
        } catch (budgetError) {
          console.log(`   ⚠️ ${customerId} 无法获取预算信息（可能账户无预算设置）`)
        }

        const accountData = {
          customer_id: customerId,
          descriptive_name: account.customer?.descriptive_name || `客户 ${customerId}`,
          currency_code: account.customer?.currency_code || 'USD',
          time_zone: account.customer?.time_zone || 'UTC',
          manager: account.customer?.manager || false,
          test_account: account.customer?.test_account || false,
          status: parsedStatus,
          account_balance: accountBalance,
        }

        // 保存到数据库
        const dbId = await upsertAccount(userId, accountData)
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

                // 查询子账户预算信息获取余额
                let childBalance: number | null = null
                const isChildManager = child.customer_client?.manager || false
                if (!isChildManager) {
                  try {
                    const childCustomer = await getCustomer(
                      childId,
                      credentials.refresh_token,
                      undefined,
                      undefined,
                      credentials.login_customer_id,
                      {
                        client_id: clientId,
                        client_secret: clientSecret,
                        developer_token: developerToken,
                      }
                    )
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
                    const childBudgetInfo = await childCustomer.query(childBudgetQuery)
                    if (childBudgetInfo && childBudgetInfo.length > 0) {
                      const budget = childBudgetInfo[0].account_budget
                      const amountServed = Number(budget?.amount_served_micros || 0)
                      const spendingLimit = Number(budget?.approved_spending_limit_micros || budget?.proposed_spending_limit_micros || 0)
                      childBalance = spendingLimit > 0 ? spendingLimit - amountServed : null
                      console.log(`      💰 ${childId} 余额: ${childBalance ? (childBalance / 1000000).toFixed(2) : 'N/A'}`)
                    }
                  } catch (budgetError) {
                    console.log(`      ⚠️ ${childId} 无法获取预算信息`)
                  }
                }

                const childData = {
                  customer_id: childId,
                  descriptive_name: child.customer_client?.descriptive_name || `客户 ${childId}`,
                  currency_code: child.customer_client?.currency_code || 'USD',
                  time_zone: child.customer_client?.time_zone || 'UTC',
                  manager: isChildManager,
                  test_account: child.customer_client?.test_account || false,
                  status: parsedChildStatus,
                  account_balance: childBalance,
                  parent_mcc: customerId,
                }

                const dbId = await upsertAccount(userId, childData)
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
      const dbId = await upsertAccount(userId, fallbackData)
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

    const userId = authResult.user.userId

    // 🔧 修复(2025-12-11): 支持用户只配置 login_customer_id，使用共享管理员配置
    let credentials = await getGoogleAdsCredentials(userId)
    let usingSharedConfig = false

    if (!credentials) {
      // 用户没有 google_ads_credentials 记录，检查是否配置了 login_customer_id
      const userLoginCustomerId = await getUserOnlySetting('google_ads', 'login_customer_id', userId)

      if (userLoginCustomerId?.value) {
        // 用户配置了 login_customer_id，检查管理员是否有完整的共享配置
        const adminCredentials = await getGoogleAdsCredentials(1) // 1 = autoads管理员
        if (adminCredentials && adminCredentials.refresh_token) {
          // 使用管理员的凭证，但替换 login_customer_id
          credentials = {
            ...adminCredentials,
            login_customer_id: userLoginCustomerId.value,
            user_id: userId
          }
          usingSharedConfig = true
          console.log(`✅ 用户 ${userId} 使用共享管理员配置，login_customer_id: ${userLoginCustomerId.value}`)
        }
      }

      if (!credentials) {
        return NextResponse.json({ error: '未配置Google Ads凭证' }, { status: 404 })
      }
    }

    if (!credentials.refresh_token) {
      return NextResponse.json({ error: '未找到Refresh Token，请先完成OAuth授权' }, { status: 401 })
    }

    // 校验: login_customer_id 必须存在（MCC账户ID是调用Google Ads API的必填项）
    if (!credentials.login_customer_id) {
      return NextResponse.json({
        error: '缺少 Login Customer ID (MCC账户ID)',
        message: '请先在设置页面配置 Login Customer ID，这是使用 Google Ads API 的必填项'
      }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === 'true'
    console.log(`🔍 [GET /api/google-ads/credentials/accounts] forceRefresh=${forceRefresh}, usingSharedConfig=${usingSharedConfig}`)

    let allAccounts: any[]

    // 检查缓存
    const cachedAccounts = await getCachedAccounts(userId)
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
        account_balance: acc.account_balance,
        parent_mcc: acc.parent_mcc_id,
        db_account_id: acc.id,
        last_sync_at: acc.last_sync_at,
      }))
    } else {
      // 从 API 获取并同步
      console.log(`🔄 强制刷新: 从 Google Ads API 同步账号...`)
      allAccounts = await syncAccountsFromAPI(userId, credentials)
      console.log(`✅ 同步完成，获取到 ${allAccounts.length} 个账号`)
    }

    // 查询关联的 Offer 信息
    const db = await getDatabase()
    const accountsWithOffers = await Promise.all(allAccounts.map(async (account) => {
      const dbAccountId = account.db_account_id
      if (!dbAccountId) {
        return { ...account, linked_offers: [] }
      }

      const linkedOffers = await db.query(`
        SELECT DISTINCT
          o.id,
          o.offer_name,
          o.brand,
          o.target_country,
          CASE WHEN o.is_deleted = TRUE OR o.is_deleted = 1 THEN 0 ELSE 1 END as is_active,
          COUNT(DISTINCT c.id) as campaign_count
        FROM offers o
        INNER JOIN campaigns c ON o.id = c.offer_id
        WHERE c.google_ads_account_id = ?
          AND c.user_id = ?
          AND (o.is_deleted = FALSE OR o.is_deleted = 0 OR o.is_deleted IS NULL)
          AND c.status != 'REMOVED'
        GROUP BY o.id, o.offer_name, o.brand, o.target_country, o.is_deleted
      `, [dbAccountId, userId])

      return { ...account, linked_offers: linkedOffers }
    }))

    return NextResponse.json({
      success: true,
      data: {
        total: accountsWithOffers.length,
        accounts: accountsWithOffers,
        cached: !forceRefresh && cachedAccounts.length > 0,
        usingSharedConfig, // 返回是否使用共享配置的标记
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
