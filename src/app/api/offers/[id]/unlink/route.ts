import { NextRequest, NextResponse } from 'next/server'
import { unlinkOfferFromAccount } from '@/lib/offers'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import { updateGoogleAdsCampaignStatus } from '@/lib/google-ads-api'

/**
 * POST /api/offers/:id/unlink
 * 手动解除Offer与Ads账号的关联
 * 需求25: 增加Offer手动解除与已关联的Ads账号解除关联的功能
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 统一鉴权：避免仅依赖可伪造的 x-user-id
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    // 从请求体获取要解除关联的Ads账号ID
    const body = await request.json()
    const { accountId } = body

    if (!accountId) {
      return NextResponse.json({ error: '缺少accountId参数' }, { status: 400 })
    }

    const offerId = parseInt(id, 10)
    const googleAdsAccountId = parseInt(accountId, 10)
    const db = await getDatabase()

    // 先尝试在 Google Ads 中移除/停止该 Offer 在该账号下的所有 Campaign（best-effort）
    const campaignsToUnlink = await db.query(`
      SELECT id, google_campaign_id, campaign_name, status
      FROM campaigns
      WHERE offer_id = ?
        AND google_ads_account_id = ?
        AND user_id = ?
        AND status != 'REMOVED'
    `, [offerId, googleAdsAccountId, userId]) as Array<{
      id: number
      google_campaign_id: string | null
      campaign_name: string | null
      status: string | null
    }>

    // 查询账号信息（用于 customer_id / login_customer_id）
    const adsAccount = await db.queryOne(`
      SELECT id, customer_id, parent_mcc_id, is_active, is_deleted
      FROM google_ads_accounts
      WHERE id = ? AND user_id = ?
    `, [googleAdsAccountId, userId]) as {
      id: number
      customer_id: string | null
      parent_mcc_id: string | null
      is_active: any
      is_deleted: any
    } | null

    const googleAdsRemoval = {
      attempted: 0,
      removed: 0,
      pausedFallback: 0,
      failed: 0,
      failures: [] as Array<{ campaignId: string; reason: string }>
    }

    // 若账号不可用/缺少customer_id，则只能做本地解除关联
    const accountIsActive = adsAccount ? (adsAccount.is_active === true || adsAccount.is_active === 1) : false
    const accountIsDeleted = adsAccount ? (adsAccount.is_deleted === true || adsAccount.is_deleted === 1) : false

    if (adsAccount?.customer_id && accountIsActive && !accountIsDeleted && campaignsToUnlink.length > 0) {
      const auth = await getUserAuthType(userId)
      const credentials = await getGoogleAdsCredentials(userId)
      const refreshToken = credentials?.refresh_token || ''

      let loginCustomerId: string | undefined = adsAccount.parent_mcc_id ? String(adsAccount.parent_mcc_id) : undefined
      if (!loginCustomerId) {
        try {
          const { getGoogleAdsConfig } = await import('@/lib/keyword-planner')
          const config = await getGoogleAdsConfig(userId)
          if (config?.loginCustomerId) {
            loginCustomerId = String(config.loginCustomerId)
            // 缓存到账号表，减少后续重复读取
            await db.exec(`UPDATE google_ads_accounts SET parent_mcc_id = ? WHERE id = ?`, [loginCustomerId, adsAccount.id])
          }
        } catch {
          // 忽略：没有loginCustomerId时会让调用方走降级策略或报权限错误
        }
      }

      for (const campaign of campaignsToUnlink) {
        const googleCampaignId = campaign.google_campaign_id ? String(campaign.google_campaign_id) : ''
        if (!googleCampaignId) continue

        googleAdsRemoval.attempted++
        try {
          await updateGoogleAdsCampaignStatus({
            customerId: adsAccount.customer_id,
            refreshToken,
            campaignId: googleCampaignId,
            status: 'REMOVED',
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId
          })
          googleAdsRemoval.removed++
        } catch (err: any) {
          // 降级：至少暂停，确保投放停止
          try {
            await updateGoogleAdsCampaignStatus({
              customerId: adsAccount.customer_id,
              refreshToken,
              campaignId: googleCampaignId,
              status: 'PAUSED',
              accountId: adsAccount.id,
              userId,
              loginCustomerId,
              authType: auth.authType,
              serviceAccountId: auth.serviceAccountId
            })
            googleAdsRemoval.pausedFallback++
          } catch (err2: any) {
            googleAdsRemoval.failed++
            googleAdsRemoval.failures.push({
              campaignId: googleCampaignId,
              reason: String(err2?.message || err?.message || 'UNKNOWN_ERROR')
            })
          }
        }
      }
    }

    // 执行解除关联
    const result = await unlinkOfferFromAccount(
      offerId,
      googleAdsAccountId,
      userId
    )

    return NextResponse.json({
      success: true,
      message: '成功解除关联',
      data: {
        offerId,
        accountId: googleAdsAccountId,
        unlinkedCampaigns: result.unlinkedCount,
        googleAds: googleAdsRemoval
      },
    })
  } catch (error: any) {
    console.error('解除关联失败:', error)

    return NextResponse.json(
      {
        error: error.message || '解除关联失败',
      },
      { status: 500 }
    )
  }
}
