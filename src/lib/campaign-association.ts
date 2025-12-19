/**
 * 广告系列关联管理
 *
 * 通过命名规范建立广告创意与Google Ads账号中真实广告系列的关联关系
 * 命名规范：[Offer ID]-[Creative ID]-[品牌]-[类型]
 * 例如：173-456-reolink-Search
 */

/**
 * 广告系列命名信息
 */
export interface CampaignNamingInfo {
  offerId?: number
  creativeId?: number
  brandName?: string
  campaignType?: string
  isValidNaming: boolean
}

/**
 * Google Ads 广告系列信息（简化版）
 */
export interface GoogleAdsCampaignInfo {
  id: string
  name: string
  status: 'ENABLED' | 'PAUSED'
  budget?: number
}

/**
 * 解析广告系列名称
 *
 * @param campaignName 广告系列名称
 * @returns 解析后的命名信息
 */
export function parseCampaignName(campaignName: string): CampaignNamingInfo {
  // 匹配命名规范：[数字]-[数字]-[文本]-[文本]
  // 例如：173-456-reolink-Search
  const namingPattern = /^(\d+)-(\d+)-([^-]+)-([^-]+)$/

  const match = campaignName.match(namingPattern)

  if (!match) {
    return {
      isValidNaming: false
    }
  }

  const [, offerIdStr, creativeIdStr, brandName, campaignType] = match

  return {
    offerId: parseInt(offerIdStr, 10),
    creativeId: parseInt(creativeIdStr, 10),
    brandName,
    campaignType,
    isValidNaming: true
  }
}

/**
 * 分类广告系列
 *
 * @param campaigns Google Ads 广告系列列表
 * @param currentOfferId 当前Offer ID
 * @returns 分类结果
 */
export function categorizeCampaigns(
  campaigns: GoogleAdsCampaignInfo[],
  currentOfferId: number
): {
  // 属于当前Offer的广告系列（通过命名规范匹配）
  ownCampaigns: GoogleAdsCampaignInfo[]
  // 用户手动创建的广告系列（不匹配命名规范）
  manualCampaigns: GoogleAdsCampaignInfo[]
  // 属于其他Offer的广告系列
  otherCampaigns: GoogleAdsCampaignInfo[]
} {
  const ownCampaigns: GoogleAdsCampaignInfo[] = []
  const manualCampaigns: GoogleAdsCampaignInfo[] = []
  const otherCampaigns: GoogleAdsCampaignInfo[] = []

  for (const campaign of campaigns) {
    // 只处理启用的广告系列
    if (campaign.status !== 'ENABLED') {
      continue
    }

    const namingInfo = parseCampaignName(campaign.name)

    if (!namingInfo.isValidNaming) {
      // 不匹配命名规范，可能是用户手动创建
      manualCampaigns.push(campaign)
    } else if (namingInfo.offerId === currentOfferId) {
      // 匹配当前Offer ID
      ownCampaigns.push(campaign)
    } else {
      // 属于其他Offer
      otherCampaigns.push(campaign)
    }
  }

  return {
    ownCampaigns,
    manualCampaigns,
    otherCampaigns
  }
}

/**
 * 生成广告系列名称
 *
 * @param params 生成参数
 * @returns 标准化的广告系列名称
 */
export function generateCampaignName(params: {
  offerId: number
  creativeId: number
  brandName: string
  campaignType?: string
}): string {
  const { offerId, creativeId, brandName, campaignType = 'Search' } = params

  // 清理品牌名称中的特殊字符
  const cleanBrandName = brandName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

  return `${offerId}-${creativeId}-${cleanBrandName}-${campaignType}`
}

/**
 * 检查广告系列是否属于当前Offer
 *
 * @param campaignName 广告系列名称
 * @param offerId Offer ID
 * @returns 是否属于当前Offer
 */
export function isCampaignOwnedByOffer(campaignName: string, offerId: number): boolean {
  const namingInfo = parseCampaignName(campaignName)
  return namingInfo.isValidNaming && namingInfo.offerId === offerId
}
