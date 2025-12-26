import { NextRequest, NextResponse } from 'next/server'
import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { findEnabledGoogleAdsAccounts } from '@/lib/google-ads-accounts'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getUserAuthType } from '@/lib/google-ads-oauth'
import { executeGAQLQueryPython, updateCampaignPython, updateAdGroupPython } from '@/lib/python-ads-client'

/**
 * 统一的 Mutate 操作（支持 OAuth 和服务账号两种认证模式）
 * 🔧 修复(2025-12-26): 服务账号模式使用 Python 服务更新
 *
 * @param customer - Google Ads 客户端
 * @param isServiceAccount - 是否为服务账号模式
 * @param mutateType - mutate 类型 (ad_group, campaign 等)
 * @param operations - 操作数组
 * @param userId - 用户ID（服务账号模式需要）
 * @param serviceAccountId - 服务账号ID（服务账号模式需要）
 * @param customerId - 客户ID（服务账号模式需要）
 */
async function mutateResources(
  customer: any,
  isServiceAccount: boolean,
  mutateType: string,
  operations: any[],
  userId: number,
  serviceAccountId: string | undefined,
  customerId: string
): Promise<void> {
  if (isServiceAccount) {
    // 服务账号模式：使用 Python 服务更新
    const { updateCampaignPython, updateAdGroupPython } = await import('@/lib/python-ads-client')

    for (const op of operations) {
      const resourceName = op.update.resource_name
      const cpcBidMicros = op.update.cpc_bid_micros

      if (mutateType === 'campaign') {
        await updateCampaignPython({
          userId,
          serviceAccountId,
          customerId,
          campaignResourceName: resourceName,
          cpcBidMicros,
        })
      } else if (mutateType === 'ad_group') {
        await updateAdGroupPython({
          userId,
          serviceAccountId,
          customerId,
          adGroupResourceName: resourceName,
          cpcBidMicros,
        })
      } else {
        throw new Error(`服务账号模式不支持的 mutate 类型: ${mutateType}`)
      }
    }
  } else {
    // OAuth 模式：使用 google-ads-api 的 update 方法
    switch (mutateType) {
      case 'ad_group':
        await customer.adGroups.update(operations)
        break
      case 'campaign':
        await customer.campaigns.update(operations)
        break
      default:
        throw new Error(`不支持的 mutate 类型: ${mutateType}`)
    }
  }
}

/**
 * PUT /api/campaigns/:id/update-cpc
 * 更新广告系列的CPC出价
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: campaignId } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { newCpc } = body

    if (!newCpc || newCpc <= 0) {
      return NextResponse.json(
        { error: '请提供有效的CPC值' },
        { status: 400 }
      )
    }

    // 获取用户可用的Google Ads账号（ENABLED状态，非Manager账号）
    const googleAdsAccounts = await findEnabledGoogleAdsAccounts(parseInt(userId, 10))

    if (googleAdsAccounts.length === 0) {
      return NextResponse.json(
        {
          error: '未找到已连接的Google Ads账号',
          needsConnection: true,
        },
        { status: 400 }
      )
    }

    // 使用第一个激活账号
    const googleAdsAccount = googleAdsAccounts[0]

    if (!googleAdsAccount.refreshToken && !googleAdsAccount.serviceAccountId) {
      return NextResponse.json(
        {
          error: 'Google Ads账号缺少认证信息',
          needsReauth: true,
        },
        { status: 400 }
      )
    }

    // 获取用户的 Google Ads 凭证
    const credentials = await getGoogleAdsCredentialsFromDB(parseInt(userId, 10))

    // 判断使用服务账号还是 OAuth 认证
    const useServiceAccount = !!(
      googleAdsAccount.serviceAccountId &&
      credentials.useServiceAccount
    )

    const auth = await getUserAuthType(parseInt(userId, 10))
    let customer: any

    if (auth.authType === 'service_account') {
      // 服务账号模式 - 检查配置是否存在
      const config = await getServiceAccountConfig(
        parseInt(userId, 10),
        auth.serviceAccountId
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
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })
    } else {
      // OAuth 模式
      if (!googleAdsAccount.refreshToken) {
        return NextResponse.json(
          {
            error: 'Google Ads账号缺少refresh token',
            needsReauth: true,
          },
          { status: 400 }
        )
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

    // 查询广告系列信息，获取竞价策略类型
    const campaignQuery = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.bidding_strategy_type,
        campaign.status
      FROM campaign
      WHERE campaign.id = ${campaignId}
    `

    // 根据认证模式选择正确的查询方法
    const campaignResults = useServiceAccount
      ? await executeGAQLQueryPython({ userId: parseInt(userId, 10), serviceAccountId: auth.serviceAccountId, customerId: googleAdsAccount.customerId, query: campaignQuery })
      : await customer.query(campaignQuery)

    if (campaignResults.length === 0) {
      return NextResponse.json(
        { error: '广告系列不存在' },
        { status: 404 }
      )
    }

    const campaign = campaignResults[0].campaign
    if (!campaign) {
      return NextResponse.json(
        { error: '未找到广告系列数据' },
        { status: 404 }
      )
    }

    const biddingStrategy = campaign.bidding_strategy_type

    // 根据竞价策略类型更新CPC
    if (biddingStrategy === 'MANUAL_CPC') {
      // Manual CPC: 更新该广告系列下所有Ad Group的CPC
      const adGroupQuery = `
        SELECT
          ad_group.id,
          ad_group.name,
          ad_group.status
        FROM ad_group
        WHERE campaign.id = ${campaignId}
          AND ad_group.status != 'REMOVED'
      `

      // 根据认证模式选择正确的查询方法
      const adGroups = useServiceAccount
        ? await executeGAQLQueryPython({ userId: parseInt(userId, 10), serviceAccountId: auth.serviceAccountId, customerId: googleAdsAccount.customerId, query: adGroupQuery })
        : await customer.query(adGroupQuery)

      if (adGroups.length === 0) {
        return NextResponse.json(
          { error: '该广告系列下没有广告组' },
          { status: 400 }
        )
      }

      // 更新每个Ad Group的CPC
      const cpcMicros = Math.round(newCpc * 1000000) // 转换为微单位

      const adGroupOperations = adGroups.map((adGroup: any) => ({
        update: {
          resource_name: `customers/${googleAdsAccount.customerId}/adGroups/${adGroup.ad_group.id}`,
          cpc_bid_micros: cpcMicros,
        },
        update_mask: 'cpc_bid_micros',
      }))

      // 批量更新Ad Groups
      await mutateResources(
        customer,
        useServiceAccount,
        'ad_group',
        adGroupOperations,
        parseInt(userId, 10),
        auth.serviceAccountId,
        googleAdsAccount.customerId
      )

      return NextResponse.json({
        success: true,
        message: `成功更新 ${adGroups.length} 个广告组的CPC为 ${newCpc}`,
        updatedAdGroups: adGroups.length,
        newCpc: newCpc,
      })
    } else if ((biddingStrategy as string) === 'MAXIMIZE_CLICKS') {
      // Maximize Clicks: 更新最大CPC限制
      const cpcMicros = Math.round(newCpc * 1000000)

      const campaignOperation = {
        update: {
          resource_name: `customers/${googleAdsAccount.customerId}/campaigns/${campaignId}`,
          maximize_clicks: {
            max_cpc_bid_micros: cpcMicros,
          },
        },
        update_mask: 'maximize_clicks.max_cpc_bid_micros',
      }

      // 更新广告系列
      await mutateResources(
        customer,
        useServiceAccount,
        'campaign',
        [campaignOperation],
        parseInt(userId, 10),
        auth.serviceAccountId,
        googleAdsAccount.customerId
      )

      return NextResponse.json({
        success: true,
        message: `成功更新广告系列的最大CPC限制为 ${newCpc}`,
        newCpc: newCpc,
      })
    } else if (biddingStrategy === 'TARGET_CPA') {
      // Target CPA: 更新目标CPA
      const cpaMicros = Math.round(newCpc * 1000000)

      const campaignOperation = {
        update: {
          resource_name: `customers/${googleAdsAccount.customerId}/campaigns/${campaignId}`,
          target_cpa: {
            target_cpa_micros: cpaMicros,
          },
        },
        update_mask: 'target_cpa.target_cpa_micros',
      }

      // 更新广告系列
      await mutateResources(
        customer,
        useServiceAccount,
        'campaign',
        [campaignOperation],
        parseInt(userId, 10),
        auth.serviceAccountId,
        googleAdsAccount.customerId
      )

      return NextResponse.json({
        success: true,
        message: `成功更新广告系列的目标CPA为 ${newCpc}`,
        newCpa: newCpc,
      })
    } else {
      return NextResponse.json(
        {
          error: `不支持的竞价策略类型: ${biddingStrategy}`,
          supportedStrategies: ['MANUAL_CPC', 'MAXIMIZE_CLICKS', 'TARGET_CPA'],
        },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('更新CPC失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新CPC失败',
      },
      { status: 500 }
    )
  }
}
