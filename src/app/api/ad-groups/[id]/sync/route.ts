import { NextRequest, NextResponse } from 'next/server'
import { findAdGroupById, updateAdGroup } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'
import { findGoogleAdsAccountById } from '@/lib/google-ads-accounts'
import { findKeywordsByAdGroupId, updateKeyword } from '@/lib/keywords'
import { createGoogleAdsAdGroup, createGoogleAdsKeywordsBatch } from '@/lib/google-ads-api'

/**
 * POST /api/ad-groups/:id/sync
 * 同步Ad Group和Keywords到Google Ads
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 查找Ad Group
    const adGroup = findAdGroupById(parseInt(id, 10), parseInt(userId, 10))
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 检查是否已经同步
    if (adGroup.adGroupId) {
      return NextResponse.json(
        {
          error: 'Ad Group已同步，不能重复同步',
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

    // 验证Campaign已同步
    if (!campaign.campaignId) {
      return NextResponse.json(
        {
          error: 'Campaign未同步到Google Ads，请先同步Campaign',
        },
        { status: 400 }
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
    updateAdGroup(adGroup.id, parseInt(userId, 10), {
      creationStatus: 'pending',
      creationError: null,
    })

    try {
      // 创建Google Ads Ad Group
      const adGroupResult = await createGoogleAdsAdGroup({
        customerId: googleAdsAccount.customerId,
        refreshToken: googleAdsAccount.refreshToken,
        campaignId: campaign.campaignId,
        adGroupName: adGroup.adGroupName,
        cpcBidMicros: adGroup.cpcBidMicros || undefined,
        status: adGroup.status as 'ENABLED' | 'PAUSED',
        accountId: googleAdsAccount.id,
        userId: parseInt(userId, 10),
      })

      // 更新Ad Group，标记为已同步
      updateAdGroup(adGroup.id, parseInt(userId, 10), {
        adGroupId: adGroupResult.adGroupId,
        creationStatus: 'synced',
        creationError: null,
        lastSyncAt: new Date().toISOString(),
      })

      // 查找Ad Group的所有Keywords
      const keywords = findKeywordsByAdGroupId(adGroup.id, parseInt(userId, 10))

      let syncedKeywordsCount = 0

      // 如果有Keywords，批量同步到Google Ads
      if (keywords.length > 0) {
        const keywordsBatch = keywords.map(kw => ({
          keywordText: kw.keywordText,
          matchType: kw.matchType as 'BROAD' | 'PHRASE' | 'EXACT',
          status: kw.status as 'ENABLED' | 'PAUSED',
          finalUrl: kw.finalUrl || undefined,
          isNegative: kw.isNegative,
        }))

        const keywordResults = await createGoogleAdsKeywordsBatch({
          customerId: googleAdsAccount.customerId,
          refreshToken: googleAdsAccount.refreshToken,
          adGroupId: adGroupResult.adGroupId,
          keywords: keywordsBatch,
          accountId: googleAdsAccount.id,
          userId: parseInt(userId, 10),
        })

        // 更新每个Keyword的Google Ads ID
        for (let i = 0; i < keywordResults.length; i++) {
          const keywordResult = keywordResults[i]
          const keyword = keywords[i]

          updateKeyword(keyword.id, parseInt(userId, 10), {
            keywordId: keywordResult.keywordId,
            creationStatus: 'synced',
            lastSyncAt: new Date().toISOString(),
          })

          syncedKeywordsCount++
        }
      }

      return NextResponse.json({
        success: true,
        adGroup: {
          ...adGroup,
          adGroupId: adGroupResult.adGroupId,
          creationStatus: 'synced',
        },
        syncedKeywordsCount,
      })
    } catch (error: any) {
      // 同步失败，更新错误状态
      updateAdGroup(adGroup.id, parseInt(userId, 10), {
        creationStatus: 'failed',
        creationError: error.message || '同步到Google Ads失败',
      })

      throw error
    }
  } catch (error: any) {
    console.error('同步Ad Group失败:', error)

    return NextResponse.json(
      {
        error: error.message || '同步Ad Group失败',
      },
      { status: 500 }
    )
  }
}
