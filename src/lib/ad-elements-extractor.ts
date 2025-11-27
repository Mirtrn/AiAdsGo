/**
 * 广告关键元素提取器
 * 需求34：从商品标题和描述中提取关键字、标题、广告描述
 *
 * 核心功能：
 * 1. 从商品标题提取"品牌名+商品名"作为关键字和广告标题
 * 2. 从商品描述提取精炼信息作为广告描述
 * 3. 支持单商品和店铺两种场景
 * 4. 整合Google搜索下拉词
 * 5. 通过Keyword Planner查询搜索量并过滤
 */

import { generateContent } from './gemini'
import { getKeywordSearchVolumes } from './keyword-planner'
import { getHighIntentKeywords } from './google-suggestions'
import type { AmazonProductData, AmazonStoreData } from './scraper-stealth'

// Type alias for Store Product (extracted from AmazonStoreData.products)
type StoreProduct = AmazonStoreData['products'][number]

/**
 * 从AI响应中提取JSON（处理markdown代码块等格式）
 */
function extractJsonFromResponse(response: string): any {
  // 立即记录输入（同步日志确保显示）
  const inputLength = response?.length || 0
  console.log(`🔍 extractJsonFromResponse: 输入长度=${inputLength}`)

  if (!response || typeof response !== 'string') {
    throw new Error(`无效输入: ${typeof response}`)
  }

  let jsonText = response.trim()

  // 1. 移除markdown代码块标记（多种格式）
  jsonText = jsonText
    .replace(/```json\s*/gi, '')
    .replace(/```javascript\s*/gi, '')
    .replace(/```\s*/gi, '')
    .replace(/^json\s*/i, '') // 移除开头的 "json" 标记

  // 2. 移除可能的thinking/reasoning块（Gemini 2.5有时会添加）
  const thinkingEnd = jsonText.search(/\{[\s\S]*"headlines"|\{[\s\S]*"descriptions"|\[/)
  if (thinkingEnd > 0) {
    jsonText = jsonText.slice(thinkingEnd)
  }

  console.log(`🔍 清理后长度=${jsonText.length}`)

  // 3. 尝试直接解析（如果整个响应就是JSON）
  try {
    const directParse = JSON.parse(jsonText)
    console.log(`✅ 直接解析成功`)
    return directParse
  } catch {
    // 继续尝试其他方法
  }

  // 4. 尝试找到JSON对象（从第一个{到匹配的最后一个}）
  const firstBrace = jsonText.indexOf('{')
  const lastBrace = jsonText.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const possibleJson = jsonText.slice(firstBrace, lastBrace + 1)
    try {
      const parsed = JSON.parse(possibleJson)
      console.log(`✅ 找到JSON对象，位置: ${firstBrace}-${lastBrace}`)
      return parsed
    } catch (e) {
      console.log(`⚠️ JSON对象解析失败: ${(e as Error).message}`)
    }
  }

  // 5. 尝试找到JSON数组（从第一个[到最后一个]）
  const firstBracket = jsonText.indexOf('[')
  const lastBracket = jsonText.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const possibleArray = jsonText.slice(firstBracket, lastBracket + 1)
    try {
      const parsed = JSON.parse(possibleArray)
      console.log(`✅ 找到JSON数组，位置: ${firstBracket}-${lastBracket}`)
      return parsed
    } catch (e) {
      console.log(`⚠️ JSON数组解析失败: ${(e as Error).message}`)
    }
  }

  // 6. 尝试提取headlines/descriptions数组（特殊处理AI可能返回的格式）
  const headlinesMatch = response.match(/"headlines"\s*:\s*\[([\s\S]*?)\]/i)
  if (headlinesMatch) {
    try {
      const headlinesJson = `{"headlines": [${headlinesMatch[1]}]}`
      const parsed = JSON.parse(headlinesJson)
      console.log(`✅ 使用正则提取headlines成功`)
      return parsed
    } catch {
      // 继续
    }
  }

  const descriptionsMatch = response.match(/"descriptions"\s*:\s*\[([\s\S]*?)\]/i)
  if (descriptionsMatch) {
    try {
      const descriptionsJson = `{"descriptions": [${descriptionsMatch[1]}]}`
      const parsed = JSON.parse(descriptionsJson)
      console.log(`✅ 使用正则提取descriptions成功`)
      return parsed
    } catch {
      // 继续
    }
  }

  // 7. 输出调试信息
  console.log(`❌ 未找到有效JSON，前300字符: ${response.slice(0, 300)}`)
  console.log(`❌ 未找到有效JSON，后300字符: ${response.slice(-300)}`)

  throw new Error('未找到有效的JSON结构')
}

/**
 * 提取的广告元素
 */
export interface ExtractedAdElements {
  // 关键字（已查询搜索量）
  keywords: Array<{
    keyword: string
    source: 'product_title' | 'google_suggest' | 'brand_variant'
    searchVolume: number
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
  }>

  // 广告标题（15个）
  headlines: string[]

  // 广告描述（4个）
  descriptions: string[]

  // 提取来源统计
  sources: {
    productCount: number
    keywordSources: Record<string, number>
    topProducts: Array<{
      name: string
      rating: string | null
      reviewCount: string | null
    }>
  }
}

/**
 * 商品数据接口（兼容单商品和店铺商品）
 */
interface ProductInfo {
  name: string
  description?: string
  features?: string[]
  aboutThisItem?: string[]  // Amazon "About this item" 产品详细描述
  brand?: string
  rating?: string | null
  reviewCount?: string | null
}

/**
 * 从商品标题提取"品牌名+商品名"
 * @example "Teslong Inspection Camera with Light" → "Teslong Inspection Camera"
 */
function extractBrandProductName(productTitle: string, brandName: string): string {
  // 移除常见的无关词汇
  const cleanedTitle = productTitle
    .replace(/\s+with\s+.*/i, '') // 移除 "with ..."
    .replace(/\s+for\s+.*/i, '') // 移除 "for ..."
    .replace(/\s+-\s+.*/i, '') // 移除 " - ..."
    .replace(/\s+\|.*/i, '') // 移除 " | ..."
    .trim()

  // 确保包含品牌名
  if (!cleanedTitle.toLowerCase().includes(brandName.toLowerCase())) {
    return `${brandName} ${cleanedTitle}`
  }

  return cleanedTitle
}

/**
 * 🔥 P1.2优化1：类目权重系数
 * 不同类目的评论数量基准不同，需要动态调整门槛
 */
interface CategoryThreshold {
  highReviewBase: number  // High 流行度评论数基准
  mediumReviewBase: number  // Medium 流行度评论数基准
  multiplier: number  // 门槛倍数
  description: string
}

const CATEGORY_THRESHOLDS: Record<string, CategoryThreshold> = {
  // 电子产品：竞争激烈，门槛提高 50%
  'Electronics': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '电子产品' },
  'Computers': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '计算机' },
  'Cell Phones': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '手机' },

  // 服装鞋包：评论较多，标准门槛
  'Clothing': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '服装' },
  'Shoes': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '鞋类' },
  'Handbags': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '箱包' },

  // 图书音乐：评论较少，门槛降低 20%
  'Books': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '图书' },
  'Music': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '音乐' },
  'Movies': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '影视' },

  // 家居园艺：评论中等，门槛降低 10%
  'Home': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '家居' },
  'Kitchen': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '厨具' },
  'Garden': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '园艺' },

  // 美容健康：评论较多，标准门槛
  'Beauty': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '美容' },
  'Health': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '健康' },

  // 玩具游戏：评论中等，门槛降低 10%
  'Toys': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '玩具' },
  'Games': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '游戏' },

  // 运动户外：评论较多，标准门槛
  'Sports': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '运动' },
  'Outdoors': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '户外' },

  // 汽车配件：评论较少，门槛降低 15%
  'Automotive': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.85, description: '汽车配件' },

  // 工具：评论较少，门槛降低 15%
  'Tools': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.85, description: '工具' },

  // 默认类目：标准门槛
  'default': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '默认' }
}

/**
 * 🔥 P1.2优化1：从 Sales Rank 中提取类目
 * @param salesRank - Sales Rank 字符串，如 "#123 in Electronics" 或 "#1 in Cell Phones & Accessories"
 * @returns 类目名称或 'default'
 */
function extractCategoryFromSalesRank(salesRank: string | null | undefined): string {
  if (!salesRank) return 'default'

  // 提取 "in" 后面的类目名称
  const categoryMatch = salesRank.match(/in\s+([^>]+?)(?:\s*>|$)/)
  if (!categoryMatch) return 'default'

  const category = categoryMatch[1].trim()

  // 精确匹配
  if (CATEGORY_THRESHOLDS[category]) {
    return category
  }

  // 模糊匹配（包含关键词）
  for (const [key, _] of Object.entries(CATEGORY_THRESHOLDS)) {
    if (key !== 'default' && category.includes(key)) {
      return key
    }
  }

  return 'default'
}

/**
 * 🔥 P3优化：评估品牌流行度
 * 基于评论数量、评分、Sales Rank等因素评估品牌知名度
 *
 * @param reviewCount - 评论数量（字符串，如 "1,234" 或 "1.2K"）
 * @param rating - 评分（字符串，如 "4.5" 或 null）
 * @param salesRank - 销售排名（字符串，如 "#123 in Electronics" 或 null）
 * @returns 'high' | 'medium' | 'low'
 */
function estimateBrandPopularity(
  reviewCount: string | null | undefined,
  rating: string | null | undefined,
  salesRank: string | null | undefined
): 'high' | 'medium' | 'low' {
  // 解析评论数量（处理 "1,234" 或 "1.2K" 格式）
  let numReviews = 0
  if (reviewCount) {
    const cleanCount = reviewCount.replace(/,/g, '')
    if (cleanCount.includes('K')) {
      numReviews = parseFloat(cleanCount) * 1000
    } else if (cleanCount.includes('M')) {
      numReviews = parseFloat(cleanCount) * 1000000
    } else {
      numReviews = parseFloat(cleanCount) || 0
    }
  }

  // 解析评分
  let numRating = rating ? parseFloat(rating) : 0

  // 解析Sales Rank（提取数字，如 "#123" → 123）
  let rankNum = Infinity
  if (salesRank) {
    const rankMatch = salesRank.match(/#?(\d+)/)
    if (rankMatch) {
      rankNum = parseInt(rankMatch[1], 10)
    }
  }

  // 🔥 P1.2优化1: 类目动态门槛调整
  const category = extractCategoryFromSalesRank(salesRank)
  const threshold = CATEGORY_THRESHOLDS[category]
  const multiplier = threshold.multiplier

  // 应用类目倍数调整门槛
  const highThreshold = Math.round(threshold.highReviewBase * multiplier)
  const mediumThreshold = Math.round(threshold.mediumReviewBase * multiplier)
  const mediumWithRatingThreshold = Math.round(300 * multiplier)

  if (category !== 'default') {
    console.log(`  📂 类目: ${threshold.description} (${category}) - 门槛倍数: ${multiplier}x`)
    console.log(`     High门槛: ${highThreshold}, Medium门槛: ${mediumThreshold}/${mediumWithRatingThreshold}`)
  }

  // 🔥 改进3: Sales Rank 缺失补偿 - 无 Sales Rank 时增加评分权重
  if (!salesRank && numRating >= 4.7) {
    // 评分 >= 4.7 视为高质量信号，评论数权重放大 50%
    numReviews *= 1.5
    console.log(`  📊 无Sales Rank，评分${numRating}较高，评论数权重放大: ${Math.round(numReviews / 1.5)} → ${Math.round(numReviews)}`)
  }

  // 🔥 流行度评估规则（使用动态门槛）
  // High: 评论数 >= highThreshold 或 (评论数 >= 1000 且评分 >= 4.5) 或 Sales Rank <= 100
  if (
    numReviews >= highThreshold ||
    (numReviews >= 1000 && numRating >= 4.5) ||
    rankNum <= 100
  ) {
    return 'high'
  }

  // 🔥 改进1: Medium 门槛调整 - 将 100 评论数提升至 300，避免边界误判
  // Medium: 评论数 >= mediumThreshold 或 (评论数 >= mediumWithRatingThreshold 且评分 >= 4.0) 或 Sales Rank <= 1000
  if (
    numReviews >= mediumThreshold ||
    (numReviews >= mediumWithRatingThreshold && numRating >= 4.0) ||
    rankNum <= 1000
  ) {
    return 'medium'
  }

  // Low: 其他情况
  return 'low'
}

/**
 * 🔥 P1.2优化3：品牌名标准化
 * 统一品牌名格式，去除空格、标点，统一大小写
 * @param brand - 原始品牌名，如 "Bag Smart" 或 "NIKE™"
 * @returns 标准化品牌名，如 "bagsmart" 或 "nike"
 */
function normalizeBrandName(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[™®©]/g, '')  // 移除商标符号
    .replace(/\s+/g, '')     // 移除所有空格
    .replace(/[_-]+/g, '')   // 移除下划线和连字符
    .trim()
}

/**
 * 🔥 P1.2优化2：多语言语义关键词检测
 * 检测品牌名中是否包含各语言的商店、官方、网站等关键词
 */
const SEMANTIC_KEYWORDS = {
  store: [
    'store', 'shop',           // 英语
    'geschäft', 'laden',       // 德语
    'magasin', 'boutique',     // 法语
    'tienda',                  // 西班牙语
    'negozio',                 // 意大利语
    'loja',                    // 葡萄牙语
    'sklep',                   // 波兰语
    'winkel'                   // 荷兰语
  ],
  official: [
    'official', 'authentic',   // 英语
    'offiziell', 'echt',       // 德语
    'officiel', 'authentique', // 法语
    'oficial', 'auténtico',    // 西班牙语
    'ufficiale', 'autentico',  // 意大利语
    'oficial', 'autêntico',    // 葡萄牙语
    'oficjalny'                // 波兰语
  ],
  website: [
    'website', 'site', 'web',  // 英语
    'webseite', 'seite',       // 德语
    'site web', 'site',        // 法语
    'sitio web', 'sitio',      // 西班牙语
    'sito web', 'sito',        // 意大利语
    'site', 'página'           // 葡萄牙语
  ]
}

/**
 * 检测品牌名中是否包含语义关键词
 * @param brandLower - 小写品牌名
 * @param keywords - 关键词数组
 * @returns 是否包含
 */
function containsSemanticKeyword(brandLower: string, keywords: string[]): boolean {
  return keywords.some(keyword => brandLower.includes(keyword))
}

/**
 * 🔥 P3优化：动态生成品牌变体关键词
 * 根据品牌流行度调整变体数量和类型
 *
 * @param brand - 品牌名
 * @param popularity - 品牌流行度 ('high' | 'medium' | 'low')
 * @returns 品牌变体关键词数组
 */
function generateDynamicBrandVariants(
  brand: string,
  popularity: 'high' | 'medium' | 'low'
): string[] {
  // 🔥 P1.2优化3: 品牌名标准化
  const brandNormalized = normalizeBrandName(brand)
  const brandLower = brandNormalized  // 已经是小写了

  if (brandNormalized !== brand.toLowerCase()) {
    console.log(`  🔧 品牌名标准化: "${brand}" → "${brandNormalized}"`)
  }

  // 🔥 P1.2优化2: 多语言语义重复检测
  const containsStore = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.store)
  const containsOfficial = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.official)
  const containsWebsite = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.website)

  if (containsStore || containsOfficial || containsWebsite) {
    console.log(`  🌐 多语言检测: store=${containsStore}, official=${containsOfficial}, website=${containsWebsite}`)
  }

  // 🔥 知名品牌（如Nike, Apple, Samsung）: 减少变体，避免与热门搜索词冲突
  if (popularity === 'high') {
    console.log(`  🏆 高知名度品牌 "${brand}" - 使用精简变体（2个）`)
    const variants = [brandLower]

    // 避免 "official store official" 语义重复
    if (!containsOfficial) {
      variants.push(`${brandLower} official`)
    }

    return variants
  }

  // 🔥 中等知名度品牌: 标准变体
  if (popularity === 'medium') {
    console.log(`  ⭐ 中等知名度品牌 "${brand}" - 使用标准变体（4个）`)
    const variants = [brandLower]

    if (!containsOfficial) {
      variants.push(`${brandLower} official`)
    }

    // 避免 "led store store" 语义重复
    if (!containsStore) {
      variants.push(`${brandLower} store`)
    }

    variants.push(`buy ${brandLower}`)

    return variants
  }

  // 🔥 低知名度品牌: 扩展变体，增加曝光
  console.log(`  📌 低知名度品牌 "${brand}" - 使用扩展变体（6个）`)
  const variants = [brandLower]

  if (!containsOfficial) {
    variants.push(`${brandLower} official`)
  }

  if (!containsStore) {
    variants.push(`${brandLower} store`)
  }

  variants.push(`buy ${brandLower}`)

  if (!containsStore && !containsWebsite) {
    // 只有不包含 store/website 时才添加 amazon 和 website 变体
    variants.push(`${brandLower} amazon`)

    if (!containsWebsite) {
      variants.push(`${brandLower} website`)
    }
  } else {
    // 如果包含 store/website，用其他有价值的变体替换
    variants.push(`${brandLower} online`)
    variants.push(`${brandLower} reviews`)
  }

  return variants
}

/**
 * 从单个商品提取广告元素
 */
async function extractFromSingleProduct(
  product: AmazonProductData,
  brand: string,
  targetCountry: string,
  targetLanguage: string,
  userId: number
): Promise<ExtractedAdElements> {
  console.log('📦 单商品场景：提取广告元素...')

  const productInfo: ProductInfo = {
    name: product.productName || '',
    description: product.productDescription || '',
    features: product.features || [],
    aboutThisItem: product.aboutThisItem || [],  // Amazon "About this item"
    brand: product.brandName || brand,
    rating: product.rating,
    reviewCount: product.reviewCount
  }

  // 1. 提取关键字候选词
  const keywordCandidates: string[] = []

  // 1.1 从商品标题提取"品牌名+商品名"
  if (productInfo.name) {
    const brandProductName = extractBrandProductName(productInfo.name, brand)
    keywordCandidates.push(brandProductName)
    console.log(`  ✓ 商品标题关键字: "${brandProductName}"`)
  }

  // 1.2 获取Google搜索下拉词（高购买意图）- 🔥 调整顺序：先获取Google词
  let googleKeywords: string[] = []
  try {
    googleKeywords = await getHighIntentKeywords({
      brand,
      country: targetCountry,
      language: targetLanguage,
      useProxy: true
    })
    console.log(`  ✓ Google下拉词: ${googleKeywords.length}个`)
  } catch (error: any) {
    console.warn('  ⚠️ Google下拉词获取失败:', error.message)
  }

  // 1.3 生成品牌变体关键字 - 🔥 P3优化：动态品牌变体生成
  const productTitle = productInfo.name?.toLowerCase() || ''
  const googleKeywordsLower = new Set(googleKeywords.map(k => k.toLowerCase()))

  // 🔥 P3优化：评估品牌流行度
  const brandPopularity = estimateBrandPopularity(
    productInfo.reviewCount,
    productInfo.rating,
    (product as any).salesRank // AmazonProductData可能有salesRank字段
  )

  // 🔥 P3优化：根据流行度动态生成品牌变体
  const allBrandVariants = generateDynamicBrandVariants(brand, brandPopularity)

  // 🔥 P1优化：智能过滤已存在的变体
  const brandVariants = allBrandVariants.filter(variant => {
    const variantLower = variant.toLowerCase()

    // 过滤规则1: 如果Product Title已包含该变体，跳过
    if (productTitle.includes(variantLower)) {
      console.log(`  ⊘ 跳过品牌变体 "${variant}" (已存在于Product Title)`)
      return false
    }

    // 过滤规则2: 如果Google Suggest已包含完全相同的关键词，跳过
    if (googleKeywordsLower.has(variantLower)) {
      console.log(`  ⊘ 跳过品牌变体 "${variant}" (已存在于Google下拉词)`)
      return false
    }

    return true
  })

  keywordCandidates.push(...googleKeywords)
  keywordCandidates.push(...brandVariants)
  console.log(`  ✓ 品牌变体关键字: ${brandVariants.length}个（已智能过滤${allBrandVariants.length - brandVariants.length}个重复）`)

  // 🔥 P1优化：去重关键词候选（大小写不敏感）
  const keywordCountBeforeDedup = keywordCandidates.length
  const uniqueKeywordsMap = new Map<string, string>()

  keywordCandidates.forEach(keyword => {
    const keywordLower = keyword.toLowerCase()
    if (!uniqueKeywordsMap.has(keywordLower)) {
      // 保留原始大小写（通常是首次出现的版本）
      uniqueKeywordsMap.set(keywordLower, keyword)
    }
  })

  const deduplicatedKeywords = Array.from(uniqueKeywordsMap.values())
  const duplicatesRemoved = keywordCountBeforeDedup - deduplicatedKeywords.length

  if (duplicatesRemoved > 0) {
    console.log(`\n🔄 关键词去重: ${keywordCountBeforeDedup}个 → ${deduplicatedKeywords.length}个（移除${duplicatesRemoved}个重复）`)
  }

  // 更新keywordCandidates为去重后的列表
  keywordCandidates.length = 0
  keywordCandidates.push(...deduplicatedKeywords)

  // 2. 查询搜索量并过滤
  console.log(`\n🔍 查询${keywordCandidates.length}个关键字的搜索量...`)
  const minSearchVolume = 500 // 最小搜索量阈值

  let keywordsWithVolume: Array<{
    keyword: string
    source: 'product_title' | 'google_suggest' | 'brand_variant'
    searchVolume: number
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
  }> = []

  try {
    const volumeData = await getKeywordSearchVolumes(
      keywordCandidates,
      targetCountry,
      targetLanguage,
      userId
    )

    keywordsWithVolume = keywordCandidates.map((keyword, index) => {
      const volume = volumeData[index]?.avgMonthlySearches || 0

      // 确定来源
      let source: 'product_title' | 'google_suggest' | 'brand_variant' = 'brand_variant'
      if (productInfo.name && keyword.includes(extractBrandProductName(productInfo.name, brand))) {
        source = 'product_title'
      } else if (!brandVariants.includes(keyword)) {
        source = 'google_suggest'
      }

      // 确定优先级
      let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
      if (source === 'product_title') {
        priority = 'HIGH'
      } else if (volume >= 1000) {
        priority = 'HIGH'
      } else if (volume >= 500) {
        priority = 'MEDIUM'
      } else {
        priority = 'LOW'
      }

      return {
        keyword,
        source,
        searchVolume: volume,
        priority
      }
    })

    // 过滤搜索量过低的关键字
    const filteredKeywords = keywordsWithVolume.filter(k => k.searchVolume >= minSearchVolume)
    console.log(`  ✓ 过滤后剩余${filteredKeywords.length}个关键字（搜索量>=${minSearchVolume}）`)

    // 按优先级和搜索量排序
    filteredKeywords.sort((a, b) => {
      const priorityWeight = { HIGH: 3, MEDIUM: 2, LOW: 1 }
      const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority]
      if (priorityDiff !== 0) return priorityDiff
      return b.searchVolume - a.searchVolume
    })

    keywordsWithVolume = filteredKeywords
  } catch (error: any) {
    console.error('  ❌ 搜索量查询失败:', error.message)
    // 失败时仍返回候选关键字，搜索量设为0
    keywordsWithVolume = keywordCandidates.map(keyword => ({
      keyword,
      source: 'brand_variant' as const,
      searchVolume: 0,
      priority: 'MEDIUM' as const
    }))
  }

  // 3. 使用AI生成15个广告标题
  console.log('\n📝 生成15个广告标题...')
  const headlines = await generateHeadlines(productInfo, keywordsWithVolume.slice(0, 10), targetLanguage, userId)

  // 4. 使用AI生成4个广告描述
  console.log('\n📝 生成4个广告描述...')
  const descriptions = await generateDescriptions(productInfo, targetLanguage, userId)

  return {
    keywords: keywordsWithVolume,
    headlines,
    descriptions,
    sources: {
      productCount: 1,
      keywordSources: {
        product_title: keywordsWithVolume.filter(k => k.source === 'product_title').length,
        google_suggest: keywordsWithVolume.filter(k => k.source === 'google_suggest').length,
        brand_variant: keywordsWithVolume.filter(k => k.source === 'brand_variant').length
      },
      topProducts: [{
        name: productInfo.name,
        rating: productInfo.rating,
        reviewCount: productInfo.reviewCount
      }]
    }
  }
}

/**
 * 从店铺多个热销商品提取广告元素
 */
async function extractFromStore(
  products: StoreProduct[],
  brand: string,
  targetCountry: string,
  targetLanguage: string,
  userId: number
): Promise<ExtractedAdElements> {
  console.log(`🏪 店铺场景：从${products.length}个热销商品提取广告元素...`)

  // 按热销分数排序，取前5个
  const topProducts = products
    .filter(p => p.hotScore && p.hotScore > 0)
    .sort((a, b) => (b.hotScore || 0) - (a.hotScore || 0))
    .slice(0, 5)

  console.log(`  → 筛选TOP 5热销商品`)
  topProducts.forEach((p, i) => {
    console.log(`    ${i + 1}. ${p.name} (评分${p.rating}, ${p.reviewCount}评论, 热度${p.hotScore?.toFixed(2)})`)
  })

  // 1. 从每个热销商品提取"品牌名+商品名"作为关键字
  const keywordCandidates: string[] = []

  topProducts.forEach(product => {
    const brandProductName = extractBrandProductName(product.name, brand)
    keywordCandidates.push(brandProductName)
  })
  console.log(`  ✓ 商品标题关键字: ${keywordCandidates.length}个`)

  // 1.2 生成品牌变体关键字
  const brandVariants = [
    brand,
    `${brand} official`,
    `${brand} store`,
    `buy ${brand}`,
    `${brand} amazon`
  ]
  keywordCandidates.push(...brandVariants)
  console.log(`  ✓ 品牌变体关键字: ${brandVariants.length}个`)

  // 1.3 获取Google搜索下拉词
  try {
    const googleKeywords = await getHighIntentKeywords({
      brand,
      country: targetCountry,
      language: targetLanguage,
      useProxy: true
    })
    keywordCandidates.push(...googleKeywords)
    console.log(`  ✓ Google下拉词: ${googleKeywords.length}个`)
  } catch (error: any) {
    console.warn('  ⚠️ Google下拉词获取失败:', error.message)
  }

  // 2. 查询搜索量并过滤
  console.log(`\n🔍 查询${keywordCandidates.length}个关键字的搜索量...`)
  const minSearchVolume = 500

  let keywordsWithVolume: Array<{
    keyword: string
    source: 'product_title' | 'google_suggest' | 'brand_variant'
    searchVolume: number
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
  }> = []

  try {
    const volumeData = await getKeywordSearchVolumes(
      keywordCandidates,
      targetCountry,
      targetLanguage,
      userId
    )

    keywordsWithVolume = keywordCandidates.map((keyword, index) => {
      const volume = volumeData[index]?.avgMonthlySearches || 0

      // 确定来源
      let source: 'product_title' | 'google_suggest' | 'brand_variant' = 'brand_variant'
      const isFromProduct = topProducts.some(p =>
        keyword.includes(extractBrandProductName(p.name, brand))
      )
      if (isFromProduct) {
        source = 'product_title'
      } else if (!brandVariants.includes(keyword)) {
        source = 'google_suggest'
      }

      // 确定优先级
      let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
      if (source === 'product_title') {
        priority = 'HIGH'
      } else if (volume >= 1000) {
        priority = 'HIGH'
      } else if (volume >= 500) {
        priority = 'MEDIUM'
      } else {
        priority = 'LOW'
      }

      return {
        keyword,
        source,
        searchVolume: volume,
        priority
      }
    })

    const filteredKeywords = keywordsWithVolume.filter(k => k.searchVolume >= minSearchVolume)
    console.log(`  ✓ 过滤后剩余${filteredKeywords.length}个关键字（搜索量>=${minSearchVolume}）`)

    // 排序
    filteredKeywords.sort((a, b) => {
      const priorityWeight = { HIGH: 3, MEDIUM: 2, LOW: 1 }
      const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority]
      if (priorityDiff !== 0) return priorityDiff
      return b.searchVolume - a.searchVolume
    })

    keywordsWithVolume = filteredKeywords
  } catch (error: any) {
    console.error('  ❌ 搜索量查询失败:', error.message)
    keywordsWithVolume = keywordCandidates.map(keyword => ({
      keyword,
      source: 'brand_variant' as const,
      searchVolume: 0,
      priority: 'MEDIUM' as const
    }))
  }

  // 3. 从多个热销商品生成15个广告标题
  console.log('\n📝 从TOP 5热销商品生成15个广告标题...')
  const productInfos: ProductInfo[] = topProducts.map(p => ({
    name: p.name,
    brand: brand,
    rating: p.rating,
    reviewCount: p.reviewCount
  }))
  const headlines = await generateHeadlinesFromMultipleProducts(productInfos, keywordsWithVolume.slice(0, 10), targetLanguage, userId)

  // 4. 从多个热销商品生成4个广告描述
  console.log('\n📝 从TOP 5热销商品生成4个广告描述...')
  const descriptions = await generateDescriptionsFromMultipleProducts(productInfos, targetLanguage, userId)

  return {
    keywords: keywordsWithVolume,
    headlines,
    descriptions,
    sources: {
      productCount: topProducts.length,
      keywordSources: {
        product_title: keywordsWithVolume.filter(k => k.source === 'product_title').length,
        google_suggest: keywordsWithVolume.filter(k => k.source === 'google_suggest').length,
        brand_variant: keywordsWithVolume.filter(k => k.source === 'brand_variant').length
      },
      topProducts: topProducts.map(p => ({
        name: p.name,
        rating: p.rating,
        reviewCount: p.reviewCount
      }))
    }
  }
}

/**
 * 生成语言特定的提示词（Headline生成）
 */
function getHeadlinePrompt(
  product: ProductInfo,
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string
): string {
  const languageInstructions = {
    'English': {
      intro: 'You are a professional Google Ads copywriter. Based on the following product information, generate 15 Google Search ad headlines.',
      productInfo: 'Product Information:',
      productName: 'Product Name',
      brand: 'Brand',
      unknown: 'Unknown',
      rating: 'Rating',
      reviews: 'reviews',
      aboutItem: 'About this item',
      features: 'Product Features',
      notProvided: 'Not provided',
      keywords: 'High-Volume Keywords:',
      searchVolume: 'Search Volume',
      requirements: 'Requirements:',
      req1: '1. Generate 15 headlines, each with a maximum of 30 characters (including spaces)',
      req2: '2. First 3 headlines must include brand name and core product name (e.g., "Teslong Inspection Camera")',
      req3: '3. Middle 5 headlines should incorporate high-volume keywords',
      req4: '4. Last 7 headlines should emphasize product features, benefits, promotions',
      req5: '5. Use high-intent purchase language (buy, shop, official, store, sale, discount, etc.)',
      req6: '6. Avoid using DKI dynamic insertion syntax',
      outputFormat: 'Output Format (JSON):',
      strictFormat: 'Please strictly follow JSON format and ensure 15 headlines.'
    },
    'German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den folgenden Produktinformationen generieren Sie 15 Google-Suchanzeigen-Überschriften.',
      productInfo: 'Produktinformationen:',
      productName: 'Produktname',
      brand: 'Marke',
      unknown: 'Unbekannt',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      aboutItem: 'Über diesen Artikel',
      features: 'Produktmerkmale',
      notProvided: 'Nicht angegeben',
      keywords: 'Hochvolumen-Keywords:',
      searchVolume: 'Suchvolumen',
      requirements: 'Anforderungen:',
      req1: '1. Generieren Sie 15 Überschriften mit jeweils maximal 30 Zeichen (einschließlich Leerzeichen)',
      req2: '2. Die ersten 3 Überschriften müssen Markennamen und Kernproduktname enthalten (z. B. "Teslong Inspection Camera")',
      req3: '3. Die mittleren 5 Überschriften sollten hochvolumige Keywords enthalten',
      req4: '4. Die letzten 7 Überschriften sollten Produktmerkmale, Vorteile und Aktionen hervorheben',
      req5: '5. Verwenden Sie kaufintensiven Wortschatz (kaufen, shop, offiziell, store, sale, rabatt usw.)',
      req6: '6. Vermeiden Sie die Verwendung von DKI-Dynamik-Syntax',
      outputFormat: 'Ausgabeformat (JSON):',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format und stellen Sie 15 Überschriften sicher.'
    },
    'Chinese': {
      intro: '你是专业的Google Ads文案专家。请基于以下商品信息，生成15个Google搜索广告标题（Headlines）。',
      productInfo: '商品信息：',
      productName: '商品名称',
      brand: '品牌',
      unknown: '未知',
      rating: '评分',
      reviews: '条评论',
      aboutItem: 'About this item',
      features: '商品特性',
      notProvided: '未提供',
      keywords: '高搜索量关键词：',
      searchVolume: '搜索量',
      requirements: '要求：',
      req1: '1. 生成15个标题，每个最多30个字符（包含空格）',
      req2: '2. 前3个标题必须包含品牌名和核心商品名（如"Teslong Inspection Camera"）',
      req3: '3. 中间5个标题融入高搜索量关键词',
      req4: '4. 后7个标题强调商品特性、优势、促销',
      req5: '5. 使用购买意图强烈的词汇（buy, shop, official, store, sale, discount等）',
      req6: '6. 避免使用DKI动态插入语法',
      outputFormat: '输出格式（JSON）：',
      strictFormat: '请严格遵循JSON格式输出，确保15个标题。'
    },
    'Japanese': {
      intro: 'あなたはプロのGoogle広告コピーライターです。以下の商品情報に基づいて、15個のGoogle検索広告の見出しを生成してください。',
      productInfo: '商品情報：',
      productName: '商品名',
      brand: 'ブランド',
      unknown: '不明',
      rating: '評価',
      reviews: 'レビュー',
      aboutItem: 'この商品について',
      features: '商品の特徴',
      notProvided: '提供されていません',
      keywords: '高検索ボリュームキーワード：',
      searchVolume: '検索ボリューム',
      requirements: '要件：',
      req1: '1. 15個の見出しを生成し、それぞれ最大30文字（スペースを含む）',
      req2: '2. 最初の3つの見出しにはブランド名と主要商品名を含める（例："Teslong Inspection Camera"）',
      req3: '3. 中間の5つの見出しには高検索ボリュームキーワードを組み込む',
      req4: '4. 最後の7つの見出しでは商品の特徴、メリット、プロモーションを強調',
      req5: '5. 購買意欲の高い言葉を使用（購入、ショップ、公式、ストア、セール、割引など）',
      req6: '6. DKI動的挿入構文の使用を避ける',
      outputFormat: '出力形式（JSON）：',
      strictFormat: 'JSON形式に厳密に従い、15個の見出しを確保してください。'
    },
    'Italian': {
      intro: 'Sei un copywriter professionista di Google Ads. In base alle seguenti informazioni sul prodotto, genera 15 titoli per gli annunci di ricerca di Google.',
      productInfo: 'Informazioni sul prodotto：',
      productName: 'Nome del prodotto',
      brand: 'Marca',
      unknown: 'Sconosciuto',
      rating: 'Valutazione',
      reviews: 'recensioni',
      aboutItem: 'Informazioni su questo articolo',
      features: 'Caratteristiche del prodotto',
      notProvided: 'Non fornito',
      keywords: 'Parole chiave ad alto volume：',
      searchVolume: 'Volume di ricerca',
      requirements: 'Requisiti：',
      req1: '1. Genera 15 titoli, ciascuno con un massimo di 30 caratteri (spazi inclusi)',
      req2: '2. I primi 3 titoli devono includere il nome del brand e il nome del prodotto principale (es. "Teslong Inspection Camera")',
      req3: '3. I 5 titoli centrali dovrebbero incorporare parole chiave ad alto volume',
      req4: '4. Gli ultimi 7 titoli dovrebbero enfatizzare caratteristiche del prodotto, vantaggi, promozioni',
      req5: '5. Utilizza un linguaggio ad alta intenzione d\'acquisto (acquista, negozio, ufficiale, store, saldi, sconto, ecc.)',
      req6: '6. Evita di utilizzare la sintassi di inserimento dinamico DKI',
      outputFormat: 'Formato di output (JSON)：',
      strictFormat: 'Si prega di seguire rigorosamente il formato JSON e assicurarsi di avere 15 titoli.'
    },
    'Korean': {
      intro: '당신은 전문 Google Ads 카피라이터입니다. 다음 제품 정보를 기반으로 15개의 Google 검색 광고 헤드라인을 생성하세요.',
      productInfo: '제품 정보：',
      productName: '제품명',
      brand: '브랜드',
      unknown: '알 수 없음',
      rating: '평점',
      reviews: '리뷰',
      aboutItem: '제품 설명',
      features: '제품 특징',
      notProvided: '제공되지 않음',
      keywords: '높은 검색량 키워드：',
      searchVolume: '검색량',
      requirements: '요구사항：',
      req1: '1. 15개의 헤드라인을 생성하고, 각각 최대 30자（공백 포함）',
      req2: '2. 처음 3개의 헤드라인에는 브랜드명과 핵심 제품명을 포함해야 합니다（예： "Teslong Inspection Camera"）',
      req3: '3. 중간 5개의 헤드라인에는 높은 검색량 키워드를 포함해야 합니다',
      req4: '4. 마지막 7개의 헤드라인은 제품 특징, 이점, 프로모션을 강조해야 합니다',
      req5: '5. 구매 의도가 높은 언어 사용（구매, 쇼핑, 공식, 스토어, 세일, 할인 등）',
      req6: '6. DKI 동적 삽입 구문 사용 피하기',
      outputFormat: '출력 형식（JSON）：',
      strictFormat: 'JSON 형식을 엄격히 따르고 15개의 헤드라인을 확보하세요.'
    },
    'French': {
      intro: 'Vous êtes un rédacteur professionnel Google Ads. En vous basant sur les informations produit suivantes, générez 15 titres d\'annonces de recherche Google.',
      productInfo: 'Informations sur le produit：',
      productName: 'Nom du produit',
      brand: 'Marque',
      unknown: 'Inconnu',
      rating: 'Note',
      reviews: 'avis',
      aboutItem: 'À propos de cet article',
      features: 'Caractéristiques du produit',
      notProvided: 'Non fourni',
      keywords: 'Mots-clés à fort volume：',
      searchVolume: 'Volume de recherche',
      requirements: 'Exigences：',
      req1: '1. Générez 15 titres, chacun avec un maximum de 30 caractères (espaces inclus)',
      req2: '2. Les 3 premiers titres doivent inclure le nom de la marque et le nom du produit principal (ex： "Teslong Inspection Camera")',
      req3: '3. Les 5 titres du milieu doivent incorporer des mots-clés à fort volume',
      req4: '4. Les 7 derniers titres doivent mettre en avant les caractéristiques, avantages et promotions du produit',
      req5: '5. Utilisez un langage à forte intention d\'achat (acheter, boutique, officiel, magasin, soldes, réduction, etc.)',
      req6: '6. Évitez d\'utiliser la syntaxe d\'insertion dynamique DKI',
      outputFormat: 'Format de sortie (JSON)：',
      strictFormat: 'Veuillez suivre strictement le format JSON et assurer 15 titres.'
    },
    'Swedish': {
      intro: 'Du är en professionell Google Ads-copywriter. Baserat på följande produktinformation, generera 15 Google sökannons-rubriker.',
      productInfo: 'Produktinformation：',
      productName: 'Produktnamn',
      brand: 'Varumärke',
      unknown: 'Okänd',
      rating: 'Betyg',
      reviews: 'recensioner',
      aboutItem: 'Om denna artikel',
      features: 'Produktegenskaper',
      notProvided: 'Ej tillhandahållet',
      keywords: 'Höga sökvolymer nyckelord：',
      searchVolume: 'Sökvolym',
      requirements: 'Krav：',
      req1: '1. Generera 15 rubriker, var och en med maximalt 30 tecken (inklusive mellanslag)',
      req2: '2. De första 3 rubrikerna måste innehålla varumärkesnamn och kärnproduktnamn (t.ex. "Teslong Inspection Camera")',
      req3: '3. De mittersta 5 rubrikerna bör inkorporera nyckelord med hög sökvolym',
      req4: '4. De sista 7 rubrikerna bör betona produktegenskaper, fördelar, kampanjer',
      req5: '5. Använd språk med hög köpintention (köp, butik, officiell, store, rea, rabatt, etc.)',
      req6: '6. Undvik att använda DKI dynamisk insättningssyntax',
      outputFormat: 'Utdataformat (JSON)：',
      strictFormat: 'Följ strikt JSON-formatet och säkerställ 15 rubriker.'
    },
    'Swiss German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den folgenden Produktinformationen generieren Sie 15 Google-Suchanzeigen-Überschriften.',
      productInfo: 'Produktinformationen：',
      productName: 'Produktname',
      brand: 'Marke',
      unknown: 'Unbekannt',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      aboutItem: 'Über diesen Artikel',
      features: 'Produktmerkmale',
      notProvided: 'Nicht angegeben',
      keywords: 'Hochvolumen-Keywords：',
      searchVolume: 'Suchvolumen',
      requirements: 'Anforderungen：',
      req1: '1. Generieren Sie 15 Überschriften mit jeweils maximal 30 Zeichen (einschließlich Leerzeichen)',
      req2: '2. Die ersten 3 Überschriften müssen Markennamen und Kernproduktname enthalten (z. B. "Teslong Inspection Camera")',
      req3: '3. Die mittleren 5 Überschriften sollten hochvolumige Keywords enthalten',
      req4: '4. Die letzten 7 Überschriften sollten Produktmerkmale, Vorteile und Aktionen hervorheben',
      req5: '5. Verwenden Sie kaufintensiven Wortschatz (kaufen, shop, offiziell, store, sale, rabatt usw.)',
      req6: '6. Vermeiden Sie die Verwendung von DKI-Dynamik-Syntax',
      outputFormat: 'Ausgabeformat (JSON)：',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format und stellen Sie 15 Überschriften sicher.'
    }
  }

  const lang = languageInstructions[targetLanguage as keyof typeof languageInstructions] || languageInstructions['English']

  return `${lang.intro}

**${lang.productInfo}**
- ${lang.productName}：${product.name}
- ${lang.brand}：${product.brand || lang.unknown}
- ${lang.rating}：${product.rating || 'N/A'} (${product.reviewCount || 'N/A'}${lang.reviews})
- ${lang.aboutItem}：${product.aboutThisItem?.slice(0, 5).join('; ') || lang.notProvided}
- ${lang.features}：${product.features?.slice(0, 5).join('; ') || lang.notProvided}

**${lang.keywords}**
${topKeywords.map(k => `- ${k.keyword} (${lang.searchVolume}: ${k.searchVolume})`).join('\n')}

**${lang.requirements}**
${lang.req1}
${lang.req2}
${lang.req3}
${lang.req4}
${lang.req5}
${lang.req6}

**${lang.outputFormat}**
{
  "headlines": ["headline1", "headline2", ..., "headline15"]
}

${lang.strictFormat}`
}

/**
 * 使用AI从单个商品生成15个广告标题
 */
async function generateHeadlines(
  product: ProductInfo,
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string,
  userId: number
): Promise<string[]> {
  const prompt = getHeadlinePrompt(product, topKeywords, targetLanguage)

  try {
    const response = await generateContent({ prompt }, userId)
    const parsed = extractJsonFromResponse(response)

    if (!parsed.headlines || !Array.isArray(parsed.headlines)) {
      throw new Error('AI响应格式错误：缺少headlines字段')
    }

    // 验证数量和长度
    const validHeadlines = parsed.headlines
      .filter((h: string) => h && h.length <= 30)
      .slice(0, 15)

    if (validHeadlines.length < 15) {
      console.warn(`  ⚠️ AI生成的标题不足15个，当前${validHeadlines.length}个`)
      // 补齐到15个（使用前面的标题变体）
      while (validHeadlines.length < 15) {
        const baseHeadline = validHeadlines[validHeadlines.length % validHeadlines.length]
        validHeadlines.push(baseHeadline)
      }
    }

    console.log(`  ✓ 成功生成${validHeadlines.length}个广告标题`)
    return validHeadlines
  } catch (error: any) {
    console.error('  ❌ AI生成标题失败:', error.message)
    // 降级方案：手动生成基础标题
    return generateFallbackHeadlines(product, topKeywords)
  }
}

/**
 * 生成语言特定的提示词（Headline生成 - 多商品店铺）
 */
function getMultipleProductHeadlinePrompt(
  products: ProductInfo[],
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string
): string {
  const languageInstructions = {
    'English': {
      intro: 'You are a professional Google Ads copywriter. Based on the following store\'s TOP 5 best-selling products, generate 15 Google Search ad headlines.',
      topProducts: 'TOP 5 Best-Selling Products:',
      rating: 'rating',
      reviews: 'reviews',
      brand: 'Brand',
      unknown: 'Unknown',
      keywords: 'High-Volume Keywords:',
      searchVolume: 'Search Volume',
      requirements: 'Requirements:',
      req1: '1. Generate 15 headlines, each with a maximum of 30 characters',
      req2: '2. First 5 headlines should be based on the 5 best-selling products (brand name + product name)',
      req3: '3. Middle 5 headlines should incorporate high-volume keywords',
      req4: '4. Last 5 headlines should emphasize store advantages (official store, best-sellers, quality guarantee, etc.)',
      req5: '5. Use high-intent purchase language',
      req6: '6. Avoid using DKI dynamic insertion syntax',
      outputFormat: 'Output Format (JSON):',
      strictFormat: 'Please strictly follow JSON format and ensure 15 headlines.'
    },
    'German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den TOP 5 Bestsellern des Shops generieren Sie 15 Google-Suchanzeigen-Überschriften.',
      topProducts: 'TOP 5 Bestseller:',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      brand: 'Marke',
      unknown: 'Unbekannt',
      keywords: 'Hochvolumen-Keywords:',
      searchVolume: 'Suchvolumen',
      requirements: 'Anforderungen:',
      req1: '1. Generieren Sie 15 Überschriften mit jeweils maximal 30 Zeichen',
      req2: '2. Die ersten 5 Überschriften sollten auf den 5 Bestsellern basieren (Markenname + Produktname)',
      req3: '3. Die mittleren 5 Überschriften sollten hochvolumige Keywords enthalten',
      req4: '4. Die letzten 5 Überschriften sollten Shop-Vorteile betonen (offizieller Shop, Bestseller, Qualitätsgarantie usw.)',
      req5: '5. Verwenden Sie kaufintensiven Wortschatz',
      req6: '6. Vermeiden Sie die Verwendung von DKI-Dynamik-Syntax',
      outputFormat: 'Ausgabeformat (JSON):',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format und stellen Sie 15 Überschriften sicher.'
    },
    'Chinese': {
      intro: '你是专业的Google Ads文案专家。请基于以下店铺的TOP 5热销商品，生成15个Google搜索广告标题（Headlines）。',
      topProducts: 'TOP 5热销商品：',
      rating: '评分',
      reviews: '评论',
      brand: '品牌',
      unknown: '未知',
      keywords: '高搜索量关键词：',
      searchVolume: '搜索量',
      requirements: '要求：',
      req1: '1. 生成15个标题，每个最多30个字符',
      req2: '2. 前5个标题分别基于5个热销商品（品牌名+商品名）',
      req3: '3. 中间5个标题融入高搜索量关键词',
      req4: '4. 后5个标题强调品牌店铺优势（官方旗舰店、热销爆品、品质保证等）',
      req5: '5. 使用购买意图强烈的词汇',
      req6: '6. 避免使用DKI动态插入语法',
      outputFormat: '输出格式（JSON）：',
      strictFormat: '请严格遵循JSON格式输出，确保15个标题。'
    },
    'Japanese': {
      intro: 'あなたはプロのGoogle広告コピーライターです。以下のストアのTOP 5ベストセラー商品に基づいて、15個のGoogle検索広告の見出しを生成してください。',
      topProducts: 'TOP 5ベストセラー商品：',
      rating: '評価',
      reviews: 'レビュー',
      brand: 'ブランド',
      unknown: '不明',
      keywords: '高検索ボリュームキーワード：',
      searchVolume: '検索ボリューム',
      requirements: '要件：',
      req1: '1. 15個の見出しを生成し、それぞれ最大30文字',
      req2: '2. 最初の5つの見出しは5つのベストセラー商品に基づく（ブランド名+商品名）',
      req3: '3. 中間の5つの見出しには高検索ボリュームキーワードを組み込む',
      req4: '4. 最後の5つの見出しではストアの利点を強調（公式ストア、ベストセラー、品質保証など）',
      req5: '5. 購買意欲の高い言葉を使用',
      req6: '6. DKI動的挿入構文の使用を避ける',
      outputFormat: '出力形式（JSON）：',
      strictFormat: 'JSON形式に厳密に従い、15個の見出しを確保してください。'
    },
    'Italian': {
      intro: 'Sei un copywriter professionista di Google Ads. In base ai TOP 5 prodotti più venduti del negozio, genera 15 titoli per gli annunci di ricerca di Google.',
      topProducts: 'TOP 5 Prodotti più venduti：',
      rating: 'Valutazione',
      reviews: 'recensioni',
      brand: 'Marca',
      unknown: 'Sconosciuto',
      keywords: 'Parole chiave ad alto volume：',
      searchVolume: 'Volume di ricerca',
      requirements: 'Requisiti：',
      req1: '1. Genera 15 titoli, ciascuno con un massimo di 30 caratteri',
      req2: '2. I primi 5 titoli dovrebbero essere basati sui 5 prodotti più venduti (nome del brand + nome del prodotto)',
      req3: '3. I 5 titoli centrali dovrebbero incorporare parole chiave ad alto volume',
      req4: '4. Gli ultimi 5 titoli dovrebbero enfatizzare i vantaggi del negozio (negozio ufficiale, best-seller, garanzia di qualità, ecc.)',
      req5: '5. Utilizza un linguaggio ad alta intenzione d\'acquisto',
      req6: '6. Evita di utilizzare la sintassi di inserimento dinamico DKI',
      outputFormat: 'Formato di output (JSON)：',
      strictFormat: 'Si prega di seguire rigorosamente il formato JSON e assicurarsi di avere 15 titoli.'
    },
    'Korean': {
      intro: '당신은 전문 Google Ads 카피라이터입니다. 다음 스토어의 TOP 5 베스트셀러 제품을 기반으로 15개의 Google 검색 광고 헤드라인을 생성하세요.',
      topProducts: 'TOP 5 베스트셀러 제품：',
      rating: '평점',
      reviews: '리뷰',
      brand: '브랜드',
      unknown: '알 수 없음',
      keywords: '높은 검색량 키워드：',
      searchVolume: '검색량',
      requirements: '요구사항：',
      req1: '1. 15개의 헤드라인을 생성하고, 각각 최대 30자',
      req2: '2. 처음 5개의 헤드라인은 5개의 베스트셀러 제품을 기반으로 해야 합니다（브랜드명 + 제품명）',
      req3: '3. 중간 5개의 헤드라인에는 높은 검색량 키워드를 포함해야 합니다',
      req4: '4. 마지막 5개의 헤드라인은 스토어 장점을 강조해야 합니다（공식 스토어, 베스트셀러, 품질 보증 등）',
      req5: '5. 구매 의도가 높은 언어 사용',
      req6: '6. DKI 동적 삽입 구문 사용 피하기',
      outputFormat: '출력 형식（JSON）：',
      strictFormat: 'JSON 형식을 엄격히 따르고 15개의 헤드라인을 확보하세요.'
    },
    'French': {
      intro: 'Vous êtes un rédacteur professionnel Google Ads. En vous basant sur les TOP 5 meilleures ventes du magasin, générez 15 titres d\'annonces de recherche Google.',
      topProducts: 'TOP 5 Meilleures ventes：',
      rating: 'Note',
      reviews: 'avis',
      brand: 'Marque',
      unknown: 'Inconnu',
      keywords: 'Mots-clés à fort volume：',
      searchVolume: 'Volume de recherche',
      requirements: 'Exigences：',
      req1: '1. Générez 15 titres, chacun avec un maximum de 30 caractères',
      req2: '2. Les 5 premiers titres doivent être basés sur les 5 meilleures ventes (nom de la marque + nom du produit)',
      req3: '3. Les 5 titres du milieu doivent incorporer des mots-clés à fort volume',
      req4: '4. Les 5 derniers titres doivent mettre en avant les avantages du magasin (magasin officiel, best-sellers, garantie de qualité, etc.)',
      req5: '5. Utilisez un langage à forte intention d\'achat',
      req6: '6. Évitez d\'utiliser la syntaxe d\'insertion dynamique DKI',
      outputFormat: 'Format de sortie (JSON)：',
      strictFormat: 'Veuillez suivre strictement le format JSON et assurer 15 titres.'
    },
    'Swedish': {
      intro: 'Du är en professionell Google Ads-copywriter. Baserat på butikens TOP 5 bästsäljare, generera 15 Google sökannons-rubriker.',
      topProducts: 'TOP 5 Bästsäljare：',
      rating: 'Betyg',
      reviews: 'recensioner',
      brand: 'Varumärke',
      unknown: 'Okänd',
      keywords: 'Höga sökvolymer nyckelord：',
      searchVolume: 'Sökvolym',
      requirements: 'Krav：',
      req1: '1. Generera 15 rubriker, var och en med maximalt 30 tecken',
      req2: '2. De första 5 rubrikerna bör baseras på de 5 bästsäljarna (varumärkesnamn + produktnamn)',
      req3: '3. De mittersta 5 rubrikerna bör inkorporera nyckelord med hög sökvolym',
      req4: '4. De sista 5 rubrikerna bör betona butiksfördelar (officiell butik, bästsäljare, kvalitetsgaranti, etc.)',
      req5: '5. Använd språk med hög köpintention',
      req6: '6. Undvik att använda DKI dynamisk insättningssyntax',
      outputFormat: 'Utdataformat (JSON)：',
      strictFormat: 'Följ strikt JSON-formatet och säkerställ 15 rubriker.'
    },
    'Swiss German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den TOP 5 Bestsellern des Shops generieren Sie 15 Google-Suchanzeigen-Überschriften.',
      topProducts: 'TOP 5 Bestseller：',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      brand: 'Marke',
      unknown: 'Unbekannt',
      keywords: 'Hochvolumen-Keywords：',
      searchVolume: 'Suchvolumen',
      requirements: 'Anforderungen：',
      req1: '1. Generieren Sie 15 Überschriften mit jeweils maximal 30 Zeichen',
      req2: '2. Die ersten 5 Überschriften sollten auf den 5 Bestsellern basieren (Markenname + Produktname)',
      req3: '3. Die mittleren 5 Überschriften sollten hochvolumige Keywords enthalten',
      req4: '4. Die letzten 5 Überschriften sollten Shop-Vorteile betonen (offizieller Shop, Bestseller, Qualitätsgarantie usw.)',
      req5: '5. Verwenden Sie kaufintensiven Wortschatz',
      req6: '6. Vermeiden Sie die Verwendung von DKI-Dynamik-Syntax',
      outputFormat: 'Ausgabeformat (JSON)：',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format und stellen Sie 15 Überschriften sicher.'
    }
  }

  const lang = languageInstructions[targetLanguage as keyof typeof languageInstructions] || languageInstructions['English']

  return `${lang.intro}

**${lang.topProducts}**
${products.map((p, i) => `${i + 1}. ${p.name} (${lang.rating}${p.rating}, ${p.reviewCount}${lang.reviews})`).join('\n')}

**${lang.brand}:** ${products[0]?.brand || lang.unknown}

**${lang.keywords}**
${topKeywords.map(k => `- ${k.keyword} (${lang.searchVolume}: ${k.searchVolume})`).join('\n')}

**${lang.requirements}**
${lang.req1}
${lang.req2}
${lang.req3}
${lang.req4}
${lang.req5}
${lang.req6}

**${lang.outputFormat}**
{
  "headlines": ["headline1", "headline2", ..., "headline15"]
}

${lang.strictFormat}`
}

/**
 * 使用AI从多个商品生成15个广告标题（店铺场景）
 */
async function generateHeadlinesFromMultipleProducts(
  products: ProductInfo[],
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  targetLanguage: string,
  userId: number
): Promise<string[]> {
  const prompt = getMultipleProductHeadlinePrompt(products, topKeywords, targetLanguage)

  try {
    const response = await generateContent({ prompt }, userId)
    const parsed = extractJsonFromResponse(response)
    const validHeadlines = parsed.headlines
      .filter((h: string) => h && h.length <= 30)
      .slice(0, 15)

    if (validHeadlines.length < 15) {
      console.warn(`  ⚠️ 标题不足，补齐到15个`)
      while (validHeadlines.length < 15) {
        validHeadlines.push(validHeadlines[validHeadlines.length % validHeadlines.length])
      }
    }

    console.log(`  ✓ 成功生成${validHeadlines.length}个广告标题`)
    return validHeadlines
  } catch (error: any) {
    console.error('  ❌ AI生成标题失败:', error.message)
    return generateFallbackHeadlinesFromMultiple(products, topKeywords)
  }
}

/**
 * 生成语言特定的提示词（Description生成 - 单商品）
 */
function getDescriptionPrompt(product: ProductInfo, targetLanguage: string): string {
  const languageInstructions = {
    'English': {
      intro: 'You are a professional Google Ads copywriter. Based on the following product information, generate 4 Google Search ad descriptions.',
      productInfo: 'Product Information:',
      productName: 'Product Name',
      brand: 'Brand',
      unknown: 'Unknown',
      rating: 'Rating',
      reviews: 'reviews',
      description: 'Product Description',
      aboutItem: 'About this item',
      features: 'Product Features',
      notProvided: 'Not provided',
      requirements: 'Requirements:',
      req1: '1. Generate 4 descriptions, each with a maximum of 90 characters (including spaces)',
      req2: '2. Description 1: Highlight core selling points and user value',
      req3: '3. Description 2: Emphasize product features and advantages',
      req4: '4. Description 3: Promotional information or social proof (high ratings, best-selling, etc.)',
      req5: '5. Description 4: Call to action (CTA) and purchase channel',
      req6: '6. Extract information from product description and features, express concisely',
      req7: '7. Use high-intent purchase language',
      outputFormat: 'Output Format (JSON):',
      strictFormat: 'Please strictly follow JSON format.'
    },
    'German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den folgenden Produktinformationen generieren Sie 4 Google-Suchanzeigen-Beschreibungen.',
      productInfo: 'Produktinformationen:',
      productName: 'Produktname',
      brand: 'Marke',
      unknown: 'Unbekannt',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      description: 'Produktbeschreibung',
      aboutItem: 'Über diesen Artikel',
      features: 'Produktmerkmale',
      notProvided: 'Nicht angegeben',
      requirements: 'Anforderungen:',
      req1: '1. Generieren Sie 4 Beschreibungen mit jeweils maximal 90 Zeichen (einschließlich Leerzeichen)',
      req2: '2. Beschreibung 1: Kernverkaufsargumente und Nutzerwert hervorheben',
      req3: '3. Beschreibung 2: Produktmerkmale und Vorteile betonen',
      req4: '4. Beschreibung 3: Aktionsinformationen oder Social Proof (hohe Bewertungen, Bestseller, etc.)',
      req5: '5. Beschreibung 4: Call-to-Action (CTA) und Kaufkanal',
      req6: '6. Informationen aus Produktbeschreibung und Merkmalen extrahieren, prägnant ausdrücken',
      req7: '7. Kaufintensive Sprache verwenden',
      outputFormat: 'Ausgabeformat (JSON):',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format.'
    },
    'Chinese': {
      intro: '你是专业的Google Ads文案专家。请基于以下商品信息，生成4个Google搜索广告描述（Descriptions）。',
      productInfo: '商品信息：',
      productName: '商品名称',
      brand: '品牌',
      unknown: '未知',
      rating: '评分',
      reviews: '条评论',
      description: '商品描述',
      aboutItem: 'About this item',
      features: '商品特性',
      notProvided: '未提供',
      requirements: '要求：',
      req1: '1. 生成4个描述，每个最多90个字符（包含空格）',
      req2: '2. 第1个描述：突出核心卖点和用户价值',
      req3: '3. 第2个描述：强调商品特性和优势',
      req4: '4. 第3个描述：促销信息或社会证明（高评分、畅销等）',
      req5: '5. 第4个描述：行动号召（CTA）和购买渠道',
      req6: '6. 从商品描述和特性中提取信息，精炼表达',
      req7: '7. 使用购买意图强烈的语言',
      outputFormat: '输出格式（JSON）：',
      strictFormat: '请严格遵循JSON格式输出。'
    },
    'Japanese': {
      intro: 'あなたはプロのGoogle広告コピーライターです。以下の商品情報に基づいて、4つのGoogle検索広告の説明文を生成してください。',
      productInfo: '商品情報：',
      productName: '商品名',
      brand: 'ブランド',
      unknown: '不明',
      rating: '評価',
      reviews: 'レビュー',
      description: '商品説明',
      aboutItem: 'この商品について',
      features: '商品の特徴',
      notProvided: '提供されていません',
      requirements: '要件：',
      req1: '1. 4つの説明文を生成し、それぞれ最大90文字（スペースを含む）',
      req2: '2. 説明文1：主要なセールスポイントとユーザー価値を強調',
      req3: '3. 説明文2：商品の特徴とメリットを強調',
      req4: '4. 説明文3：プロモーション情報または社会的証明（高評価、ベストセラーなど）',
      req5: '5. 説明文4：行動喚起（CTA）と購入チャネル',
      req6: '6. 商品説明と特徴から情報を抽出し、簡潔に表現',
      req7: '7. 購買意欲の高い言葉を使用',
      outputFormat: '出力形式（JSON）：',
      strictFormat: 'JSON形式に厳密に従ってください。'
    },
    'Italian': {
      intro: 'Sei un copywriter professionista di Google Ads. In base alle seguenti informazioni sul prodotto, genera 4 descrizioni per gli annunci di ricerca di Google.',
      productInfo: 'Informazioni sul prodotto：',
      productName: 'Nome del prodotto',
      brand: 'Marca',
      unknown: 'Sconosciuto',
      rating: 'Valutazione',
      reviews: 'recensioni',
      description: 'Descrizione del prodotto',
      aboutItem: 'Informazioni su questo articolo',
      features: 'Caratteristiche del prodotto',
      notProvided: 'Non fornito',
      requirements: 'Requisiti：',
      req1: '1. Genera 4 descrizioni, ciascuna con un massimo di 90 caratteri (spazi inclusi)',
      req2: '2. Descrizione 1: Evidenzia i punti di vendita principali e il valore per l\'utente',
      req3: '3. Descrizione 2: Enfatizza le caratteristiche e i vantaggi del prodotto',
      req4: '4. Descrizione 3: Informazioni promozionali o prova sociale (valutazioni elevate, più venduto, ecc.)',
      req5: '5. Descrizione 4: Chiamata all\'azione (CTA) e canale di acquisto',
      req6: '6. Estrai informazioni dalla descrizione e dalle caratteristiche del prodotto, esprimi in modo conciso',
      req7: '7. Utilizza un linguaggio ad alta intenzione d\'acquisto',
      outputFormat: 'Formato di output (JSON)：',
      strictFormat: 'Si prega di seguire rigorosamente il formato JSON.'
    },
    'Korean': {
      intro: '당신은 전문 Google Ads 카피라이터입니다. 다음 제품 정보를 기반으로 4개의 Google 검색 광고 설명을 생성하세요.',
      productInfo: '제품 정보：',
      productName: '제품명',
      brand: '브랜드',
      unknown: '알 수 없음',
      rating: '평점',
      reviews: '리뷰',
      description: '제품 설명',
      aboutItem: '제품 설명',
      features: '제품 특징',
      notProvided: '제공되지 않음',
      requirements: '요구사항：',
      req1: '1. 4개의 설명을 생성하고, 각각 최대 90자（공백 포함）',
      req2: '2. 설명 1: 핵심 판매 포인트와 사용자 가치를 강조',
      req3: '3. 설명 2: 제품 특징과 장점을 강조',
      req4: '4. 설명 3: 프로모션 정보 또는 사회적 증거（높은 평점, 베스트셀러 등）',
      req5: '5. 설명 4: 행동 유도（CTA）와 구매 채널',
      req6: '6. 제품 설명과 특징에서 정보를 추출하여 간결하게 표현',
      req7: '7. 구매 의도가 높은 언어 사용',
      outputFormat: '출력 형식（JSON）：',
      strictFormat: 'JSON 형식을 엄격히 따르세요.'
    },
    'French': {
      intro: 'Vous êtes un rédacteur professionnel Google Ads. En vous basant sur les informations produit suivantes, générez 4 descriptions d\'annonces de recherche Google.',
      productInfo: 'Informations sur le produit：',
      productName: 'Nom du produit',
      brand: 'Marque',
      unknown: 'Inconnu',
      rating: 'Note',
      reviews: 'avis',
      description: 'Description du produit',
      aboutItem: 'À propos de cet article',
      features: 'Caractéristiques du produit',
      notProvided: 'Non fourni',
      requirements: 'Exigences：',
      req1: '1. Générez 4 descriptions, chacune avec un maximum de 90 caractères (espaces inclus)',
      req2: '2. Description 1: Mettez en avant les arguments de vente principaux et la valeur pour l\'utilisateur',
      req3: '3. Description 2: Soulignez les caractéristiques et avantages du produit',
      req4: '4. Description 3: Informations promotionnelles ou preuve sociale (notes élevées, best-seller, etc.)',
      req5: '5. Description 4: Appel à l\'action (CTA) et canal d\'achat',
      req6: '6. Extrayez des informations de la description et des caractéristiques du produit, exprimez de manière concise',
      req7: '7. Utilisez un langage à forte intention d\'achat',
      outputFormat: 'Format de sortie (JSON)：',
      strictFormat: 'Veuillez suivre strictement le format JSON.'
    },
    'Swedish': {
      intro: 'Du är en professionell Google Ads-copywriter. Baserat på följande produktinformation, generera 4 Google sökannons-beskrivningar.',
      productInfo: 'Produktinformation：',
      productName: 'Produktnamn',
      brand: 'Varumärke',
      unknown: 'Okänd',
      rating: 'Betyg',
      reviews: 'recensioner',
      description: 'Produktbeskrivning',
      aboutItem: 'Om denna artikel',
      features: 'Produktegenskaper',
      notProvided: 'Ej tillhandahållet',
      requirements: 'Krav：',
      req1: '1. Generera 4 beskrivningar, var och en med maximalt 90 tecken (inklusive mellanslag)',
      req2: '2. Beskrivning 1: Lyft fram huvudsakliga försäljningsargument och användarvärde',
      req3: '3. Beskrivning 2: Betona produktegenskaper och fördelar',
      req4: '4. Beskrivning 3: Kampanjinformation eller socialt bevis (höga betyg, bästsäljare, etc.)',
      req5: '5. Beskrivning 4: Uppmaning till handling (CTA) och köpkanal',
      req6: '6. Extrahera information från produktbeskrivning och egenskaper, uttryck koncist',
      req7: '7. Använd språk med hög köpintention',
      outputFormat: 'Utdataformat (JSON)：',
      strictFormat: 'Följ strikt JSON-formatet.'
    },
    'Swiss German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den folgenden Produktinformationen generieren Sie 4 Google-Suchanzeigen-Beschreibungen.',
      productInfo: 'Produktinformationen：',
      productName: 'Produktname',
      brand: 'Marke',
      unknown: 'Unbekannt',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      description: 'Produktbeschreibung',
      aboutItem: 'Über diesen Artikel',
      features: 'Produktmerkmale',
      notProvided: 'Nicht angegeben',
      requirements: 'Anforderungen：',
      req1: '1. Generieren Sie 4 Beschreibungen mit jeweils maximal 90 Zeichen (einschließlich Leerzeichen)',
      req2: '2. Beschreibung 1: Kernverkaufsargumente und Nutzerwert hervorheben',
      req3: '3. Beschreibung 2: Produktmerkmale und Vorteile betonen',
      req4: '4. Beschreibung 3: Aktionsinformationen oder Social Proof (hohe Bewertungen, Bestseller, etc.)',
      req5: '5. Beschreibung 4: Call-to-Action (CTA) und Kaufkanal',
      req6: '6. Informationen aus Produktbeschreibung und Merkmalen extrahieren, prägnant ausdrücken',
      req7: '7. Kaufintensive Sprache verwenden',
      outputFormat: 'Ausgabeformat (JSON)：',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format.'
    }
  }

  const lang = languageInstructions[targetLanguage as keyof typeof languageInstructions] || languageInstructions['English']

  return `${lang.intro}

**${lang.productInfo}**
- ${lang.productName}：${product.name}
- ${lang.brand}：${product.brand || lang.unknown}
- ${lang.rating}：${product.rating || 'N/A'} (${product.reviewCount || 'N/A'}${lang.reviews})
- ${lang.description}：${product.description?.slice(0, 500) || lang.notProvided}
- ${lang.aboutItem}：${product.aboutThisItem?.slice(0, 10).join('; ') || lang.notProvided}
- ${lang.features}：${product.features?.slice(0, 10).join('; ') || lang.notProvided}

**${lang.requirements}**
${lang.req1}
${lang.req2}
${lang.req3}
${lang.req4}
${lang.req5}
${lang.req6}
${lang.req7}

**${lang.outputFormat}**
{
  "descriptions": ["description1", "description2", "description3", "description4"]
}

${lang.strictFormat}`
}

/**
 * 使用AI从单个商品生成4个广告描述
 */
async function generateDescriptions(
  product: ProductInfo,
  targetLanguage: string,
  userId: number
): Promise<string[]> {
  const prompt = getDescriptionPrompt(product, targetLanguage)

  try {
    const response = await generateContent({ prompt }, userId)
    const parsed = extractJsonFromResponse(response)
    const validDescriptions = parsed.descriptions
      .filter((d: string) => d && d.length <= 90)
      .slice(0, 4)

    if (validDescriptions.length < 4) {
      console.warn(`  ⚠️ 描述不足4个，补齐`)
      while (validDescriptions.length < 4) {
        validDescriptions.push(validDescriptions[validDescriptions.length % validDescriptions.length])
      }
    }

    console.log(`  ✓ 成功生成${validDescriptions.length}个广告描述`)
    return validDescriptions
  } catch (error: any) {
    console.error('  ❌ AI生成描述失败:', error.message)
    return generateFallbackDescriptions(product)
  }
}

/**
 * 生成语言特定的提示词（Description生成 - 多商品店铺）
 */
function getMultipleProductDescriptionPrompt(products: ProductInfo[], targetLanguage: string): string {
  const languageInstructions = {
    'English': {
      intro: 'You are a professional Google Ads copywriter. Based on the following store\'s TOP 5 best-selling products, generate 4 Google Search ad descriptions.',
      topProducts: 'TOP 5 Best-Selling Products:',
      rating: 'rating',
      reviews: 'reviews',
      brand: 'Brand',
      unknown: 'Unknown',
      requirements: 'Requirements:',
      req1: '1. Generate 4 descriptions, each with a maximum of 90 characters',
      req2: '2. Description 1: Highlight brand store advantages and best-sellers',
      req3: '3. Description 2: Emphasize diversified product line and quality assurance',
      req4: '4. Description 3: Social proof (high ratings, many positive reviews, official flagship store)',
      req5: '5. Description 4: Promotional information and call to action',
      req6: '6. Express concisely, highlight purchase value',
      outputFormat: 'Output Format (JSON):',
      strictFormat: 'Please strictly follow JSON format.'
    },
    'German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den TOP 5 Bestsellern des Shops generieren Sie 4 Google-Suchanzeigen-Beschreibungen.',
      topProducts: 'TOP 5 Bestseller:',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      brand: 'Marke',
      unknown: 'Unbekannt',
      requirements: 'Anforderungen:',
      req1: '1. Generieren Sie 4 Beschreibungen mit jeweils maximal 90 Zeichen',
      req2: '2. Beschreibung 1: Shop-Vorteile und Bestseller hervorheben',
      req3: '3. Beschreibung 2: Vielfältige Produktpalette und Qualitätsgarantie betonen',
      req4: '4. Beschreibung 3: Social Proof (hohe Bewertungen, viele positive Bewertungen, offizieller Flagship-Shop)',
      req5: '5. Beschreibung 4: Aktionsinformationen und Call-to-Action',
      req6: '6. Prägnant ausdrücken, Kaufwert hervorheben',
      outputFormat: 'Ausgabeformat (JSON):',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format.'
    },
    'Chinese': {
      intro: '你是专业的Google Ads文案专家。请基于以下店铺的TOP 5热销商品，生成4个Google搜索广告描述（Descriptions）。',
      topProducts: 'TOP 5热销商品：',
      rating: '评分',
      reviews: '评论',
      brand: '品牌',
      unknown: '未知',
      requirements: '要求：',
      req1: '1. 生成4个描述，每个最多90个字符',
      req2: '2. 第1个描述：突出品牌店铺优势和热销爆品',
      req3: '3. 第2个描述：强调多样化产品线和品质保证',
      req4: '4. 第3个描述：社会证明（高评分、大量好评、官方旗舰店）',
      req5: '5. 第4个描述：促销信息和行动号召',
      req6: '6. 精炼表达，突出购买价值',
      outputFormat: '输出格式（JSON）：',
      strictFormat: '请严格遵循JSON格式输出。'
    },
    'Japanese': {
      intro: 'あなたはプロのGoogle広告コピーライターです。以下のストアのTOP 5ベストセラー商品に基づいて、4つのGoogle検索広告の説明文を生成してください。',
      topProducts: 'TOP 5ベストセラー商品：',
      rating: '評価',
      reviews: 'レビュー',
      brand: 'ブランド',
      unknown: '不明',
      requirements: '要件：',
      req1: '1. 4つの説明文を生成し、それぞれ最大90文字',
      req2: '2. 説明文1：ブランドストアの利点とベストセラーを強調',
      req3: '3. 説明文2：多様な製品ラインと品質保証を強調',
      req4: '4. 説明文3：社会的証明（高評価、多数の肯定的なレビュー、公式旗艦店）',
      req5: '5. 説明文4：プロモーション情報と行動喚起',
      req6: '6. 簡潔に表現し、購入価値を強調',
      outputFormat: '出力形式（JSON）：',
      strictFormat: 'JSON形式に厳密に従ってください。'
    },
    'Italian': {
      intro: 'Sei un copywriter professionista di Google Ads. In base ai TOP 5 prodotti più venduti del negozio, genera 4 descrizioni per gli annunci di ricerca di Google.',
      topProducts: 'TOP 5 Prodotti più venduti：',
      rating: 'Valutazione',
      reviews: 'recensioni',
      brand: 'Marca',
      unknown: 'Sconosciuto',
      requirements: 'Requisiti：',
      req1: '1. Genera 4 descrizioni, ciascuna con un massimo di 90 caratteri',
      req2: '2. Descrizione 1: Evidenzia i vantaggi del negozio di marca e i best-seller',
      req3: '3. Descrizione 2: Enfatizza la linea di prodotti diversificata e la garanzia di qualità',
      req4: '4. Descrizione 3: Prova sociale (valutazioni elevate, molte recensioni positive, negozio ufficiale)',
      req5: '5. Descrizione 4: Informazioni promozionali e chiamata all\'azione',
      req6: '6. Esprimi in modo conciso, evidenzia il valore d\'acquisto',
      outputFormat: 'Formato di output (JSON)：',
      strictFormat: 'Si prega di seguire rigorosamente il formato JSON.'
    },
    'Korean': {
      intro: '당신은 전문 Google Ads 카피라이터입니다. 다음 스토어의 TOP 5 베스트셀러 제품을 기반으로 4개의 Google 검색 광고 설명을 생성하세요.',
      topProducts: 'TOP 5 베스트셀러 제품：',
      rating: '평점',
      reviews: '리뷰',
      brand: '브랜드',
      unknown: '알 수 없음',
      requirements: '요구사항：',
      req1: '1. 4개의 설명을 생성하고, 각각 최대 90자',
      req2: '2. 설명 1: 브랜드 스토어 장점과 베스트셀러 강조',
      req3: '3. 설명 2: 다양한 제품 라인과 품질 보증 강조',
      req4: '4. 설명 3: 사회적 증거（높은 평점, 많은 긍정적 리뷰, 공식 플래그십 스토어）',
      req5: '5. 설명 4: 프로모션 정보와 행동 유도',
      req6: '6. 간결하게 표현하고 구매 가치 강조',
      outputFormat: '출력 형식（JSON）：',
      strictFormat: 'JSON 형식을 엄격히 따르세요.'
    },
    'French': {
      intro: 'Vous êtes un rédacteur professionnel Google Ads. En vous basant sur les TOP 5 meilleures ventes du magasin, générez 4 descriptions d\'annonces de recherche Google.',
      topProducts: 'TOP 5 Meilleures ventes：',
      rating: 'Note',
      reviews: 'avis',
      brand: 'Marque',
      unknown: 'Inconnu',
      requirements: 'Exigences：',
      req1: '1. Générez 4 descriptions, chacune avec un maximum de 90 caractères',
      req2: '2. Description 1: Mettez en avant les avantages du magasin de marque et les meilleures ventes',
      req3: '3. Description 2: Soulignez la gamme de produits diversifiée et la garantie de qualité',
      req4: '4. Description 3: Preuve sociale (notes élevées, nombreux avis positifs, magasin officiel)',
      req5: '5. Description 4: Informations promotionnelles et appel à l\'action',
      req6: '6. Exprimez de manière concise, mettez en valeur la valeur d\'achat',
      outputFormat: 'Format de sortie (JSON)：',
      strictFormat: 'Veuillez suivre strictement le format JSON.'
    },
    'Swedish': {
      intro: 'Du är en professionell Google Ads-copywriter. Baserat på butikens TOP 5 bästsäljare, generera 4 Google sökannons-beskrivningar.',
      topProducts: 'TOP 5 Bästsäljare：',
      rating: 'Betyg',
      reviews: 'recensioner',
      brand: 'Varumärke',
      unknown: 'Okänd',
      requirements: 'Krav：',
      req1: '1. Generera 4 beskrivningar, var och en med maximalt 90 tecken',
      req2: '2. Beskrivning 1: Lyft fram varumärkesbutiksfördelar och bästsäljare',
      req3: '3. Beskrivning 2: Betona diversifierad produktlinje och kvalitetsgaranti',
      req4: '4. Beskrivning 3: Socialt bevis (höga betyg, många positiva recensioner, officiell flaggskeppsbutik)',
      req5: '5. Beskrivning 4: Kampanjinformation och uppmaning till handling',
      req6: '6. Uttryck koncist, framhäv köpvärde',
      outputFormat: 'Utdataformat (JSON)：',
      strictFormat: 'Följ strikt JSON-formatet.'
    },
    'Swiss German': {
      intro: 'Sie sind ein professioneller Google Ads-Texter. Basierend auf den TOP 5 Bestsellern des Shops generieren Sie 4 Google-Suchanzeigen-Beschreibungen.',
      topProducts: 'TOP 5 Bestseller：',
      rating: 'Bewertung',
      reviews: 'Bewertungen',
      brand: 'Marke',
      unknown: 'Unbekannt',
      requirements: 'Anforderungen：',
      req1: '1. Generieren Sie 4 Beschreibungen mit jeweils maximal 90 Zeichen',
      req2: '2. Beschreibung 1: Shop-Vorteile und Bestseller hervorheben',
      req3: '3. Beschreibung 2: Vielfältige Produktpalette und Qualitätsgarantie betonen',
      req4: '4. Beschreibung 3: Social Proof (hohe Bewertungen, viele positive Bewertungen, offizieller Flagship-Shop)',
      req5: '5. Beschreibung 4: Aktionsinformationen und Call-to-Action',
      req6: '6. Prägnant ausdrücken, Kaufwert hervorheben',
      outputFormat: 'Ausgabeformat (JSON)：',
      strictFormat: 'Bitte halten Sie sich strikt an das JSON-Format.'
    }
  }

  const lang = languageInstructions[targetLanguage as keyof typeof languageInstructions] || languageInstructions['English']

  return `${lang.intro}

**${lang.topProducts}**
${products.map((p, i) => `${i + 1}. ${p.name} (${lang.rating}${p.rating}, ${p.reviewCount}${lang.reviews})`).join('\n')}

**${lang.brand}:** ${products[0]?.brand || lang.unknown}

**${lang.requirements}**
${lang.req1}
${lang.req2}
${lang.req3}
${lang.req4}
${lang.req5}
${lang.req6}

**${lang.outputFormat}**
{
  "descriptions": ["description1", "description2", "description3", "description4"]
}

${lang.strictFormat}`
}

/**
 * 使用AI从多个商品生成4个广告描述（店铺场景）
 */
async function generateDescriptionsFromMultipleProducts(
  products: ProductInfo[],
  targetLanguage: string,
  userId: number
): Promise<string[]> {
  const prompt = getMultipleProductDescriptionPrompt(products, targetLanguage)

  try {
    const response = await generateContent({ prompt }, userId)
    const parsed = extractJsonFromResponse(response)
    const validDescriptions = parsed.descriptions
      .filter((d: string) => d && d.length <= 90)
      .slice(0, 4)

    if (validDescriptions.length < 4) {
      while (validDescriptions.length < 4) {
        validDescriptions.push(validDescriptions[validDescriptions.length % validDescriptions.length])
      }
    }

    console.log(`  ✓ 成功生成${validDescriptions.length}个广告描述`)
    return validDescriptions
  } catch (error: any) {
    console.error('  ❌ AI生成描述失败:', error.message)
    return generateFallbackDescriptionsFromMultiple(products)
  }
}

/**
 * 降级方案：手动生成基础标题（单商品）
 */
function generateFallbackHeadlines(
  product: ProductInfo,
  topKeywords: Array<{ keyword: string }>
): string[] {
  const brand = product.brand || 'Brand'
  const productName = product.name || 'Product'
  const brandProductName = extractBrandProductName(productName, brand)

  const headlines = [
    brandProductName.slice(0, 30),
    `Buy ${brandProductName}`.slice(0, 30),
    `${brand} Official Store`.slice(0, 30),
    `Shop ${brand} Now`.slice(0, 30),
    `${brand} Best Price`.slice(0, 30),
    ...topKeywords.slice(0, 5).map(k => k.keyword.slice(0, 30)),
    `${brand} Sale`.slice(0, 30),
    `Free Shipping ${brand}`.slice(0, 30),
    `${brand} Discount`.slice(0, 30),
    `Top Rated ${brand}`.slice(0, 30),
    `${brand} Amazon`.slice(0, 30)
  ]

  return headlines.slice(0, 15)
}

/**
 * 降级方案：手动生成基础标题（多商品）
 */
function generateFallbackHeadlinesFromMultiple(
  products: ProductInfo[],
  topKeywords: Array<{ keyword: string }>
): string[] {
  const brand = products[0]?.brand || 'Brand'

  const headlines = [
    ...products.slice(0, 5).map(p => extractBrandProductName(p.name, brand).slice(0, 30)),
    `${brand} Official Store`.slice(0, 30),
    `Shop ${brand} Products`.slice(0, 30),
    ...topKeywords.slice(0, 3).map(k => k.keyword.slice(0, 30)),
    `${brand} Best Sellers`.slice(0, 30),
    `Buy ${brand} Online`.slice(0, 30),
    `${brand} Sale`.slice(0, 30),
    `Top Rated ${brand}`.slice(0, 30),
    `${brand} Amazon Store`.slice(0, 30)
  ]

  return headlines.slice(0, 15)
}

/**
 * 降级方案：手动生成基础描述（单商品）
 */
function generateFallbackDescriptions(product: ProductInfo): string[] {
  const brand = product.brand || 'Brand'
  // 优先使用 aboutThisItem (Amazon "About this item")，其次使用 features
  const featureSource = product.aboutThisItem?.length ? product.aboutThisItem : product.features
  const features = featureSource?.slice(0, 3).join(', ') || 'high quality features'

  return [
    `Shop ${brand} with ${features}. Official store guaranteed quality.`.slice(0, 90),
    `Buy ${brand} products online. Free shipping on qualified orders.`.slice(0, 90),
    `Top rated ${brand} with ${product.reviewCount || 'thousands of'} reviews. Trusted by customers.`.slice(0, 90),
    `Get ${brand} today. Limited time offer. Shop now on Amazon.`.slice(0, 90)
  ]
}

/**
 * 降级方案：手动生成基础描述（多商品）
 */
function generateFallbackDescriptionsFromMultiple(products: ProductInfo[]): string[] {
  const brand = products[0]?.brand || 'Brand'

  return [
    `${brand} official store with ${products.length} top-rated products. Shop bestsellers now.`.slice(0, 90),
    `Buy ${brand} products online. Premium quality guaranteed. Free shipping available.`.slice(0, 90),
    `Highly rated ${brand} store with thousands of satisfied customers. Trusted brand.`.slice(0, 90),
    `Shop ${brand} today. Limited time deals on top products. Amazon exclusive offers.`.slice(0, 90)
  ]
}

/**
 * 主入口：提取广告元素
 *
 * @param scraped - 爬虫数据（单商品或店铺）
 * @param brand - 品牌名称
 * @param targetCountry - 目标国家
 * @param targetLanguage - 目标语言
 * @param userId - 用户ID
 */
export async function extractAdElements(
  scraped: {
    pageType: 'product' | 'store' | 'unknown'
    product?: AmazonProductData
    storeProducts?: StoreProduct[]
  },
  brand: string,
  targetCountry: string,
  targetLanguage: string,
  userId: number
): Promise<ExtractedAdElements> {
  console.log('\n🎯 开始提取广告关键元素...')
  console.log(`  - 场景类型: ${scraped.pageType}`)
  console.log(`  - 品牌: ${brand}`)
  console.log(`  - 目标国家: ${targetCountry}`)
  console.log(`  - 目标语言: ${targetLanguage}`)

  if (scraped.pageType === 'product' && scraped.product) {
    return await extractFromSingleProduct(
      scraped.product,
      brand,
      targetCountry,
      targetLanguage,
      userId
    )
  } else if (scraped.pageType === 'store' && scraped.storeProducts && scraped.storeProducts.length > 0) {
    return await extractFromStore(
      scraped.storeProducts,
      brand,
      targetCountry,
      targetLanguage,
      userId
    )
  } else {
    throw new Error(`无法提取广告元素：pageType=${scraped.pageType}, 商品数据=${scraped.product ? '有' : '无'}, 店铺商品=${scraped.storeProducts?.length || 0}个`)
  }
}
