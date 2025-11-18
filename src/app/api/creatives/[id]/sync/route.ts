import { NextRequest, NextResponse } from 'next/server'
import { findCreativeById, updateCreative } from '@/lib/creatives'
import { findAdGroupById } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'
import { findGoogleAdsAccountById } from '@/lib/google-ads-accounts'
import { createGoogleAdsResponsiveSearchAd } from '@/lib/google-ads-api'

/**
 * POST /api/creatives/:id/sync
 * 同步Creative到Google Ads (创建Responsive Search Ad)
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 查找Creative
    const creative = findCreativeById(parseInt(id, 10), parseInt(userId, 10))
    if (!creative) {
      return NextResponse.json(
        {
          error: 'Creative不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 检查是否已经同步
    if (creative.adId) {
      return NextResponse.json(
        {
          error: 'Creative已同步，不能重复同步',
        },
        { status: 400 }
      )
    }

    // 检查是否已关联Ad Group
    if (!creative.adGroupId) {
      return NextResponse.json(
        {
          error: '请先将Creative关联到Ad Group',
        },
        { status: 400 }
      )
    }

    // 查找Ad Group
    const adGroup = findAdGroupById(creative.adGroupId, parseInt(userId, 10))
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在',
        },
        { status: 404 }
      )
    }

    // 验证Ad Group已同步
    if (!adGroup.adGroupId) {
      return NextResponse.json(
        {
          error: 'Ad Group未同步到Google Ads，请先同步Ad Group',
        },
        { status: 400 }
      )
    }

    // 查找Campaign
    const campaign = findCampaignById(adGroup.campaignId, parseInt(userId, 10))
    if (!campaign) {
      return NextResponse.json(
        {
          error: 'Campaign不存在',
        },
        { status: 404 }
      )
    }

    // 查找Google Ads账号
    const googleAdsAccount = findGoogleAdsAccountById(
      campaign.googleAdsAccountId,
      parseInt(userId, 10)
    )

    if (!googleAdsAccount) {
      return NextResponse.json(
        {
          error: 'Google Ads账号不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 验证账号是否已授权
    if (!googleAdsAccount.refreshToken) {
      return NextResponse.json(
        {
          error: 'Google Ads账号未授权，请先完成OAuth授权',
        },
        { status: 400 }
      )
    }

    // 更新状态为pending
    updateCreative(creative.id, parseInt(userId, 10), {
      creationStatus: 'pending',
      creationError: null,
    })

    try {
      // 准备Headlines (最多15个，最少3个)
      const headlines: string[] = []
      if (creative.headline1) headlines.push(creative.headline1)
      if (creative.headline2) headlines.push(creative.headline2)
      if (creative.headline3) headlines.push(creative.headline3)

      // 如果不足3个标题，返回错误
      if (headlines.length < 3) {
        throw new Error('Responsive Search Ad需要至少3个标题，当前只有' + headlines.length + '个')
      }

      // 准备Descriptions (最多4个，最少2个)
      const descriptions: string[] = []
      if (creative.description1) descriptions.push(creative.description1)
      if (creative.description2) descriptions.push(creative.description2)

      // 如果不足2个描述，返回错误
      if (descriptions.length < 2) {
        throw new Error(
          'Responsive Search Ad需要至少2个描述，当前只有' + descriptions.length + '个'
        )
      }

      // 准备Final URLs
      const finalUrls = [creative.finalUrl]

      // 创建Google Ads Responsive Search Ad
      const adResult = await createGoogleAdsResponsiveSearchAd({
        customerId: googleAdsAccount.customerId,
        refreshToken: googleAdsAccount.refreshToken,
        adGroupId: adGroup.adGroupId,
        headlines,
        descriptions,
        finalUrls,
        path1: creative.path1 || undefined,
        path2: creative.path2 || undefined,
        accountId: googleAdsAccount.id,
        userId: parseInt(userId, 10),
      })

      // 更新Creative，标记为已同步
      updateCreative(creative.id, parseInt(userId, 10), {
        adId: adResult.adId,
        creationStatus: 'synced',
        creationError: null,
        lastSyncAt: new Date().toISOString(),
      })

      return NextResponse.json({
        success: true,
        creative: {
          ...creative,
          adId: adResult.adId,
          creationStatus: 'synced',
        },
        adResourceName: adResult.resourceName,
      })
    } catch (error: any) {
      // 同步失败，更新错误状态
      updateCreative(creative.id, parseInt(userId, 10), {
        creationStatus: 'failed',
        creationError: error.message || '同步到Google Ads失败',
      })

      throw error
    }
  } catch (error: any) {
    console.error('同步Creative失败:', error)

    return NextResponse.json(
      {
        error: error.message || '同步Creative失败',
      },
      { status: 500 }
    )
  }
}
