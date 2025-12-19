/**
 * Google Ads统一命名规范
 *
 * 确保Campaign/AdGroup/Ad命名的唯一性、可读性和可追溯性
 */

/**
 * 命名规范配置
 */
export const NAMING_CONFIG = {
  // 最大长度限制（Google Ads限制）
  MAX_LENGTH: {
    CAMPAIGN: 255,
    AD_GROUP: 255,
    AD: 90
  },

  // 分隔符
  SEPARATOR: '_',

  // 日期格式
  DATE_FORMAT: 'YYYYMMDD',

  // 预算类型缩写
  BUDGET_TYPE: {
    DAILY: 'D',
    TOTAL: 'T'
  },

  // 投放策略缩写
  BIDDING_STRATEGY: {
    MAXIMIZE_CONVERSIONS: 'MAXCONV',
    TARGET_CPA: 'TCPA',
    TARGET_ROAS: 'TROAS',
    MANUAL_CPC: 'MCPC',
    MAXIMIZE_CLICKS: 'MAXCLICK',
    ENHANCED_CPC: 'ECPC'
  }
} as const

/**
 * 格式化日期为YYYYMMDD
 */
function formatDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/**
 * 格式化日期时间为YYYYMMDDHHmmss（用于确保唯一性）
 */
function formatDateTime(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}${hours}${minutes}${seconds}`
}

/**
 * 清理字符串中的特殊字符（Google Ads只允许字母、数字、下划线）
 * 移除连字符、空格、特殊符号，只保留字母数字和下划线
 */
function sanitize(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9_]/g, '') // 移除所有非字母数字下划线的字符
    .replace(/_{2,}/g, '_') // 合并多个下划线
    .replace(/^_|_$/g, '') // 移除首尾下划线
}

/**
 * 🔧 修复(2025-12-16): 简化分类名称
 * - 如果是层级分类（包含 ">"），只取第一级
 * - 移除特殊字符
 * - 截断到最大20个字符
 */
function simplifyCategory(category: string): string {
  if (!category) return 'General'

  // 如果包含层级分隔符 ">"，只取第一级
  const firstLevel = category.split('>')[0].trim()

  // 清理特殊字符
  const cleaned = sanitize(firstLevel)

  // 截断到最大20个字符
  if (cleaned.length > 20) {
    return cleaned.substring(0, 20)
  }

  return cleaned || 'General'
}

/**
 * 🔧 修复(2025-12-16): 简化主题名称
 * - 移除特殊字符
 * - 截断到最大25个字符
 */
function simplifyTheme(theme: string): string {
  if (!theme) return 'Default'

  // 清理特殊字符
  const cleaned = sanitize(theme)

  // 截断到最大25个字符
  if (cleaned.length > 25) {
    return cleaned.substring(0, 25)
  }

  return cleaned || 'Default'
}

/**
 * 截断字符串到指定长度，保留完整的单词
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  // 在最后一个分隔符处截断
  const truncated = text.substring(0, maxLength)
  const lastSeparator = Math.max(
    truncated.lastIndexOf('_'),
    truncated.lastIndexOf('-')
  )

  return lastSeparator > 0 ? truncated.substring(0, lastSeparator) : truncated
}

/**
 * 生成Campaign名称
 *
 * 格式: {Brand}_{Country}_{Category}_{Budget}{BudgetType}_{Strategy}_{YYYYMMDD}_{OfferID}
 *
 * 示例: Eufy_IT_Electronics_50D_TCPA_20251127_O215
 */
export function generateCampaignName(params: {
  brand: string
  country: string
  category?: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  biddingStrategy: string
  offerId: number
  date?: Date
}): string {
  const {
    brand,
    country,
    category,
    budgetAmount,
    budgetType,
    biddingStrategy,
    offerId,
    date = new Date()
  } = params

  // 构建各部分
  const parts = [
    sanitize(brand),
    sanitize(country.toUpperCase()),
    simplifyCategory(category || ''),  // 🔧 修复(2025-12-16): 使用简化分类函数
    `${Math.round(budgetAmount)}${NAMING_CONFIG.BUDGET_TYPE[budgetType]}`,
    NAMING_CONFIG.BIDDING_STRATEGY[biddingStrategy as keyof typeof NAMING_CONFIG.BIDDING_STRATEGY] || sanitize(biddingStrategy.substring(0, 6).toUpperCase()),
    formatDateTime(date), // 使用完整日期时间确保唯一性
    `O${offerId}`
  ]

  const name = parts.join(NAMING_CONFIG.SEPARATOR)
  return truncate(name, NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
}

/**
 * 生成Ad Group名称
 *
 * 格式: {Brand}_{Country}_{Theme}_{MaxCPC}_{AdGroupID}
 *
 * 示例: Eufy_IT_Cleaning_2.5EUR_AG12345
 */
export function generateAdGroupName(params: {
  brand: string
  country: string
  theme?: string
  maxCpcBid?: number
  adGroupId?: string
}): string {
  const {
    brand,
    country,
    theme,
    maxCpcBid,
    adGroupId
  } = params

  const parts = [
    sanitize(brand),
    sanitize(country.toUpperCase()),
    simplifyTheme(theme || ''),  // 🔧 修复(2025-12-16): 使用简化主题函数
  ]

  // 添加CPC（如果提供）
  if (maxCpcBid !== undefined && maxCpcBid > 0) {
    parts.push(`${maxCpcBid.toFixed(1)}CPC`)
  }

  // 添加Ad Group ID（如果提供）
  if (adGroupId) {
    parts.push(`AG${adGroupId}`)
  }

  const name = parts.join(NAMING_CONFIG.SEPARATOR)
  return truncate(name, NAMING_CONFIG.MAX_LENGTH.AD_GROUP)
}

/**
 * 生成Ad名称（用于Responsive Search Ads）
 *
 * 格式: RSA_{Theme}_{CreativeID}_{Variant}
 *
 * 示例: RSA_Cleaning_C121_V1
 */
export function generateAdName(params: {
  theme?: string
  creativeId: number
  variantIndex?: number
}): string {
  const {
    theme,
    creativeId,
    variantIndex
  } = params

  const parts = [
    'RSA',
    simplifyTheme(theme || '').substring(0, 15),  // 🔧 修复(2025-12-16): 使用简化主题函数
    `C${creativeId}`,
  ]

  // 添加变体索引（用于智能优化模式）
  if (variantIndex !== undefined && variantIndex > 0) {
    parts.push(`V${variantIndex}`)
  }

  const name = parts.join(NAMING_CONFIG.SEPARATOR)
  return truncate(name, NAMING_CONFIG.MAX_LENGTH.AD)
}

/**
 * 解析Campaign名称，提取关键信息
 *
 * @returns 解析出的信息，如果格式不匹配返回null
 */
export function parseCampaignName(name: string): {
  brand: string
  country: string
  category: string
  budget: number
  budgetType: 'DAILY' | 'TOTAL'
  strategy: string
  date: string
  offerId: number
} | null {
  const parts = name.split(NAMING_CONFIG.SEPARATOR)

  // 至少需要7个部分
  if (parts.length < 7) return null

  try {
    const budgetPart = parts[3]
    const budgetMatch = budgetPart.match(/^(\d+)([DT])$/)
    if (!budgetMatch) return null

    const offerIdMatch = parts[6].match(/^O(\d+)$/)
    if (!offerIdMatch) return null

    return {
      brand: parts[0],
      country: parts[1],
      category: parts[2],
      budget: parseInt(budgetMatch[1]),
      budgetType: budgetMatch[2] === 'D' ? 'DAILY' : 'TOTAL',
      strategy: parts[4],
      date: parts[5],
      offerId: parseInt(offerIdMatch[1])
    }
  } catch (error) {
    return null
  }
}

/**
 * 验证命名是否符合规范
 */
export function validateCampaignName(name: string): boolean {
  return parseCampaignName(name) !== null
}

/**
 * 生成智能优化模式的Campaign名称（带变体后缀）
 */
export function generateSmartOptimizationCampaignName(
  baseParams: Parameters<typeof generateCampaignName>[0],
  variantIndex: number,
  totalVariants: number
): string {
  const baseName = generateCampaignName(baseParams)
  const variantSuffix = `_V${variantIndex}of${totalVariants}`

  // 确保加上后缀后不超过最大长度
  const maxBaseLength = NAMING_CONFIG.MAX_LENGTH.CAMPAIGN - variantSuffix.length
  const truncatedBase = truncate(baseName, maxBaseLength)

  return truncatedBase + variantSuffix
}

/**
 * 从Offer和配置生成完整的命名方案
 */
export function generateNamingScheme(params: {
  offer: {
    id: number
    brand: string
    category?: string
  }
  config: {
    targetCountry: string
    budgetAmount: number
    budgetType: 'DAILY' | 'TOTAL'
    biddingStrategy: string
    maxCpcBid?: number
  }
  creative?: {
    id: number
    theme?: string
  }
  smartOptimization?: {
    enabled: boolean
    variantIndex?: number
    totalVariants?: number
  }
}): NamingScheme {
  const { offer, config, creative, smartOptimization } = params

  // 生成Campaign名称
  const baseCampaignParams = {
    brand: offer.brand,
    country: config.targetCountry,
    category: offer.category,
    budgetAmount: config.budgetAmount,
    budgetType: config.budgetType,
    biddingStrategy: config.biddingStrategy,
    offerId: offer.id
  }

  const campaignName = smartOptimization?.enabled
    ? generateSmartOptimizationCampaignName(
        baseCampaignParams,
        smartOptimization.variantIndex || 1,
        smartOptimization.totalVariants || 3
      )
    : generateCampaignName(baseCampaignParams)

  // 生成Ad Group名称
  const adGroupName = generateAdGroupName({
    brand: offer.brand,
    country: config.targetCountry,
    theme: creative?.theme,
    maxCpcBid: config.maxCpcBid
  })

  // 生成Ad名称（如果提供了creative）
  const adName = creative ? generateAdName({
    theme: creative.theme,
    creativeId: creative.id,
    variantIndex: smartOptimization?.variantIndex
  }) : undefined

  // 🔥 新增：生成符合关联规范的Campaign名称
  const associativeCampaignName = creative ? generateAssociativeCampaignName({
    offerId: offer.id,
    creativeId: creative.id,
    brand: offer.brand,
    campaignType: 'Search'
  }) : undefined

  return {
    campaignName,
    adGroupName,
    adName,
    associativeCampaignName  // 🔥 新增：用于关联的Campaign名称
  }
}

/**
 * ========================================
 * 广告系列关联管理（新增）
 * 用于建立广告创意与Google Ads账号中真实广告系列的关联关系
 * ========================================
 */

/**
 * 命名方案返回类型
 */
export interface NamingScheme {
  campaignName: string
  adGroupName: string
  adName?: string
  associativeCampaignName?: string  // 🔥 新增：用于关联的Campaign名称
}

/**
 * 生成符合关联规范的Campaign名称
 *
 * 格式: [Offer ID]-[Creative ID]-[品牌]-[类型]-[时间戳]
 * 例如: 173-456-reolink-Search-20251219211500
 *
 * 🔧 修复(2025-12-19): 添加时间戳确保唯一性，避免DUPLICATE_CAMPAIGN_NAME错误
 * 当同一个Offer+Creative组合重复发布时，时间戳确保每次生成不同的名称
 *
 * 这个命名规范用于建立广告创意与Google Ads账号中真实广告系列的关联关系
 */
export function generateAssociativeCampaignName(params: {
  offerId: number
  creativeId: number
  brand: string
  campaignType?: string
  date?: Date  // 🔧 新增：可选的日期参数，用于测试或指定特定时间
}): string {
  const { offerId, creativeId, brand, campaignType = 'Search', date = new Date() } = params

  // 清理品牌名称中的特殊字符，只保留字母和数字
  const cleanBrand = sanitize(brand.toLowerCase())

  // 🔧 添加时间戳确保唯一性（格式：YYYYMMDDHHmmss）
  const timestamp = formatDateTime(date)

  // 构建名称：[Offer ID]-[Creative ID]-[品牌]-[类型]-[时间戳]
  const name = `${offerId}-${creativeId}-${cleanBrand}-${campaignType}-${timestamp}`

  // 确保不超过最大长度
  return truncate(name, NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
}

/**
 * 解析关联Campaign名称
 *
 * 🔧 修复(2025-12-19): 支持新格式（包含时间戳）和旧格式（不含时间戳）
 * 新格式: [Offer ID]-[Creative ID]-[品牌]-[类型]-[时间戳]
 * 旧格式: [Offer ID]-[Creative ID]-[品牌]-[类型]
 *
 * @param name 广告系列名称
 * @returns 解析结果，如果格式不匹配返回null
 */
export function parseAssociativeCampaignName(name: string): {
  offerId: number
  creativeId: number
  brand: string
  campaignType: string
  timestamp?: string  // 🔧 新增：可选的时间戳字段
} | null {
  // 🔧 新格式：[数字]-[数字]-[文本]-[文本]-[14位数字时间戳]
  const newPattern = /^(\d+)-(\d+)-([^-]+)-([^-]+)-(\d{14})$/
  const newMatch = name.match(newPattern)

  if (newMatch) {
    const [, offerIdStr, creativeIdStr, brand, campaignType, timestamp] = newMatch
    return {
      offerId: parseInt(offerIdStr, 10),
      creativeId: parseInt(creativeIdStr, 10),
      brand,
      campaignType,
      timestamp
    }
  }

  // 🔧 兼容旧格式：[数字]-[数字]-[文本]-[文本]（无时间戳）
  const oldPattern = /^(\d+)-(\d+)-([^-]+)-([^-]+)$/
  const oldMatch = name.match(oldPattern)

  if (oldMatch) {
    const [, offerIdStr, creativeIdStr, brand, campaignType] = oldMatch
    return {
      offerId: parseInt(offerIdStr, 10),
      creativeId: parseInt(creativeIdStr, 10),
      brand,
      campaignType
    }
  }

  return null
}

/**
 * 检查Campaign名称是否符合关联规范
 */
export function validateAssociativeCampaignName(name: string): boolean {
  return parseAssociativeCampaignName(name) !== null
}
