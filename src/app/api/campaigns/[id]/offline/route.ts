import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { updateGoogleAdsCampaignStatus, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { invalidateOfferCache } from '@/lib/api-cache'

type OfflineBody = {
  blacklistOffer?: boolean
  forceLocalOffline?: boolean
}

function normalizeGoogleCampaignId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return /^\d+$/.test(raw) ? raw : null
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const campaignId = Number(params.id)
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: '无效的campaignId' }, { status: 400 })
    }

    const body = (await request.json().catch(() => null)) as OfflineBody | null
    const blacklistOffer = Boolean(body?.blacklistOffer)
    const forceLocalOffline = Boolean(body?.forceLocalOffline)

    const db = await getDatabase()

    const campaignRow = await db.queryOne(
      `
        SELECT
          c.id,
          c.campaign_id,
          c.google_campaign_id,
          c.google_ads_account_id,
          c.status,
          c.is_deleted,
          c.offer_id,
          o.brand as offer_brand,
          o.target_country as offer_target_country,
          o.is_deleted as offer_is_deleted,
          gaa.customer_id as customer_id,
          gaa.parent_mcc_id as parent_mcc_id,
          gaa.is_active as ads_account_active,
          gaa.is_deleted as ads_account_deleted,
          gaa.status as ads_account_status
        FROM campaigns c
        LEFT JOIN offers o ON c.offer_id = o.id
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        WHERE c.id = ? AND c.user_id = ?
        LIMIT 1
      `,
      [campaignId, userId]
    ) as
      | {
          id: number
          campaign_id: string | null
          google_campaign_id: string | null
          google_ads_account_id: number | null
          status: string | null
          is_deleted: any
          offer_id: number | null
          offer_brand: string | null
          offer_target_country: string | null
          offer_is_deleted: any
          customer_id: string | null
          parent_mcc_id: string | null
          ads_account_active: any
          ads_account_deleted: any
          ads_account_status: string | null
        }
      | undefined

    if (!campaignRow) {
      return NextResponse.json({ error: '广告系列不存在或无权访问' }, { status: 404 })
    }

    const isDeleted = campaignRow.is_deleted === true || campaignRow.is_deleted === 1
    if (isDeleted || String(campaignRow.status || '').toUpperCase() === 'REMOVED') {
      return NextResponse.json({ error: '该广告系列已下线/删除' }, { status: 400 })
    }

    const offerDeleted = campaignRow.offer_is_deleted === true || campaignRow.offer_is_deleted === 1
    if (offerDeleted) {
      return NextResponse.json({ error: '关联Offer已删除，无法下线' }, { status: 400 })
    }

    const googleCampaignId =
      normalizeGoogleCampaignId(campaignRow.google_campaign_id) ||
      normalizeGoogleCampaignId(campaignRow.campaign_id)

    if (!googleCampaignId) {
      return NextResponse.json({ error: '该广告系列尚未发布到Google Ads，无法下线' }, { status: 400 })
    }

    if (!campaignRow.google_ads_account_id) {
      return NextResponse.json({ error: '未找到关联的Ads账号，无法下线' }, { status: 400 })
    }

    const accountIsActive = campaignRow.ads_account_active === true || campaignRow.ads_account_active === 1
    const accountIsDeleted = campaignRow.ads_account_deleted === true || campaignRow.ads_account_deleted === 1
    if (!accountIsActive || accountIsDeleted) {
      return NextResponse.json({ error: '关联的Ads账号不可用（可能已解除关联或停用）' }, { status: 400 })
    }

    const accountStatus = String(campaignRow.ads_account_status || 'UNKNOWN').toUpperCase()
    const isNotUsableStatus = [
      'CANCELED',
      'CANCELLED',
      'CLOSED',
      'SUSPENDED',
      'PAUSED',
      'DISABLED',
    ].includes(accountStatus)

    let skipRemoteUpdates = false
    let skipRemoteReason: string | null = null
    if (isNotUsableStatus) {
      if (!forceLocalOffline) {
        return NextResponse.json(
          {
            action: 'ACCOUNT_STATUS_NOT_USABLE',
            message: `该 Google Ads 账号状态为 ${accountStatus}，无法执行下线操作。是否仍然仅本地下线并解除关联？`,
            details: { accountStatus },
            canProceedLocal: true,
          },
          { status: 422 }
        )
      }
      skipRemoteUpdates = true
      skipRemoteReason = `账号状态异常（${accountStatus}），已执行本地下线`
    }

    if (!campaignRow.offer_id) {
      return NextResponse.json({ error: '缺少关联Offer，无法下线' }, { status: 400 })
    }

    // 查询同一Offer + Ads账号下的全部Campaigns（用于解除关联）
    const campaignsToOffline = await db.query(
      `
        SELECT id, google_campaign_id, campaign_id, status
        FROM campaigns
        WHERE offer_id = ?
          AND google_ads_account_id = ?
          AND user_id = ?
          AND status != 'REMOVED'
      `,
      [campaignRow.offer_id, campaignRow.google_ads_account_id, userId]
    ) as Array<{
      id: number
      google_campaign_id: string | null
      campaign_id: string | null
      status: string | null
    }>

    // 先执行本地解除关联与标记下线，避免外部接口阻塞
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const isDeletedTrue = db.type === 'postgres' ? 'true' : '1'

    await db.exec(
      `
        UPDATE campaigns
        SET status = 'REMOVED',
            is_deleted = ${isDeletedTrue},
            deleted_at = ${nowFunc},
            updated_at = ${nowFunc}
        WHERE offer_id = ? AND google_ads_account_id = ? AND user_id = ? AND status != 'REMOVED'
      `,
      [campaignRow.offer_id, campaignRow.google_ads_account_id, userId]
    )

    // 解除关联后刷新Offer缓存
    invalidateOfferCache(userId, campaignRow.offer_id)

    // 可选：Offer拉黑
    let blacklistResult: { applied: boolean; reason?: string } = { applied: false }
    if (blacklistOffer && campaignRow.offer_id && campaignRow.offer_brand && campaignRow.offer_target_country) {
      const existing = await db.queryOne(
        'SELECT id FROM offer_blacklist WHERE user_id = ? AND brand = ? AND target_country = ?',
        [userId, campaignRow.offer_brand, campaignRow.offer_target_country]
      )
      if (existing) {
        blacklistResult = { applied: false, reason: '该品牌+国家组合已在黑名单中' }
      } else {
        await db.exec(
          'INSERT INTO offer_blacklist (user_id, brand, target_country, offer_id) VALUES (?, ?, ?, ?)',
          [userId, campaignRow.offer_brand, campaignRow.offer_target_country, campaignRow.offer_id]
        )
        blacklistResult = { applied: true }
      }
    }

    // Google Ads 远端下线：best-effort（REMOVED，失败则 PAUSED）
    const googleAdsSummary = {
      queued: false,
      planned: 0,
      removed: 0,
      pausedFallback: 0,
      skippedReason: null as string | null,
    }

    if (skipRemoteUpdates) {
      googleAdsSummary.skippedReason = skipRemoteReason || '已选择仅本地下线'
    }

    const customerId = campaignRow.customer_id
    if (!googleAdsSummary.skippedReason && !customerId) {
      googleAdsSummary.skippedReason = '缺少Google Ads customer_id'
    } else if (!googleAdsSummary.skippedReason) {
      const googleCampaignIds = campaignsToOffline
        .map((c) => normalizeGoogleCampaignId(c.google_campaign_id) || normalizeGoogleCampaignId(c.campaign_id))
        .filter((id): id is string => Boolean(id))

      googleAdsSummary.planned = googleCampaignIds.length

      if (googleCampaignIds.length === 0) {
        googleAdsSummary.skippedReason = '未找到可同步的Google Ads广告系列ID'
      } else {
        // 获取用户的 Google Ads 基础凭证（用于判断OAuth/服务账号模式）
        let credentials: Awaited<ReturnType<typeof getGoogleAdsCredentialsFromDB>> | null = null
        try {
          credentials = await getGoogleAdsCredentialsFromDB(userId)
        } catch (err: any) {
          googleAdsSummary.skippedReason = err?.message || 'Google Ads 凭证未配置或不可用'
        }

        if (!googleAdsSummary.skippedReason && credentials) {
          const useServiceAccount = Boolean(credentials.useServiceAccount)
          let authType: 'oauth' | 'service_account' = 'oauth'
          let refreshToken = ''
          let serviceAccountId: string | undefined

          if (useServiceAccount) {
            authType = 'service_account'
            const config = await getServiceAccountConfig(userId)
            if (!config) {
              googleAdsSummary.skippedReason = '未找到服务账号配置'
            } else {
              serviceAccountId = config.id
            }
          } else {
            authType = 'oauth'
            const oauthCredentials = await getGoogleAdsCredentials(userId)
            refreshToken = oauthCredentials?.refresh_token || ''
            if (!refreshToken) {
              googleAdsSummary.skippedReason = 'Google Ads OAuth未授权或已过期'
            }
          }

          const loginCustomerId = campaignRow.parent_mcc_id || credentials.login_customer_id || undefined

          if (!googleAdsSummary.skippedReason) {
            googleAdsSummary.queued = true
            void (async () => {
              try {
                for (const id of googleCampaignIds) {
                  try {
                    await updateGoogleAdsCampaignStatus({
                      customerId,
                      refreshToken,
                      campaignId: id,
                      status: 'REMOVED',
                      accountId: campaignRow.google_ads_account_id!,
                      userId,
                      loginCustomerId,
                      authType,
                      serviceAccountId,
                    })
                    googleAdsSummary.removed += 1
                  } catch (err: any) {
                    try {
                      await updateGoogleAdsCampaignStatus({
                        customerId,
                        refreshToken,
                        campaignId: id,
                        status: 'PAUSED',
                        accountId: campaignRow.google_ads_account_id!,
                        userId,
                        loginCustomerId,
                        authType,
                        serviceAccountId,
                      })
                      googleAdsSummary.pausedFallback += 1
                    } catch (err2: any) {
                      // best-effort; ignore per-campaign failure
                      console.error('[offline] Google Ads pause fallback failed:', err2?.message || err2)
                    }
                  }
                }
              } catch (err: any) {
                console.error('[offline] Google Ads update failed:', err?.message || err)
              }
            })()
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: '广告系列已下线',
      data: {
        campaignId,
        offerId: campaignRow.offer_id,
        offlineCount: campaignsToOffline.length,
        blacklist: blacklistResult,
      },
      googleAds: googleAdsSummary,
    })
  } catch (error: any) {
    console.error('下线广告系列失败:', error)
    return NextResponse.json(
      { error: error?.message || '下线广告系列失败' },
      { status: 500 }
    )
  }
}
