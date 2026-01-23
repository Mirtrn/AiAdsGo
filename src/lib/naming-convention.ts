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
 * 格式化毫秒为三位数
 */
function formatMilliseconds(date: Date = new Date()): string {
  return String(date.getMilliseconds()).padStart(3, '0')
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
 * 生成短随机后缀（默认3位），用于增强唯一性
 */
function generateShortRandomSuffix(length: number = 3): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = new Uint8Array(length)
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % chars.length]
  }
  return result
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
 * 格式: {OfferName}_CMP_{CreativeID}_{YYYYMMDDHHmmss}_{ms}_{Rand}
 *
 * 示例: Ecomobi_US_01_CMP_121_20260122231319_234_X7Q
 */
export function generateCampaignName(params: {
  offerName: string
  creativeId: number
  date?: Date
  randomSuffix?: string
}): string {
  const {
    offerName,
    creativeId,
    date = new Date(),
    randomSuffix
  } = params

  const safeCreativeId = Number.isFinite(creativeId) ? Math.max(0, Math.floor(creativeId)) : 0
  const safeOfferName = sanitize(offerName) || 'Offer'
  const parts = [
    safeOfferName,
    'CMP',
    String(safeCreativeId),
    formatDateTime(date),
    formatMilliseconds(date),
    randomSuffix || generateShortRandomSuffix(3)
  ]

  const name = parts.join(NAMING_CONFIG.SEPARATOR)
  return truncate(name, NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
}

/**
 * 生成Ad Group名称
 *
 * 格式: {OfferName}_AG_{CreativeID}_{Rand}
 *
 * 示例: Ecomobi_US_01_AG_121_X7Q
 */
export function generateAdGroupName(params: {
  offerName: string
  creativeId: number
  randomSuffix?: string
}): string {
  const {
    offerName,
    creativeId,
    randomSuffix
  } = params

  const safeOfferName = sanitize(offerName) || 'Offer'
  const safeCreativeId = Number.isFinite(creativeId) ? Math.max(0, Math.floor(creativeId)) : 0
  const parts = [
    safeOfferName,
    'AG',
    String(safeCreativeId),
    randomSuffix || generateShortRandomSuffix(3)
  ]

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
 * 解析Ad Group名称，提取关键信息
 * 格式: {OfferName}_AG_{CreativeID}_{Rand}
 */
export function parseAdGroupName(name: string): {
  offerName: string
  creativeId: number
  randomSuffix: string
} | null {
  const match = name.match(/^(.+)_AG_(\d+)_([A-Za-z0-9]{3})$/)
  if (!match) return null

  const [, offerName, creativeId, randomSuffix] = match
  return {
    offerName,
    creativeId: parseInt(creativeId, 10),
    randomSuffix
  }
}

/**
 * 验证Ad Group命名是否符合规范
 */
export function validateAdGroupName(name: string): boolean {
  return parseAdGroupName(name) !== null
}

/**
 * 解析Campaign名称，提取关键信息
 * 格式: {OfferName}_CMP_{CreativeID}_{YYYYMMDDHHmmss}_{ms}_{Rand}
 *
 * @returns 解析出的信息，如果格式不匹配返回null
 */
export function parseCampaignName(name: string): {
  offerName: string
  creativeId: number
  dateTime: string
  milliseconds: string
  randomSuffix: string
} | null {
  const match = name.match(/^(.+)_CMP_(\d+)_([0-9]{14})_([0-9]{3})_([A-Za-z0-9]{3})$/)
  if (!match) return null

  const [, offerName, creativeId, dateTime, milliseconds, randomSuffix] = match
  return {
    offerName,
    creativeId: parseInt(creativeId, 10),
    dateTime,
    milliseconds,
    randomSuffix
  }
}

/**
 * 验证命名是否符合规范
 */
export function validateCampaignName(name: string): boolean {
  return parseCampaignName(name) !== null
}

/**
 * 生成智能优化模式的Campaign名称（不追加变体后缀）
 */
export function generateSmartOptimizationCampaignName(
  baseParams: Parameters<typeof generateCampaignName>[0],
  variantIndex: number,
  totalVariants: number
): string {
  void variantIndex
  void totalVariants
  return generateCampaignName(baseParams)
}

/**
 * 从Offer和配置生成完整的命名方案
 */
export function generateNamingScheme(params: {
  offer: {
    id: number
    brand: string
    offerName?: string
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

  const offerIdentifier = offer.offerName
    ? sanitize(offer.offerName)
    : sanitize(`${offer.brand}_${config.targetCountry}_01`)

  const baseCampaignParams = {
    offerName: offerIdentifier,
    creativeId: creative?.id ?? 0
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
    offerName: offerIdentifier,
    creativeId: creative?.id ?? 0
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
    country: config.targetCountry,
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
 * 格式: [Offer ID]-[Creative ID]-[品牌]-[国家]-[类型]-[时间戳]
 * 例如: 173-456-reolink-US-Search-20251219211500
 *
 * 🔧 修复(2025-12-19): 添加时间戳确保唯一性，避免DUPLICATE_CAMPAIGN_NAME错误
 * 🔧 修复(2025-12-25): 添加国家参数，便于区分不同市场的广告系列
 * 当同一个Offer+Creative组合重复发布时，时间戳确保每次生成不同的名称
 *
 * 这个命名规范用于建立广告创意与Google Ads账号中真实广告系列的关联关系
 */
export function generateAssociativeCampaignName(params: {
  offerId: number
  creativeId: number
  brand: string
  country: string
  campaignType?: string
  date?: Date  // 🔧 新增：可选的日期参数，用于测试或指定特定时间
}): string {
  const { offerId, creativeId, brand, country, campaignType = 'Search', date = new Date() } = params

  // 清理品牌名称中的特殊字符，只保留字母和数字
  const cleanBrand = sanitize(brand.toLowerCase())
  const cleanCountry = sanitize(country.toUpperCase())

  // 🔧 添加时间戳确保唯一性（格式：YYYYMMDDHHmmss）
  const timestamp = formatDateTime(date)

  // 构建名称：[Offer ID]-[Creative ID]-[品牌]-[国家]-[类型]-[时间戳]
  const name = `${offerId}-${creativeId}-${cleanBrand}-${cleanCountry}-${campaignType}-${timestamp}`

  // 确保不超过最大长度
  return truncate(name, NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
}

/**
 * 解析关联Campaign名称
 *
 * 🔧 修复(2025-12-19): 支持新格式（包含时间戳）和旧格式（不含时间戳）
 * 🔧 修复(2025-12-25): 支持包含国家参数的新格式
 * 新格式: [Offer ID]-[Creative ID]-[品牌]-[国家]-[类型]-[时间戳]
 * 旧格式: [Offer ID]-[Creative ID]-[品牌]-[类型]-[时间戳]
 * 更旧格式: [Offer ID]-[Creative ID]-[品牌]-[类型]
 *
 * @param name 广告系列名称
 * @returns 解析结果，如果格式不匹配返回null
 */
export function parseAssociativeCampaignName(name: string): {
  offerId: number
  creativeId: number
  brand: string
  country?: string
  campaignType: string
  timestamp?: string  // 🔧 新增：可选的时间戳字段
} | null {
  // 🔧 最新格式：[数字]-[数字]-[文本]-[国家]-[文本]-[14位数字时间戳]
  const newWithCountryPattern = /^(\d+)-(\d+)-([^-]+)-([A-Z]{2})-([^-]+)-(\d{14})$/
  const newWithCountryMatch = name.match(newWithCountryPattern)

  if (newWithCountryMatch) {
    const [, offerIdStr, creativeIdStr, brand, country, campaignType, timestamp] = newWithCountryMatch
    return {
      offerId: parseInt(offerIdStr, 10),
      creativeId: parseInt(creativeIdStr, 10),
      brand,
      country,
      campaignType,
      timestamp
    }
  }

  // 🔧 旧格式：[数字]-[数字]-[文本]-[文本]-[14位数字时间戳]（无国家）
  const oldPattern = /^(\d+)-(\d+)-([^-]+)-([^-]+)-(\d{14})$/
  const oldMatch = name.match(oldPattern)

  if (oldMatch) {
    const [, offerIdStr, creativeIdStr, brand, campaignType, timestamp] = oldMatch
    return {
      offerId: parseInt(offerIdStr, 10),
      creativeId: parseInt(creativeIdStr, 10),
      brand,
      campaignType,
      timestamp
    }
  }

  // 🔧 兼容更旧格式：[数字]-[数字]-[文本]-[文本]（无时间戳、无国家）
  const oldestPattern = /^(\d+)-(\d+)-([^-]+)-([^-]+)$/
  const oldestMatch = name.match(oldestPattern)

  if (oldestMatch) {
    const [, offerIdStr, creativeIdStr, brand, campaignType] = oldestMatch
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
