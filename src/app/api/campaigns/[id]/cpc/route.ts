import { NextRequest, NextResponse } from 'next/server'

import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getDatabase } from '@/lib/db'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { executeGAQLQueryPython } from '@/lib/python-ads-client'

function extractSearchResults(result: any): any[] {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.results)) return result.results
  return []
}

function toBiddingStrategyType(value: unknown): string {
  if (value === undefined || value === null) return 'UNKNOWN'
  if (typeof value === 'object') {
    const candidate: any = value
    if ('value' in candidate) return toBiddingStrategyType(candidate.value)
    if ('name' in candidate) return toBiddingStrategyType(candidate.name)
  }
  return String(value).toUpperCase()
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const requestId = request.headers.get('x-request-id') || undefined
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: '未授权' }, { status: 401 })

    const numericUserId = Number(userId)
    if (!Number.isFinite(numericUserId)) return NextResponse.json({ error: '未授权' }, { status: 401 })

    const campaignIdNum = Number(params.id)
    if (!Number.isFinite(campaignIdNum)) {
      return NextResponse.json({ error: '无效的campaignId' }, { status: 400 })
    }

    const db = await getDatabase()

    const linked = await db.queryOne(`
      SELECT
        c.google_ads_account_id,
        gaa.customer_id,
        gaa.currency,
        gaa.parent_mcc_id,
        gaa.service_account_id,
        gaa.is_active,
        gaa.is_deleted
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.user_id = ?
        AND c.status != 'REMOVED'
        AND c.google_campaign_id = ?
        AND c.google_ads_account_id IS NOT NULL
      ORDER BY c.created_at DESC
      LIMIT 1
    `, [numericUserId, String(campaignIdNum)]) as {
      google_ads_account_id: number
      customer_id: string | null
      currency: string | null
      parent_mcc_id: string | null
      service_account_id: string | null
      is_active: any
      is_deleted: any
    } | undefined

    if (!linked?.customer_id) {
      return NextResponse.json({ error: '未找到关联的Ads账号或Campaign未发布' }, { status: 404 })
    }

    const isActive = linked.is_active === true || linked.is_active === 1
    const isDeleted = linked.is_deleted === true || linked.is_deleted === 1
    if (!isActive || isDeleted) {
      return NextResponse.json({ error: '关联的Ads账号不可用（可能已解除关联）' }, { status: 400 })
    }

    const credentials = await getGoogleAdsCredentialsFromDB(numericUserId)
    const useServiceAccount = Boolean(credentials.useServiceAccount)

    let serviceAccountId: string | undefined
    if (useServiceAccount) {
      const config = await getServiceAccountConfig(numericUserId)
      if (!config) return NextResponse.json({ error: '未找到服务账号配置' }, { status: 400 })
      serviceAccountId = config.id
    }

    const oauthRefreshToken = !useServiceAccount
      ? (await getGoogleAdsCredentials(numericUserId))?.refresh_token || null
      : null

    if (!useServiceAccount && !oauthRefreshToken) {
      return NextResponse.json({ error: 'Google Ads OAuth未授权或已过期', needsReauth: true }, { status: 400 })
    }

    const campaignQuery = `
      SELECT
        campaign.id,
        campaign.status,
        campaign.bidding_strategy_type,
        campaign.maximize_clicks.max_cpc_bid_micros,
        campaign.target_cpa.target_cpa_micros,
        campaign.maximize_conversions.target_cpa_micros
      FROM campaign
      WHERE campaign.id = ${campaignIdNum}
        AND campaign.status != 'REMOVED'
    `

    let campaignRows: any[] = []
    if (useServiceAccount) {
      const fetched = await executeGAQLQueryPython({
        userId: numericUserId,
        serviceAccountId,
        customerId: linked.customer_id,
        query: campaignQuery,
        requestId,
      })
      campaignRows = extractSearchResults(fetched)
    } else {
      const loginCustomerId = linked.parent_mcc_id || credentials.login_customer_id
      const customer = await getCustomerWithCredentials({
        customerId: linked.customer_id,
        refreshToken: oauthRefreshToken || undefined,
        loginCustomerId,
        accountId: undefined,
        userId: numericUserId,
      })
      campaignRows = await customer.query(campaignQuery)
    }

    const campaign = campaignRows?.[0]?.campaign
    if (!campaign) {
      return NextResponse.json({ error: '未找到该Campaign（可能已删除）' }, { status: 404 })
    }

    const biddingStrategyType = toBiddingStrategyType(campaign.bidding_strategy_type)
    const currency = linked.currency || 'USD'

    let currentCpc: number | null = null
    if (biddingStrategyType === 'MAXIMIZE_CLICKS') {
      const micros = Number(campaign.maximize_clicks?.max_cpc_bid_micros || 0)
      currentCpc = Number.isFinite(micros) && micros > 0 ? micros / 1000000 : 0
    } else if (biddingStrategyType === 'TARGET_CPA') {
      const micros = Number(
        campaign.target_cpa?.target_cpa_micros ||
        campaign.maximize_conversions?.target_cpa_micros ||
        0
      )
      currentCpc = Number.isFinite(micros) && micros > 0 ? micros / 1000000 : 0
    } else if (biddingStrategyType === 'MANUAL_CPC') {
      const adGroupQuery = `
        SELECT
          ad_group.cpc_bid_micros
        FROM ad_group
        WHERE campaign.id = ${campaignIdNum}
          AND ad_group.status != 'REMOVED'
          AND ad_group.cpc_bid_micros > 0
        ORDER BY ad_group.id
        LIMIT 1
      `

      let adGroupRows: any[] = []
      if (useServiceAccount) {
        const fetched = await executeGAQLQueryPython({
          userId: numericUserId,
          serviceAccountId,
          customerId: linked.customer_id,
          query: adGroupQuery,
          requestId,
        })
        adGroupRows = extractSearchResults(fetched)
      } else {
        const loginCustomerId = linked.parent_mcc_id || credentials.login_customer_id
        const customer = await getCustomerWithCredentials({
          customerId: linked.customer_id,
          refreshToken: oauthRefreshToken || undefined,
          loginCustomerId,
          accountId: undefined,
          userId: numericUserId,
        })
        adGroupRows = await customer.query(adGroupQuery)
      }

      const micros = Number(adGroupRows?.[0]?.ad_group?.cpc_bid_micros || 0)
      currentCpc = Number.isFinite(micros) && micros > 0 ? micros / 1000000 : 0
    }

    return NextResponse.json({
      success: true,
      campaignId: String(campaignIdNum),
      biddingStrategyType,
      currency,
      currentCpc,
    })
  } catch (error: any) {
    console.error('获取Campaign CPC配置失败:', error)
    return NextResponse.json({ error: error.message || '获取Campaign CPC配置失败' }, { status: 500 })
  }
}

