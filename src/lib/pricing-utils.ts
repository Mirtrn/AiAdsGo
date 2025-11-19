/**
 * 客户端价格计算工具函数
 * 不依赖任何服务端代码（数据库、文件系统等）
 */

/**
 * 计算建议的最大CPC
 * 计算公式：maxCPC = (产品价格 × 佣金比例) ÷ 点击转化率
 *
 * @param productPrice - 产品价格（支持货币符号，如 "$699.00" 或 "¥5999.00"）
 * @param commissionPayout - 佣金比例（支持百分号，如 "6.75%"）
 * @param targetCurrency - 目标货币（默认USD）
 * @param clicksPerConversion - 点击转化率：多少个点击出一单（默认50，可配置）
 */
export function calculateSuggestedMaxCPC(
  productPrice: string,
  commissionPayout: string,
  targetCurrency: string = 'USD',
  clicksPerConversion: number = 50
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

    // 验证点击转化率
    if (clicksPerConversion <= 0) {
      console.warn(`无效的点击转化率: ${clicksPerConversion}，使用默认值50`)
      clicksPerConversion = 50
    }

    // 计算最大CPC（使用可配置的点击转化率）
    const maxCPC = (price * payout) / clicksPerConversion

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

    const symbol = currencySymbol[targetCurrency] || '$'
    const formatted = `${symbol}${maxCPC.toFixed(2)}`

    return {
      amount: maxCPC,
      currency: targetCurrency,
      formatted,
    }
  } catch (error) {
    console.error('计算最大CPC失败:', error)
    return null
  }
}

/**
 * 格式化货币金额
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  const currencySymbol: Record<string, string> = {
    USD: '$',
    CNY: '¥',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: 'C$',
    AUD: 'A$',
  }

  const symbol = currencySymbol[currency] || '$'
  return `${symbol}${amount.toFixed(2)}`
}
