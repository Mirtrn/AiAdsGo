import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { findActiveGoogleAdsAccounts } from '@/lib/google-ads-accounts'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsResponsiveSearchAd,
} from '@/lib/google-ads-api'

/**
 * POST /api/offers/:id/launch-ads
 * 一键创建Google Ads广告系列
 */
export async function POST(
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

    const body = await request.json()
    const {
      variants, // 广告变体数据
      campaignSettings, // 广告系列设置
      keywords = [], // 关键词列表（可选）
    } = body

    // 验证必要参数
    if (!variants || variants.length === 0) {
      return NextResponse.json(
        { error: '缺少广告变体数据' },
        { status: 400 }
      )
    }

    if (!campaignSettings || !campaignSettings.dailyBudget) {
      return NextResponse.json(
        { error: '缺少广告系列设置' },
        { status: 400 }
      )
    }

    // 验证Offer存在且属于当前用户
    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取用户的激活Google Ads账号
    const googleAdsAccounts = findActiveGoogleAdsAccounts(parseInt(userId, 10))

    if (googleAdsAccounts.length === 0) {
      return NextResponse.json(
        {
          error: '未找到已连接的Google Ads账号，请先连接您的Google Ads账号',
          needsConnection: true,
        },
        { status: 400 }
      )
    }

    // 使用第一个激活账号（后续可以支持用户选择）
    const googleAdsAccount = googleAdsAccounts[0]

    if (!googleAdsAccount.refreshToken) {
      return NextResponse.json(
        {
          error: 'Google Ads账号授权已过期，请重新连接',
          needsReauth: true,
        },
        { status: 400 }
      )
    }

    // 🎯 新架构：为每个广告变体创建独立的Campaign（单主题策略）
    // 每个Campaign专注一个主题/方向，确保广告信息一致性和相关性
    const createdCampaigns: any[] = []
    const baseTimestamp = Date.now()

    console.log(`🚀 开始创建${variants.length}个单主题广告系列...`)

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i]

      // 每个Campaign以主题/方向命名，确保主题清晰
      const campaignName = `${offer.offer_name || offer.brand}_${variant.orientation}_${offer.target_country}_${baseTimestamp + i}`
      console.log(`\n📋 [${i + 1}/${variants.length}] 创建主题广告系列: ${campaignName}`)
      console.log(`   主题: ${variant.orientation}`)

      try {
        // 1. 创建单主题Campaign
        const campaign = await createGoogleAdsCampaign({
          customerId: googleAdsAccount.customerId,
          refreshToken: googleAdsAccount.refreshToken,
          campaignName,
          budgetAmount: parseFloat(campaignSettings.dailyBudget),
          budgetType: 'DAILY',
          status: campaignSettings.status === 'enabled' ? 'ENABLED' : 'PAUSED',
          startDate: campaignSettings.startDate,
          endDate: campaignSettings.endDate,
          accountId: googleAdsAccount.id,
          userId: parseInt(userId, 10),
        })

        console.log(`   ✅ Campaign创建成功: ${campaign.campaignId}`)

        // 2. 在该Campaign中创建唯一的Ad Group
        const adGroupName = `${campaignName}_AdGroup`
        console.log(`   创建Ad Group: ${adGroupName}`)

        const adGroup = await createGoogleAdsAdGroup({
          customerId: googleAdsAccount.customerId,
          refreshToken: googleAdsAccount.refreshToken,
          campaignId: campaign.campaignId,
          adGroupName,
          cpcBidMicros: campaignSettings.maxCPC
            ? parseFloat(campaignSettings.maxCPC) * 1000000
            : undefined,
          status: 'ENABLED',
          accountId: googleAdsAccount.id,
          userId: parseInt(userId, 10),
        })

        console.log(`   ✅ Ad Group创建成功: ${adGroup.adGroupId}`)

        // 3. 创建关键词（如果提供）
        let createdKeywords: any[] = []
        if (keywords.length > 0) {
          console.log(`   批量创建${keywords.length}个关键词`)
          createdKeywords = await createGoogleAdsKeywordsBatch({
            customerId: googleAdsAccount.customerId,
            refreshToken: googleAdsAccount.refreshToken,
            adGroupId: adGroup.adGroupId,
            keywords: keywords.map((kw: any) => ({
              keywordText: kw.text,
              matchType: kw.matchType || 'BROAD',
              status: 'ENABLED',
              finalUrl: offer.affiliate_link || offer.url,
            })),
            accountId: googleAdsAccount.id,
            userId: parseInt(userId, 10),
          })
          console.log(`   ✅ 关键词创建成功: ${createdKeywords.length}个`)
        }

        // 4. 创建Responsive Search Ad
        console.log(`   创建Responsive Search Ad`)

        // 准备标题（至少3个，最多15个）
        const headlines = [
          variant.headline1,
          variant.headline2,
          variant.headline3,
        ].filter(Boolean)

        // 如果标题少于3个，使用默认标题补充
        while (headlines.length < 3) {
          headlines.push(`${offer.brand} Official Store`)
        }

        // 准备描述（至少2个，最多4个）
        const descriptions = [
          variant.description1,
          variant.description2,
        ].filter(Boolean)

        // 如果描述少于2个，使用默认描述补充
        while (descriptions.length < 2) {
          descriptions.push(`Shop ${offer.brand} with exclusive offers.`)
        }

        const ad = await createGoogleAdsResponsiveSearchAd({
          customerId: googleAdsAccount.customerId,
          refreshToken: googleAdsAccount.refreshToken,
          adGroupId: adGroup.adGroupId,
          headlines,
          descriptions,
          finalUrls: [offer.affiliate_link || offer.url],
          accountId: googleAdsAccount.id,
          userId: parseInt(userId, 10),
        })

        console.log(`   ✅ Ad创建成功: ${ad.adId}`)

        createdCampaigns.push({
          campaignId: campaign.campaignId,
          campaignName,
          campaignResourceName: campaign.resourceName,
          orientation: variant.orientation,
          adGroupId: adGroup.adGroupId,
          adGroupName,
          adId: ad.adId,
          keywordsCount: createdKeywords.length,
          headlines,
          descriptions,
          status: campaignSettings.status,
        })

        console.log(`   🎉 主题广告系列 "${variant.orientation}" 创建完成\n`)
      } catch (error: any) {
        console.error(`   ❌ 创建Campaign失败 (${variant.orientation}):`, error.message)
        // 记录失败但继续处理其他variants
        createdCampaigns.push({
          orientation: variant.orientation,
          error: error.message,
          failed: true,
        })
      }
    }

    // 统计成功和失败数量
    const successCount = createdCampaigns.filter(c => !c.failed).length
    const failureCount = createdCampaigns.filter(c => c.failed).length

    console.log(`\n📊 创建结果: ${successCount}个成功, ${failureCount}个失败`)

    // 返回创建结果
    return NextResponse.json({
      success: successCount > 0,
      campaigns: createdCampaigns.filter(c => !c.failed),
      failures: createdCampaigns.filter(c => c.failed),
      googleAdsAccount: {
        customerId: googleAdsAccount.customerId,
        accountName: googleAdsAccount.accountName,
      },
      summary: {
        total: variants.length,
        successful: successCount,
        failed: failureCount,
      },
      message: `成功创建${successCount}个单主题广告系列${failureCount > 0 ? `，${failureCount}个失败` : ''}`,
    })
  } catch (error: any) {
    console.error('创建Google Ads广告失败:', error)

    // 详细的错误信息
    const errorMessage = error.message || '创建广告失败'
    const errorDetails = error.stack || ''

    return NextResponse.json(
      {
        error: errorMessage,
        details: errorDetails,
        stage: error.stage || 'unknown',
      },
      { status: 500 }
    )
  }
}
