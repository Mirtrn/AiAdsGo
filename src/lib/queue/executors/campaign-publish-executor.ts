/**
 * 广告系列发布任务执行器
 *
 * 🚀 优化(2025-12-18)：处理长耗时的Google Ads API调用
 *   - 从同步API调用改为后台任务处理
 *   - 避免Nginx 504超时（30s限制）
 *   - 支持进度追踪和错误恢复
 *
 * 工作流程：
 * 1. 验证请求数据和权限
 * 2. 保存campaign到数据库（pending状态）
 * 3. 批量创建到Google Ads
 * 4. 更新campaign状态和Google IDs
 * 5. 处理失败情况并支持重试
 */

import type { Task } from '../types'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsResponsiveSearchAd,
  updateGoogleAdsCampaignStatus,
  createGoogleAdsCalloutExtensions,
  createGoogleAdsSitelinkExtensions
} from '@/lib/google-ads-api'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { generateNamingScheme } from '@/lib/naming-convention'

/**
 * 广告系列发布任务数据接口
 */
export interface CampaignPublishTaskData {
  // 基础信息
  campaignId: number              // 数据库中已创建的campaign记录ID
  offerId: number
  googleAdsAccountId: number
  userId: number

  // 配置信息
  campaignConfig: {
    targetCountry: string
    targetLanguage: string
    biddingStrategy: string
    budgetType: 'DAILY' | 'TOTAL'
    maxCpcBid: number
    keywords: string[]
    negativeKeywords?: string[]
  }

  // 创意信息
  creative: {
    id: number
    headlines: string[]
    descriptions: string[]
    finalUrl: string
    finalUrlSuffix?: string
    path1?: string
    path2?: string
    callouts?: string[]
    sitelinks?: Array<{
      text: string
      url: string
      description?: string
    }>
    keywordsWithVolume?: Array<{
      keyword: string
      matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
      searchVolume?: number
    }>
  }

  // 品牌信息
  brandName: string

  // 可选标志
  enableCampaignImmediately?: boolean  // 是否立即启用Campaign
  pauseOldCampaigns?: boolean          // 是否暂停旧Campaign
}

/**
 * 广告系列发布任务执行器
 */
export async function executeCampaignPublish(
  task: Task<CampaignPublishTaskData>
): Promise<{
  success: boolean
  googleCampaignId?: string
  googleAdGroupId?: string
  googleAdId?: string
  error?: string
}> {
  const db = await getDatabase()
  const {
    campaignId,
    offerId,
    googleAdsAccountId,
    userId,
    campaignConfig,
    creative,
    brandName,
    enableCampaignImmediately = false,
    pauseOldCampaigns = false
  } = task.data

  const apiStartTime = Date.now()
  let apiSuccess = false
  let apiErrorMessage: string | undefined
  let totalApiOperations = 0

  try {
    console.log(`🚀 开始执行Campaign发布任务: ${task.id}`)

    // 1. 获取Google Ads账号
    const adsAccount = await db.queryOne(
      `SELECT id, customer_id, parent_mcc_id, is_active
       FROM google_ads_accounts
       WHERE id = ? AND user_id = ? AND is_active = ?`,
      [Number(googleAdsAccountId), Number(userId), 1]
    ) as any

    if (!adsAccount) {
      throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
    }

    // 2. 获取OAuth凭证
    const credentials = await getGoogleAdsCredentials(userId)
    if (!credentials || !credentials.refresh_token) {
      throw new Error('OAuth refresh token缺失，请重新授权')
    }

    // 3. 创建Campaign到Google Ads
    totalApiOperations++ // Campaign creation = 1 operation
    const { campaignId: googleCampaignId } = await createGoogleAdsCampaign({
      customerId: adsAccount.customer_id,
      refreshToken: credentials.refresh_token,
      campaignName: creative.id.toString(), // 占位符，实际名称由naming scheme提供
      budgetAmount: 0, // 预算信息来自数据库
      budgetType: campaignConfig.budgetType,
      biddingStrategy: campaignConfig.biddingStrategy,
      targetCountry: campaignConfig.targetCountry,
      targetLanguage: campaignConfig.targetLanguage,
      finalUrlSuffix: creative.finalUrlSuffix || undefined,
      status: 'ENABLED',
      accountId: adsAccount.id,
      userId,
      loginCustomerId: adsAccount.parent_mcc_id || undefined
    })

    console.log(`✅ Campaign创建成功 (Google ID: ${googleCampaignId})`)

    // 4. 创建Ad Group
    totalApiOperations++ // Ad group creation = 1 operation
    const { adGroupId: googleAdGroupId } = await createGoogleAdsAdGroup({
      customerId: adsAccount.customer_id,
      refreshToken: credentials.refresh_token,
      campaignId: googleCampaignId,
      adGroupName: `AdGroup_${creative.id}`, // 占位符
      cpcBidMicros: campaignConfig.maxCpcBid * 1000000,
      status: 'ENABLED',
      accountId: adsAccount.id,
      userId,
      loginCustomerId: adsAccount.parent_mcc_id || undefined
    })

    console.log(`✅ Ad Group创建成功 (Google ID: ${googleAdGroupId})`)

    // 5. 构建关键词映射表
    const keywordMatchTypeMap = new Map<string, 'EXACT' | 'PHRASE' | 'BROAD'>()
    if (creative.keywordsWithVolume) {
      creative.keywordsWithVolume.forEach(kw => {
        if (kw?.keyword && kw?.matchType) {
          keywordMatchTypeMap.set(kw.keyword.toLowerCase(), kw.matchType)
        }
      })
    }

    // 6. 智能分配matchType的辅助函数
    const getMatchType = (keyword: string): 'EXACT' | 'PHRASE' | 'BROAD' => {
      if (!keyword) return 'PHRASE'

      // 1. 优先使用keywordsWithVolume中的matchType
      const mappedType = keywordMatchTypeMap.get(keyword.toLowerCase())
      if (mappedType) {
        return mappedType
      }

      // 2. 智能分配：品牌词EXACT，长尾词PHRASE，短词BROAD
      const keywordLower = keyword.toLowerCase()
      const brandLower = brandName?.toLowerCase() || ''
      const brandPrefix = brandLower.substring(0, 3)
      const hasBrandPrefix = brandLower.length >= 3 &&
        new RegExp(`\\b${brandPrefix}\\b`).test(keywordLower)

      const isBrandKeyword = keywordLower === brandLower ||
                             keywordLower.startsWith(brandLower + ' ') ||
                             hasBrandPrefix
      const wordCount = keyword.split(' ').length

      if (isBrandKeyword) {
        return 'EXACT'
      } else if (wordCount >= 3) {
        return 'PHRASE'
      } else {
        return 'BROAD'
      }
    }

    // 7. 添加关键词
    const keywordOperations = (campaignConfig.keywords || [])
      .map((keyword: any) => {
        const keywordStr = typeof keyword === 'string' ? keyword : (keyword?.text || '')
        if (!keywordStr) return null
        return {
          keywordText: keywordStr,
          matchType: getMatchType(keywordStr),
          status: 'ENABLED' as const
        }
      })
      .filter((op): op is NonNullable<typeof op> => op !== null)

    if (keywordOperations.length > 0) {
      totalApiOperations += keywordOperations.length
      await createGoogleAdsKeywordsBatch({
        customerId: adsAccount.customer_id,
        refreshToken: credentials.refresh_token,
        adGroupId: googleAdGroupId,
        keywords: keywordOperations,
        accountId: adsAccount.id,
        userId
      })
      console.log(`✅ 成功添加${keywordOperations.length}个关键词`)
    }

    // 8. 添加否定关键词
    if (campaignConfig.negativeKeywords && campaignConfig.negativeKeywords.length > 0) {
      const negativeKeywordOperations = campaignConfig.negativeKeywords.map((keyword: string) => ({
        keywordText: keyword,
        matchType: 'EXACT' as const,
        status: 'ENABLED' as const,
        isNegative: true
      }))

      totalApiOperations += negativeKeywordOperations.length
      await createGoogleAdsKeywordsBatch({
        customerId: adsAccount.customer_id,
        refreshToken: credentials.refresh_token,
        adGroupId: googleAdGroupId,
        keywords: negativeKeywordOperations,
        accountId: adsAccount.id,
        userId
      })
      console.log(`✅ 成功添加${negativeKeywordOperations.length}个否定关键词`)
    }

    // 9. 创建Responsive Search Ad
    totalApiOperations++ // Ad creation = 1 operation
    const { adId: googleAdId } = await createGoogleAdsResponsiveSearchAd({
      customerId: adsAccount.customer_id,
      refreshToken: credentials.refresh_token,
      adGroupId: googleAdGroupId,
      headlines: creative.headlines.slice(0, 15),
      descriptions: creative.descriptions.slice(0, 4),
      finalUrls: [creative.finalUrl],
      path1: creative.path1 || undefined,
      path2: creative.path2 || undefined,
      accountId: adsAccount.id,
      userId,
      loginCustomerId: adsAccount.parent_mcc_id || undefined
    })

    console.log(`✅ 广告创建成功 (Google ID: ${googleAdId})`)

    // 10. 添加广告扩展（非致命错误）
    try {
      if (creative.callouts && creative.callouts.length > 0) {
        totalApiOperations += creative.callouts.length + 1
        await createGoogleAdsCalloutExtensions({
          customerId: adsAccount.customer_id,
          refreshToken: credentials.refresh_token,
          campaignId: googleCampaignId,
          callouts: creative.callouts,
          accountId: adsAccount.id,
          userId
        })
        console.log(`✅ 成功添加${creative.callouts.length}个Callout扩展`)
      }

      if (creative.sitelinks && creative.sitelinks.length > 0) {
        const formattedSitelinks = creative.sitelinks.map(link => ({
          text: link.text,
          url: link.url,
          description1: link.description || '',
          description2: ''
        }))

        totalApiOperations += creative.sitelinks.length + 1
        await createGoogleAdsSitelinkExtensions({
          customerId: adsAccount.customer_id,
          refreshToken: credentials.refresh_token,
          campaignId: googleCampaignId,
          sitelinks: formattedSitelinks,
          accountId: adsAccount.id,
          userId
        })
        console.log(`✅ 成功添加${creative.sitelinks.length}个Sitelink扩展`)
      }
    } catch (extensionError: any) {
      console.warn(`⚠️ 广告扩展创建失败（非致命错误）: ${extensionError.message}`)
    }

    // 11. 启用Campaign（如果需要）
    let finalCampaignStatus: 'ENABLED' | 'PAUSED' = 'PAUSED'
    if (enableCampaignImmediately) {
      try {
        totalApiOperations++
        await updateGoogleAdsCampaignStatus({
          customerId: adsAccount.customer_id,
          refreshToken: credentials.refresh_token,
          campaignId: googleCampaignId,
          status: 'ENABLED',
          accountId: adsAccount.id,
          userId,
          loginCustomerId: adsAccount.parent_mcc_id || undefined
        })
        finalCampaignStatus = 'ENABLED'
        console.log(`✅ Campaign已启用`)
      } catch (enableError: any) {
        console.warn(`⚠️ Campaign启用失败（非致命错误）: ${enableError.message}`)
      }
    }

    // 12. 更新数据库记录
    await db.exec(
      `UPDATE campaigns
       SET google_campaign_id = ?, google_ad_group_id = ?, google_ad_id = ?,
           status = ?, creation_status = 'synced', creation_error = NULL,
           last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [googleCampaignId, googleAdGroupId, googleAdId, finalCampaignStatus, campaignId]
    )

    apiSuccess = true
    console.log(`✅ Campaign发布成功 (${totalApiOperations} API operations)`)

    return {
      success: true,
      googleCampaignId,
      googleAdGroupId,
      googleAdId
    }

  } catch (error: any) {
    apiSuccess = false
    apiErrorMessage = error.message || String(error)

    console.error(`❌ Campaign发布失败: ${apiErrorMessage}`)
    console.error('完整错误对象:', error)

    // 更新数据库记录为失败状态
    try {
      await db.exec(
        `UPDATE campaigns
         SET creation_status = 'failed', creation_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [apiErrorMessage, campaignId]
      )
    } catch (dbError: any) {
      console.error(`❌ 更新campaign状态失败: ${dbError.message}`)
    }

    return {
      success: false,
      error: apiErrorMessage
    }

  } finally {
    // 记录API使用
    if (userId) {
      try {
        trackApiUsage({
          userId: userId,
          operationType: ApiOperationType.MUTATE_BATCH,
          endpoint: 'publishCampaign',
          customerId: task.data.googleAdsAccountId,
          requestCount: totalApiOperations,
          responseTimeMs: Date.now() - apiStartTime,
          isSuccess: apiSuccess,
          errorMessage: apiErrorMessage
        })
      } catch (trackError: any) {
        console.warn(`⚠️ API追踪失败: ${trackError.message}`)
      }
    }
  }
}

export type { CampaignPublishTaskData }
