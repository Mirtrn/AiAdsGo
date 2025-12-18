import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsResponsiveSearchAd,
  updateGoogleAdsCampaignStatus,
  createGoogleAdsCalloutExtensions,
  createGoogleAdsSitelinkExtensions
} from '@/lib/google-ads-api'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { createError, ErrorCode, AppError } from '@/lib/errors'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { calculateLaunchScore } from '@/lib/scoring'
import type { AdCreative } from '@/lib/ad-creative'
import type { ScoreAnalysis } from '@/lib/launch-scores'
import {
  createLaunchScore,
  findCachedLaunchScore,
  computeContentHash,
  computeCampaignConfigHash,
  parseLaunchScoreAnalysis,
  type CreativeContentData,
  type CampaignConfigData
} from '@/lib/launch-scores'
import { generateNamingScheme } from '@/lib/naming-convention'

/**
 * 从ScoreAnalysis中提取所有问题（v4.0 - 4维度）
 */
function extractAllIssues(analysis: ScoreAnalysis): string[] {
  return [
    ...(analysis.launchViability?.issues || []),
    ...(analysis.adQuality?.issues || []),
    ...(analysis.keywordStrategy?.issues || []),
    ...(analysis.basicConfig?.issues || []),
  ]
}

/**
 * 从ScoreAnalysis中提取所有建议（v4.0 - 4维度）
 */
function extractAllSuggestions(analysis: ScoreAnalysis): string[] {
  return [
    ...(analysis.launchViability?.suggestions || []),
    ...(analysis.adQuality?.suggestions || []),
    ...(analysis.keywordStrategy?.suggestions || []),
    ...(analysis.basicConfig?.suggestions || []),
  ]
}

/**
 * POST /api/campaigns/publish
 *
 * 发布广告系列到Google Ads
 *
 * Request Body (🔧 修复2025-12-11: 统一使用camelCase):
 * {
 *   offerId: number
 *   adCreativeId: number  // 单创意模式：指定创意ID；智能优化模式：忽略（自动选择多个）
 *   googleAdsAccountId: number
 *   campaignConfig: {
 *     campaignName: string
 *     budgetAmount: number
 *     budgetType: 'DAILY' | 'TOTAL'
 *     targetCountry: string
 *     targetLanguage: string
 *     biddingStrategy: string
 *     finalUrlSuffix: string
 *     adGroupName: string
 *     maxCpcBid: number
 *     keywords: string[]
 *     negativeKeywords: string[]
 *   }
 *   pauseOldCampaigns: boolean
 *   enableSmartOptimization?: boolean  // 启用智能优化（默认false）
 *   variantCount?: number              // 创意变体数量（默认3，范围2-5）
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify authentication
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const userId = authResult.user.userId

    // 2. 解析请求体 - 🔧 修复(2025-12-11): 接受camelCase字段名
    const body = await request.json()
    const {
      // 支持camelCase（推荐）
      offerId,
      adCreativeId,
      googleAdsAccountId,
      campaignConfig,
      pauseOldCampaigns,
      enableCampaignImmediately = false,  // 是否立即启用Campaign，默认false（PAUSED状态）
      enableSmartOptimization = false,
      variantCount = 3,
      forcePublish = false, // 强制发布标志（用于绕过60-80分警告）
      // 向后兼容snake_case
      offer_id,
      ad_creative_id,
      google_ads_account_id,
      campaign_config,
      pause_old_campaigns,
      enable_campaign_immediately,
      enable_smart_optimization,
      variant_count,
      force_publish
    } = body

    // 使用camelCase优先，兼容snake_case
    const _offerId = offerId ?? offer_id
    const _adCreativeId = adCreativeId ?? ad_creative_id
    const _googleAdsAccountId = googleAdsAccountId ?? google_ads_account_id
    const _campaignConfig = campaignConfig ?? campaign_config
    const _pauseOldCampaigns = pauseOldCampaigns ?? pause_old_campaigns
    const _enableCampaignImmediately = enableCampaignImmediately ?? enable_campaign_immediately ?? false
    const _enableSmartOptimization = enableSmartOptimization ?? enable_smart_optimization ?? false
    const _variantCount = variantCount ?? variant_count ?? 3
    const _forcePublish = forcePublish ?? force_publish ?? false

    // 3. 验证必填字段
    if (!_offerId || !_googleAdsAccountId || !_campaignConfig) {
      const missing = []
      if (!_offerId) missing.push('offerId')
      if (!_googleAdsAccountId) missing.push('googleAdsAccountId')
      if (!_campaignConfig) missing.push('campaignConfig')

      const error = createError.requiredField(missing.join(', '))
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 单创意模式需要指定adCreativeId
    if (!_enableSmartOptimization && !_adCreativeId) {
      const error = createError.requiredField('adCreativeId')
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 智能优化模式验证variantCount
    if (_enableSmartOptimization) {
      if (_variantCount < 2 || _variantCount > 5) {
        const error = createError.invalidParameter({
          field: 'variantCount',
          value: _variantCount,
          constraint: 'Must be between 2 and 5'
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
    }

    const db = await getDatabase()

    // 4. 验证Offer归属
    const offer = await db.queryOne(`
      SELECT id, url, brand, target_country, target_language, scrape_status
      FROM offers
      WHERE id = ? AND user_id = ?
    `, [_offerId, userId]) as any

    if (!offer) {
      const error = createError.offerNotFound({ offerId: _offerId, userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    if (offer.scrape_status !== 'completed') {
      const error = createError.offerNotReady({
        offerId: _offerId,
        currentStatus: offer.scrape_status,
        requiredStatus: 'completed'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 5. 选择广告创意（单创意模式 vs 智能优化模式）
    let creatives: any[] = []

    if (_enableSmartOptimization) {
      // 智能优化模式：选择多个最优创意
      creatives = await db.query(`
        SELECT id, headlines, descriptions, keywords, negative_keywords, callouts, sitelinks, final_url, final_url_suffix, launch_score, keywords_with_volume
        FROM ad_creatives
        WHERE offer_id = ? AND user_id = ?
        ORDER BY launch_score DESC, created_at DESC
        LIMIT ?
      `, [_offerId, userId, _variantCount]) as any[]

      if (creatives.length < _variantCount) {
        const error = createError.invalidParameter({
          field: 'creatives',
          message: `需要至少${_variantCount}个创意，但只找到${creatives.length}个`
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
    } else {
      // 单创意模式：验证指定的创意
      const creative = await db.queryOne(`
        SELECT id, headlines, descriptions, keywords, negative_keywords, callouts, sitelinks, final_url, final_url_suffix, is_selected, keywords_with_volume
        FROM ad_creatives
        WHERE id = ? AND offer_id = ? AND user_id = ?
      `, [_adCreativeId, _offerId, userId]) as any

      if (!creative) {
        const error = createError.creativeNotFound({ creativeId: _adCreativeId })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }

      creatives = [creative]
    }

    // 验证Final URL必须存在（Final URL Suffix可以为空）
    for (const creative of creatives) {
      if (!creative.final_url) {
        const error = createError.invalidParameter({
          field: 'final_url',
          message: `广告创意 ${creative.id} 缺少Final URL，请重新抓取Offer数据`
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
    }

    // 6. 获取Google Ads账号信息（customer_id）
    // 🔧 确保参数类型正确：googleAdsAccountId和userId应该是数字
    // 📝 注意：db.ts的convertParams会自动处理SQLite(1/0) ↔ PostgreSQL(true/false)转换
    const adsAccount = await db.queryOne(`
      SELECT id, customer_id, is_active
      FROM google_ads_accounts
      WHERE id = ? AND user_id = ? AND is_active = ?
    `, [Number(_googleAdsAccountId), Number(userId), 1]) as any

    if (!adsAccount) {
      const error = createError.gadsAccountNotActive({
        accountId: _googleAdsAccountId,
        userId
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 🔓 KISS优化(2025-12-12): 移除独占约束，允许多个Offer共享同一Ads账号
    // 原逻辑：一个Ads账号只能被一个Offer使用
    // 新逻辑：多个Offer可以共享同一Ads账号，通过前端优先级排序引导用户选择
    console.log(`✅ Ads账号 ${_googleAdsAccountId} 可供Offer #${_offerId} 使用（已移除独占约束）`)

    // 🔍 验证2：查询当前Offer在该账号下的已激活Campaign
    const existingActiveCampaigns = await db.query(`
      SELECT
        c.id,
        c.campaign_name,
        c.budget_amount,
        c.status,
        c.created_at,
        ac.theme as creative_theme
      FROM campaigns c
      LEFT JOIN ad_creatives ac ON c.ad_creative_id = ac.id
      WHERE c.offer_id = ?
        AND c.google_ads_account_id = ?
        AND c.status = 'ENABLED'
        AND c.is_deleted = 0
      ORDER BY c.created_at DESC
    `, [_offerId, _googleAdsAccountId]) as any[]

    console.log(`📊 当前Offer在该Ads账号下有${existingActiveCampaigns.length}个激活的Campaign`)

    // ⚠️ 验证3：如果有激活Campaign且用户未确认，返回确认提示
    if (existingActiveCampaigns.length > 0 && !_pauseOldCampaigns && !_forcePublish) {
      console.log(`⚠️ 需要用户确认: 是否暂停${existingActiveCampaigns.length}个已激活的Campaign`)
      return NextResponse.json({
        action: 'CONFIRM_PAUSE_OLD_CAMPAIGNS',
        existingCampaigns: existingActiveCampaigns.map((c: any) => ({
          id: c.id,
          campaignName: c.campaign_name,
          budgetAmount: c.budget_amount,
          creativeTheme: c.creative_theme,
          createdAt: c.created_at
        })),
        total: existingActiveCampaigns.length,
        message: `该Offer在此Ads账号下已有${existingActiveCampaigns.length}个激活的广告系列`,
        question: '是否暂停旧广告后再发布新创意？',
        options: [
          { label: '暂停并发布', value: 'pause_and_publish', description: '推荐：先暂停所有旧广告，再发布新广告' },
          { label: '直接发布（A/B测试）', value: 'publish_together', description: '旧广告继续运行，新广告同时激活' },
          { label: '取消', value: 'cancel', description: '不发布新广告' }
        ]
      }, { status: 422 })
    }

    // 6.1 获取全局OAuth凭证（refresh_token存储在google_ads_credentials表）
    const credentials = await getGoogleAdsCredentials(userId)
    if (!credentials || !credentials.refresh_token) {
      const error = new AppError(ErrorCode.GADS_CREDENTIALS_INVALID, {
        userId,
        reason: 'OAuth refresh token missing in google_ads_credentials table'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 7. 暂停旧广告系列（如果请求）
    if (_pauseOldCampaigns) {
      const oldCampaigns = await db.query(`
        SELECT id, google_campaign_id
        FROM campaigns
        WHERE offer_id = ? AND user_id = ? AND status = 'ENABLED' AND google_campaign_id IS NOT NULL
      `, [_offerId, userId]) as any[]

      for (const oldCampaign of oldCampaigns) {
        try {
          await updateGoogleAdsCampaignStatus({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            campaignId: oldCampaign.google_campaign_id,
            status: 'PAUSED',
            accountId: adsAccount.id,
            userId
          })

          // 更新数据库状态
          await db.exec(`
            UPDATE campaigns
            SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [oldCampaign.id])
        } catch (error: any) {
          console.error(`Failed to pause campaign ${oldCampaign.id}:`, error.message)
          // 继续处理，不中断流程
        }
      }
    }

    // 7.5 Launch Score评估（投放风险评估）
    console.log(`\n🎯 开始Launch Score评估...`)
    const primaryCreative = creatives[0]

    // 解析创意数据（从JSON字符串）
    const creativeData = {
      headlines: JSON.parse(primaryCreative.headlines || '[]'),
      descriptions: JSON.parse(primaryCreative.descriptions || '[]'),
      keywords: JSON.parse(primaryCreative.keywords || '[]'),
      negativeKeywords: JSON.parse(primaryCreative.negative_keywords || '[]'),  // 🔥 修复：添加否定关键词解析
      callouts: JSON.parse(primaryCreative.callouts || '[]'),
      sitelinks: JSON.parse(primaryCreative.sitelinks || '[]')
    }

    // 🔥 新增：调试日志 - 追踪creativeData中的否定关键词
    console.log(`[Publish] 创意ID: ${primaryCreative.id}`)
    console.log(`[Publish] creativeData.negativeKeywords长度: ${creativeData.negativeKeywords.length}`)
    console.log(`[Publish] creativeData.negativeKeywords示例: ${creativeData.negativeKeywords.slice(0, 5).join(', ')}`)

    // 🔥 新增(2025-12-17): 计算缓存哈希
    const contentHashData: CreativeContentData = {
      headlines: creativeData.headlines,
      descriptions: creativeData.descriptions,
      keywords: creativeData.keywords,
      negativeKeywords: creativeData.negativeKeywords,
      finalUrl: primaryCreative.final_url || ''
    }
    const campaignConfigHashData: CampaignConfigData = {
      targetCountry: _campaignConfig.targetCountry || '',
      targetLanguage: _campaignConfig.targetLanguage || '',
      dailyBudget: _campaignConfig.budgetAmount || 0,
      maxCpc: _campaignConfig.maxCpcBid || 0
    }
    const contentHash = computeContentHash(contentHashData)
    const campaignConfigHash = computeCampaignConfigHash(campaignConfigHashData)
    console.log(`📝 内容哈希: ${contentHash}, 配置哈希: ${campaignConfigHash}`)

    // 🔥 新增(2025-12-17): 检查缓存的Launch Score
    let cachedLaunchScore = null
    try {
      cachedLaunchScore = await findCachedLaunchScore(
        primaryCreative.id,
        contentHash,
        campaignConfigHash,
        userId
      )
      if (cachedLaunchScore) {
        console.log(`✅ 找到缓存的Launch Score (ID: ${cachedLaunchScore.id})，跳过重新计算`)
      }
    } catch (cacheError: any) {
      console.warn(`⚠️ 缓存查询失败: ${cacheError.message}，将重新计算`)
    }

    try {
      let launchScore: number
      let scoreAnalysis: ScoreAnalysis

      if (cachedLaunchScore) {
        // 使用缓存的数据
        launchScore = cachedLaunchScore.totalScore
        scoreAnalysis = parseLaunchScoreAnalysis(cachedLaunchScore)
        console.log(`📦 使用缓存的Launch Score: ${launchScore}分`)
      } else {
        // 🔥 修复：明确构建创意对象，避免字段冲突
        const creativeForLaunchScore = {
          id: primaryCreative.id,
          offer_id: primaryCreative.offer_id,
          user_id: primaryCreative.user_id,
          headlines: creativeData.headlines,
          descriptions: creativeData.descriptions,
          keywords: creativeData.keywords,
          negativeKeywords: creativeData.negativeKeywords,  // 使用解析后的数组
          keywordsWithVolume: primaryCreative.keywords_with_volume ?
            JSON.parse(primaryCreative.keywords_with_volume) :
            creativeData.keywords,  // 优先使用数据库中的keywords_with_volume
          callouts: creativeData.callouts,
          sitelinks: creativeData.sitelinks,
          final_url: primaryCreative.final_url,
          final_url_suffix: primaryCreative.final_url_suffix,
          path_1: primaryCreative.path_1,
          path_2: primaryCreative.path_2,
          score: primaryCreative.score || 0,
          score_breakdown: primaryCreative.score_breakdown || {
            relevance: 0,
            quality: 0,
            engagement: 0,
            diversity: 0,
            clarity: 0,
            brandSearchVolume: 0,
            competitivePositioning: 0
          },
          score_explanation: primaryCreative.score_explanation || '',
          version: primaryCreative.version || 1,
          generation_round: primaryCreative.generation_round || 1,
          generation_prompt: primaryCreative.generation_prompt,
          theme: primaryCreative.theme || '',
          ai_model: primaryCreative.ai_model || 'gemini-pro',
          ad_group_id: primaryCreative.ad_group_id,
          ad_id: primaryCreative.ad_id,
          creation_status: primaryCreative.creation_status || 'draft',
          creation_error: primaryCreative.creation_error,
          last_sync_at: primaryCreative.last_sync_at,
          is_selected: primaryCreative.is_selected || 0,
          created_at: primaryCreative.created_at,
          updated_at: primaryCreative.updated_at
        } as AdCreative

        // 🔥 新增：调试日志 - 追踪构建的创意对象
        console.log(`[Publish] 构建的创意对象ID: ${creativeForLaunchScore.id}`)
        console.log(`[Publish] negativeKeywords字段存在: ${!!creativeForLaunchScore.negativeKeywords}`)
        console.log(`[Publish] negativeKeywords长度: ${creativeForLaunchScore.negativeKeywords?.length || 0}`)
        console.log(`[Publish] negativeKeywords示例: ${creativeForLaunchScore.negativeKeywords?.slice(0, 5).join(', ') || 'NONE'}`)

        // 重新计算Launch Score
        const launchScoreResult = await calculateLaunchScore(
          offer,
          creativeForLaunchScore,
          userId,
          {
            budgetAmount: _campaignConfig.budgetAmount,
            maxCpcBid: _campaignConfig.maxCpcBid,
            budgetType: _campaignConfig.budgetType
          }
        )

        // 🔥 新增：调试日志 - 追踪传递给Launch Score的参数
        console.log(`[Publish] 传递给Launch Score的negativeKeywords长度: ${creativeData.negativeKeywords.length}`)
        console.log(`[Publish] 传递给Launch Score的negativeKeywords示例: ${creativeData.negativeKeywords.slice(0, 5).join(', ')}`)

        launchScore = launchScoreResult.totalScore
        scoreAnalysis = launchScoreResult.scoreAnalysis
        const overallRecommendations = launchScoreResult.recommendations || []  // 🔧 修复：从launchScoreResult获取recommendations

        // 🔥 修复(2025-12-17): 保存Launch Score到数据库（带缓存信息）
        try {
          // 1. 保存到launch_scores表（带缓存哈希）
          await createLaunchScore(userId, _offerId, scoreAnalysis, {
            adCreativeId: primaryCreative.id,
            contentHash,
            campaignConfigHash
          })
          console.log(`✅ Launch Score已保存到launch_scores表（带缓存信息）`)

          // 2. 更新ad_creatives表的launch_score字段
          await db.exec(`
            UPDATE ad_creatives
            SET launch_score = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [launchScore, primaryCreative.id])
          console.log(`✅ ad_creatives.launch_score已更新为${launchScore}`)
        } catch (saveError: any) {
          // 保存失败不阻断流程，只记录警告
          console.warn(`⚠️ 保存Launch Score失败: ${saveError.message}`)
        }
      }

      // 🎯 从scoreAnalysis中提取各维度分数（v4.0 - 4维度）
      const analysis = scoreAnalysis

      console.log(`📊 Launch Score评估结果 (v4.0): ${launchScore}分`)
      console.log(`   - 投放可行性: ${analysis.launchViability.score}/35`)
      console.log(`   - 广告质量: ${analysis.adQuality.score}/30`)
      console.log(`   - 关键词策略: ${analysis.keywordStrategy.score}/20`)
      console.log(`   - 基础配置: ${analysis.basicConfig.score}/15`)

      // 阻断规则
      const CRITICAL_THRESHOLD = 60  // 严重问题阈值
      const WARNING_THRESHOLD = 80   // 警告阈值

      if (launchScore < CRITICAL_THRESHOLD) {
        // 强制阻断：<60分
        console.error(`❌ Launch Score过低: ${launchScore}分 < ${CRITICAL_THRESHOLD}分，强制阻断`)

        // 🎯 收集所有维度的问题和建议
        const allIssues = extractAllIssues(scoreAnalysis)
        const allSuggestions = extractAllSuggestions(scoreAnalysis)

        return NextResponse.json(
          {
            error: `投放风险过高（Launch Score: ${launchScore}分），无法发布`,
            details: {
              launchScore,
              threshold: CRITICAL_THRESHOLD,
              breakdown: {
                launchViability: { score: analysis.launchViability.score, max: 35 },
                adQuality: { score: analysis.adQuality.score, max: 30 },
                keywordStrategy: { score: analysis.keywordStrategy.score, max: 20 },
                basicConfig: { score: analysis.basicConfig.score, max: 15 }
              },
              issues: allIssues,
              suggestions: allSuggestions,
              overallRecommendations: overallRecommendations  // 🔧 修复：使用正确的变量
            },
            action: 'LAUNCH_SCORE_BLOCKED'
          },
          { status: 422 } // 422 Unprocessable Entity
        )
      } else if (launchScore < WARNING_THRESHOLD && !_forcePublish) {
        // 警告但可绕过：60-80分
        console.warn(`⚠️ Launch Score偏低: ${launchScore}分 < ${WARNING_THRESHOLD}分，建议优化后再发布`)

        // 🎯 收集所有维度的问题和建议
        const allIssues = extractAllIssues(scoreAnalysis)
        const allSuggestions = extractAllSuggestions(scoreAnalysis)

        return NextResponse.json(
          {
            error: `投放风险较高（Launch Score: ${launchScore}分），建议优化`,
            details: {
              launchScore,
              threshold: WARNING_THRESHOLD,
              breakdown: {
                launchViability: { score: analysis.launchViability.score, max: 35 },
                adQuality: { score: analysis.adQuality.score, max: 30 },
                keywordStrategy: { score: analysis.keywordStrategy.score, max: 20 },
                basicConfig: { score: analysis.basicConfig.score, max: 15 }
              },
              issues: allIssues,
              suggestions: allSuggestions,
              overallRecommendations: overallRecommendations,  // 🔧 修复：使用正确的变量
              canForcePublish: true // 允许强制发布
            },
            action: 'LAUNCH_SCORE_WARNING'
          },
          { status: 422 }
        )
      }

      console.log(`✅ Launch Score评估通过: ${launchScore}分 ${_forcePublish ? '(强制发布)' : ''}`)

    } catch (error: any) {
      console.error('Launch Score评估失败:', error.message)
      // Launch Score评估失败不阻断发布，只记录日志
      console.warn('⚠️ Launch Score评估失败，跳过风险评估')
    }

    // 8. A/B测试功能已下线 (KISS optimization 2025-12-08)
    // 保留ab_test_id变量以保持向后兼容性，但始终为null
    const abTestId: number | null = null
    // A/B测试记录创建已移除 - 原代码: INSERT INTO ab_tests ...

    // 9. 计算流量分配（预算分配）
    const trafficAllocations = creatives.map((_, index) => {
      // 均匀分配流量
      return 1.0 / creatives.length
    })

    // 10. 批量创建Campaigns
    const createdCampaigns: any[] = []
    const now = new Date().toISOString()

    for (let i = 0; i < creatives.length; i++) {
      const creative = creatives[i]
      const variantName = creatives.length > 1 ? String.fromCharCode(65 + i) : '' // A, B, C...
      const variantSuffix = variantName ? ` - Variant ${variantName}` : ''
      const variantBudget = _campaignConfig.budgetAmount * trafficAllocations[i]

      // 🔥 使用统一命名规范生成名称
      const naming = generateNamingScheme({
        offer: {
          id: _offerId,
          brand: offer.brand,
          category: offer.category || undefined
        },
        config: {
          targetCountry: _campaignConfig.targetCountry,
          budgetAmount: variantBudget,
          budgetType: _campaignConfig.budgetType,
          biddingStrategy: _campaignConfig.biddingStrategy,
          maxCpcBid: _campaignConfig.maxCpcBid
        },
        creative: {
          id: creative.id,
          theme: creative.theme || undefined
        },
        smartOptimization: _enableSmartOptimization ? {
          enabled: true,
          variantIndex: i + 1,
          totalVariants: creatives.length
        } : undefined
      })

      console.log(`📝 生成命名: Campaign=${naming.campaignName}, AdGroup=${naming.adGroupName}, Ad=${naming.adName}`)

      const campaignInsert = await db.exec(`
        INSERT INTO campaigns (
          user_id,
          offer_id,
          google_ads_account_id,
          campaign_name,
          budget_amount,
          budget_type,
          status,
          creation_status,
          ad_creative_id,
          campaign_config,
          pause_old_campaigns,
          is_test_variant,
          ab_test_id,
          traffic_allocation,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ENABLED', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId,
        _offerId,
        _googleAdsAccountId,
        naming.campaignName,  // 🔥 使用规范化的Campaign名称
        variantBudget,
        _campaignConfig.budgetType,
        creative.id,
        JSON.stringify(_campaignConfig),
        _pauseOldCampaigns ? 1 : 0,
        _enableSmartOptimization ? 1 : 0,
        abTestId,
        trafficAllocations[i],
        now,
        now
      ])

      const campaignId = Number(campaignInsert.lastInsertRowid)
      createdCampaigns.push({
        campaignId,
        creative,
        variantName,
        variantBudget,
        naming  // 🔥 保存命名方案供后续使用
      })
    }

    // 11. 批量发布到Google Ads
    const publishResults: any[] = []
    const failedCampaigns: any[] = []

    try {
      for (const { campaignId, creative, variantName, variantBudget, naming } of createdCampaigns) {
        // API追踪设置
        const apiStartTime = Date.now()
        let apiSuccess = false
        let apiErrorMessage: string | undefined
        let totalApiOperations = 0

        try {
          console.log(`🚀 发布Campaign ${campaignId} (Variant ${variantName || 'Single'})...`)

          // 创建Campaign到Google Ads
          totalApiOperations++ // Campaign creation = 1 operation
          const { campaignId: googleCampaignId } = await createGoogleAdsCampaign({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            campaignName: naming.campaignName,  // 🔥 使用规范化的Campaign名称
            budgetAmount: variantBudget,
            budgetType: _campaignConfig.budgetType,
            biddingStrategy: _campaignConfig.biddingStrategy,
            targetCountry: _campaignConfig.targetCountry,
            targetLanguage: _campaignConfig.targetLanguage,
            finalUrlSuffix: creative.final_url_suffix || undefined,  // Final URL suffix从推广链接中提取（如果为空则不设置）
            status: 'ENABLED',
            accountId: adsAccount.id,
            userId
          })

          // 创建Ad Group到Google Ads
          totalApiOperations++ // Ad group creation = 1 operation
          const { adGroupId: googleAdGroupId } = await createGoogleAdsAdGroup({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            campaignId: googleCampaignId,
            adGroupName: naming.adGroupName,  // 🔥 使用规范化的Ad Group名称
            cpcBidMicros: _campaignConfig.maxCpcBid * 1000000,
            status: 'ENABLED',
            accountId: adsAccount.id,
            userId
          })

          // 添加关键词
          let headlines = JSON.parse(creative.headlines) as string[]
          const descriptions = JSON.parse(creative.descriptions) as string[]

          // 🎯 验证RSA最小要求（至少10个headlines和4个descriptions）
          if (headlines.length < 10) {
            throw new Error(`RSA广告至少需要10个headlines，当前只有${headlines.length}个`)
          }
          if (descriptions.length < 4) {
            throw new Error(`RSA广告至少需要4个descriptions，当前只有${descriptions.length}个`)
          }

          // 🔥 修复未闭合的DKI标签（防御性处理已存储的数据）
          headlines = headlines.map((h: string) => {
            const unclosedPattern = /\{KeyWord:([^}]*?)$/i
            if (unclosedPattern.test(h)) {
              const match = h.match(unclosedPattern)
              if (match) {
                const defaultText = match[1].trim()
                // Google Ads headline限制30字符，DKI的defaultText也应支持到30字符
                if (defaultText.length > 0 && defaultText.length <= 30) {
                  console.log(`🔧 [Publish] 修复DKI标签: "${h}"`)
                  return h + '}'
                } else {
                  console.log(`🔧 [Publish] 移除无效DKI标签（defaultText长度${defaultText.length}）: "${h}"`)
                  return h.replace(unclosedPattern, defaultText || '')
                }
              }
            }
            return h
          })

          // 🎯 修复：从creative的keywordsWithVolume中读取matchType
          const keywordsWithVolume = JSON.parse(creative.keywords_with_volume || '[]') as Array<{
            keyword: string
            matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
            searchVolume?: number
          }>

          // 构建关键词映射表（keyword -> matchType）
          const keywordMatchTypeMap = new Map<string, 'EXACT' | 'PHRASE' | 'BROAD'>()
          keywordsWithVolume.forEach(kw => {
            if (kw.matchType) {
              keywordMatchTypeMap.set(kw.keyword.toLowerCase(), kw.matchType)
            }
          })

          // 智能分配matchType的辅助函数
          const getMatchType = (keyword: string): 'EXACT' | 'PHRASE' | 'BROAD' => {
            // 1. 优先使用keywordsWithVolume中的matchType
            const mappedType = keywordMatchTypeMap.get(keyword.toLowerCase())
            if (mappedType) {
              return mappedType
            }

            // 2. 智能分配：品牌词EXACT，长尾词PHRASE，短词BROAD
            const keywordLower = keyword.toLowerCase()
            const brandLower = offer.brand?.toLowerCase() || ''
            // 🔥 修复：添加品牌前缀匹配，识别包含品牌缩写的关键词（如"reo link camera"中的"reo"）
            // 提取品牌名前3个字符作为前缀，使用单词边界确保精确匹配
            const brandPrefix = brandLower.substring(0, 3)
            const hasBrandPrefix = brandLower.length >= 3 && new RegExp(`\\b${brandPrefix}\\b`).test(keywordLower)

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

          const keywordOperations = _campaignConfig.keywords.map((keyword: string) => ({
            keywordText: keyword,
            matchType: getMatchType(keyword),
            status: 'ENABLED' as const
          }))

          if (keywordOperations.length > 0) {
            totalApiOperations += keywordOperations.length // Each keyword = 1 operation
            await createGoogleAdsKeywordsBatch({
              customerId: adsAccount.customer_id,
              refreshToken: credentials.refresh_token,
              adGroupId: googleAdGroupId,
              keywords: keywordOperations,
              accountId: adsAccount.id,
              userId
            })
          }

          // 添加否定关键词
          if (_campaignConfig.negativeKeywords && _campaignConfig.negativeKeywords.length > 0) {
            const negativeKeywordOperations = _campaignConfig.negativeKeywords.map((keyword: string) => ({
              keywordText: keyword,
              matchType: 'EXACT' as const,
              status: 'ENABLED' as const,
              isNegative: true
            }))

            totalApiOperations += negativeKeywordOperations.length // Each negative keyword = 1 operation
            await createGoogleAdsKeywordsBatch({
              customerId: adsAccount.customer_id,
              refreshToken: credentials.refresh_token,
              adGroupId: googleAdGroupId,
              keywords: negativeKeywordOperations,
              accountId: adsAccount.id,
              userId
            })
          }

          // 创建Responsive Search Ad
          totalApiOperations++ // Ad creation = 1 operation
          console.log(`📝 创建广告: ${naming.adName || 'RSA_Default'}`)  // 🔥 记录Ad命名（仅用于日志追踪）
          const { adId: googleAdId } = await createGoogleAdsResponsiveSearchAd({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            adGroupId: googleAdGroupId,
            headlines: headlines.slice(0, 15),
            descriptions: descriptions.slice(0, 4),
            finalUrls: [creative.final_url],
            path1: creative.path1 || undefined,  // RSA Display URL路径1
            path2: creative.path2 || undefined,  // RSA Display URL路径2
            accountId: adsAccount.id,
            userId
          })

          // 🎯 添加广告扩展（Callout和Sitelink）
          try {
            // 解析Callout数据
            const callouts = JSON.parse(creative.callouts || '[]') as string[]
            if (callouts.length > 0) {
              totalApiOperations += callouts.length + 1 // Assets creation + campaign link
              await createGoogleAdsCalloutExtensions({
                customerId: adsAccount.customer_id,
                refreshToken: credentials.refresh_token,
                campaignId: googleCampaignId,
                callouts: callouts,
                accountId: adsAccount.id,
                userId
              })
              console.log(`✅ 成功添加${callouts.length}个Callout扩展`)
            }

            // 解析Sitelink数据
            const sitelinks = JSON.parse(creative.sitelinks || '[]') as Array<{
              text: string
              url: string
              description?: string
            }>
            if (sitelinks.length > 0) {
              // 处理Sitelink的description字段（可能需要拆分为description1和description2）
              const formattedSitelinks = sitelinks.map(link => ({
                text: link.text,
                url: link.url,
                description1: link.description || '',
                description2: ''
              }))

              totalApiOperations += sitelinks.length + 1 // Assets creation + campaign link
              await createGoogleAdsSitelinkExtensions({
                customerId: adsAccount.customer_id,
                refreshToken: credentials.refresh_token,
                campaignId: googleCampaignId,
                sitelinks: formattedSitelinks,
                accountId: adsAccount.id,
                userId
              })
              console.log(`✅ 成功添加${sitelinks.length}个Sitelink扩展`)
            }
          } catch (extensionError: any) {
            // 扩展创建失败不影响主流程，只记录警告
            console.warn(`⚠️ 广告扩展创建失败（非致命错误）:`, extensionError.message)
          }

          // 🎯 启用Campaign（如果用户选择立即启用）
          // Campaign创建时默认是PAUSED状态，需要在所有组件（Ad Group、Keywords、Ad、Extensions）创建完成后启用
          let finalCampaignStatus: 'ENABLED' | 'PAUSED' = 'PAUSED'
          if (_enableCampaignImmediately) {
            try {
              totalApiOperations++ // Campaign status update = 1 operation
              await updateGoogleAdsCampaignStatus({
                customerId: adsAccount.customer_id,
                refreshToken: credentials.refresh_token,
                campaignId: googleCampaignId,
                status: 'ENABLED',
                accountId: adsAccount.id,
                userId
              })
              finalCampaignStatus = 'ENABLED'
              console.log(`✅ Campaign ${googleCampaignId} 已启用`)
            } catch (enableError: any) {
              // 启用失败不阻止流程，Campaign会保持PAUSED状态
              console.warn(`⚠️ Campaign启用失败（非致命错误）:`, enableError.message)
              console.warn('Campaign将保持PAUSED状态，请在Google Ads后台手动启用')
            }
          } else {
            console.log(`ℹ️ Campaign ${googleCampaignId} 保持PAUSED状态（用户选择不立即启用）`)
          }

          // 更新数据库记录
          await db.exec(`
            UPDATE campaigns
            SET
              google_campaign_id = ?,
              google_ad_group_id = ?,
              google_ad_id = ?,
              status = ?,
              creation_status = 'synced',
              creation_error = NULL,
              last_sync_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [googleCampaignId, googleAdGroupId, googleAdId, finalCampaignStatus, campaignId])

          // 🔧 修复(2025-12-11): snake_case → camelCase
          publishResults.push({
            id: campaignId,
            googleCampaignId: googleCampaignId,
            googleAdGroupId: googleAdGroupId,
            googleAdId: googleAdId,
            variantName: variantName,
            status: finalCampaignStatus,  // 使用实际的Campaign状态
            creationStatus: 'synced'
          })

          apiSuccess = true
          console.log(`✅ Campaign ${campaignId} 发布成功 (${totalApiOperations} API operations)`)

        } catch (variantError: any) {
          apiSuccess = false
          // 安全获取错误消息
          let errorMessage = '未知错误'
          if (variantError?.message) {
            errorMessage = variantError.message
          } else if (typeof variantError === 'string') {
            errorMessage = variantError
          } else if (variantError) {
            try {
              errorMessage = JSON.stringify(variantError, null, 2)
            } catch {
              errorMessage = String(variantError)
            }
          }

          apiErrorMessage = errorMessage
          console.error(`❌ Campaign ${campaignId} 发布失败:`, errorMessage)
          console.error('完整错误对象:', variantError)

          await db.exec(`
            UPDATE campaigns
            SET
              creation_status = 'failed',
              creation_error = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [errorMessage, campaignId])

          // 🔧 修复(2025-12-11): snake_case → camelCase
          failedCampaigns.push({
            id: campaignId,
            variantName: variantName,
            error: errorMessage
          })
        } finally {
          // 记录API使用（仅在有userId时追踪）
          if (userId) {
            trackApiUsage({
              userId: userId,
              operationType: ApiOperationType.MUTATE_BATCH,
              endpoint: 'publishCampaign',
              customerId: adsAccount.customer_id,
              requestCount: totalApiOperations,
              responseTimeMs: Date.now() - apiStartTime,
              isSuccess: apiSuccess,
              errorMessage: apiErrorMessage
            })
          }
        }
      }

      // A/B测试功能已下线 (KISS optimization 2025-12-08)
      // ab_test_variants记录创建已移除 - abTestId始终为null

      return NextResponse.json({
        success: publishResults.length > 0,
        abTestId: abTestId,  // 🔧 修复(2025-12-11): ab_test_id → abTestId
        campaigns: publishResults,
        failed: failedCampaigns,
        summary: {
          total: createdCampaigns.length,
          successful: publishResults.length,
          failed: failedCampaigns.length
        }
      })

    } catch (error: any) {
      // 批量创建过程中的系统级错误
      console.error('Batch publish error:', error)

      // 标记所有未成功的campaigns为失败
      for (const { campaignId } of createdCampaigns) {
        const alreadySucceeded = publishResults.some(r => r.id === campaignId)
        if (!alreadySucceeded) {
          await db.exec(`
            UPDATE campaigns
            SET
              creation_status = 'failed',
              creation_error = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [error.message, campaignId])
        }
      }

      // 如果是AppError，直接返回
      if (error instanceof AppError) {
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }

      // 通用错误
      const appError = createError.campaignCreateFailed({
        originalError: error.message
      })
      return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
    }

  } catch (error: any) {
    console.error('Publish campaign error:', error)

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 通用系统错误
    const appError = createError.internalError({
      operation: 'publish_campaign',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}
