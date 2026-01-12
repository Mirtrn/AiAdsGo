import { NextRequest, NextResponse } from 'next/server'
import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { executeGAQLQueryPython } from '@/lib/python-ads-client'

/**
 * GET /api/offers/:id/campaigns
 * 获取Offer关联的所有Google Ads广告系列
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const requestId = request.headers.get('x-request-id') || undefined

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = await getDatabase()
    const numericUserId = parseInt(userId, 10)
    const offerId = parseInt(id, 10)

    // 从数据库获取该Offer关联的已发布campaign列表（google_campaign_id非空）
    // 注意：campaigns 表没有 is_deleted 字段，使用 status='REMOVED' 作为解除关联/移除标记
    const localCampaigns = await db.query(`
      SELECT
        c.google_campaign_id,
        c.google_ads_account_id,
        gaa.customer_id,
        gaa.account_name,
        gaa.currency,
        gaa.parent_mcc_id,
        gaa.service_account_id,
        gaa.is_active,
        gaa.is_deleted,
        c.created_at
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.offer_id = ?
        AND c.user_id = ?
        AND c.status != 'REMOVED'
        AND c.google_campaign_id IS NOT NULL
        AND c.google_campaign_id != ''
        AND c.google_ads_account_id IS NOT NULL
      ORDER BY c.created_at DESC
    `, [offerId, numericUserId]) as Array<{
      google_campaign_id: string
      google_ads_account_id: number
      customer_id: string | null
      account_name: string | null
      currency: string | null
      parent_mcc_id: string | null
      service_account_id: string | null
      is_active: any
      is_deleted: any
      created_at: string
    }>

    if (localCampaigns.length === 0) {
      return NextResponse.json({
        success: true,
        campaigns: [],
        message: '该Offer还没有创建任何广告系列，请先发布广告',
      })
    }

    const credentials = await getGoogleAdsCredentialsFromDB(numericUserId)
    const useServiceAccount = Boolean(credentials.useServiceAccount)
    let serviceAccountId: string | undefined

    const oauthRefreshToken = !useServiceAccount
      ? (await getGoogleAdsCredentials(numericUserId))?.refresh_token || null
      : null

    if (useServiceAccount) {
      const config = await getServiceAccountConfig(numericUserId)
      if (!config) {
        return NextResponse.json({ error: '未找到服务账号配置' }, { status: 400 })
      }
      serviceAccountId = config.id
    } else if (!oauthRefreshToken) {
      return NextResponse.json({
        error: 'Google Ads OAuth未授权或已过期，请先在设置页面重新授权',
        needsReauth: true,
      }, { status: 400 })
    }

    // 按账号分组 campaign ids（一个Offer可能关联多个Ads账号）
    const campaignsByAccountId = new Map<number, {
      customerId: string
      accountName: string | null
      currency: string
      parentMccId: string | null
      serviceAccountId: string | null
      campaignIds: number[]
    }>()
    for (const row of localCampaigns) {
      if (!row.customer_id) continue
      const isActive = row.is_active === true || row.is_active === 1
      const isDeleted = row.is_deleted === true || row.is_deleted === 1
      if (!isActive || isDeleted) continue

      const campaignIdNum = Number(row.google_campaign_id)
      if (!Number.isFinite(campaignIdNum)) continue

      if (!campaignsByAccountId.has(row.google_ads_account_id)) {
        campaignsByAccountId.set(row.google_ads_account_id, {
          customerId: row.customer_id,
          accountName: row.account_name || null,
          currency: row.currency || 'USD',
          parentMccId: row.parent_mcc_id || null,
          serviceAccountId: row.service_account_id || null,
          campaignIds: []
        })
      }
      campaignsByAccountId.get(row.google_ads_account_id)!.campaignIds.push(campaignIdNum)
    }

    if (campaignsByAccountId.size === 0) {
      return NextResponse.json({
        success: true,
        campaigns: [],
        message: '该Offer关联的Ads账号已解除关联或不可用',
      })
    }

    const results: any[] = []
    for (const [googleAdsAccountId, account] of campaignsByAccountId.entries()) {
      const uniqueIds = Array.from(new Set(account.campaignIds))
      const query = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign_budget.amount_micros,
          campaign.bidding_strategy_type,
          campaign.target_cpa.target_cpa_micros,
          campaign.target_roas.target_roas,
          campaign.manual_cpc.enhanced_cpc_enabled,
          campaign.maximize_conversions.target_cpa_micros
        FROM campaign
        WHERE campaign.id IN (${uniqueIds.join(', ')})
          AND campaign.status != 'REMOVED'
        ORDER BY campaign.name
      `

      if (useServiceAccount) {
        const fetched = await executeGAQLQueryPython({
          userId: numericUserId,
          serviceAccountId,
          customerId: account.customerId,
          query,
          requestId
        })
        results.push(...fetched.map((r: any) => ({
          ...r,
          __currency: account.currency,
          __googleAdsAccountId: googleAdsAccountId,
          __adsCustomerId: account.customerId,
          __adsAccountName: account.accountName,
        })))
      } else {
        const loginCustomerId = account.parentMccId || credentials.login_customer_id
        const customer = await getCustomerWithCredentials({
          customerId: account.customerId,
          refreshToken: oauthRefreshToken || undefined,
          loginCustomerId,
          accountId: undefined,
          userId: numericUserId,
        })
        const fetched = await customer.query(query)
        results.push(...fetched.map((r: any) => ({
          ...r,
          __currency: account.currency,
          __googleAdsAccountId: googleAdsAccountId,
          __adsCustomerId: account.customerId,
          __adsAccountName: account.accountName,
        })))
      }
    }

    // 提取CPC信息
    const formattedCampaigns = results.map((campaign: any) => {
      // 默认CPC值（如果没有设置则为0）
      let currentCpc = 0
      let currency = campaign.__currency || 'USD'

      // 根据竞价策略类型获取CPC
      // 对于Manual CPC策略，CPC在ad group层级设置，这里我们返回0，让用户在ad group层级调整
      // 对于Target CPA，我们显示目标CPA作为参考
      if (campaign.campaign.bidding_strategy_type === 'TARGET_CPA') {
        const targetCpaMicros =
          campaign.campaign.target_cpa?.target_cpa_micros ||
          campaign.campaign.maximize_conversions?.target_cpa_micros ||
          0
        currentCpc = targetCpaMicros / 1000000 // 转换为实际货币单位
      }

      return {
        id: campaign.campaign.id.toString(),
        name: campaign.campaign.name,
        status: campaign.campaign.status,
        currentCpc: currentCpc,
        currency: currency,
        biddingStrategy: campaign.campaign.bidding_strategy_type,
        googleAdsAccountId: campaign.__googleAdsAccountId ?? null,
        adsCustomerId: campaign.__adsCustomerId ?? null,
        adsAccountName: campaign.__adsAccountName ?? null,
      }
    })

    return NextResponse.json({
      success: true,
      campaigns: formattedCampaigns,
      count: formattedCampaigns.length,
    })
  } catch (error: any) {
    console.error('获取广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告系列失败',
      },
      { status: 500 }
    )
  }
}
