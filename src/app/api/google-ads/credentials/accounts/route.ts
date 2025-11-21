import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getGoogleAdsClient, getCustomer } from '@/lib/google-ads-api'
import { getDatabase } from '@/lib/db'

// Google Ads CustomerStatus 枚举值映射
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
  'SUSPENDED': 'SUSPENDED',
  'CLOSED': 'CLOSED',
}

function parseStatus(status: any): string {
  if (status === undefined || status === null) return 'UNKNOWN'
  const mapped = CustomerStatusMap[status]
  return mapped || String(status)
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
  const db = getDatabase()
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
  const db = getDatabase()

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

    try {
      const customer = await getCustomer(customerId, credentials.refresh_token)
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

      if (accountInfo && accountInfo.length > 0) {
        const account = accountInfo[0]
        const accountData = {
          customer_id: customerId,
          descriptive_name: account.customer?.descriptive_name || `客户 ${customerId}`,
          currency_code: account.customer?.currency_code || 'USD',
          time_zone: account.customer?.time_zone || 'UTC',
          manager: account.customer?.manager || false,
          test_account: account.customer?.test_account || false,
          status: parseStatus(account.customer?.status),
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
            WHERE customer_client.status = 'ENABLED'
          `

          try {
            const childAccounts = await customer.query(childAccountsQuery)

            for (const child of childAccounts) {
              const childId = child.customer_client?.id?.toString()

              if (childId && !processedIds.has(childId)) {
                const childData = {
                  customer_id: childId,
                  descriptive_name: child.customer_client?.descriptive_name || `客户 ${childId}`,
                  currency_code: child.customer_client?.currency_code || 'USD',
                  time_zone: child.customer_client?.time_zone || 'UTC',
                  manager: child.customer_client?.manager || false,
                  test_account: child.customer_client?.test_account || false,
                  status: parseStatus(child.customer_client?.status),
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
            console.warn(`   ⚠️ 查询MCC ${customerId} 子账户失败: ${childError.message}`)
          }
        }
      }
    } catch (accountError: any) {
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

    let allAccounts: any[]

    // 检查缓存
    const cachedAccounts = getCachedAccounts(authResult.user.userId)

    if (!forceRefresh && cachedAccounts.length > 0) {
      // 使用缓存数据
      console.log(`📦 使用缓存的 ${cachedAccounts.length} 个账号`)
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
      allAccounts = await syncAccountsFromAPI(authResult.user.userId, credentials)
    }

    // 查询关联的 Offer 信息
    const db = getDatabase()
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
