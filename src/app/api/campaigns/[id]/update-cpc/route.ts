import { NextRequest, NextResponse } from 'next/server'
import { getCustomer } from '@/lib/google-ads-api'
import { findActiveGoogleAdsAccounts } from '@/lib/google-ads-accounts'

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

    // 获取用户的激活Google Ads账号
    const googleAdsAccounts = findActiveGoogleAdsAccounts(parseInt(userId, 10))

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

    if (!googleAdsAccount.refreshToken) {
      return NextResponse.json(
        {
          error: 'Google Ads账号缺少refresh token',
          needsReauth: true,
        },
        { status: 400 }
      )
    }

    // 获取Google Ads客户端
    const customer = await getCustomer(
      googleAdsAccount.customerId,
      googleAdsAccount.refreshToken
    )

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

    const campaignResults = await customer.query(campaignQuery)

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

      const adGroups = await customer.query(adGroupQuery)

      if (adGroups.length === 0) {
        return NextResponse.json(
          { error: '该广告系列下没有广告组' },
          { status: 400 }
        )
      }

      // 更新每个Ad Group的CPC
      const cpcMicros = Math.round(newCpc * 1000000) // 转换为微单位

      const operations = adGroups.map((adGroup: any) => ({
        resource_name: `customers/${googleAdsAccount.customerId}/adGroups/${adGroup.ad_group.id}`,
        cpc_bid_micros: cpcMicros,
      }))

      // 批量更新Ad Groups
      await customer.adGroups.update(operations as any)

      return NextResponse.json({
        success: true,
        message: `成功更新 ${adGroups.length} 个广告组的CPC为 ${newCpc}`,
        updatedAdGroups: adGroups.length,
        newCpc: newCpc,
      })
    } else if ((biddingStrategy as string) === 'MAXIMIZE_CLICKS') {
      // Maximize Clicks: 更新最大CPC限制
      const cpcMicros = Math.round(newCpc * 1000000)

      const operation = {
        update: {
          resource_name: `customers/${googleAdsAccount.customerId}/campaigns/${campaignId}`,
          maximize_clicks: {
            max_cpc_bid_micros: cpcMicros,
          },
        },
        update_mask: 'maximize_clicks.max_cpc_bid_micros',
      }

      await customer.campaigns.update([operation] as any)

      return NextResponse.json({
        success: true,
        message: `成功更新广告系列的最大CPC限制为 ${newCpc}`,
        newCpc: newCpc,
      })
    } else if (biddingStrategy === 'TARGET_CPA') {
      // Target CPA: 更新目标CPA
      const cpaMicros = Math.round(newCpc * 1000000)

      const operation = {
        update: {
          resource_name: `customers/${googleAdsAccount.customerId}/campaigns/${campaignId}`,
          target_cpa: {
            target_cpa_micros: cpaMicros,
          },
        },
        update_mask: 'target_cpa.target_cpa_micros',
      }

      await customer.campaigns.update([operation] as any)

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
