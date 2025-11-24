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
import type { AmazonProductData, StoreProduct } from './scraper-stealth'

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

  // 1.3 获取Google搜索下拉词（高购买意图）
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
  const minSearchVolume = 500 // 最小搜索量阈值

  let keywordsWithVolume: Array<{
    keyword: string
    source: 'product_title' | 'google_suggest' | 'brand_variant'
    searchVolume: number
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
  }> = []

  try {
    const volumeData = await getKeywordSearchVolumes({
      keywords: keywordCandidates,
      targetCountry,
      targetLanguage,
      userId
    })

    keywordsWithVolume = keywordCandidates.map((keyword, index) => {
      const volume = volumeData[index]?.searchVolume || 0

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
  const headlines = await generateHeadlines(productInfo, keywordsWithVolume.slice(0, 10), userId)

  // 4. 使用AI生成4个广告描述
  console.log('\n📝 生成4个广告描述...')
  const descriptions = await generateDescriptions(productInfo, userId)

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
    const volumeData = await getKeywordSearchVolumes({
      keywords: keywordCandidates,
      targetCountry,
      targetLanguage,
      userId
    })

    keywordsWithVolume = keywordCandidates.map((keyword, index) => {
      const volume = volumeData[index]?.searchVolume || 0

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
  const headlines = await generateHeadlinesFromMultipleProducts(productInfos, keywordsWithVolume.slice(0, 10), userId)

  // 4. 从多个热销商品生成4个广告描述
  console.log('\n📝 从TOP 5热销商品生成4个广告描述...')
  const descriptions = await generateDescriptionsFromMultipleProducts(productInfos, userId)

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
 * 使用AI从单个商品生成15个广告标题
 */
async function generateHeadlines(
  product: ProductInfo,
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  userId: number
): Promise<string[]> {
  const prompt = `你是专业的Google Ads文案专家。请基于以下商品信息，生成15个Google搜索广告标题（Headlines）。

**商品信息：**
- 商品名称：${product.name}
- 品牌：${product.brand || '未知'}
- 评分：${product.rating || 'N/A'} (${product.reviewCount || 'N/A'}条评论)
- 商品特性：${product.features?.slice(0, 5).join('; ') || '未提供'}

**高搜索量关键词：**
${topKeywords.map(k => `- ${k.keyword} (搜索量: ${k.searchVolume})`).join('\n')}

**要求：**
1. 生成15个标题，每个最多30个字符（包含空格）
2. 前3个标题必须包含品牌名和核心商品名（如"Teslong Inspection Camera"）
3. 中间5个标题融入高搜索量关键词
4. 后7个标题强调商品特性、优势、促销
5. 使用购买意图强烈的词汇（buy, shop, official, store, sale, discount等）
6. 避免使用DKI动态插入语法

**输出格式（JSON）：**
{
  "headlines": ["标题1", "标题2", ..., "标题15"]
}

请严格遵循JSON格式输出，确保15个标题。`

  try {
    const response = await generateContent(prompt, userId)
    const jsonMatch = response.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('AI响应格式错误：未找到JSON')
    }

    const parsed = JSON.parse(jsonMatch[0])

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
 * 使用AI从多个商品生成15个广告标题（店铺场景）
 */
async function generateHeadlinesFromMultipleProducts(
  products: ProductInfo[],
  topKeywords: Array<{ keyword: string; searchVolume: number }>,
  userId: number
): Promise<string[]> {
  const prompt = `你是专业的Google Ads文案专家。请基于以下店铺的TOP 5热销商品，生成15个Google搜索广告标题（Headlines）。

**TOP 5热销商品：**
${products.map((p, i) => `${i + 1}. ${p.name} (评分${p.rating}, ${p.reviewCount}评论)`).join('\n')}

**品牌：** ${products[0]?.brand || '未知'}

**高搜索量关键词：**
${topKeywords.map(k => `- ${k.keyword} (搜索量: ${k.searchVolume})`).join('\n')}

**要求：**
1. 生成15个标题，每个最多30个字符
2. 前5个标题分别基于5个热销商品（品牌名+商品名）
3. 中间5个标题融入高搜索量关键词
4. 后5个标题强调品牌店铺优势（官方旗舰店、热销爆品、品质保证等）
5. 使用购买意图强烈的词汇
6. 避免使用DKI动态插入语法

**输出格式（JSON）：**
{
  "headlines": ["标题1", "标题2", ..., "标题15"]
}

请严格遵循JSON格式输出。`

  try {
    const response = await generateContent(prompt, userId)
    const jsonMatch = response.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('AI响应格式错误')
    }

    const parsed = JSON.parse(jsonMatch[0])
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
 * 使用AI从单个商品生成4个广告描述
 */
async function generateDescriptions(
  product: ProductInfo,
  userId: number
): Promise<string[]> {
  const prompt = `你是专业的Google Ads文案专家。请基于以下商品信息，生成4个Google搜索广告描述（Descriptions）。

**商品信息：**
- 商品名称：${product.name}
- 品牌：${product.brand || '未知'}
- 评分：${product.rating || 'N/A'} (${product.reviewCount || 'N/A'}条评论)
- 商品描述：${product.description?.slice(0, 500) || '未提供'}
- 商品特性：${product.features?.slice(0, 10).join('; ') || '未提供'}

**要求：**
1. 生成4个描述，每个最多90个字符（包含空格）
2. 第1个描述：突出核心卖点和用户价值
3. 第2个描述：强调商品特性和优势
4. 第3个描述：促销信息或社会证明（高评分、畅销等）
5. 第4个描述：行动号召（CTA）和购买渠道
6. 从商品描述和特性中提取信息，精炼表达
7. 使用购买意图强烈的语言

**输出格式（JSON）：**
{
  "descriptions": ["描述1", "描述2", "描述3", "描述4"]
}

请严格遵循JSON格式输出。`

  try {
    const response = await generateContent(prompt, userId)
    const jsonMatch = response.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('AI响应格式错误')
    }

    const parsed = JSON.parse(jsonMatch[0])
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
 * 使用AI从多个商品生成4个广告描述（店铺场景）
 */
async function generateDescriptionsFromMultipleProducts(
  products: ProductInfo[],
  userId: number
): Promise<string[]> {
  const prompt = `你是专业的Google Ads文案专家。请基于以下店铺的TOP 5热销商品，生成4个Google搜索广告描述（Descriptions）。

**TOP 5热销商品：**
${products.map((p, i) => `${i + 1}. ${p.name} (评分${p.rating}, ${p.reviewCount}评论)`).join('\n')}

**品牌：** ${products[0]?.brand || '未知'}

**要求：**
1. 生成4个描述，每个最多90个字符
2. 第1个描述：突出品牌店铺优势和热销爆品
3. 第2个描述：强调多样化产品线和品质保证
4. 第3个描述：社会证明（高评分、大量好评、官方旗舰店）
5. 第4个描述：促销信息和行动号召
6. 精炼表达，突出购买价值

**输出格式（JSON）：**
{
  "descriptions": ["描述1", "描述2", "描述3", "描述4"]
}

请严格遵循JSON格式输出。`

  try {
    const response = await generateContent(prompt, userId)
    const jsonMatch = response.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('AI响应格式错误')
    }

    const parsed = JSON.parse(jsonMatch[0])
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
  const features = product.features?.slice(0, 3).join(', ') || 'high quality features'

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
