import { NextRequest, NextResponse } from 'next/server'
import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { findGoogleAdsAccountById, findEnabledGoogleAdsAccounts } from '@/lib/google-ads-accounts'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getDatabase } from '@/lib/db'

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

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取用户可用的Google Ads账号（ENABLED状态，非Manager账号）
    const googleAdsAccounts = await findEnabledGoogleAdsAccounts(parseInt(userId, 10))

    if (googleAdsAccounts.length === 0) {
      return NextResponse.json({
        campaigns: [],
        message: '未找到已连接的Google Ads账号',
      })
    }

    // 使用第一个激活账号
    const googleAdsAccount = googleAdsAccounts[0]

    if (!googleAdsAccount.refreshToken && !googleAdsAccount.serviceAccountId) {
      return NextResponse.json({
        error: 'Google Ads账号缺少认证信息',
        needsReauth: true,
      }, { status: 400 })
    }

    // 获取用户的 Google Ads 凭证
    const credentials = await getGoogleAdsCredentialsFromDB(parseInt(userId, 10))

    // 判断使用服务账号还是 OAuth 认证
    const useServiceAccount = googleAdsAccount.serviceAccountId && credentials.useServiceAccount

    let customer: any

    if (useServiceAccount) {
      // 服务账号模式 - 检查配置是否存在
      const config = await getServiceAccountConfig(
        parseInt(userId, 10),
        googleAdsAccount.serviceAccountId as string
      )

      if (!config) {
        return NextResponse.json(
          { error: '未找到服务账号配置' },
          { status: 400 }
        )
      }

      // 使用统一客户端（服务账号模式）
      customer = await getCustomerWithCredentials({
        customerId: googleAdsAccount.customerId,
        accountId: googleAdsAccount.id,
        userId: parseInt(userId, 10),
        loginCustomerId: googleAdsAccount.parentMccId || credentials.login_customer_id,
        authType: 'service_account',
        serviceAccountId: googleAdsAccount.serviceAccountId as string,
      })
    } else {
      // OAuth 模式
      if (!googleAdsAccount.refreshToken) {
        return NextResponse.json({
          error: 'Google Ads账号缺少refresh token',
          needsReauth: true,
        }, { status: 400 })
      }

      const loginCustomerId = googleAdsAccount.parentMccId || credentials.login_customer_id

      // 使用统一客户端（OAuth模式）
      customer = await getCustomerWithCredentials({
        customerId: googleAdsAccount.customerId,
        refreshToken: googleAdsAccount.refreshToken,
        loginCustomerId,
        credentials: {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          developer_token: credentials.developer_token,
        },
        accountId: googleAdsAccount.id,
        userId: parseInt(userId, 10),
      })
    }

    // 查询该账号下所有广告系列
    // 注意：Google Ads API不直接支持按Offer筛选，我们需要通过广告系列名称来匹配
    // 广告系列名称格式通常包含Offer名称，例如: "Reolink_US_01_1234567890"

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
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `

    // 根据认证模式选择正确的查询方法
    const campaigns = useServiceAccount
      ? await customer.search({ query })
      : await customer.query(query)

    // 提取CPC信息
    const formattedCampaigns = campaigns.map((campaign: any) => {
      // 默认CPC值（如果没有设置则为0）
      let currentCpc = 0
      let currency = googleAdsAccount.currency || 'USD'

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
      }
    })

    // 从数据库获取该Offer关联的campaign_id列表
    const db = await getDatabase()
    const localCampaigns = await db.query(`
      SELECT campaign_id
      FROM campaigns
      WHERE offer_id = ? AND user_id = ?
    `, [id, parseInt(userId, 10)]) as Array<{ campaign_id: string }>
    const offerCampaignIds = new Set(localCampaigns.map(c => c.campaign_id))

    // 过滤出属于该Offer的广告系列（基于数据库映射关系）
    const offerCampaigns = formattedCampaigns.filter((campaign: any) => {
      return offerCampaignIds.has(campaign.id)
    })

    return NextResponse.json({
      success: true,
      campaigns: offerCampaigns,
      count: offerCampaigns.length,
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
