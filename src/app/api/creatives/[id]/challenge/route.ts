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
import { createError, ErrorCode, AppError } from '@/lib/errors'

/**
 * POST /api/creatives/[id]/challenge
 *
 * 创建挑战者Campaign（优化模式）
 *
 * 用途：用新创意挑战现有Campaign，流量分配70/30（原Campaign 70%，挑战者 30%）
 *
 * Request Body:
 * {
 *   original_campaign_id: number    // 原Campaign ID（要挑战的对象）
 *   challenger_traffic: number      // 挑战者流量比例（默认0.3）
 *   test_duration_days?: number     // 测试周期（默认7天）
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
    const challengerCreativeId = parseInt(params.id)

    // 2. 解析请求体
    const body = await request.json()
    const {
      original_campaign_id,
      challenger_traffic = 0.3,
      test_duration_days = 7
    } = body

    // 3. 验证必填字段
    if (!original_campaign_id) {
      const error = createError.requiredField('original_campaign_id')
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 验证流量分配比例
    if (challenger_traffic <= 0 || challenger_traffic >= 1) {
      const error = createError.invalidParameter({
        field: 'challenger_traffic',
        value: challenger_traffic,
        constraint: 'Must be between 0 and 1'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const db = getDatabase()

    // 4. 验证原Campaign归属
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
        c.google_ad_group_id,
        c.ad_creative_id,
        c.campaign_config,
        c.status,
        gaa.customer_id,
        gaa.refresh_token
      FROM campaigns c
      JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.id = ? AND c.user_id = ?
    `).get(original_campaign_id, userId) as any

    if (!originalCampaign) {
      const error = createError.campaignNotFound({
        campaignId: original_campaign_id
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 5. 验证挑战者创意
    const challengerCreative = db.prepare(`
      SELECT id, headlines, descriptions, keywords, callouts, sitelinks, final_url, launch_score
      FROM ad_creatives
      WHERE id = ? AND offer_id = ? AND user_id = ?
    `).get(challengerCreativeId, originalCampaign.offer_id, userId) as any

    if (!challengerCreative) {
      const error = createError.creativeNotFound({
        creativeId: challengerCreativeId
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 6. 创建A/B测试记录
    const now = new Date().toISOString()
    const endDate = new Date(Date.now() + test_duration_days * 24 * 60 * 60 * 1000).toISOString()

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
      ) VALUES (?, ?, ?, ?, 'full_creative', 'creative', 'optimization_challenge', 1, ?, 'running', ?, ?, 100, 0.95, ?, ?)
    `).run(
      userId,
      originalCampaign.offer_id,
      `挑战者测试 - ${originalCampaign.campaign_name}`,
      `新创意挑战现有Campaign，流量分配：原${Math.round((1 - challenger_traffic) * 100)}% vs 新${Math.round(challenger_traffic * 100)}%`,
      original_campaign_id,
      now,
      endDate,
      now,
      now
    )

    const abTestId = Number(abTestInsert.lastInsertRowid)

    // 7. 调整原Campaign预算（70%）
    const originalTraffic = 1 - challenger_traffic
    const newOriginalBudget = originalCampaign.budget_amount * originalTraffic

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

      // 更新数据库中的预算和流量分配
      db.prepare(`
        UPDATE campaigns
        SET
          budget_amount = ?,
          traffic_allocation = ?,
          ab_test_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newOriginalBudget, originalTraffic, abTestId, original_campaign_id)

      console.log(`✅ 原Campaign预算调整为 ${newOriginalBudget} (${Math.round(originalTraffic * 100)}%)`)

    } catch (budgetError: any) {
      console.error('❌ 调整原Campaign预算失败:', budgetError.message)

      // 删除A/B测试记录
      db.prepare('DELETE FROM ab_tests WHERE id = ?').run(abTestId)

      const error = createError.campaignUpdateFailed({
        campaignId: original_campaign_id,
        operation: 'update_budget',
        originalError: budgetError.message
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 8. 创建挑战者Campaign到数据库
    const challengerBudget = originalCampaign.budget_amount * challenger_traffic
    const campaignConfig = JSON.parse(originalCampaign.campaign_config)

    const challengerCampaignInsert = db.prepare(`
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
      originalCampaign.campaign_name + ' - Challenger',
      challengerBudget,
      originalCampaign.budget_type,
      challengerCreativeId,
      originalCampaign.campaign_config,
      abTestId,
      challenger_traffic,
      now,
      now
    )

    const challengerCampaignId = Number(challengerCampaignInsert.lastInsertRowid)

    // 9. 创建挑战者Campaign到Google Ads
    try {
      const { campaignId: googleCampaignId } = await createGoogleAdsCampaign({
        customerId: originalCampaign.customer_id,
        refreshToken: originalCampaign.refresh_token,
        campaignName: originalCampaign.campaign_name + ' - Challenger',
        budgetAmount: challengerBudget,
        budgetType: originalCampaign.budget_type,
        status: 'ENABLED',
        accountId: originalCampaign.google_ads_account_id,
        userId
      })

      const { adGroupId: googleAdGroupId } = await createGoogleAdsAdGroup({
        customerId: originalCampaign.customer_id,
        refreshToken: originalCampaign.refresh_token,
        campaignId: googleCampaignId,
        adGroupName: campaignConfig.adGroupName + ' Challenger',
        cpcBidMicros: campaignConfig.maxCpcBid * 1000000,
        status: 'ENABLED',
        accountId: originalCampaign.google_ads_account_id,
        userId
      })

      // 添加关键词
      const headlines = JSON.parse(challengerCreative.headlines) as string[]
      const descriptions = JSON.parse(challengerCreative.descriptions) as string[]

      const keywordOperations = campaignConfig.keywords.map((keyword: string) => ({
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

      // 创建广告
      const { adId: googleAdId } = await createGoogleAdsResponsiveSearchAd({
        customerId: originalCampaign.customer_id,
        refreshToken: originalCampaign.refresh_token,
        adGroupId: googleAdGroupId,
        headlines: headlines.slice(0, 15),
        descriptions: descriptions.slice(0, 4),
        finalUrls: [challengerCreative.final_url],
        accountId: originalCampaign.google_ads_account_id,
        userId
      })

      // 更新挑战者Campaign数据库记录
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
      `).run(googleCampaignId, googleAdGroupId, googleAdId, challengerCampaignId)

      // 10. 创建ab_test_variants记录
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
        ) VALUES
          (?, 'A', 'Original', ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          (?, 'B', 'Challenger', ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        abTestId, originalCampaign.ad_creative_id, originalTraffic,
        abTestId, challengerCreativeId, challenger_traffic
      )

      return NextResponse.json({
        success: true,
        ab_test_id: abTestId,
        original_campaign: {
          id: original_campaign_id,
          new_budget: newOriginalBudget,
          traffic: originalTraffic
        },
        challenger_campaign: {
          id: challengerCampaignId,
          google_campaign_id: googleCampaignId,
          budget: challengerBudget,
          traffic: challenger_traffic
        },
        test_duration_days,
        end_date: endDate
      })

    } catch (error: any) {
      console.error('❌ 创建挑战者Campaign失败:', error.message)

      // 标记失败
      db.prepare(`
        UPDATE campaigns
        SET creation_status = 'failed', creation_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(error.message, challengerCampaignId)

      // 回滚原Campaign预算（尽力而为）
      try {
        await updateGoogleAdsCampaignBudget({
          customerId: originalCampaign.customer_id,
          refreshToken: originalCampaign.refresh_token,
          campaignId: originalCampaign.google_campaign_id,
          budgetAmount: originalCampaign.budget_amount,  // 恢复原预算
          budgetType: originalCampaign.budget_type,
          accountId: originalCampaign.google_ads_account_id,
          userId
        })

        db.prepare(`
          UPDATE campaigns
          SET budget_amount = ?, traffic_allocation = 1.0, ab_test_id = NULL
          WHERE id = ?
        `).run(originalCampaign.budget_amount, original_campaign_id)
      } catch (rollbackError) {
        console.error('⚠️ 回滚原Campaign预算失败:', rollbackError)
      }

      if (error instanceof AppError) {
        return NextResponse.json(error.toJSON(), { status: error.httpStatus })
      }

      const appError = createError.campaignCreateFailed({
        originalError: error.message
      })
      return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
    }

  } catch (error: any) {
    console.error('Challenge creative error:', error)

    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    const appError = createError.internalError({
      operation: 'challenge_creative',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}
