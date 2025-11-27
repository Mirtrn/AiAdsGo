import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase, getSQLiteDatabase } from '@/lib/db'
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

/**
 * POST /api/campaigns/publish
 *
 * 发布广告系列到Google Ads
 *
 * Request Body:
 * {
 *   offer_id: number
 *   ad_creative_id: number  // 单创意模式：指定创意ID；智能优化模式：忽略（自动选择多个）
 *   google_ads_account_id: number
 *   campaign_config: {
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
 *   pause_old_campaigns: boolean
 *   enable_smart_optimization?: boolean  // 启用智能优化（默认false）
 *   variant_count?: number              // 创意变体数量（默认3，范围2-5）
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

    // 2. 解析请求体
    const body = await request.json()
    const {
      offer_id,
      ad_creative_id,
      google_ads_account_id,
      campaign_config,
      pause_old_campaigns,
      enable_smart_optimization = false,
      variant_count = 3,
      force_publish = false // 强制发布标志（用于绕过60-80分警告）
    } = body

    // 3. 验证必填字段
    if (!offer_id || !google_ads_account_id || !campaign_config) {
      const missing = []
      if (!offer_id) missing.push('offer_id')
      if (!google_ads_account_id) missing.push('google_ads_account_id')
      if (!campaign_config) missing.push('campaign_config')

      const error = createError.requiredField(missing.join(', '))
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 单创意模式需要指定ad_creative_id
    if (!enable_smart_optimization && !ad_creative_id) {
      const error = createError.requiredField('ad_creative_id')
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 智能优化模式验证variant_count
    if (enable_smart_optimization) {
      if (variant_count < 2 || variant_count > 5) {
        const error = createError.invalidParameter({
          field: 'variant_count',
          value: variant_count,
          constraint: 'Must be between 2 and 5'
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
    }

    const db = getSQLiteDatabase()

    // 4. 验证Offer归属
    const offer = db.prepare(`
      SELECT id, url, brand, target_country, target_language, scrape_status
      FROM offers
      WHERE id = ? AND user_id = ?
    `).get(offer_id, userId) as any

    if (!offer) {
      const error = createError.offerNotFound({ offerId: offer_id, userId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    if (offer.scrape_status !== 'completed') {
      const error = createError.offerNotReady({
        offerId: offer_id,
        currentStatus: offer.scrape_status,
        requiredStatus: 'completed'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 5. 选择广告创意（单创意模式 vs 智能优化模式）
    let creatives: any[] = []

    if (enable_smart_optimization) {
      // 智能优化模式：选择多个最优创意
      creatives = db.prepare(`
        SELECT id, headlines, descriptions, keywords, callouts, sitelinks, final_url, final_url_suffix, launch_score
        FROM ad_creatives
        WHERE offer_id = ? AND user_id = ?
        ORDER BY launch_score DESC, created_at DESC
        LIMIT ?
      `).all(offer_id, userId, variant_count) as any[]

      if (creatives.length < variant_count) {
        const error = createError.invalidParameter({
          field: 'creatives',
          message: `需要至少${variant_count}个创意，但只找到${creatives.length}个`
        })
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }
    } else {
      // 单创意模式：验证指定的创意
      const creative = db.prepare(`
        SELECT id, headlines, descriptions, keywords, callouts, sitelinks, final_url, final_url_suffix, is_selected
        FROM ad_creatives
        WHERE id = ? AND offer_id = ? AND user_id = ?
      `).get(ad_creative_id, offer_id, userId) as any

      if (!creative) {
        const error = createError.creativeNotFound({ creativeId: ad_creative_id })
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
    const adsAccount = db.prepare(`
      SELECT id, customer_id, is_active
      FROM google_ads_accounts
      WHERE id = ? AND user_id = ? AND is_active = 1
    `).get(google_ads_account_id, userId) as any

    if (!adsAccount) {
      const error = createError.gadsAccountNotActive({
        accountId: google_ads_account_id,
        userId
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 6.1 获取全局OAuth凭证（refresh_token存储在google_ads_credentials表）
    const credentials = getGoogleAdsCredentials(userId)
    if (!credentials || !credentials.refresh_token) {
      const error = new AppError(ErrorCode.GADS_CREDENTIALS_INVALID, {
        userId,
        reason: 'OAuth refresh token missing in google_ads_credentials table'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 7. 暂停旧广告系列（如果请求）
    if (pause_old_campaigns) {
      const oldCampaigns = db.prepare(`
        SELECT id, google_campaign_id
        FROM campaigns
        WHERE offer_id = ? AND user_id = ? AND status = 'ENABLED' AND google_campaign_id IS NOT NULL
      `).all(offer_id, userId) as any[]

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
          db.prepare(`
            UPDATE campaigns
            SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(oldCampaign.id)
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

    try {
      const launchScoreResult = await calculateLaunchScore(
        offer,
        {
          ...primaryCreative,
          headlines: creativeData.headlines,
          descriptions: creativeData.descriptions,
          keywords: creativeData.keywords,
          negativeKeywords: creativeData.negativeKeywords,  // 🔥 修复：传递否定关键词给Launch Score评估
          callouts: creativeData.callouts,
          sitelinks: creativeData.sitelinks
        } as AdCreative,
        userId
      )

      // 从scoreAnalysis中提取各维度分数
      const keywordScore = launchScoreResult.scoreAnalysis.keywordAnalysis.score
      const marketFitScore = launchScoreResult.scoreAnalysis.marketFitAnalysis.score
      const landingPageScore = launchScoreResult.scoreAnalysis.landingPageAnalysis.score
      const budgetScore = launchScoreResult.scoreAnalysis.budgetAnalysis.score
      const contentScore = launchScoreResult.scoreAnalysis.contentAnalysis.score
      const launchScore = keywordScore + marketFitScore + landingPageScore + budgetScore + contentScore

      console.log(`📊 Launch Score评估结果: ${launchScore}分`)
      console.log(`   - 关键词: ${keywordScore}/30`)
      console.log(`   - 市场契合: ${marketFitScore}/25`)
      console.log(`   - 着陆页: ${landingPageScore}/20`)
      console.log(`   - 预算: ${budgetScore}/15`)
      console.log(`   - 内容: ${contentScore}/10`)

      // 阻断规则
      const CRITICAL_THRESHOLD = 60  // 严重问题阈值
      const WARNING_THRESHOLD = 80   // 警告阈值

      if (launchScore < CRITICAL_THRESHOLD) {
        // 强制阻断：<60分
        console.error(`❌ Launch Score过低: ${launchScore}分 < ${CRITICAL_THRESHOLD}分，强制阻断`)

        return NextResponse.json(
          {
            error: `投放风险过高（Launch Score: ${launchScore}分），无法发布`,
            details: {
              launchScore,
              threshold: CRITICAL_THRESHOLD,
              breakdown: {
                keyword: keywordScore,
                marketFit: marketFitScore,
                landingPage: landingPageScore,
                budget: budgetScore,
                content: contentScore
              },
              issues: launchScoreResult.scoreAnalysis.keywordAnalysis?.issues || [],
              recommendations: launchScoreResult.scoreAnalysis.overallRecommendations || []
            },
            action: 'LAUNCH_SCORE_BLOCKED'
          },
          { status: 422 } // 422 Unprocessable Entity
        )
      } else if (launchScore < WARNING_THRESHOLD && !force_publish) {
        // 警告但可绕过：60-80分
        console.warn(`⚠️ Launch Score偏低: ${launchScore}分 < ${WARNING_THRESHOLD}分，建议优化后再发布`)

        return NextResponse.json(
          {
            error: `投放风险较高（Launch Score: ${launchScore}分），建议优化`,
            details: {
              launchScore,
              threshold: WARNING_THRESHOLD,
              breakdown: {
                keyword: keywordScore,
                marketFit: marketFitScore,
                landingPage: landingPageScore,
                budget: budgetScore,
                content: contentScore
              },
              issues: launchScoreResult.scoreAnalysis.keywordAnalysis?.issues || [],
              recommendations: launchScoreResult.scoreAnalysis.overallRecommendations || [],
              canForcePublish: true // 允许强制发布
            },
            action: 'LAUNCH_SCORE_WARNING'
          },
          { status: 422 }
        )
      }

      console.log(`✅ Launch Score评估通过: ${launchScore}分 ${force_publish ? '(强制发布)' : ''}`)

    } catch (error: any) {
      console.error('Launch Score评估失败:', error.message)
      // Launch Score评估失败不阻断发布，只记录日志
      console.warn('⚠️ Launch Score评估失败，跳过风险评估')
    }

    // 8. 创建A/B测试记录（智能优化模式）
    let abTestId: number | null = null
    if (enable_smart_optimization) {
      const now = new Date().toISOString()
      const abTestInsert = db.prepare(`
        INSERT INTO ab_tests (
          user_id,
          offer_id,
          test_name,
          test_description,
          test_type,
          test_dimension,
          test_mode,
          is_auto_test,
          status,
          min_sample_size,
          confidence_level,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'full_creative', 'creative', 'launch_multi_variant', 1, 'running', 100, 0.95, ?, ?)
      `).run(
        userId,
        offer_id,
        `智能优化 - ${campaign_config.campaignName}`,
        `自动测试${variant_count}个创意变体，流量分配：均匀分布`,
        now,
        now
      )

      abTestId = Number(abTestInsert.lastInsertRowid)
      console.log(`✅ 创建A/B测试记录: ${abTestId}`)
    }

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
      const variantBudget = campaign_config.budgetAmount * trafficAllocations[i]

      const campaignInsert = db.prepare(`
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
      `).run(
        userId,
        offer_id,
        google_ads_account_id,
        campaign_config.campaignName + variantSuffix,
        variantBudget,
        campaign_config.budgetType,
        creative.id,
        JSON.stringify(campaign_config),
        pause_old_campaigns ? 1 : 0,
        enable_smart_optimization ? 1 : 0,
        abTestId,
        trafficAllocations[i],
        now,
        now
      )

      const campaignId = Number(campaignInsert.lastInsertRowid)
      createdCampaigns.push({ campaignId, creative, variantName, variantBudget })
    }

    // 11. 批量发布到Google Ads
    const publishResults: any[] = []
    const failedCampaigns: any[] = []

    try {
      for (const { campaignId, creative, variantName, variantBudget } of createdCampaigns) {
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
            campaignName: campaign_config.campaignName + (variantName ? ` - Variant ${variantName}` : ''),
            budgetAmount: variantBudget,
            budgetType: campaign_config.budgetType,
            biddingStrategy: campaign_config.biddingStrategy,
            targetCountry: campaign_config.targetCountry,
            targetLanguage: campaign_config.targetLanguage,
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
            adGroupName: campaign_config.adGroupName + (variantName ? ` ${variantName}` : ''),
            cpcBidMicros: campaign_config.maxCpcBid * 1000000,
            status: 'ENABLED',
            accountId: adsAccount.id,
            userId
          })

          // 添加关键词
          let headlines = JSON.parse(creative.headlines) as string[]
          const descriptions = JSON.parse(creative.descriptions) as string[]

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

          const keywordOperations = campaign_config.keywords.map((keyword: string) => ({
            keywordText: keyword,
            matchType: 'BROAD' as const,
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
          if (campaign_config.negativeKeywords && campaign_config.negativeKeywords.length > 0) {
            const negativeKeywordOperations = campaign_config.negativeKeywords.map((keyword: string) => ({
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
          const { adId: googleAdId } = await createGoogleAdsResponsiveSearchAd({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            adGroupId: googleAdGroupId,
            headlines: headlines.slice(0, 15),
            descriptions: descriptions.slice(0, 4),
            finalUrls: [creative.final_url],
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

          // 更新数据库记录
          db.prepare(`
            UPDATE campaigns
            SET
              google_campaign_id = ?,
              google_ad_group_id = ?,
              google_ad_id = ?,
              creation_status = 'synced',
              creation_error = NULL,
              last_sync_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(googleCampaignId, googleAdGroupId, googleAdId, campaignId)

          publishResults.push({
            id: campaignId,
            google_campaign_id: googleCampaignId,
            google_ad_group_id: googleAdGroupId,
            google_ad_id: googleAdId,
            variant_name: variantName,
            status: 'ENABLED',
            creation_status: 'synced'
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

          db.prepare(`
            UPDATE campaigns
            SET
              creation_status = 'failed',
              creation_error = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(errorMessage, campaignId)

          failedCampaigns.push({
            id: campaignId,
            variant_name: variantName,
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

      // 创建ab_test_variants记录（智能优化模式）
      if (enable_smart_optimization && abTestId) {
        for (let i = 0; i < publishResults.length; i++) {
          const result = publishResults[i]
          const creative = creatives[i]

          db.prepare(`
            INSERT INTO ab_test_variants (
              ab_test_id,
              variant_name,
              variant_label,
              ad_creative_id,
              traffic_allocation,
              is_control,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).run(
            abTestId,
            result.variant_name,
            `Variant ${result.variant_name}`,
            creative.id,
            trafficAllocations[i],
            i === 0 ? 1 : 0  // 第一个作为对照组
          )
        }
      }

      return NextResponse.json({
        success: publishResults.length > 0,
        ab_test_id: abTestId,
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
          db.prepare(`
            UPDATE campaigns
            SET
              creation_status = 'failed',
              creation_error = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(error.message, campaignId)
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
