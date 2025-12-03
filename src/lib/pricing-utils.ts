/**
 * 价格解析和处理工具函数
 * 用于将product_price字符串解析为结构化的pricing JSON
 */

export interface ParsedPrice {
  original: string
  current: string
  currency: string
  discount?: {
    type: 'percentage' | 'fixed'
    value: number
    label: string
  }
}

/**
 * 货币符号到货币代码的映射
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  'A$': 'AUD',
  'C$': 'CAD',
  'CHF': 'CHF',
  'kr': 'SEK',
  'R$': 'BRL',
}

/**
 * 解析产品价格字符串
 * 支持格式:
 * - "$99.99"
 * - "€79.99"
 * - "$99.99 (20% OFF)"
 * - "$119.99 → $99.99" (折扣价格)
 * - "¥599"
 *
 * @param productPrice - 价格字符串
 * @returns 解析后的价格对象，如果无法解析则返回null
 */
export function parseProductPrice(productPrice: string | null | undefined): ParsedPrice | null {
  if (!productPrice || !productPrice.trim()) {
    return null
  }

  const trimmed = productPrice.trim()

  // 提取货币符号
  const currencyMatch = trimmed.match(/^([A-Z]{3}|[A-Z]\$|[$€£¥₹])/)
  const currencySymbol = currencyMatch ? currencyMatch[1] : '$'
  const currency = CURRENCY_SYMBOLS[currencySymbol] || 'USD'

  // 情况1: 检查是否有折扣箭头 "原价 → 现价" 或 "原价 - 现价"
  const arrowMatch = trimmed.match(/([^\s→-]+)\s*[→-]\s*([^\s(]+)/)
  if (arrowMatch) {
    const originalPrice = arrowMatch[1].trim()
    const currentPrice = arrowMatch[2].trim()

    // 提取数值用于计算折扣
    const originalValue = parseFloat(originalPrice.replace(/[^0-9.]/g, ''))
    const currentValue = parseFloat(currentPrice.replace(/[^0-9.]/g, ''))

    if (!isNaN(originalValue) && !isNaN(currentValue) && originalValue > currentValue) {
      const discountPercent = Math.round(((originalValue - currentValue) / originalValue) * 100)

      return {
        original: originalPrice,
        current: currentPrice,
        currency,
        discount: {
          type: 'percentage',
          value: discountPercent,
          label: discountPercent + '% OFF',
        },
      }
    }
  }

  // 情况2: 检查是否有括号中的折扣信息 "$99.99 (20% OFF)"
  const discountMatch = trimmed.match(/([^\s(]+)\s*\(([^)]+)\)/)
  if (discountMatch) {
    const currentPrice = discountMatch[1].trim()
    const discountLabel = discountMatch[2].trim()

    // 提取折扣百分比
    const percentMatch = discountLabel.match(/(\d+)%/)
    if (percentMatch) {
      const discountPercent = parseInt(percentMatch[1], 10)
      const currentValue = parseFloat(currentPrice.replace(/[^0-9.]/g, ''))

      if (!isNaN(currentValue) && !isNaN(discountPercent)) {
        // 反推原价
        const originalValue = currentValue / (1 - discountPercent / 100)
        const originalPrice = currencySymbol + originalValue.toFixed(2)

        return {
          original: originalPrice,
          current: currentPrice,
          currency,
          discount: {
            type: 'percentage',
            value: discountPercent,
            label: discountLabel,
          },
        }
      }
    }
  }

  // 情况3: 仅有单一价格 "$99.99"
  return {
    original: trimmed,
    current: trimmed,
    currency,
  }
}

/**
 * 生成pricing JSON字符串
 * @param productPrice - 价格字符串
 * @returns JSON字符串，如果无法解析则返回null
 */
export function generatePricingJSON(productPrice: string | null | undefined): string | null {
  const parsed = parseProductPrice(productPrice)
  if (!parsed) {
    return null
  }

  return JSON.stringify(parsed, null, 2)
}

/**
 * 初始化空的promotions JSON结构
 */
export function initializePromotionsJSON(): string {
  return JSON.stringify({
    active: [],
  })
}

/**
 * 初始化空的scraped_data JSON结构
 * @param productPrice - 可选的价格字符串，用于填充price字段
 */
export function initializeScrapedDataJSON(productPrice?: string | null): string {
  const parsed = productPrice ? parseProductPrice(productPrice) : null

  return JSON.stringify({
    price: parsed ? {
      original: parsed.original,
      current: parsed.current,
      discount: parsed.discount?.label || null,
    } : null,
    reviews: null,
    salesRank: null,
    badge: null,
    availability: null,
    shipping: null,
  })
}
