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
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsResponsiveSearchAd,
  updateGoogleAdsCampaignStatus,
  createGoogleAdsCalloutExtensions,
  createGoogleAdsSitelinkExtensions,
  ensureKeywordsInHeadlines,
} from '@/lib/google-ads-api'
import { setCampaignPageViewGoalWithCredentials } from '@/lib/google-ads-conversion-goals'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { generateNamingScheme, type NamingScheme } from '@/lib/naming-convention'
import { invalidateOfferCache } from '@/lib/api-cache'
import { formatGoogleAdsApiError } from '@/lib/google-ads-api-error'
import { addUrlSwapTargetForOfferCampaign } from '@/lib/url-swap'

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
    keywords: Array<
      | string
      | {
          text?: string
          keyword?: string
          matchType?: 'EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER'
        }
    >
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
  const safeJsonStringify = (value: unknown, space: number = 2): string => {
    const seen = new WeakSet<object>()
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'bigint') return val.toString()
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        return val
      },
      space
    )
  }

  const redactSecrets = (value: unknown, depth: number = 0): unknown => {
    const MAX_DEPTH = 6
    if (depth > MAX_DEPTH) return '[Truncated]'

    const SENSITIVE_KEYS = new Set([
      'private_key',
      'privateKey',
      'developer_token',
      'developerToken',
      'refresh_token',
      'refreshToken',
      'access_token',
      'accessToken',
      'authorization',
      'cookie',
      'set-cookie',
    ])

    const redactString = (s: string): string => {
      if (s.includes('-----BEGIN PRIVATE KEY-----') || s.includes('BEGIN PRIVATE KEY')) return '[REDACTED_PRIVATE_KEY]'
      if (s.length > 6000) return `[TRUNCATED_STRING len=${s.length}]`
      return s
    }

    if (typeof value === 'string') return redactString(value)
    if (typeof value !== 'object' || value === null) return value
    if (Array.isArray(value)) return value.map(v => redactSecrets(v, depth + 1))

    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]'
        continue
      }
      // AxiosError 常见的大字段：config.data / request / socket 等，既敏感又巨大
      if (k === 'request' || k === 'socket' || k === 'agent') {
        out[k] = '[OMITTED]'
        continue
      }
      if (k === 'data' && typeof v === 'string' && v.includes('private_key')) {
        out[k] = '[REDACTED]'
        continue
      }
      out[k] = redactSecrets(v, depth + 1)
    }
    return out
  }

  const buildErrorLogObject = (err: unknown): Record<string, unknown> => {
    // 专门处理 AxiosError：避免把 config/request 等敏感和巨大对象打到日志
    if (err && typeof err === 'object' && (err as any).isAxiosError) {
      const ax = err as any
      return redactSecrets({
        kind: 'AxiosError',
        name: ax.name,
        message: ax.message,
        code: ax.code,
        url: ax.config?.url,
        method: ax.config?.method,
        status: ax.response?.status,
        pythonRequestId: ax.response?.headers?.['x-request-id'],
        responseData: ax.response?.data,
      }) as Record<string, unknown>
    }

    if (err instanceof Error) {
      const ownProps: Record<string, unknown> = {}
      for (const key of Object.getOwnPropertyNames(err)) {
        ownProps[key] = (err as any)[key]
      }
      for (const key of Object.keys(err as any)) {
        ownProps[key] = (err as any)[key]
      }
      return redactSecrets({
        kind: 'Error',
        name: err.name,
        message: err.message,
        stack: err.stack,
        ...ownProps,
      }) as Record<string, unknown>
    }

    if (typeof err === 'object' && err !== null) {
      const ownProps: Record<string, unknown> = {}
      for (const key of Object.getOwnPropertyNames(err)) {
        ownProps[key] = (err as any)[key]
      }
      for (const key of Object.keys(err as any)) {
        ownProps[key] = (err as any)[key]
      }
      return redactSecrets({ kind: typeof err, ...ownProps }) as Record<string, unknown>
    }

    return redactSecrets({ kind: typeof err, value: err }) as Record<string, unknown>
  }

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

    if (!effectiveLoginCustomerId) {
      try {
        // 🔧 修复(2025-12-25): 支持OAuth和服务账号两种方式获取login_customer_id
        const { getGoogleAdsConfig } = await import('@/lib/keyword-planner')
        const config = await getGoogleAdsConfig(userId)

        if (config?.loginCustomerId) {
          effectiveLoginCustomerId = config.loginCustomerId
          // 同时更新数据库，避免后续调用继续走这条路径
          await db.exec(
            `UPDATE google_ads_accounts SET parent_mcc_id = ? WHERE id = ?`,
            [effectiveLoginCustomerId, adsAccount.id]
          )
        }
      } catch (settingsError: any) {
        console.warn(`⚠️ 无法从用户设置获取login_customer_id: ${settingsError.message}`)
      }
    }

    // 🔧 确保loginCustomerId是字符串类型（Google Ads API要求）
    const finalLoginCustomerId = effectiveLoginCustomerId ? String(effectiveLoginCustomerId) : undefined

    // 2. 检查OAuth凭证或服务账号配置
    const credentials = await getGoogleAdsCredentials(userId)

    // 检查是否有服务账号配置
    const serviceAccount = await db.queryOne(`
      SELECT id FROM google_ads_service_accounts
      WHERE user_id = ? AND is_active = true
      ORDER BY created_at DESC LIMIT 1
    `, [userId]) as { id: string } | undefined

    if ((!credentials || !credentials.refresh_token) && !serviceAccount) {
      throw new Error('OAuth refresh token或服务账号配置缺失，请重新授权或配置服务账号')
    }

    // 获取认证类型和服务账号ID
    const auth = await getUserAuthType(userId)
    const refreshToken = credentials?.refresh_token || ''

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
    // 注意: 营销目标设置已移除 (2025-12-26)
    // Google Ads会自动推断营销目标，无需手动设置
    totalApiOperations++ // Campaign creation = 1 operation
    // 🔧 修复(2025-12-26): 确保CPC是计费单位的倍数（10000微单位）
    const rawCpcBid = campaignConfig.maxCpcBid || getDefaultCPC(adsAccount.currency)
    const effectiveMaxCpcBid = Math.round(rawCpcBid * 100) / 100  // 四舍五入到0.01

    // 使用关联命名规范（优先）或规范化命名或回退到占位符
    const campaignName = task.data.naming?.associativeCampaignName
      || task.data.naming?.campaignName
      || `Campaign_${creative.id}`
    const adGroupName = task.data.naming?.adGroupName || `AdGroup_${creative.id}`

    const { campaignId: googleCampaignId } = await createGoogleAdsCampaign({
      customerId: adsAccount.customer_id,
      refreshToken: refreshToken,
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
      loginCustomerId: finalLoginCustomerId,  // 🔧 使用effective值（从DB或用户设置）
      authType: auth.authType,
      serviceAccountId: auth.serviceAccountId,
    })

    console.log(`✅ Campaign创建成功 (Google ID: ${googleCampaignId})`)
    console.log(`📝 使用命名: Campaign=${campaignName}, AdGroup=${adGroupName}`)

    // 5. 创建Ad Group（使用相同的货币适配CPC）
    totalApiOperations++ // Ad group creation = 1 operation
    const { adGroupId: googleAdGroupId } = await createGoogleAdsAdGroup({
      customerId: adsAccount.customer_id,
      refreshToken: refreshToken,
      campaignId: googleCampaignId,
      adGroupName: adGroupName, // 🔥 使用规范化命名
      cpcBidMicros: effectiveMaxCpcBid * 1000000, // 🔥 使用相同的货币适配CPC
      status: 'ENABLED',
      accountId: adsAccount.id,
      userId,
      loginCustomerId: finalLoginCustomerId,  // 🔧 使用effective值（从DB或用户设置）
      authType: auth.authType,
      serviceAccountId: auth.serviceAccountId,
    })

    console.log(`✅ Ad Group创建成功 (Google ID: ${googleAdGroupId})`)

    const normalizeMatchType = (value?: string): 'EXACT' | 'PHRASE' | 'BROAD' | null => {
      if (!value) return null
      const upper = value.toUpperCase()
      if (upper === 'BROAD_MATCH_MODIFIER' || upper === 'BMM') return 'BROAD'
      if (upper === 'BROAD' || upper === 'PHRASE' || upper === 'EXACT') {
        return upper as 'BROAD' | 'PHRASE' | 'EXACT'
      }
      return null
    }

    // 6. 构建关键词映射表
    const keywordMatchTypeMap = new Map<string, 'EXACT' | 'PHRASE' | 'BROAD'>()
    if (creative.keywordsWithVolume) {
      creative.keywordsWithVolume.forEach(kw => {
        const rawKeyword = kw?.keyword
        const normalizedMatchType = normalizeMatchType(kw?.matchType)
        if (typeof rawKeyword === 'string' && rawKeyword.trim() && normalizedMatchType) {
          keywordMatchTypeMap.set(rawKeyword.trim().toLowerCase(), normalizedMatchType)
        }
      })
    }

    // 7. 智能分配matchType的辅助函数
    const getMatchType = (keyword: string, explicitMatchType?: string): 'EXACT' | 'PHRASE' | 'BROAD' => {
      if (!keyword) return 'PHRASE'

      // 1. 优先使用用户配置的matchType
      const normalizedExplicit = normalizeMatchType(explicitMatchType)
      if (normalizedExplicit) {
        return normalizedExplicit
      }

      // 2. 使用keywordsWithVolume中的matchType
      const mappedType = keywordMatchTypeMap.get(keyword.toLowerCase().trim())
      if (mappedType) {
        return mappedType
      }

      // 3. 智能分配：品牌词EXACT，长尾词PHRASE，短词BROAD
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

      const safeText = typeof text === 'string' ? text : ''
      const safeBaseDescription = typeof baseDescription === 'string' ? baseDescription : ''
      const textLower = safeText.toLowerCase()

      // 尝试匹配预定义描述（优先匹配更具体的关键词）
      const sortedKeys = Object.keys(predefinedDescriptions).sort((a, b) => b.length - a.length)
      for (const key of sortedKeys) {
        if (textLower.includes(key)) {
          const [desc1, desc2] = predefinedDescriptions[key]
          return { desc1, desc2 }
        }
      }

      // 默认处理：基于baseDescription生成两个相关描述
      if (safeBaseDescription) {
        return {
          desc1: safeBaseDescription,
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
        const keywordStr = typeof keyword === 'string'
          ? keyword
          : (keyword?.text || keyword?.keyword || '')
        const normalizedKeyword = keywordStr.trim()
        if (!normalizedKeyword) return null
        const explicitMatchType = typeof keyword === 'object' ? keyword?.matchType : undefined
        return {
          keywordText: normalizedKeyword,
          matchType: getMatchType(normalizedKeyword, explicitMatchType),
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
    // 🔧 修复：支持两种格式 - 字符串数组 ["a","b"] 和对象数组 [{"text":"a"}]
    let finalCallouts = creative.callouts || []
    // 转换为字符串数组（兼容对象数组格式）
    finalCallouts = finalCallouts.map((c: any) => {
      if (typeof c === 'string') return c
      if (typeof c === 'object' && c?.text) return c.text
      return null
    }).filter((c: string | null): c is string => c !== null && c.trim().length > 0)

    if (finalCallouts.length === 0) {
      finalCallouts = [
        'Free Shipping',
        '24/7 Support',
        'Quality Guaranteed'
      ]
      console.log(`📝 生成默认Callouts: ${finalCallouts.length}个`)
    }

    // 11. 准备Sitelink Extensions数据
    const normalizedSitelinks = (creative.sitelinks || [])
      .map((link: any) => {
        if (typeof link === 'string') {
          const text = link.trim()
          if (!text) return null
          return { text, url: creative.finalUrl, description: undefined as string | undefined }
        }

        if (typeof link !== 'object' || link === null) return null

        const rawText = typeof link.text === 'string' ? link.text.trim() : ''
        const rawUrl = typeof link.url === 'string' ? link.url.trim() : ''
        const url = rawUrl || creative.finalUrl
        if (!rawText || !url) return null

        const description = typeof link.description === 'string' ? link.description.trim() : undefined
        return { text: rawText, url, description }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null)

    let finalSitelinks = normalizedSitelinks
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

    // 12. 串行执行：Keywords + Ad (🔧 修复并发冲突：改为串行避免资源竞争)
    console.log(`\n🔄 开始串行执行Keywords + Ad（避免并发冲突）...`)
    const serialStartTime = Date.now()

    // 12.1 添加正向关键词
    let keywordsCount = 0
    if (keywordOperations.length > 0) {
      totalApiOperations += keywordOperations.length
      await createGoogleAdsKeywordsBatch({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        adGroupId: googleAdGroupId,
        keywords: keywordOperations,
        accountId: adsAccount.id,
        userId,
        loginCustomerId: finalLoginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })
      keywordsCount = keywordOperations.length
      console.log(`  ✅ [串行1/3] 成功添加${keywordsCount}个关键词`)
    }

    // 12.2 添加否定关键词
    let negativeKeywordsCount = 0
    if (negativeKeywordOperations.length > 0) {
      totalApiOperations += negativeKeywordOperations.length
      await createGoogleAdsKeywordsBatch({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        adGroupId: googleAdGroupId,
        keywords: negativeKeywordOperations,
        accountId: adsAccount.id,
        userId,
        loginCustomerId: finalLoginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })
      negativeKeywordsCount = negativeKeywordOperations.length
      console.log(`  ✅ [串行2/3] 成功添加${negativeKeywordsCount}个否定关键词`)
    }

    // 12.3 创建Responsive Search Ad
    // 🔧 新增(2025-12-20): 优化标题，确保包含热门关键词
    console.log(`\n📝 优化广告标题，确保包含热门关键词...`)
    const originalHeadlines = creative.headlines.slice(0, 15)
    const keywordsForOptimization = (campaignConfig.keywords || [])
      .map((keyword: any) => typeof keyword === 'string' ? keyword : (keyword?.text || keyword?.keyword || ''))
      .map((keyword: any) => String(keyword ?? '').trim())
      .filter((keyword: string) => keyword.length > 0)
    const optimizedHeadlines = ensureKeywordsInHeadlines(
      originalHeadlines,
      keywordsForOptimization,
      brandName,
      3  // 确保 Top 3 关键词被覆盖
    )

    totalApiOperations++
    const adResult = await createGoogleAdsResponsiveSearchAd({
      customerId: adsAccount.customer_id,
      refreshToken: refreshToken,
      adGroupId: googleAdGroupId,
      headlines: optimizedHeadlines,
      descriptions: creative.descriptions.slice(0, 4),
      finalUrls: [creative.finalUrl],
      path1: creative.path1 || undefined,
      path2: creative.path2 || undefined,
      accountId: adsAccount.id,
      userId,
      loginCustomerId: finalLoginCustomerId,
      authType: auth.authType,
      serviceAccountId: auth.serviceAccountId
    })
    console.log(`  ✅ [串行3/3] 广告创建成功 (Google ID: ${adResult.adId})`)

    const serialDuration = Date.now() - serialStartTime
    console.log(`🔄 串行执行完成，耗时: ${serialDuration}ms`)
    console.log(`   - 正向关键词: ${keywordsCount}个`)
    console.log(`   - 否定关键词: ${negativeKeywordsCount}个`)
    console.log(`   - 广告ID: ${adResult.adId}`)

    const googleAdId = adResult.adId

    // 13. 串行执行：Extensions（避免并发修改Campaign资源冲突）
    // 🔧 修复(2026-01-05): Extensions是可选扩展，失败不应影响核心发布状态
    console.log(`\n🔄 开始串行执行Extensions（避免并发冲突）...`)
    const extensionsStartTime = Date.now()

    // 跟踪Extensions执行结果（非致命错误）
    let extensionsErrors: string[] = []

    // 13.1 添加Callout Extensions（非致命，失败时记录错误但继续）
    try {
      totalApiOperations += finalCallouts.length + 1
      await createGoogleAdsCalloutExtensions({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        campaignId: googleCampaignId,
        callouts: finalCallouts,
        accountId: adsAccount.id,
        userId,
        loginCustomerId: finalLoginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId
      })
      console.log(`  ✅ [串行1/2] 成功添加${finalCallouts.length}个Callout扩展`)
    } catch (calloutError: any) {
      const errorMsg = calloutError.message || String(calloutError)
      extensionsErrors.push(`Callout扩展: ${errorMsg}`)
      console.warn(`  ⚠️ [串行1/2] Callout扩展失败（非致命）: ${errorMsg}`)
    }

    // 13.2 添加Sitelink Extensions（非致命，失败时记录错误但继续）
    try {
      totalApiOperations += formattedSitelinks.length + 1
      await createGoogleAdsSitelinkExtensions({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        campaignId: googleCampaignId,
        sitelinks: formattedSitelinks,
        accountId: adsAccount.id,
        userId,
        loginCustomerId: finalLoginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId
      })
      console.log(`  ✅ [串行2/2] 成功添加${formattedSitelinks.length}个Sitelink扩展`)
    } catch (sitelinkError: any) {
      const errorMsg = sitelinkError.message || String(sitelinkError)
      extensionsErrors.push(`Sitelink扩展: ${errorMsg}`)
      console.warn(`  ⚠️ [串行2/2] Sitelink扩展失败（非致命）: ${errorMsg}`)
    }

    const extensionsDuration = Date.now() - extensionsStartTime
    console.log(`🔄 Extensions串行执行完成，耗时: ${extensionsDuration}ms`)

    // 14. 配置Campaign转化目标为"网页浏览"（非阻塞操作）
    console.log(`\n🎯 配置Campaign转化目标...`)
    try {
      await setCampaignPageViewGoalWithCredentials({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        campaignId: googleCampaignId,
        userId,
        loginCustomerId: finalLoginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })
    } catch (goalError: any) {
      console.warn(`⚠️ 转化目标配置失败（非致命错误）: ${goalError.message}`)
    }

    // 15. 启用Campaign（如果需要）
    let finalCampaignStatus: 'ENABLED' | 'PAUSED' = 'PAUSED'
    if (enableCampaignImmediately) {
      try {
        totalApiOperations++
        await updateGoogleAdsCampaignStatus({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          campaignId: googleCampaignId,
          status: 'ENABLED',
          accountId: adsAccount.id,
          userId,
          loginCustomerId: finalLoginCustomerId,  // 🔧 使用effective值（从DB或用户设置）
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId,
        })
        finalCampaignStatus = 'ENABLED'
        console.log(`✅ Campaign已启用`)
      } catch (enableError: any) {
        console.warn(`⚠️ Campaign启用失败（非致命错误）: ${enableError.message}`)
      }
    }

    // 16. 更新数据库记录
    // 🔧 修复(2026-01-05): 核心成功但Extensions失败时，仍计为成功，只记录警告信息
    let finalCreationStatus = 'synced'
    let finalCreationError: string | null = null

    if (extensionsErrors.length > 0) {
      // 核心成功但Extensions失败 → 记录警告信息，不改变成功状态
      finalCreationError = `[警告] ${extensionsErrors.join('; ')}`
    }

    await db.exec(
      `UPDATE campaigns
       SET google_campaign_id = ?, google_ad_group_id = ?, google_ad_id = ?,
           status = ?, creation_status = ?, creation_error = ?,
           published_at = COALESCE(NULLIF(published_at, ''), CAST(CURRENT_TIMESTAMP AS TEXT)),
           last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [googleCampaignId, googleAdGroupId, googleAdId, finalCampaignStatus, finalCreationStatus, finalCreationError, campaignId]
    )
    // 🔧 发布完成后立即失效 Offer 列表缓存，确保 /offers 页面"关联Ads账号"及时更新
    invalidateOfferCache(userId, offerId)

    // 🔥 新增：发布成功后自动追加换链接任务目标（多账号/多Campaign）
    try {
      if (adsAccount?.customer_id) {
        const added = await addUrlSwapTargetForOfferCampaign({
          offerId,
          userId,
          googleAdsAccountId: adsAccount.id,
          googleCustomerId: adsAccount.customer_id,
          googleCampaignId
        })
        if (added) {
          console.log(`🔗 已追加换链接任务目标: offer=${offerId}, campaign=${googleCampaignId}`)
        }
      }
    } catch (err: any) {
      console.warn('⚠️ 追加换链接任务目标失败（不影响发布）:', err?.message || err)
    }

    apiSuccess = true

    // 🔧 修复(2026-01-05): 区分完全成功和部分成功
    if (extensionsErrors.length === 0) {
      console.log(`\n🎉 Campaign发布成功完成！`)
      console.log(`   📋 命名: Campaign=${campaignName}, AdGroup=${adGroupName}`)
      console.log(`   💰 货币: ${adsAccount.currency}, CPC: ${effectiveMaxCpcBid}`)
      console.log(`   🔗 Google IDs: Campaign=${googleCampaignId}, AdGroup=${googleAdGroupId}, Ad=${googleAdId}`)
      console.log(`   📊 总计 ${totalApiOperations} 个API操作`)
    } else {
      console.log(`\n⚠️ Campaign核心发布成功，但部分扩展失败`)
      console.log(`   📋 命名: Campaign=${campaignName}, AdGroup=${adGroupName}`)
      console.log(`   💰 货币: ${adsAccount.currency}, CPC: ${effectiveMaxCpcBid}`)
      console.log(`   🔗 Google IDs: Campaign=${googleCampaignId}, AdGroup=${googleAdGroupId}, Ad=${googleAdId}`)
      console.log(`   📊 总计 ${totalApiOperations} 个API操作`)
      console.log(`   ⚠️ 扩展失败: ${extensionsErrors.length}项`)
      extensionsErrors.forEach((err, i) => {
        console.log(`      ${i + 1}. ${err}`)
      })
    }

    return {
      success: true,
      googleCampaignId,
      googleAdGroupId,
      googleAdId
    }

  } catch (error: any) {
    apiSuccess = false

    apiErrorMessage = formatGoogleAdsApiError(error)
    console.error(`❌ Campaign发布失败: ${apiErrorMessage}`)
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      console.error(`   错误代码:`, error.errors[0]?.error_code)
      console.error(`   请求ID: ${error.request_id || 'N/A'}`)
    }
    console.error('完整错误对象:', safeJsonStringify(buildErrorLogObject(error), 2))

    // 更新数据库记录为失败状态
    try {
      await db.exec(
        `UPDATE campaigns
         SET status = 'PAUSED', creation_status = 'failed', creation_error = ?, updated_at = CURRENT_TIMESTAMP
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
