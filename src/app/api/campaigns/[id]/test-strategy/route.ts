import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsResponsiveSearchAd,
  updateGoogleAdsCampaignBudget
} from '@/lib/google-ads-api'
import { createError, AppError } from '@/lib/errors'

/**
 * POST /api/campaigns/[id]/test-strategy
 *
 * 启动投放策略测试（Phase 2）
 *
 * 前提条件：
 * - Campaign是Phase 1的胜出者（已找到最优创意）
 * - 使用相同的创意，测试不同的投放策略
 *
 * 测试维度：
 * 1. negative_keywords - 否定关键词策略
 * 2. cpc_optimization - CPC出价优化
 * 3. bidding_strategy - 出价策略类型
 *
 * Request Body:
 * {
 *   test_dimension: 'negative_keywords' | 'cpc_optimization' | 'bidding_strategy',
 *   strategies: [
 *     {
 *       name: string,
 *       config: {
 *         negativeKeywords?: string[],
 *         cpcBid?: number,
 *         biddingStrategy?: string
 *       }
 *     }
 *   ],
 *   traffic_distribution?: number[],  // 流量分配（默认均匀）
 *   test_duration_days?: number       // 测试周期（默认14天）
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 1. 验证认证
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      const error = createError.unauthorized()
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const userId = authResult.user.userId
    const originalCampaignId = parseInt(params.id)

    // 2. 解析请求体
    const body = await request.json()
    const {
      test_dimension,
      strategies = [],
      traffic_distribution,
      test_duration_days = 14
    } = body

    // 3. 验证参数
    if (!test_dimension || !['negative_keywords', 'cpc_optimization', 'bidding_strategy'].includes(test_dimension)) {
      const error = createError.invalidParameter({
        field: 'test_dimension',
        expected: 'negative_keywords | cpc_optimization | bidding_strategy'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    if (!strategies || strategies.length < 2 || strategies.length > 5) {
      const error = createError.invalidParameter({
        field: 'strategies',
        constraint: 'Must have 2-5 strategies'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const db = getDatabase()

    // 4. 验证原Campaign
    const originalCampaign = db.prepare(`
      SELECT
        c.id,
        c.user_id,
        c.offer_id,
        c.google_ads_account_id,
        c.campaign_name,
        c.budget_amount,
        c.budget_type,
        c.google_campaign_id,
        c.ad_creative_id,
        c.campaign_config,
        c.status,
        ac.headlines,
        ac.descriptions,
        ac.keywords,
        ac.callouts,
        ac.sitelinks,
        ac.final_url,
        gaa.customer_id,
        gaa.refresh_token
      FROM campaigns c
      JOIN ad_creatives ac ON c.ad_creative_id = ac.id
      JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.id = ? AND c.user_id = ?
    `).get(originalCampaignId, userId) as any

    if (!originalCampaign) {
      const error = createError.campaignNotFound({ campaignId: originalCampaignId })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 5. 验证是否适合进行策略测试
    // 理想情况：原Campaign是Phase 1的胜出者
    const isPhase1Winner = db.prepare(`
      SELECT COUNT(*) as count
      FROM ab_tests
      WHERE winner_variant_id IN (
        SELECT id FROM ab_test_variants WHERE ad_creative_id = ?
      )
      AND test_dimension = 'creative'
      AND status = 'completed'
    `).get(originalCampaign.ad_creative_id) as any

    if (isPhase1Winner.count === 0) {
      console.log(`⚠️ Campaign ${originalCampaignId} 的创意不是Phase 1胜出者，但允许继续测试`)
    }

    // 6. 创建A/B测试记录
    const now = new Date().toISOString()
    const endDate = new Date(Date.now() + test_duration_days * 24 * 60 * 60 * 1000).toISOString()

    const testName = `策略优化 - ${originalCampaign.campaign_name} - ${test_dimension}`
    const testDescription = `测试${strategies.length}种${getDimensionLabel(test_dimension)}策略，使用相同创意`

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
        parent_campaign_id,
        status,
        start_date,
        end_date,
        min_sample_size,
        confidence_level,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'strategy', 'optimization_challenge', 1, ?, 'running', ?, ?, 200, 0.95, ?, ?)
    `).run(
      userId,
      originalCampaign.offer_id,
      testName,
      testDescription,
      test_dimension,
      originalCampaignId,
      now,
      endDate,
      now,
      now
    )

    const abTestId = Number(abTestInsert.lastInsertRowid)

    // 7. 计算流量分配
    const totalStrategies = strategies.length + 1 // +1 for original
    const trafficAllocations = traffic_distribution ||
      Array(totalStrategies).fill(1.0 / totalStrategies)

    if (trafficAllocations.length !== totalStrategies) {
      const error = createError.invalidParameter({
        field: 'traffic_distribution',
        message: `长度必须为${totalStrategies}（${strategies.length}个策略 + 1个原始）`
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 8. 调整原Campaign预算
    const newOriginalBudget = originalCampaign.budget_amount * trafficAllocations[0]

    try {
      await updateGoogleAdsCampaignBudget({
        customerId: originalCampaign.customer_id,
        refreshToken: originalCampaign.refresh_token,
        campaignId: originalCampaign.google_campaign_id,
        budgetAmount: newOriginalBudget,
        budgetType: originalCampaign.budget_type,
        accountId: originalCampaign.google_ads_account_id,
        userId
      })

      db.prepare(`
        UPDATE campaigns
        SET
          budget_amount = ?,
          traffic_allocation = ?,
          ab_test_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newOriginalBudget, trafficAllocations[0], abTestId, originalCampaignId)

      console.log(`✅ 原Campaign预算调整为 ${newOriginalBudget} (${(trafficAllocations[0] * 100).toFixed(0)}%)`)

    } catch (budgetError: any) {
      console.error('❌ 调整原Campaign预算失败:', budgetError.message)
      db.prepare('DELETE FROM ab_tests WHERE id = ?').run(abTestId)

      const error = createError.campaignUpdateFailed({
        campaignId: originalCampaignId,
        operation: 'update_budget',
        originalError: budgetError.message
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 9. 创建策略测试Campaigns
    const createdCampaigns: any[] = []
    const failedCampaigns: any[] = []
    const campaignConfig = JSON.parse(originalCampaign.campaign_config)

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i]
      const variantName = String.fromCharCode(66 + i) // B, C, D...
      const variantBudget = originalCampaign.budget_amount * trafficAllocations[i + 1]

      // 应用策略配置
      const strategyConfig = applyStrategyConfig(
        campaignConfig,
        test_dimension,
        strategy.config
      )

      // 创建Campaign到数据库
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
          is_test_variant,
          ab_test_id,
          traffic_allocation,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ENABLED', 'pending', ?, ?, 1, ?, ?, ?, ?)
      `).run(
        userId,
        originalCampaign.offer_id,
        originalCampaign.google_ads_account_id,
        `${originalCampaign.campaign_name} - Strategy ${variantName}`,
        variantBudget,
        originalCampaign.budget_type,
        originalCampaign.ad_creative_id,
        JSON.stringify(strategyConfig),
        abTestId,
        trafficAllocations[i + 1],
        now,
        now
      )

      const campaignId = Number(campaignInsert.lastInsertRowid)

      try {
        // 创建到Google Ads
        console.log(`🚀 创建策略测试Campaign ${variantName}: ${strategy.name}`)

        const { campaignId: googleCampaignId } = await createGoogleAdsCampaign({
          customerId: originalCampaign.customer_id,
          refreshToken: originalCampaign.refresh_token,
          campaignName: `${originalCampaign.campaign_name} - Strategy ${variantName}`,
          budgetAmount: variantBudget,
          budgetType: originalCampaign.budget_type,
          status: 'ENABLED',
          accountId: originalCampaign.google_ads_account_id,
          userId
        })

        const { adGroupId: googleAdGroupId } = await createGoogleAdsAdGroup({
          customerId: originalCampaign.customer_id,
          refreshToken: originalCampaign.refresh_token,
          campaignId: googleCampaignId,
          adGroupName: `${strategyConfig.adGroupName} ${variantName}`,
          cpcBidMicros: strategyConfig.maxCpcBid * 1000000,
          status: 'ENABLED',
          accountId: originalCampaign.google_ads_account_id,
          userId
        })

        // 添加关键词（使用原创意的关键词）
        const keywordOperations = strategyConfig.keywords.map((keyword: string) => ({
          keywordText: keyword,
          matchType: 'BROAD' as const,
          status: 'ENABLED' as const
        }))

        if (keywordOperations.length > 0) {
          await createGoogleAdsKeywordsBatch({
            customerId: originalCampaign.customer_id,
            refreshToken: originalCampaign.refresh_token,
            adGroupId: googleAdGroupId,
            keywords: keywordOperations,
            accountId: originalCampaign.google_ads_account_id,
            userId
          })
        }

        // 添加否定关键词（根据策略）
        if (strategyConfig.negativeKeywords && strategyConfig.negativeKeywords.length > 0) {
          const negativeKeywordOperations = strategyConfig.negativeKeywords.map((keyword: string) => ({
            keywordText: keyword,
            matchType: 'EXACT' as const,
            status: 'ENABLED' as const,
            isNegative: true
          }))

          await createGoogleAdsKeywordsBatch({
            customerId: originalCampaign.customer_id,
            refreshToken: originalCampaign.refresh_token,
            adGroupId: googleAdGroupId,
            keywords: negativeKeywordOperations,
            accountId: originalCampaign.google_ads_account_id,
            userId
          })
        }

        // 创建广告（使用原创意）
        const headlines = JSON.parse(originalCampaign.headlines) as string[]
        const descriptions = JSON.parse(originalCampaign.descriptions) as string[]

        const { adId: googleAdId } = await createGoogleAdsResponsiveSearchAd({
          customerId: originalCampaign.customer_id,
          refreshToken: originalCampaign.refresh_token,
          adGroupId: googleAdGroupId,
          headlines: headlines.slice(0, 15),
          descriptions: descriptions.slice(0, 4),
          finalUrls: [originalCampaign.final_url],
          accountId: originalCampaign.google_ads_account_id,
          userId
        })

        // 更新数据库
        db.prepare(`
          UPDATE campaigns
          SET
            google_campaign_id = ?,
            google_ad_group_id = ?,
            google_ad_id = ?,
            creation_status = 'synced',
            last_sync_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(googleCampaignId, googleAdGroupId, googleAdId, campaignId)

        createdCampaigns.push({
          id: campaignId,
          google_campaign_id: googleCampaignId,
          variant_name: variantName,
          strategy_name: strategy.name,
          status: 'ENABLED'
        })

        console.log(`✅ Strategy ${variantName} 创建成功`)

      } catch (error: any) {
        console.error(`❌ Strategy ${variantName} 创建失败:`, error.message)

        db.prepare(`
          UPDATE campaigns
          SET creation_status = 'failed', creation_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(error.message, campaignId)

        failedCampaigns.push({
          id: campaignId,
          variant_name: variantName,
          strategy_name: strategy.name,
          error: error.message
        })
      }
    }

    // 10. 创建ab_test_variants记录
    // 原Campaign作为对照组
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
      ) VALUES (?, 'A', 'Original', ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(abTestId, originalCampaign.ad_creative_id, trafficAllocations[0])

    // 策略测试变体
    for (let i = 0; i < createdCampaigns.length; i++) {
      const campaign = createdCampaigns[i]
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
        ) VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        abTestId,
        campaign.variant_name,
        campaign.strategy_name,
        originalCampaign.ad_creative_id,
        trafficAllocations[i + 1]
      )
    }

    return NextResponse.json({
      success: createdCampaigns.length > 0,
      ab_test_id: abTestId,
      test_dimension,
      original_campaign: {
        id: originalCampaignId,
        new_budget: newOriginalBudget,
        traffic: trafficAllocations[0]
      },
      strategy_campaigns: createdCampaigns,
      failed: failedCampaigns,
      summary: {
        total: strategies.length,
        successful: createdCampaigns.length,
        failed: failedCampaigns.length
      },
      test_duration_days,
      end_date: endDate
    })

  } catch (error: any) {
    console.error('Test strategy error:', error)

    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const appError = createError.internalError({
      operation: 'test_strategy',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}

/**
 * 获取维度标签
 */
function getDimensionLabel(dimension: string): string {
  const labels: Record<string, string> = {
    negative_keywords: '否定关键词',
    cpc_optimization: 'CPC出价',
    bidding_strategy: '出价策略'
  }
  return labels[dimension] || dimension
}

/**
 * 应用策略配置
 */
function applyStrategyConfig(
  baseConfig: any,
  test_dimension: string,
  strategyConfig: any
): any {
  const newConfig = { ...baseConfig }

  switch (test_dimension) {
    case 'negative_keywords':
      // 应用否定关键词策略
      newConfig.negativeKeywords = strategyConfig.negativeKeywords || []
      break

    case 'cpc_optimization':
      // 应用CPC出价策略
      if (strategyConfig.cpcBid !== undefined) {
        newConfig.maxCpcBid = strategyConfig.cpcBid
      }
      break

    case 'bidding_strategy':
      // 应用出价策略类型
      if (strategyConfig.biddingStrategy) {
        newConfig.biddingStrategy = strategyConfig.biddingStrategy
      }
      break
  }

  return newConfig
}
