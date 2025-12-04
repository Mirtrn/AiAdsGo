import { getDatabase } from '@/lib/db'
import { getAllProxyUrls } from '@/lib/settings'
import { getProxyPool } from '@/lib/url-resolver-enhanced'
import { getLanguageNameForCountry, getSupportedCountries, getCountryChineseName } from '@/lib/language-country-codes'
import { parsePrice } from '@/lib/pricing-utils'

/**
 * Offer相关的辅助函数库
 * 包括offer_name生成、语言映射、验证等
 */

/**
 * 页面类型检测结果
 */
export interface PageTypeResult {
  pageType: 'amazon_store' | 'amazon_product' | 'independent_store' | 'independent_product' | 'unknown'
  isAmazonStore: boolean
  isAmazonProductPage: boolean
  isIndependentStore: boolean
}

/**
 * 检测页面类型
 *
 * @param url - 目标URL
 * @returns 页面类型检测结果
 */
export function detectPageType(url: string): PageTypeResult {
  if (!url) {
    return {
      pageType: 'unknown',
      isAmazonStore: false,
      isAmazonProductPage: false,
      isIndependentStore: false,
    }
  }

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    const pathname = urlObj.pathname.toLowerCase()

    // Amazon域名检测
    const isAmazonDomain = hostname.includes('amazon.')

    if (isAmazonDomain) {
      // Amazon Store页面检测（stores路径）
      if (pathname.includes('/stores/') || pathname.includes('/storefront/')) {
        return {
          pageType: 'amazon_store',
          isAmazonStore: true,
          isAmazonProductPage: false,
          isIndependentStore: false,
        }
      }

      // Amazon单品页面检测（dp路径）
      if (pathname.includes('/dp/') || pathname.includes('/gp/product/')) {
        return {
          pageType: 'amazon_product',
          isAmazonStore: false,
          isAmazonProductPage: true,
          isIndependentStore: false,
        }
      }

      // 其他Amazon页面默认视为单品页面
      return {
        pageType: 'amazon_product',
        isAmazonStore: false,
        isAmazonProductPage: true,
        isIndependentStore: false,
      }
    }

    // 独立站检测
    const isSingleProductPage =
      pathname.includes('/products/') ||
      pathname.includes('/product/') ||
      pathname.includes('/p/') ||
      pathname.includes('/item/')

    if (isSingleProductPage) {
      return {
        pageType: 'independent_product',
        isAmazonStore: false,
        isAmazonProductPage: false,
        isIndependentStore: false,
      }
    }

    // 店铺首页特征
    const isStorePage =
      pathname === '/' ||
      pathname === '' ||
      pathname.includes('/collections') ||
      pathname.includes('/shop') ||
      pathname.includes('/store')

    if (isStorePage) {
      return {
        pageType: 'independent_store',
        isAmazonStore: false,
        isAmazonProductPage: false,
        isIndependentStore: true,
      }
    }

    return {
      pageType: 'unknown',
      isAmazonStore: false,
      isAmazonProductPage: false,
      isIndependentStore: false,
    }
  } catch {
    return {
      pageType: 'unknown',
      isAmazonStore: false,
      isAmazonProductPage: false,
      isIndependentStore: false,
    }
  }
}

/**
 * 缓存代理池初始化状态，避免重复加载
 */
let proxyPoolInitialized = false
let proxyPoolInitializedForUser: number | null = null

/**
 * 初始化代理池
 *
 * 检查用户的代理配置并确保可用
 * 注意：只在第一次调用时初始化，后续调用会跳过（使用缓存）
 *
 * @param userId - 用户ID
 * @param targetCountry - 目标国家
 * @throws AppError 如果代理配置未设置
 */
export async function initializeProxyPool(userId: number, targetCountry: string): Promise<void> {
  // 检查是否已经初始化过，且是同一个用户
  if (proxyPoolInitialized && proxyPoolInitializedForUser === userId) {
    console.log(`✅ [initializeProxyPool] 代理池已初始化，跳过重复初始化`)
    return
  }

  console.log(`🔍 [initializeProxyPool] 开始初始化代理池...`)
  console.log(`   - userId: ${userId}`)
  console.log(`   - targetCountry: ${targetCountry}`)
  console.log(`   - 之前初始化用户: ${proxyPoolInitializedForUser || '无'}`)

  // 获取用户配置的代理URL列表
  const proxyUrls = await getAllProxyUrls(userId)

  console.log(`🔍 [initializeProxyPool] getAllProxyUrls返回:`, proxyUrls)

  if (!proxyUrls || proxyUrls.length === 0) {
    console.error(`❌ [initializeProxyPool] 未找到代理配置`)
    const error = new Error(`未找到代理配置，请在设置页面配置代理URL`) as any
    error.code = 'PROXY_NOT_CONFIGURED'
    error.details = { targetCountry, userId }
    throw error
  }

  // 🔥 修复:所有代理都不设置为 default（emergency）优先级
  // 代理池会自动将第一个代理作为兜底代理（如果需要）
  const proxiesWithDefault = proxyUrls.map((p: any) => ({
    url: p.url,
    country: p.country,
    is_default: false, // 不自动设置兜底代理，让代理池自行管理
  }))

  console.log(`🔍 [initializeProxyPool] 准备加载${proxiesWithDefault.length}个代理到代理池`)

  // 加载代理到代理池
  const proxyPool = getProxyPool()
  await proxyPool.loadProxies(proxiesWithDefault)

  // 更新缓存状态
  proxyPoolInitialized = true
  proxyPoolInitializedForUser = userId

  console.log(`✅ 代理池初始化成功: ${proxiesWithDefault.length}个代理 (用户ID: ${userId})`)
}

/**
 * 规范化品牌名称
 * - 首字母大写格式（Title Case）："apple" → "Apple", "APPLE" → "Apple"
 * - 多个单词："outdoor life" → "Outdoor Life"
 * - 保留常见全大写缩写：IBM, BMW, HP, LG, etc.
 *
 * @param brand - 原始品牌名称
 * @returns 规范化后的品牌名称
 */
export function normalizeBrandName(brand: string): string {
  if (!brand || typeof brand !== 'string') return brand

  const trimmed = brand.trim()
  if (!trimmed) return trimmed

  // 常见全大写缩写列表（保持大写）
  const ABBREVIATIONS = new Set([
    'IBM', 'HP', 'LG', 'BMW', 'ASUS', 'DELL', 'AMD', 'AT&T',
    'BBC', 'CNN', 'ESPN', 'HBO', 'MTV', 'NBA', 'NFL', 'NHL',
    'USA', 'UK', 'EU', 'NASA', 'FBI', 'CIA', 'DVD', 'LCD',
    'LED', 'USB', 'GPS', 'API', 'SEO', 'CEO', 'CTO', 'CFO'
  ])

  // 如果是常见缩写，保持大写
  if (ABBREVIATIONS.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase()
  }

  // 对每个单词进行首字母大写处理
  return trimmed
    .split(/\s+/)
    .map(word => {
      if (!word) return word

      // 检查是否是缩写
      if (ABBREVIATIONS.has(word.toUpperCase())) {
        return word.toUpperCase()
      }

      // 首字母大写，其余小写
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * 生成Offer唯一标识
 * 格式：品牌名称_推广国家_序号
 * 示例：Reolink_US_01, Reolink_US_02, ITEHIL_DE_01
 *
 * 需求1: 自动生成的字段
 */
export async function generateOfferName(
  brandName: string,
  countryCode: string,
  userId: number
): Promise<string> {
  const db = await getDatabase()

  // 查询该用户下同品牌同国家的Offer数量
  const result = await db.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count
    FROM offers
    WHERE user_id = ? AND brand = ? AND target_country = ?
  `,
    [userId, brandName, countryCode]
  )

  // 序号从01开始，格式化为2位数字
  const sequence = String((result?.count || 0) + 1).padStart(2, '0')

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
 *
 * 使用全局统一映射，支持69+国家
 */
export function getTargetLanguage(countryCode: string): string {
  return getLanguageNameForCountry(countryCode)
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
    // 解析价格（使用智能价格解析，支持欧洲/美国格式）
    const price = parsePrice(productPrice)
    if (!price || price <= 0) return null

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
 * 使用全局统一的国家映射，支持69个国家
 */
export function getCountryList(): Array<{ code: string; name: string; language: string }> {
  return getSupportedCountries()
    .map(country => ({
      code: country.code,
      name: getCountryChineseName(country.code),
      language: getLanguageNameForCountry(country.code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/**
 * 验证Offer名称是否唯一
 */
export async function isOfferNameUnique(offerName: string, userId: number, excludeOfferId?: number): Promise<boolean> {
  const db = await getDatabase()

  const query = excludeOfferId
    ? `SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND offer_name = ? AND id != ?`
    : `SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND offer_name = ?`

  const params = excludeOfferId ? [userId, offerName, excludeOfferId] : [userId, offerName]

  const result = await db.queryOne<{ count: number }>(query, params)

  return (result?.count || 0) === 0
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

/**
 * 从URL检测目标国家
 *
 * 支持的检测规则：
 * - Amazon域名: amazon.com(US), amazon.co.uk(UK), amazon.de(DE), amazon.ca(CA), amazon.co.jp(JP)等
 * - 其他域名: 使用顶级域名推断(.uk→UK, .de→DE等)
 *
 * @param url - 目标URL
 * @returns 检测到的国家代码，默认返回'US'
 */
export function detectCountryFromUrl(url: string): string {
  if (!url) return 'US';

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Amazon域名映射
    const amazonDomainMap: Record<string, string> = {
      'amazon.com': 'US',
      'amazon.co.uk': 'UK',
      'amazon.de': 'DE',
      'amazon.fr': 'FR',
      'amazon.it': 'IT',
      'amazon.es': 'ES',
      'amazon.ca': 'CA',
      'amazon.co.jp': 'JP',
      'amazon.com.au': 'AU',
      'amazon.in': 'IN',
      'amazon.com.br': 'BR',
      'amazon.com.mx': 'MX',
      'amazon.nl': 'NL',
      'amazon.se': 'SE',
      'amazon.pl': 'PL',
      'amazon.ae': 'AE',
      'amazon.sa': 'SA',
      'amazon.sg': 'SG',
    };

    // 检查Amazon域名
    for (const [domain, country] of Object.entries(amazonDomainMap)) {
      if (hostname === domain || hostname === `www.${domain}`) {
        return country;
      }
    }

    // 通用顶级域名映射
    const tldMap: Record<string, string> = {
      'uk': 'UK',
      'de': 'DE',
      'fr': 'FR',
      'it': 'IT',
      'es': 'ES',
      'ca': 'CA',
      'jp': 'JP',
      'au': 'AU',
      'in': 'IN',
      'br': 'BR',
      'mx': 'MX',
      'nl': 'NL',
      'se': 'SE',
      'pl': 'PL',
    };

    // 从顶级域名推断
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const tld = parts[parts.length - 1];
      // 处理 .co.uk 这类复合顶级域名
      if (parts.length >= 3 && parts[parts.length - 2] === 'co') {
        const countryTld = parts[parts.length - 1];
        if (tldMap[countryTld]) {
          return tldMap[countryTld];
        }
      }
      if (tldMap[tld]) {
        return tldMap[tld];
      }
    }

    // 默认返回US
    return 'US';
  } catch {
    return 'US';
  }
}
