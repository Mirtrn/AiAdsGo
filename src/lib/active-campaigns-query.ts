/**
 * 查询Google Ads账号中的已激活广告系列
 *
 * 使用真实的Google Ads API查询，结合命名规范建立关联关系
 */

import { getDatabase } from './db'
import { getGoogleAdsCredentials } from './google-ads-oauth'
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
  const adsAccount = await db.queryOne(
    `SELECT id, customer_id, parent_mcc_id FROM google_ads_accounts
     WHERE id = ? AND user_id = ? AND is_active = 1`,
    [Number(googleAdsAccountId), Number(userId)]
  ) as any

  if (!adsAccount) {
    throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
  }

  // 🔧 处理MCC子账号的login-customer-id参数
  // 如果有parent_mcc_id，说明是子账号，需要传递loginCustomerId
  let effectiveLoginCustomerId = adsAccount.parent_mcc_id
  console.log(`🔍 [Debug] 账号 ${adsAccount.customer_id} 的 parent_mcc_id: ${adsAccount.parent_mcc_id} (类型: ${typeof adsAccount.parent_mcc_id})`)

  // 🔧 确保loginCustomerId是字符串类型（Google Ads API要求）
  const finalLoginCustomerId = effectiveLoginCustomerId ? String(effectiveLoginCustomerId) : undefined
  console.log(`🔍 [Debug] 转换后的 finalLoginCustomerId: ${finalLoginCustomerId} (类型: ${typeof finalLoginCustomerId})`)

  // 2. 获取OAuth凭证
  const credentials = await getGoogleAdsCredentials(userId)
  if (!credentials?.refresh_token) {
    throw new Error('Google Ads OAuth凭证无效')
  }

  // 3. 查询Google Ads账号中的所有广告系列
  console.log(`🔍 查询Google Ads账号 ${adsAccount.customer_id} 中的广告系列...`)
  const allCampaigns = await listGoogleAdsCampaigns({
    customerId: adsAccount.customer_id,
    refreshToken: credentials.refresh_token,
    accountId: googleAdsAccountId,
    userId,
    loginCustomerId: finalLoginCustomerId
  })

  // 4. 转换为简化格式
  const campaigns: GoogleAdsCampaignInfo[] = allCampaigns.map((c: any) => ({
    id: c.campaign.id,
    name: c.campaign.name,
    status: c.campaign.status as 'ENABLED' | 'PAUSED',
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
): Promise<void> {
  const db = await getDatabase()

  // 获取账号信息（包含parent_mcc_id用于MCC子账号权限）
  const adsAccount = await db.queryOne(
    `SELECT customer_id, parent_mcc_id FROM google_ads_accounts WHERE id = ?`,
    [Number(googleAdsAccountId)]
  ) as any

  if (!adsAccount) {
    throw new Error(`Google Ads账号不存在: ${googleAdsAccountId}`)
  }

  // 🔧 处理MCC子账号的login-customer-id参数
  let effectiveLoginCustomerId = adsAccount.parent_mcc_id
  const finalLoginCustomerId = effectiveLoginCustomerId ? String(effectiveLoginCustomerId) : undefined

  // 获取OAuth凭证
  const credentials = await getGoogleAdsCredentials(userId)
  if (!credentials?.refresh_token) {
    throw new Error('Google Ads OAuth凭证无效')
  }

  // 动态导入updateGoogleAdsCampaignStatus
  const { updateGoogleAdsCampaignStatus } = await import('./google-ads-api')

  // 逐个暂停（串行执行，避免并发冲突）
  for (const campaign of campaigns) {
    try {
      console.log(`⏸️ 暂停广告系列: ${campaign.name} (${campaign.id})`)
      await updateGoogleAdsCampaignStatus({
        customerId: adsAccount.customer_id,
        refreshToken: credentials.refresh_token,
        campaignId: campaign.id,
        status: 'PAUSED',
        accountId: googleAdsAccountId,
        userId,
        loginCustomerId: finalLoginCustomerId
      })
      console.log(`✅ 成功暂停: ${campaign.name}`)
    } catch (error) {
      console.error(`❌ 暂停失败: ${campaign.name}`, error)
      // 继续处理其他广告系列，不中断流程
    }
  }
}
