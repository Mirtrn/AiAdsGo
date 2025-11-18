import { getDatabase } from '@/lib/db'

/**
 * Offer相关的辅助函数库
 * 包括offer_name生成、语言映射、验证等
 */

/**
 * 生成Offer唯一标识
 * 格式：品牌名称_推广国家_序号
 * 示例：Reolink_US_01, Reolink_US_02, ITEHIL_DE_01
 *
 * 需求1: 自动生成的字段
 */
export function generateOfferName(
  brandName: string,
  countryCode: string,
  userId: number
): string {
  const db = getDatabase()

  // 查询该用户下同品牌同国家的Offer数量
  const result = db
    .prepare(
      `
    SELECT COUNT(*) as count
    FROM offers
    WHERE user_id = ? AND brand = ? AND target_country = ?
  `
    )
    .get(userId, brandName, countryCode) as { count: number }

  // 序号从01开始，格式化为2位数字
  const sequence = String(result.count + 1).padStart(2, '0')

  // 组合生成offer_name: 品牌_国家_序号
  return `${brandName}_${countryCode}_${sequence}`
}

/**
 * 根据国家代码获取推广语言
 *
 * 需求5: 根据国家确定推广语言
 * 示例：
 * - 美国US → English
 * - 德国DE → German
 */
export function getTargetLanguage(countryCode: string): string {
  const mapping: Record<string, string> = {
    // 英语国家
    US: 'English', // 美国
    GB: 'English', // 英国
    CA: 'English', // 加拿大（默认英语）
    AU: 'English', // 澳大利亚
    NZ: 'English', // 新西兰
    IE: 'English', // 爱尔兰

    // 欧洲主要语言
    DE: 'German', // 德国
    AT: 'German', // 奥地利
    CH: 'German', // 瑞士（默认德语）
    FR: 'French', // 法国
    BE: 'French', // 比利时（默认法语）
    ES: 'Spanish', // 西班牙
    IT: 'Italian', // 意大利
    PT: 'Portuguese', // 葡萄牙
    NL: 'Dutch', // 荷兰
    PL: 'Polish', // 波兰
    SE: 'Swedish', // 瑞典
    NO: 'Norwegian', // 挪威
    DK: 'Danish', // 丹麦
    FI: 'Finnish', // 芬兰
    GR: 'Greek', // 希腊
    CZ: 'Czech', // 捷克
    HU: 'Hungarian', // 匈牙利
    RO: 'Romanian', // 罗马尼亚

    // 亚洲语言
    JP: 'Japanese', // 日本
    CN: 'Chinese', // 中国
    TW: 'Chinese', // 台湾
    HK: 'Chinese', // 香港
    KR: 'Korean', // 韩国
    TH: 'Thai', // 泰国
    VN: 'Vietnamese', // 越南
    IN: 'Hindi', // 印度（默认印地语）
    ID: 'Indonesian', // 印度尼西亚
    MY: 'Malay', // 马来西亚
    SG: 'English', // 新加坡（默认英语）
    PH: 'English', // 菲律宾（默认英语）

    // 美洲
    BR: 'Portuguese', // 巴西
    MX: 'Spanish', // 墨西哥
    AR: 'Spanish', // 阿根廷
    CL: 'Spanish', // 智利
    CO: 'Spanish', // 哥伦比亚

    // 中东
    SA: 'Arabic', // 沙特阿拉伯
    AE: 'Arabic', // 阿联酋
    IL: 'Hebrew', // 以色列
    TR: 'Turkish', // 土耳其

    // 非洲
    ZA: 'English', // 南非（默认英语）
    EG: 'Arabic', // 埃及
  }

  // 如果没有映射，默认返回English
  return mapping[countryCode] || 'English'
}

/**
 * 验证品牌名称长度
 * 需求1要求品牌名称≤25字符
 */
export function validateBrandName(brandName: string): {
  valid: boolean
  error?: string
} {
  if (!brandName || brandName.trim().length === 0) {
    return { valid: false, error: '品牌名称不能为空' }
  }

  if (brandName.length > 25) {
    return { valid: false, error: '品牌名称最多25个字符' }
  }

  return { valid: true }
}

/**
 * 计算建议最大CPC（需求28）
 *
 * 公式：最大CPC = product_price * commission_payout / 50
 * （按照50个广告点击出一单来计算）
 *
 * @param productPrice - 产品价格字符串（如 "$699.00" 或 "¥699.00"）
 * @param commissionPayout - 佣金比例字符串（如 "6.75%"）
 * @param targetCurrency - 目标货币（USD, CNY等）
 * @returns 建议最大CPC信息，如果解析失败返回null
 *
 * 示例：
 * - 输入：$699.00, 6.75%, USD
 * - 计算：$699.00 * 6.75% / 50 = $0.94
 * - 输出：{ amount: 0.94, currency: 'USD', formatted: '$0.94' }
 */
export function calculateSuggestedMaxCPC(
  productPrice: string,
  commissionPayout: string,
  targetCurrency: string = 'USD'
): { amount: number; currency: string; formatted: string } | null {
  try {
    // 解析价格（去除货币符号和其他非数字字符，保留小数点）
    const priceMatch = productPrice.match(/[\d.]+/)
    if (!priceMatch) return null
    const price = parseFloat(priceMatch[0])

    if (isNaN(price) || price <= 0) return null

    // 解析佣金比例（去除%符号）
    const payoutMatch = commissionPayout.match(/[\d.]+/)
    if (!payoutMatch) return null
    const payout = parseFloat(payoutMatch[0]) / 100 // 转换为小数（6.75% → 0.0675）

    if (isNaN(payout) || payout <= 0 || payout > 1) return null

    // 计算最大CPC（按50个点击出一单）
    const maxCPC = (price * payout) / 50

    // 货币符号映射
    const currencySymbol: Record<string, string> = {
      USD: '$',
      CNY: '¥',
      EUR: '€',
      GBP: '£',
      JPY: '¥',
      CAD: 'C$',
      AUD: 'A$',
    }

    return {
      amount: maxCPC,
      currency: targetCurrency,
      formatted: `${currencySymbol[targetCurrency] || targetCurrency}${maxCPC.toFixed(2)}`,
    }
  } catch (error) {
    console.error('计算建议最大CPC失败:', error)
    return null
  }
}

/**
 * 获取国家列表（用于前端下拉选择）
 */
export function getCountryList(): Array<{ code: string; name: string; language: string }> {
  return [
    // 北美
    { code: 'US', name: '美国', language: 'English' },
    { code: 'CA', name: '加拿大', language: 'English' },
    { code: 'MX', name: '墨西哥', language: 'Spanish' },

    // 欧洲
    { code: 'GB', name: '英国', language: 'English' },
    { code: 'DE', name: '德国', language: 'German' },
    { code: 'FR', name: '法国', language: 'French' },
    { code: 'ES', name: '西班牙', language: 'Spanish' },
    { code: 'IT', name: '意大利', language: 'Italian' },
    { code: 'NL', name: '荷兰', language: 'Dutch' },
    { code: 'BE', name: '比利时', language: 'French' },
    { code: 'PL', name: '波兰', language: 'Polish' },
    { code: 'SE', name: '瑞典', language: 'Swedish' },
    { code: 'NO', name: '挪威', language: 'Norwegian' },
    { code: 'DK', name: '丹麦', language: 'Danish' },
    { code: 'FI', name: '芬兰', language: 'Finnish' },
    { code: 'AT', name: '奥地利', language: 'German' },
    { code: 'CH', name: '瑞士', language: 'German' },
    { code: 'PT', name: '葡萄牙', language: 'Portuguese' },

    // 亚太
    { code: 'AU', name: '澳大利亚', language: 'English' },
    { code: 'NZ', name: '新西兰', language: 'English' },
    { code: 'JP', name: '日本', language: 'Japanese' },
    { code: 'CN', name: '中国', language: 'Chinese' },
    { code: 'KR', name: '韩国', language: 'Korean' },
    { code: 'SG', name: '新加坡', language: 'English' },
    { code: 'IN', name: '印度', language: 'Hindi' },
    { code: 'TH', name: '泰国', language: 'Thai' },
    { code: 'VN', name: '越南', language: 'Vietnamese' },
    { code: 'ID', name: '印度尼西亚', language: 'Indonesian' },
    { code: 'MY', name: '马来西亚', language: 'Malay' },
    { code: 'PH', name: '菲律宾', language: 'English' },

    // 南美
    { code: 'BR', name: '巴西', language: 'Portuguese' },
    { code: 'AR', name: '阿根廷', language: 'Spanish' },
    { code: 'CL', name: '智利', language: 'Spanish' },
    { code: 'CO', name: '哥伦比亚', language: 'Spanish' },

    // 中东
    { code: 'AE', name: '阿联酋', language: 'Arabic' },
    { code: 'SA', name: '沙特阿拉伯', language: 'Arabic' },
    { code: 'IL', name: '以色列', language: 'Hebrew' },
    { code: 'TR', name: '土耳其', language: 'Turkish' },

    // 非洲
    { code: 'ZA', name: '南非', language: 'English' },
  ].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/**
 * 验证Offer名称是否唯一
 */
export function isOfferNameUnique(offerName: string, userId: number, excludeOfferId?: number): boolean {
  const db = getDatabase()

  const query = excludeOfferId
    ? `SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND offer_name = ? AND id != ?`
    : `SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND offer_name = ?`

  const params = excludeOfferId ? [userId, offerName, excludeOfferId] : [userId, offerName]

  const result = db.prepare(query).get(...params) as { count: number }

  return result.count === 0
}

/**
 * 格式化Offer显示名称
 * 用于UI显示，提供更友好的格式
 */
export function formatOfferDisplayName(offer: {
  brand: string
  target_country: string
  offer_name?: string
}): string {
  if (offer.offer_name) {
    return offer.offer_name
  }

  // 如果没有offer_name，临时生成一个显示名称
  return `${offer.brand} (${offer.target_country})`
}
