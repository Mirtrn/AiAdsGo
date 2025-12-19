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
import { generateNamingScheme, type NamingScheme } from '@/lib/naming-convention'

/**
 * 广告系列发布任务数据接口
 */
export interface CampaignPublishTaskData {
  // 基础信息
  campaignId: number              // 数据库中已创建的campaign记录ID
  offerId: number
  googleAdsAccountId: number
  userId: number

  // 命名规范
  naming?: NamingScheme  // 🔥 使用NamingScheme类型，包含associativeCampaignName

  // 配置信息
  campaignConfig: {
    targetCountry: string
    targetLanguage: string
    biddingStrategy: string
    budgetAmount: number
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

    // 1. 获取Google Ads账号（包含currency信息）
    const adsAccount = await db.queryOne(
      `SELECT id, customer_id, currency, parent_mcc_id, is_active
       FROM google_ads_accounts
       WHERE id = ? AND user_id = ? AND is_active = ?`,
      [Number(googleAdsAccountId), Number(userId), 1]
    ) as any

    if (!adsAccount) {
      throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
    }

    console.log(`💰 使用账号货币: ${adsAccount.currency}`)

    // 🔧 修复(2025-12-19): 如果parent_mcc_id为NULL，从用户设置中获取login_customer_id
    // 这确保MCC账户ID正确传递给Google Ads API
    let effectiveLoginCustomerId = adsAccount.parent_mcc_id
    console.log(`🔍 [Debug] 账号 ${adsAccount.customer_id} 的 parent_mcc_id: ${adsAccount.parent_mcc_id} (类型: ${typeof adsAccount.parent_mcc_id})`)

    if (!effectiveLoginCustomerId) {
      try {
        const { getGoogleAdsCredentials } = await import('@/lib/google-ads-oauth')
        const userCredentials = await getGoogleAdsCredentials(userId)
        console.log(`🔍 [Debug] 用户设置的 login_customer_id: ${userCredentials?.login_customer_id} (类型: ${typeof userCredentials?.login_customer_id})`)

        if (userCredentials?.login_customer_id) {
          effectiveLoginCustomerId = userCredentials.login_customer_id
          console.log(`⚠️ 使用来自用户设置的login_customer_id: ${effectiveLoginCustomerId} (类型: ${typeof effectiveLoginCustomerId})`)

          // 同时更新数据库，避免后续调用继续走这条路径
          await db.exec(
            `UPDATE google_ads_accounts SET parent_mcc_id = ? WHERE id = ?`,
            [effectiveLoginCustomerId, adsAccount.id]
          )
          console.log(`✅ 已更新parent_mcc_id到数据库`)
        }
      } catch (settingsError: any) {
        console.warn(`⚠️ 无法从用户设置获取login_customer_id: ${settingsError.message}`)
      }
    }

    console.log(`🔍 [Debug] 最终使用的 effectiveLoginCustomerId: ${effectiveLoginCustomerId} (类型: ${typeof effectiveLoginCustomerId})`)

    // 🔧 确保loginCustomerId是字符串类型（Google Ads API要求）
    const finalLoginCustomerId = effectiveLoginCustomerId ? String(effectiveLoginCustomerId) : undefined
    console.log(`🔍 [Debug] 转换后的 finalLoginCustomerId: ${finalLoginCustomerId} (类型: ${typeof finalLoginCustomerId})`)

    // 2. 获取OAuth凭证
    const credentials = await getGoogleAdsCredentials(userId)
    if (!credentials || !credentials.refresh_token) {
      throw new Error('OAuth refresh token缺失，请重新授权')
    }

    // 3. 根据货币获取CPC默认值
    const getDefaultCPC = (currency: string): number => {
      const defaults: Record<string, number> = {
        USD: 0.17,
        CNY: 1.2,
        EUR: 0.16,
        GBP: 0.13,
        JPY: 25,
        KRW: 220,
        AUD: 0.26,
        CAD: 0.23,
        CHF: 0.15,
        SEK: 1.8,
        NOK: 1.7,
        DKK: 1.2,
        NZD: 0.29,
        MXN: 3.4,
        BRL: 0.85,
        INR: 14,
        KWD: 0.05,
        BHD: 0.06,
        OMR: 0.06,
        JOD: 0.11,
        TND: 0.5,
        AED: 0.61,
        SAR: 0.62,
        QAR: 0.61,
        HKD: 1.3,
        TWD: 5.4,
        SGD: 0.23,
      }
      return defaults[currency] || 0.17
    }

    // 4. 创建Campaign到Google Ads
    totalApiOperations++ // Campaign creation = 1 operation
    const effectiveMaxCpcBid = campaignConfig.maxCpcBid || getDefaultCPC(adsAccount.currency)

    // 使用关联命名规范（优先）或规范化命名或回退到占位符
    const campaignName = task.data.naming?.associativeCampaignName
      || task.data.naming?.campaignName
      || `Campaign_${creative.id}`
    const adGroupName = task.data.naming?.adGroupName || `AdGroup_${creative.id}`

    const { campaignId: googleCampaignId } = await createGoogleAdsCampaign({
      customerId: adsAccount.customer_id,
      refreshToken: credentials.refresh_token,
      campaignName: campaignName, // 🔥 使用规范化命名
      budgetAmount: campaignConfig.budgetAmount,
      budgetType: campaignConfig.budgetType,
      biddingStrategy: campaignConfig.biddingStrategy,
      cpcBidCeilingMicros: effectiveMaxCpcBid * 1000000, // 🔥 使用用户配置或货币默认值
      targetCountry: campaignConfig.targetCountry,
      targetLanguage: campaignConfig.targetLanguage,
      finalUrlSuffix: creative.finalUrlSuffix || undefined,
      status: 'ENABLED',
      accountId: adsAccount.id,
      userId,
      loginCustomerId: finalLoginCustomerId  // 🔧 使用effective值（从DB或用户设置）
    })

    console.log(`✅ Campaign创建成功 (Google ID: ${googleCampaignId})`)
    console.log(`📝 使用命名: Campaign=${campaignName}, AdGroup=${adGroupName}`)

    // 5. 创建Ad Group（使用相同的货币适配CPC）
    totalApiOperations++ // Ad group creation = 1 operation
    const { adGroupId: googleAdGroupId } = await createGoogleAdsAdGroup({
      customerId: adsAccount.customer_id,
      refreshToken: credentials.refresh_token,
      campaignId: googleCampaignId,
      adGroupName: adGroupName, // 🔥 使用规范化命名
      cpcBidMicros: effectiveMaxCpcBid * 1000000, // 🔥 使用相同的货币适配CPC
      status: 'ENABLED',
      accountId: adsAccount.id,
      userId,
      loginCustomerId: finalLoginCustomerId  // 🔧 使用effective值（从DB或用户设置）
    })

    console.log(`✅ Ad Group创建成功 (Google ID: ${googleAdGroupId})`)

    // 6. 构建关键词映射表
    const keywordMatchTypeMap = new Map<string, 'EXACT' | 'PHRASE' | 'BROAD'>()
    if (creative.keywordsWithVolume) {
      creative.keywordsWithVolume.forEach(kw => {
        if (kw?.keyword && kw?.matchType) {
          keywordMatchTypeMap.set(kw.keyword.toLowerCase(), kw.matchType)
        }
      })
    }

    // 7. 智能分配matchType的辅助函数
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

    /**
     * 为Sitelink生成两个不同的描述，提高广告质量
     *
     * @param text Sitelink文本（如"Products", "Support"等）
     * @param baseDescription 基础描述（可选）
     * @returns 包含desc1和desc2的对象
     */
    function generateSitelinkDescriptions(text: string, baseDescription: string = ''): { desc1: string, desc2: string } {
      // 预定义的描述对，根据Sitelink类型智能选择
      const predefinedDescriptions: Record<string, [string, string]> = {
        // 产品相关
        'products': ['Browse our full catalog', 'Latest security solutions'],
        '4k': ['8, 16, & 32 channel kits', 'Professional security solutions'],
        'security systems': ['Complete surveillance kits', 'Easy DIY installation'],

        // 公司信息
        'about': ['Learn about our mission', 'Trusted by millions worldwide'],
        'company': ['Our story & values', 'Industry leader since 2012'],

        // 产品对比
        'compare': ['Compare features & prices', 'Find your perfect match'],
        'poe': ['Wired vs wireless options', 'Expert buying guide'],
        'wifi': ['No cables, easy setup', 'Flexible placement'],
        'cameras': ['Indoor & outdoor models', 'HD & 4K resolution'],

        // 用户反馈
        'review': ['See customer reviews', '4.5+ star average rating'],
        'rating': ['Real user feedback', 'Join 1M+ happy customers'],
        'testimonial': ['What customers say', 'Proven track record'],

        // 支持帮助
        'support': ['Get help and manuals', '24/7 technical assistance'],
        'help': ['Step-by-step guides', 'Video tutorials included'],
        'faq': ['Common questions answered', 'Quick solutions'],

        // 联系方式
        'contact': ['Have questions? Get in touch', 'Expert team ready to help'],
        'call': ['Speak to an expert', 'Free consultation'],
        'email': ['Send us a message', 'Fast response time']
      }

      const textLower = text.toLowerCase()

      // 尝试匹配预定义描述（优先匹配更具体的关键词）
      const sortedKeys = Object.keys(predefinedDescriptions).sort((a, b) => b.length - a.length)
      for (const key of sortedKeys) {
        if (textLower.includes(key)) {
          const [desc1, desc2] = predefinedDescriptions[key]
          return { desc1, desc2 }
        }
      }

      // 默认处理：基于baseDescription生成两个相关描述
      if (baseDescription) {
        return {
          desc1: baseDescription,
          desc2: 'Learn more about this'
        }
      }

      // 最基本的默认值
      return {
        desc1: 'Learn more',
        desc2: 'Discover our solutions'
      }
    }

    // 8. 准备关键词数据
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

    // 9. 准备否定关键词数据
    const negativeKeywordOperations = (campaignConfig.negativeKeywords && campaignConfig.negativeKeywords.length > 0)
      ? campaignConfig.negativeKeywords.map((keyword: string) => ({
          keywordText: keyword,
          matchType: 'EXACT' as const,
          status: 'ENABLED' as const,
          isNegative: true
        }))
      : []

    // 10. 准备Callout Extensions数据
    let finalCallouts = creative.callouts || []
    if (finalCallouts.length === 0) {
      finalCallouts = [
        'Free Shipping',
        '24/7 Support',
        'Quality Guaranteed'
      ]
      console.log(`📝 生成默认Callouts: ${finalCallouts.length}个`)
    }

    // 11. 准备Sitelink Extensions数据
    let finalSitelinks = creative.sitelinks || []
    if (finalSitelinks.length === 0) {
      finalSitelinks = [
        {
          text: 'Products',
          url: creative.finalUrl,
          description: 'Browse all products'
        },
        {
          text: 'Support',
          url: creative.finalUrl,
          description: 'Get help'
        }
      ]
      console.log(`📝 生成默认Sitelinks: ${finalSitelinks.length}个`)
    }
    const formattedSitelinks = finalSitelinks.map(link => {
      // 使用智能描述生成函数，为每个Sitelink生成两个不同的描述
      const descriptions = generateSitelinkDescriptions(link.text, link.description)
      return {
        text: link.text,
        url: link.url,
        description1: descriptions.desc1,
        description2: descriptions.desc2
      }
    })

    // 12. 并行执行：Keywords + Ad (⚡ KISS优化：3个独立操作并行，避免并发冲突)
    console.log(`\n⚡ 开始并行执行3个独立API操作（Keywords + Ad）...`)
    const parallelStartTime = Date.now()

    // 计算并行API操作数（用于统计）
    const parallelApiCount = (
      (keywordOperations.length > 0 ? keywordOperations.length : 0) +
      (negativeKeywordOperations.length > 0 ? negativeKeywordOperations.length : 0) +
      1 // Ad creation
    )
    totalApiOperations += parallelApiCount

    const [
      keywordsResult,
      negativeKeywordsResult,
      adResult
    ] = await Promise.all([
      // 1. 正向关键词
      keywordOperations.length > 0
        ? createGoogleAdsKeywordsBatch({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            adGroupId: googleAdGroupId,
            keywords: keywordOperations,
            accountId: adsAccount.id,
            userId,
            loginCustomerId: finalLoginCustomerId
          }).then(() => {
            console.log(`  ✅ [并行1/3] 成功添加${keywordOperations.length}个关键词`)
            return { success: true, count: keywordOperations.length }
          })
        : Promise.resolve({ success: true, count: 0 }),

      // 2. 否定关键词
      negativeKeywordOperations.length > 0
        ? createGoogleAdsKeywordsBatch({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            adGroupId: googleAdGroupId,
            keywords: negativeKeywordOperations,
            accountId: adsAccount.id,
            userId,
            loginCustomerId: finalLoginCustomerId
          }).then(() => {
            console.log(`  ✅ [并行2/3] 成功添加${negativeKeywordOperations.length}个否定关键词`)
            return { success: true, count: negativeKeywordOperations.length }
          })
        : Promise.resolve({ success: true, count: 0 }),

      // 3. 创建Responsive Search Ad
      createGoogleAdsResponsiveSearchAd({
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
        loginCustomerId: finalLoginCustomerId
      }).then((result) => {
        console.log(`  ✅ [并行3/3] 广告创建成功 (Google ID: ${result.adId})`)
        return result
      })
    ])

    const parallelDuration = Date.now() - parallelStartTime
    console.log(`⚡ 并行执行完成，耗时: ${parallelDuration}ms`)
    console.log(`   - 正向关键词: ${keywordsResult.count}个`)
    console.log(`   - 否定关键词: ${negativeKeywordsResult.count}个`)
    console.log(`   - 广告ID: ${adResult.adId}`)

    const googleAdId = adResult.adId

    // 13. 串行执行：Extensions（避免并发修改Campaign资源冲突）
    console.log(`\n🔄 开始串行执行Extensions（避免并发冲突）...`)
    const extensionsStartTime = Date.now()

    // 13.1 添加Callout Extensions
    totalApiOperations += finalCallouts.length + 1
    await createGoogleAdsCalloutExtensions({
      customerId: adsAccount.customer_id,
      refreshToken: credentials.refresh_token,
      campaignId: googleCampaignId,
      callouts: finalCallouts,
      accountId: adsAccount.id,
      userId,
      loginCustomerId: finalLoginCustomerId
    })
    console.log(`  ✅ [串行1/2] 成功添加${finalCallouts.length}个Callout扩展`)

    // 13.2 添加Sitelink Extensions
    totalApiOperations += formattedSitelinks.length + 1
    await createGoogleAdsSitelinkExtensions({
      customerId: adsAccount.customer_id,
      refreshToken: credentials.refresh_token,
      campaignId: googleCampaignId,
      sitelinks: formattedSitelinks,
      accountId: adsAccount.id,
      userId,
      loginCustomerId: finalLoginCustomerId
    })
    console.log(`  ✅ [串行2/2] 成功添加${formattedSitelinks.length}个Sitelink扩展`)

    const extensionsDuration = Date.now() - extensionsStartTime
    console.log(`🔄 Extensions串行执行完成，耗时: ${extensionsDuration}ms`)

    // 13. 启用Campaign（如果需要）
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
          loginCustomerId: finalLoginCustomerId  // 🔧 使用effective值（从DB或用户设置）
        })
        finalCampaignStatus = 'ENABLED'
        console.log(`✅ Campaign已启用`)
      } catch (enableError: any) {
        console.warn(`⚠️ Campaign启用失败（非致命错误）: ${enableError.message}`)
      }
    }

    // 14. 更新数据库记录
    await db.exec(
      `UPDATE campaigns
       SET google_campaign_id = ?, google_ad_group_id = ?, google_ad_id = ?,
           status = ?, creation_status = 'synced', creation_error = NULL,
           last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [googleCampaignId, googleAdGroupId, googleAdId, finalCampaignStatus, campaignId]
    )

    apiSuccess = true
    console.log(`\n🎉 Campaign发布成功完成！`)
    console.log(`   📋 命名: Campaign=${campaignName}, AdGroup=${adGroupName}`)
    console.log(`   💰 货币: ${adsAccount.currency}, CPC: ${effectiveMaxCpcBid}`)
    console.log(`   🔗 Google IDs: Campaign=${googleCampaignId}, AdGroup=${googleAdGroupId}, Ad=${googleAdId}`)
    console.log(`   📊 总计 ${totalApiOperations} 个API操作`)

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
          customerId: task.data.googleAdsAccountId.toString(),
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
