/**
 * 查询Google Ads账号中的已激活广告系列
 *
 * 使用真实的Google Ads API查询，结合命名规范建立关联关系
 */

import { enums } from 'google-ads-api'
import { getDatabase } from './db'
import { getGoogleAdsCredentials, getUserAuthType } from './google-ads-oauth'
import { listGoogleAdsCampaigns } from './google-ads-api'
import {
  categorizeCampaigns,
  type GoogleAdsCampaignInfo
} from './campaign-association'

/**
 * 查询结果
 */
export interface ActiveCampaignsQueryResult {
  // 属于当前Offer的广告系列
  ownCampaigns: GoogleAdsCampaignInfo[]
  // 用户手动创建的广告系列
  manualCampaigns: GoogleAdsCampaignInfo[]
  // 属于其他Offer的广告系列
  otherCampaigns: GoogleAdsCampaignInfo[]
  // 总计
  total: {
    enabled: number
    own: number
    manual: number
    other: number
  }
}

function normalizeCampaignStatus(status: unknown): 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' {
  if (typeof status === 'number') {
    const mapped = (enums.CampaignStatus as Record<number, string>)[status]
    return (mapped || 'UNKNOWN') as 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  }

  if (typeof status === 'string') {
    const trimmed = status.trim()
    if (!trimmed) return 'UNKNOWN'
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      const mapped = (enums.CampaignStatus as Record<number, string>)[numeric]
      return (mapped || 'UNKNOWN') as 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
    }
    return trimmed.toUpperCase() as 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  }

  if (status && typeof status === 'object') {
    const maybeValue = (status as { value?: unknown; name?: unknown; status?: unknown })
    const nested = maybeValue.value ?? maybeValue.name ?? maybeValue.status
    if (typeof nested === 'string' || typeof nested === 'number') {
      return normalizeCampaignStatus(nested)
    }
  }

  return 'UNKNOWN'
}

/**
 * 查询已激活的广告系列
 *
 * @param offerId Offer ID
 * @param googleAdsAccountId Google Ads账号ID
 * @param userId 用户ID
 * @returns 查询结果
 */
export async function queryActiveCampaigns(
  offerId: number,
  googleAdsAccountId: number,
  userId: number
): Promise<ActiveCampaignsQueryResult> {
  const db = await getDatabase()

  // 1. 获取Google Ads账号信息（包含parent_mcc_id用于MCC子账号权限）
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const adsAccount = await db.queryOne(
    `SELECT id, customer_id, parent_mcc_id FROM google_ads_accounts
     WHERE id = ? AND user_id = ? AND ${isActiveCondition}`,
    [Number(googleAdsAccountId), Number(userId)]
  ) as any

  if (!adsAccount) {
    throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
  }

  // 2. 检查OAuth凭证或服务账号配置
  const credentials = await getGoogleAdsCredentials(userId)

  // 检查是否有服务账号配置
  const serviceAccount = await db.queryOne(`
    SELECT id FROM google_ads_service_accounts
    WHERE user_id = ? AND ${isActiveCondition}
    ORDER BY created_at DESC LIMIT 1
  `, [userId]) as { id: string } | undefined

  const auth = await getUserAuthType(userId)

  // 🔧 处理MCC子账号的login-customer-id参数
  // 优先使用用户配置的login_customer_id（OAuth）或服务账号MCC（service_account）
  let effectiveLoginCustomerId = adsAccount.parent_mcc_id

  if (auth.authType === 'oauth') {
    if (credentials?.login_customer_id) {
      effectiveLoginCustomerId = credentials.login_customer_id
    }
  } else if (auth.authType === 'service_account') {
    try {
      const { getServiceAccountConfig } = await import('./google-ads-service-account')
      const saConfig = await getServiceAccountConfig(userId, auth.serviceAccountId)
      if (saConfig?.mccCustomerId) {
        effectiveLoginCustomerId = saConfig.mccCustomerId
      }
    } catch (error) {
      console.warn('⚠️ 无法获取服务账号MCC Customer ID:', error)
    }
  }

  // 🔧 确保loginCustomerId是字符串类型（Google Ads API要求）
  const finalLoginCustomerId = effectiveLoginCustomerId ? String(effectiveLoginCustomerId) : undefined

  if (!credentials?.refresh_token && !serviceAccount) {
    throw new Error('Google Ads OAuth凭证或服务账号配置无效')
  }

  // 3. 查询Google Ads账号中的所有广告系列（跳过缓存，获取实时状态）
  console.log(`🔍 查询Google Ads账号 ${adsAccount.customer_id} 中的广告系列...`)
  const allCampaigns = await listGoogleAdsCampaigns({
    customerId: adsAccount.customer_id,
    refreshToken: credentials?.refresh_token || '',
    accountId: googleAdsAccountId,
    userId,
    loginCustomerId: finalLoginCustomerId,
    authType: auth.authType,
    serviceAccountId: auth.serviceAccountId,
    skipCache: true  // 🔧 修复：暂停操作必须获取最新状态，不能使用缓存
  })

  // 4. 转换为简化格式
  const campaigns: GoogleAdsCampaignInfo[] = allCampaigns.map((c: any) => ({
    id: c.campaign.id,
    name: c.campaign.name,
    status: normalizeCampaignStatus(c.campaign.status),
    budget: c.campaign_budget?.amount_micros
      ? Math.round(Number(c.campaign_budget.amount_micros) / 1000000)
      : undefined
  }))

  // 5. 分类广告系列
  const categorized = categorizeCampaigns(campaigns, offerId)

  // 6. 日志输出
  console.log(`📊 广告系列分类结果:`)
  console.log(`   - 总启用广告系列: ${campaigns.filter(c => c.status === 'ENABLED').length}`)
  console.log(`   - 属于当前Offer: ${categorized.ownCampaigns.length}`)
  console.log(`   - 用户手动创建: ${categorized.manualCampaigns.length}`)
  console.log(`   - 属于其他Offer: ${categorized.otherCampaigns.length}`)

  return {
    ownCampaigns: categorized.ownCampaigns,
    manualCampaigns: categorized.manualCampaigns,
    otherCampaigns: categorized.otherCampaigns,
    total: {
      enabled: campaigns.filter(c => c.status === 'ENABLED').length,
      own: categorized.ownCampaigns.length,
      manual: categorized.manualCampaigns.length,
      other: categorized.otherCampaigns.length
    }
  }
}

export interface PauseCampaignsResult {
  attemptedCount: number
  pausedCount: number
  failedCount: number
  failures: Array<{
    id: string
    name: string
    error: string
  }>
}

/**
 * 批量暂停广告系列
 *
 * @param campaigns 要暂停的广告系列列表
 * @param googleAdsAccountId Google Ads账号ID
 * @param userId 用户ID
 */
export async function pauseCampaigns(
  campaigns: GoogleAdsCampaignInfo[],
  googleAdsAccountId: number,
  userId: number
): Promise<PauseCampaignsResult> {
  const db = await getDatabase()

  // 获取账号信息（包含parent_mcc_id用于MCC子账号权限）
  const adsAccount = await db.queryOne(
    `SELECT customer_id, parent_mcc_id FROM google_ads_accounts WHERE id = ?`,
    [Number(googleAdsAccountId)]
  ) as any

  if (!adsAccount) {
    throw new Error(`Google Ads账号不存在: ${googleAdsAccountId}`)
  }

  // 检查OAuth凭证或服务账号配置
  const credentials2 = await getGoogleAdsCredentials(userId)

  // 检查是否有服务账号配置
  const isActiveCondition2 = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const serviceAccount2 = await db.queryOne(`
    SELECT id FROM google_ads_service_accounts
    WHERE user_id = ? AND ${isActiveCondition2}
    ORDER BY created_at DESC LIMIT 1
  `, [userId]) as { id: string } | undefined

  const auth = await getUserAuthType(userId)

  // 🔧 处理MCC子账号的login-customer-id参数
  // 优先使用用户配置的login_customer_id（OAuth）或服务账号MCC（service_account）
  let effectiveLoginCustomerId = adsAccount.parent_mcc_id

  if (auth.authType === 'oauth') {
    if (credentials2?.login_customer_id) {
      effectiveLoginCustomerId = credentials2.login_customer_id
    }
  } else if (auth.authType === 'service_account') {
    try {
      const { getServiceAccountConfig } = await import('./google-ads-service-account')
      const saConfig = await getServiceAccountConfig(userId, auth.serviceAccountId)
      if (saConfig?.mccCustomerId) {
        effectiveLoginCustomerId = saConfig.mccCustomerId
      }
    } catch (error) {
      console.warn('⚠️ 无法获取服务账号MCC Customer ID:', error)
    }
  }

  const finalLoginCustomerId = effectiveLoginCustomerId ? String(effectiveLoginCustomerId) : undefined

  if (!credentials2?.refresh_token && !serviceAccount2) {
    throw new Error('Google Ads OAuth凭证或服务账号配置无效')
  }

  // 动态导入updateGoogleAdsCampaignStatus
  const { updateGoogleAdsCampaignStatus } = await import('./google-ads-api')

  // 逐个暂停（串行执行，避免并发冲突）
  const failures: PauseCampaignsResult['failures'] = []
  let pausedCount = 0
  for (const campaign of campaigns) {
    try {
      console.log(`⏸️ 暂停广告系列: ${campaign.name} (${campaign.id})`)
      await updateGoogleAdsCampaignStatus({
        customerId: adsAccount.customer_id,
        refreshToken: credentials2?.refresh_token || '',
        campaignId: campaign.id,
        status: 'PAUSED',
        accountId: googleAdsAccountId,
        userId,
        loginCustomerId: finalLoginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })
      console.log(`✅ 成功暂停: ${campaign.name}`)
      pausedCount++
    } catch (error) {
      console.error(`❌ 暂停失败: ${campaign.name}`, error)
      failures.push({
        id: campaign.id,
        name: campaign.name,
        error: error instanceof Error ? error.message : String(error)
      })
      // 继续处理其他广告系列，不中断流程
    }
  }

  return {
    attemptedCount: campaigns.length,
    pausedCount,
    failedCount: failures.length,
    failures
  }
}
