/**
 * P0高级优化：竞品对比分析
 *
 * 功能：
 * 1. 智能识别竞品（从多个来源）
 * 2. 提取竞品数据（价格、评分、特性）
 * 3. AI分析竞争定位（价格优势、评分优势、功能对比）
 * 4. 识别独特卖点（USP）和竞品优势
 * 5. 为广告创意生成提供差异化洞察
 *
 * 预期效果：
 * - 差异化定位显著提升
 * - 转化率提升: +15-20%（明确价值主张）
 * - 广告质量分数: +20%（相关性和独特性）
 */

import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { getLanguageNameForCountry } from './language-country-codes'
import { compressCompetitors, type CompetitorInfo as CompressorCompetitorInfo } from './competitor-compressor'
import { withCache, type CacheOptions } from './ai-cache'
import { loadPrompt } from './prompt-loader'

// ==================== 数据结构定义 ====================

/**
 * 单个竞品的基础信息
 */
export interface CompetitorProduct {
  asin: string | null
  name: string
  brand: string | null
  price: number | null              // 数值价格（便于计算）
  priceText: string | null          // 原始价格文本
  rating: number | null
  reviewCount: number | null
  imageUrl: string | null

  // 竞品来源
  source: 'amazon_compare' | 'amazon_also_viewed' | 'amazon_similar' | 'same_category'

  // 相似度评分（0-100）
  similarityScore?: number

  // 关键特性（从页面提取）
  features?: string[]
}

/**
 * 价格竞争力分析
 */
export interface PricePosition {
  ourPrice: number
  avgCompetitorPrice: number
  minCompetitorPrice: number
  maxCompetitorPrice: number
  pricePercentile: number         // 在竞品中的价格百分位（0-100）
  priceAdvantage: 'lowest' | 'below_average' | 'average' | 'above_average' | 'premium'
  savingsVsAvg: string | null     // "Save $20 vs average competitor"
  savingsVsMin: string | null     // "Only $5 more than cheapest"
}

/**
 * 评分竞争力分析
 */
export interface RatingPosition {
  ourRating: number
  avgCompetitorRating: number
  maxCompetitorRating: number
  minCompetitorRating: number
  ratingPercentile: number
  ratingAdvantage: 'top_rated' | 'above_average' | 'average' | 'below_average'
}

/**
 * 功能对比项
 */
export interface FeatureComparison {
  feature: string              // "4K Resolution", "Night Vision"
  weHave: boolean
  competitorsHave: number      // 有此功能的竞品数量
  ourAdvantage: boolean        // 我们有而大多数竞品没有
}

/**
 * 独特卖点（USP）
 */
export interface UniqueSellingPoint {
  usp: string                  // "Only camera with solar panel option"
  differentiator: string       // 差异化说明
  competitorCount: number      // 有此功能的竞品数量（越少越独特）
  significance: 'high' | 'medium' | 'low'  // 差异化重要性
}

/**
 * 竞品优势（需要应对的）
 */
export interface CompetitorAdvantage {
  advantage: string            // "Longer warranty", "More storage options"
  competitor: string           // 竞品名称
  howToCounter: string         // AI建议的应对策略
}

/**
 * 完整的竞品分析结果
 */
export interface CompetitorAnalysisResult {
  // 识别的竞品
  competitors: CompetitorProduct[]
  totalCompetitors: number

  // 价格竞争力
  pricePosition: PricePosition | null

  // 评分竞争力
  ratingPosition: RatingPosition | null

  // 功能对比
  featureComparison: FeatureComparison[]

  // 独特卖点
  uniqueSellingPoints: UniqueSellingPoint[]

  // 竞品优势
  competitorAdvantages: CompetitorAdvantage[]

  // 综合竞争力评分（0-100）
  overallCompetitiveness: number

  // 分析时间
  analyzedAt: string
}

// ==================== AI驱动的竞品发现逻辑 ====================

/**
 * 从产品名称中提取核心产品类型关键词
 * 用于品类验证，确保推断的竞品与原产品在同一类目
 */
function extractCoreProductType(productNameLower: string): string[] {
  const keywords: string[] = []

  // 常见产品类型关键词（按优先级排序）
  const productTypes = [
    // 家电类
    'robot vacuum', 'vacuum cleaner', 'air purifier', 'humidifier', 'dehumidifier',
    'robot aspirapolvere', 'aspirapolvere', 'purificatore', 'umidificatore',

    // 电子产品
    'wireless earbuds', 'earbuds', 'headphones', 'speaker', 'soundbar',
    'auricolari', 'cuffie', 'altoparlante',

    // 智能设备
    'security camera', 'smart camera', 'doorbell', 'smart lock', 'smart display',
    'videocamera', 'telecamera', 'citofono', 'serratura intelligente',

    // 健康美容
    'electric toothbrush', 'hair dryer', 'trimmer', 'shaver',
    'spazzolino elettrico', 'asciugacapelli', 'rasoio',

    // 厨房电器
    'coffee maker', 'blender', 'air fryer', 'microwave',
    'macchina caffè', 'frullatore', 'friggitrice',
  ]

  // 提取匹配的产品类型关键词
  for (const type of productTypes) {
    if (productNameLower.includes(type)) {
      keywords.push(type)
    }
  }

  // 如果没有匹配到预定义类型，尝试提取核心名词短语
  if (keywords.length === 0) {
    // 提取最后2-3个有意义的词作为产品类型
    const words = productNameLower.split(/\s+/)
    const meaningfulWords = words.filter(w =>
      w.length > 3 &&
      !['with', 'and', 'the', 'for', 'con', 'per', 'alla'].includes(w)
    )

    if (meaningfulWords.length >= 2) {
      // 取最后2-3个词作为产品类型
      const lastWords = meaningfulWords.slice(-3).join(' ')
      keywords.push(lastWords)
    }
  }

  return keywords
}

/**
 * 使用AI推断竞品搜索关键词
 *
 * @param productInfo 产品基本信息
 * @param userId 用户ID（用于token计费）
 * @returns 竞品搜索关键词数组
 */
export async function inferCompetitorKeywords(
  productInfo: {
    name: string
    brand: string | null
    category: string
    price: number | null
    targetCountry: string
  },
  userId: number
): Promise<string[]> {
  console.log(`🤖 AI推断竞品搜索关键词...`)

  // 根据目标国家确定分析语言
  const langName = getLanguageNameForCountry(productInfo.targetCountry)

  // 📦 从数据库加载prompt模板 (版本管理)
  const promptTemplate = await loadPrompt('competitor_keyword_inference')

  // 🎨 插值替换模板变量
  const prompt = promptTemplate
    .replace('{{productInfo.name}}', productInfo.name)
    .replace('{{productInfo.brand}}', productInfo.brand || 'Unknown')
    .replace('{{productInfo.category}}', productInfo.category)
    .replace('{{productInfo.price}}', productInfo.price ? `Around $${productInfo.price}` : 'Not specified')
    .replace('{{productInfo.targetCountry}}', productInfo.targetCountry)

  try {
    const aiResponse = await generateContent({
      model: 'gemini-2.0-flash-exp',  // 使用快速模型，降低成本
      prompt,
      temperature: 0.3,  // 低温度保证稳定输出
      maxOutputTokens: 500,
    }, userId)

    // 记录token使用
    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: aiResponse.model,
        operationType: 'competitor_keyword_inference',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 提取JSON
    let jsonText = aiResponse.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.warn('⚠️ AI返回格式错误，使用通用搜索词')
      // 降级方案：基于类目的通用搜索
      return [`${productInfo.category} ${productInfo.targetCountry}`]
    }

    const result = JSON.parse(jsonMatch[0])
    let searchTerms = result.searchTerms || []

    // 🔍 品类验证：提取产品名称中的核心类型关键词
    const productNameLower = productInfo.name.toLowerCase()
    const coreTypeKeywords = extractCoreProductType(productNameLower)

    if (coreTypeKeywords.length > 0 && searchTerms.length > 0) {
      // 验证每个搜索词是否包含核心类型关键词
      const validatedTerms = searchTerms.filter((term: string) => {
        const termLower = term.toLowerCase()
        // 检查是否至少包含一个核心类型关键词
        return coreTypeKeywords.some(keyword => termLower.includes(keyword))
      })

      if (validatedTerms.length < searchTerms.length) {
        console.warn(`⚠️ 品类验证：过滤掉${searchTerms.length - validatedTerms.length}个跨品类搜索词`)
        console.warn(`   原始搜索词: ${searchTerms.join(', ')}`)
        console.warn(`   核心类型: ${coreTypeKeywords.join(', ')}`)
        console.warn(`   验证后: ${validatedTerms.join(', ')}`)
      }

      searchTerms = validatedTerms.length > 0 ? validatedTerms : searchTerms
    }

    console.log(`✅ AI推断了${searchTerms.length}个搜索词: ${searchTerms.join(', ')}`)
    return searchTerms

  } catch (error: any) {
    console.error('❌ AI推断失败:', error.message)
    // 降级方案
    return [`${productInfo.category} ${productInfo.targetCountry}`]
  }
}

/**
 * 在Amazon上搜索验证竞品
 *
 * @param searchTerms AI推断的搜索关键词
 * @param page Playwright页面对象
 * @param targetCountry 目标国家
 * @param limit 每个搜索词提取的产品数量
 * @returns 验证后的真实竞品数组
 */
export async function searchCompetitorsOnAmazon(
  searchTerms: string[],
  page: any,
  targetCountry: string,
  limit: number = 2
): Promise<CompetitorProduct[]> {
  console.log(`🔍 开始Amazon搜索验证竞品，搜索词数量: ${searchTerms.length}`)

  const competitors: CompetitorProduct[] = []
  const domain = getAmazonDomain(targetCountry)

  for (const term of searchTerms.slice(0, 5)) { // 最多搜索5次
    console.log(`   搜索: "${term}"`)

    try {
      const searchUrl = `https://www.${domain}/s?k=${encodeURIComponent(term)}`
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })

      // 等待搜索结果加载
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 5000 })
        .catch(() => null)

      // 提取搜索结果
      const results = await page.evaluate((maxItems: number) => {
        const items: any[] = []
        const resultElements = document.querySelectorAll('[data-component-type="s-search-result"]')

        for (let i = 0; i < Math.min(maxItems, resultElements.length); i++) {
          const el = resultElements[i]

          const asin = el.getAttribute('data-asin')
          if (!asin) continue

          const nameEl = el.querySelector('h2 a span, h2 span')
          const name = nameEl?.textContent?.trim() || ''

          const priceEl = el.querySelector('.a-price .a-offscreen')
          const priceText = priceEl?.textContent?.trim() || null

          const ratingEl = el.querySelector('.a-icon-star-small .a-icon-alt')
          const ratingText = ratingEl?.textContent?.trim() || null
          const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

          const reviewEl = el.querySelector('[aria-label*="stars"]')
          const reviewText = reviewEl?.getAttribute('aria-label') || null
          const reviewCount = reviewText ? parseInt(reviewText.replace(/\D/g, '')) : null

          const imageEl = el.querySelector('.s-image') as HTMLImageElement | null
          const imageUrl = imageEl?.src || null

          if (name && priceText) {
            items.push({
              asin,
              name,
              brand: null,  // 可以从名称中提取
              priceText,
              price: parseFloat(priceText.replace(/[^0-9.,]/g, '').replace(',', '.')),
              rating,
              reviewCount,
              imageUrl,
              source: 'amazon_search'
            })
          }
        }

        return items
      }, limit)

      if (results.length > 0) {
        console.log(`   ✅ 找到${results.length}个产品`)
        competitors.push(...results)
      } else {
        console.log(`   ⚠️ 未找到结果`)
      }

      // 达到目标数量就停止
      if (competitors.length >= 10) {
        console.log(`   已收集足够竞品，停止搜索`)
        break
      }

    } catch (error: any) {
      console.warn(`   ⚠️ 搜索"${term}"失败: ${error.message}`)
      continue
    }
  }

  // 去重
  const uniqueCompetitors = deduplicateCompetitors(competitors)
  console.log(`✅ 搜索验证完成，共找到${uniqueCompetitors.length}个真实竞品`)

  return uniqueCompetitors
}

/**
 * 根据国家代码获取Amazon域名
 */
function getAmazonDomain(countryCode: string): string {
  const domainMap: Record<string, string> = {
    'US': 'amazon.com',
    'UK': 'amazon.co.uk',
    'DE': 'amazon.de',
    'FR': 'amazon.fr',
    'IT': 'amazon.it',
    'ES': 'amazon.es',
    'JP': 'amazon.co.jp',
    'CA': 'amazon.ca',
    'AU': 'amazon.com.au',
    'IN': 'amazon.in',
    'MX': 'amazon.com.mx',
    'BR': 'amazon.com.br',
  }
  return domainMap[countryCode] || 'amazon.com'
}

// ==================== 竞品抓取逻辑（保留作为补充数据源）====================

/**
 * 从Playwright页面对象中抓取Amazon竞品信息
 *
 * 策略：
 * 1. 优先从"Compare with similar items"区域抓取（最相关）
 * 2. 如果没有，从"Customers also viewed"抓取
 * 3. 如果还是没有，从"Similar items"抓取
 *
 * @param page Playwright页面对象
 * @param limit 抓取竞品数量上限（默认10）
 * @returns 竞品数组
 */
export async function scrapeAmazonCompetitors(
  page: any,
  limit: number = 10
): Promise<CompetitorProduct[]> {
  console.log(`🔍 开始抓取竞品信息，目标数量: ${limit}`)

  const competitors: CompetitorProduct[] = []

  try {
    // 策略1: 从"Compare with similar items"表格抓取
    const compareTableCompetitors = await scrapeCompareTable(page, limit)
    if (compareTableCompetitors.length > 0) {
      console.log(`✅ 从Compare Table抓取到${compareTableCompetitors.length}个竞品`)
      competitors.push(...compareTableCompetitors)
    }

    // 策略2: 如果数量不足，从"Related to items you've viewed"抓取
    if (competitors.length < limit) {
      const relatedCompetitors = await scrapeRelatedToItemsYouViewed(page, limit - competitors.length)
      if (relatedCompetitors.length > 0) {
        console.log(`✅ 从Related to items you've viewed抓取到${relatedCompetitors.length}个竞品`)
        competitors.push(...relatedCompetitors)
      }
    }

    // 策略3: 如果数量不足，从"Customers also viewed"抓取
    if (competitors.length < limit) {
      const alsoViewedCompetitors = await scrapeAlsoViewed(page, limit - competitors.length)
      if (alsoViewedCompetitors.length > 0) {
        console.log(`✅ 从Also Viewed抓取到${alsoViewedCompetitors.length}个竞品`)
        competitors.push(...alsoViewedCompetitors)
      }
    }

    // 策略4: 如果还是不足，从"Similar items"抓取
    if (competitors.length < limit) {
      const similarCompetitors = await scrapeSimilarItems(page, limit - competitors.length)
      if (similarCompetitors.length > 0) {
        console.log(`✅ 从Similar Items抓取到${similarCompetitors.length}个竞品`)
        competitors.push(...similarCompetitors)
      }
    }

    // 去重（基于ASIN）
    const uniqueCompetitors = deduplicateCompetitors(competitors)
    console.log(`✅ 竞品抓取完成，共${uniqueCompetitors.length}个（去重后）`)

    return uniqueCompetitors

  } catch (error: any) {
    console.error('❌ 竞品抓取失败:', error.message)
    return []
  }
}

/**
 * 从"Compare with similar items"表格抓取竞品
 */
async function scrapeCompareTable(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    await page.waitForSelector('[data-component-type="comparison-table"], .comparison-table, #HLCXComparisonTable', { timeout: 3000 })
      .catch(() => null)

    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // 多种选择器策略
      const selectors = [
        '[data-component-type="comparison-table"] .comparison-item',
        '.comparison-table .comparison-item',
        '#HLCXComparisonTable .comparison-item',
        '[cel_widget_id*="comparison"] .comparison-item'
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const asin = el.querySelector('[data-asin]')?.getAttribute('data-asin') ||
                        el.getAttribute('data-asin')

            const nameEl = el.querySelector('.product-title, .a-link-normal[title], h3')
            const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('title') || 'Unknown'

            const priceEl = el.querySelector('.a-price .a-offscreen, .a-price-whole')
            const priceText = priceEl?.textContent?.trim() || null

            const ratingEl = el.querySelector('.a-icon-star, [class*="star-rating"]')
            const ratingText = ratingEl?.textContent?.trim() || ratingEl?.getAttribute('aria-label') || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const reviewEl = el.querySelector('.a-size-small[href*="customerReviews"]')
            const reviewText = reviewEl?.textContent?.trim() || null
            const reviewCount = reviewText ? parseInt(reviewText.replace(/[^0-9]/g, '')) : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            items.push({
              asin,
              name,
              brand: null,
              priceText,
              price: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) : null,
              rating,
              reviewCount,
              imageUrl,
              source: 'amazon_compare'
            })
          })
          break
        }
      }

      return items
    }, limit)

    return competitors.filter((c: any) => c.name && c.name !== 'Unknown')

  } catch (error) {
    return []
  }
}

/**
 * 从"Related to items you've viewed"区域抓取竞品
 *
 * 这是Amazon产品页上常见的竞品推荐区域，通常包含相关竞品
 */
async function scrapeRelatedToItemsYouViewed(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // "Related to items you've viewed" 区域选择器
      // 这个区域通常使用不同的carousel widget ID
      const selectors = [
        '[cel_widget_id*="AVD"] .a-carousel-card',
        '[cel_widget_id*="AVD-desktop"] .a-carousel-card',
        '[data-a-carousel-options*="AVD"] .a-carousel-card',
        '#rhf .a-carousel-card',
        '[aria-label*="Related to items you"] .a-carousel-card',
        '[aria-label*="Related"] .a-carousel-card',
        // 备选：通用carousel，如果上面的都找不到
        '.a-carousel-container .a-carousel-card'
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          console.log(`✅ 找到Related区域: ${selector}, 共${elements.length}个商品`)

          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const linkEl = el.querySelector('a[href*="/dp/"]') as HTMLAnchorElement | null
            const asin = linkEl?.href?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null

            // 策略1：从产品链接的aria-label或title属性获取名称
            let name = linkEl?.getAttribute('aria-label')?.trim() ||
                      linkEl?.getAttribute('title')?.trim() ||
                      linkEl?.querySelector('img')?.getAttribute('alt')?.trim() || ''

            // 策略2：如果没有，尝试从文本元素获取（排除<style>标签）
            if (!name || name === 'Unknown') {
              const textElements = el.querySelectorAll('.a-truncate-full, .p13n-sc-truncated, .a-link-normal')
              for (const textEl of Array.from(textElements)) {
                const text = textEl.textContent?.trim() || ''
                // 排除包含CSS代码的文本
                if (text && !text.includes('{') && !text.includes('position:') && text.length > 5) {
                  name = text
                  break
                }
              }
            }

            // 策略3：清理名称中的CSS/JS代码
            if (name && (name.includes('{') || name.includes('position:'))) {
              // 尝试提取实际产品名（通常在CSS代码之后）
              const cleanMatch = name.match(/([A-Z][A-Za-z\s\d,.()+-]+?)(?:,\s*\.\.\.|$)/);
              if (cleanMatch) {
                name = cleanMatch[1].trim();
              } else {
                name = 'Unknown';
              }
            }

            if (!name) name = 'Unknown'

            const priceEl = el.querySelector('.a-price .a-offscreen, .p13n-sc-price, .a-price-whole')
            const priceText = priceEl?.textContent?.trim() || null

            const ratingEl = el.querySelector('.a-icon-star-small, .a-icon-star, [class*="a-star"]')
            const ratingText = ratingEl?.getAttribute('aria-label') || ratingEl?.textContent || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const reviewEl = el.querySelector('[aria-label*="ratings"]')
            const reviewText = reviewEl?.getAttribute('aria-label') || null
            const reviewCount = reviewText ? parseInt(reviewText.replace(/[^0-9]/g, '')) : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            if (name !== 'Unknown') {
              items.push({
                asin,
                name,
                brand: null,
                priceText,
                price: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) : null,
                rating,
                reviewCount,
                imageUrl,
                source: 'amazon_also_viewed'  // 使用相同source标识
              })
            }
          })
          break
        }
      }

      return items
    }, limit)

    return competitors

  } catch (error) {
    return []
  }
}

/**
 * 从"Customers also viewed"区域抓取竞品
 */
async function scrapeAlsoViewed(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // "Customers also viewed" 区域选择器
      const selectors = [
        '[data-a-carousel-options*="also_viewed"] .a-carousel-card',
        '#similarities_feature_div .a-carousel-card',
        '[cel_widget_id*="also_viewed"] .a-carousel-card',
        '#dp-pod-similars .a-carousel-card'
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const linkEl = el.querySelector('a[href*="/dp/"]') as HTMLAnchorElement | null
            const asin = linkEl?.href?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null

            const nameEl = el.querySelector('.a-truncate-full, .p13n-sc-truncated')
            const name = nameEl?.textContent?.trim() || 'Unknown'

            const priceEl = el.querySelector('.a-price .a-offscreen, .p13n-sc-price')
            const priceText = priceEl?.textContent?.trim() || null

            const ratingEl = el.querySelector('.a-icon-star-small, .a-icon-star')
            const ratingText = ratingEl?.getAttribute('aria-label') || ratingEl?.textContent || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const reviewEl = el.querySelector('[aria-label*="ratings"]')
            const reviewText = reviewEl?.getAttribute('aria-label') || null
            const reviewCount = reviewText ? parseInt(reviewText.replace(/[^0-9]/g, '')) : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            if (name !== 'Unknown') {
              items.push({
                asin,
                name,
                brand: null,
                priceText,
                price: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) : null,
                rating,
                reviewCount,
                imageUrl,
                source: 'amazon_also_viewed'
              })
            }
          })
          break
        }
      }

      return items
    }, limit)

    return competitors

  } catch (error) {
    return []
  }
}

/**
 * 从"Similar items"区域抓取竞品
 */
async function scrapeSimilarItems(page: any, limit: number): Promise<CompetitorProduct[]> {
  try {
    const competitors = await page.evaluate((maxItems: number) => {
      const items: any[] = []

      // "Similar items" 区域选择器
      const selectors = [
        '[data-a-carousel-options*="similar"] .a-carousel-card',
        '#sp_detail .a-carousel-card',
        '[cel_widget_id*="similar"] .a-carousel-card'
      ]

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        if (elements.length > 0) {
          elements.forEach((el, idx) => {
            if (idx >= maxItems) return

            const linkEl = el.querySelector('a[href*="/dp/"]') as HTMLAnchorElement | null
            const asin = linkEl?.href?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null

            const nameEl = el.querySelector('.a-truncate-full, .p13n-sc-truncated')
            const name = nameEl?.textContent?.trim() || 'Unknown'

            const priceEl = el.querySelector('.a-price .a-offscreen')
            const priceText = priceEl?.textContent?.trim() || null

            const ratingEl = el.querySelector('.a-icon-star-small')
            const ratingText = ratingEl?.getAttribute('aria-label') || null
            const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0] || '0') : null

            const imageEl = el.querySelector('img')
            const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || null

            if (name !== 'Unknown') {
              items.push({
                asin,
                name,
                brand: null,
                priceText,
                price: priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) : null,
                rating,
                reviewCount: null,
                imageUrl,
                source: 'amazon_similar'
              })
            }
          })
          break
        }
      }

      return items
    }, limit)

    return competitors

  } catch (error) {
    return []
  }
}

/**
 * 去重竞品（基于ASIN）
 */
function deduplicateCompetitors(competitors: CompetitorProduct[]): CompetitorProduct[] {
  const seen = new Set<string>()
  const unique: CompetitorProduct[] = []

  for (const competitor of competitors) {
    const key = competitor.asin || competitor.name
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(competitor)
    }
  }

  return unique
}

// ==================== AI竞品分析逻辑 ====================

/**
 * 使用AI分析竞品对比，识别竞争优势和劣势
 *
 * @param ourProduct 我们的产品信息
 * @param competitors 竞品数组
 * @param targetCountry 目标国家（用于语言适配）
 * @param userId 用户ID（用于API配额管理）
 * @param options 优化选项（可选）
 * @returns 竞品分析结果
 */
export async function analyzeCompetitorsWithAI(
  ourProduct: {
    name: string
    price: number | null
    rating: number | null
    reviewCount: number | null
    features: string[]
  },
  competitors: CompetitorProduct[],
  targetCountry: string = 'US',
  userId?: number,
  options?: {
    enableCompression?: boolean  // 启用竞品数据压缩（默认false，零破坏性）
    enableCache?: boolean        // 启用缓存（默认false，零破坏性）
    cacheKey?: string            // 自定义缓存键（默认使用产品名+竞品数量）
  }
): Promise<CompetitorAnalysisResult> {

  if (competitors.length === 0) {
    console.log('⚠️ 无竞品数据，返回空分析结果')
    return getEmptyCompetitorAnalysis()
  }

  console.log(`🤖 开始AI竞品分析,我们的产品vs ${competitors.length}个竞品...`)

  // 根据目标国家确定分析语言(使用全局语言映射)
  const langName = getLanguageNameForCountry(targetCountry)

  // 计算基础竞争力指标
  const pricePosition = calculatePricePosition(ourProduct, competitors)
  const ratingPosition = calculateRatingPosition(ourProduct, competitors)

  // 准备竞品数据(支持压缩优化)
  let competitorSummaries: string
  let compressionStats: any = null

  if (options?.enableCompression) {
    // 🆕 Token优化:使用压缩格式(40-50%减少)
    console.log('🗜️ 启用竞品数据压缩优化...')
    const compressorInput: CompressorCompetitorInfo[] = competitors.slice(0, 10).map(c => ({
      name: c.name,
      brand: c.brand || undefined,
      price: c.priceText || undefined,
      rating: c.rating ? `${c.rating} stars` : undefined,
      reviewCount: c.reviewCount || undefined,
      usp: undefined,
      keyFeatures: c.features,
      url: undefined,
    }))

    const compressed = compressCompetitors(compressorInput, 20)
    competitorSummaries = compressed.compressed
    compressionStats = compressed.stats
    console.log(`   压缩率: ${compressionStats.compressionRatio}(${compressionStats.originalChars} → ${compressionStats.compressedChars}字符)`)
  } else {
    // 原始格式(保持向后兼容)
    competitorSummaries = competitors.slice(0, 10).map((c, idx) => {
      return `Competitor ${idx + 1}:
- Name: ${c.name}
- Brand: ${c.brand || 'Unknown'}
- Price: ${c.priceText || 'N/A'}
- Rating: ${c.rating || 'N/A'} stars
- Reviews: ${c.reviewCount || 'N/A'}
- Source: ${c.source}`
    }).join('\n\n')
  }

  // 📦 从数据库加载prompt模板(版本管理)
  const promptTemplate = await loadPrompt('competitor_analysis')

  // 🎨 准备模板变量
  const ourProductName = ourProduct.name
  const ourProductPrice = ourProduct.price ? `$${ourProduct.price.toFixed(2)}` : 'N/A'
  const ourProductRating = `${ourProduct.rating || 'N/A'} stars (${ourProduct.reviewCount || 0} reviews)`
  const ourProductFeatures = ourProduct.features.slice(0, 10).join('; ') || 'Not specified'

  const priceAdvantage = pricePosition?.priceAdvantage || 'unknown'
  const pricePercentile = pricePosition?.pricePercentile?.toString() || '0'
  const ratingAdvantage = ratingPosition?.ratingAdvantage || 'unknown'
  const ratingPercentile = ratingPosition?.ratingPercentile?.toString() || '0'

  const totalCompetitorsText = competitors.length.toString()

  // 🎨 插值替换模板变量
  const prompt = promptTemplate
    .replace('{{ourProduct.name}}', ourProductName)
    .replace('{{ourProduct.price}}', ourProductPrice)
    .replace('{{ourProduct.rating}}', ourProductRating)
    .replace('{{ourProduct.features}}', ourProductFeatures)
    .replace('{{pricePosition.priceAdvantage}}', priceAdvantage)
    .replace('{{pricePosition.pricePercentile}}', pricePercentile)
    .replace('{{ratingPosition.ratingAdvantage}}', ratingAdvantage)
    .replace('{{ratingPosition.ratingPercentile}}', ratingPercentile)
    .replace('{{totalCompetitors}}', totalCompetitorsText)
    .replace('{{competitorSummaries}}', competitorSummaries)
    .replace('{{targetLanguage}}', langName)

  try {
    // 使用Gemini AI进行分析
    if (!userId) {
      throw new Error('竞品分析需要用户ID,请确保已登录')
    }

    // 🆕 Token优化：支持缓存（3天TTL）
    const cacheKey = options?.cacheKey || `${ourProduct.name}:${competitors.length}competitors`
    const performAnalysis = async () => {
      const aiResponse = await generateContent({
        model: 'gemini-2.5-pro',
        prompt,
        temperature: 0.6,  // 平衡创造性和准确性
        maxOutputTokens: 8192,  // 恢复原始值，确保JSON不被截断
      }, userId!)

      // 记录token使用
      if (aiResponse.usage) {
        const cost = estimateTokenCost(
          aiResponse.model,
          aiResponse.usage.inputTokens,
          aiResponse.usage.outputTokens
        )
        await recordTokenUsage({
          userId: userId!,
          model: aiResponse.model,
          operationType: 'competitor_analysis',
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
          cost,
          apiType: aiResponse.apiType
        })
      }

      return aiResponse.text
    }

    // 使用缓存包装器（如果启用）
    const text = options?.enableCache
      ? await withCache('competitor_analysis', cacheKey, performAnalysis)
      : await performAnalysis()

    // 提取JSON内容
    let jsonText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('❌ AI返回格式错误，未找到JSON')
      return getEmptyCompetitorAnalysis()
    }

    const analysisData = JSON.parse(jsonMatch[0])

    // 构建完整结果
    const result: CompetitorAnalysisResult = {
      competitors,
      totalCompetitors: competitors.length,
      pricePosition,
      ratingPosition,
      featureComparison: analysisData.featureComparison || [],
      uniqueSellingPoints: analysisData.uniqueSellingPoints || [],
      competitorAdvantages: analysisData.competitorAdvantages || [],
      overallCompetitiveness: analysisData.overallCompetitiveness || 50,
      analyzedAt: new Date().toISOString(),
    }

    console.log('✅ AI竞品分析完成')
    console.log(`   - 识别${result.uniqueSellingPoints.length}个独特卖点`)
    console.log(`   - 发现${result.competitorAdvantages.length}个竞品优势需应对`)
    console.log(`   - 综合竞争力: ${result.overallCompetitiveness}/100`)

    return result

  } catch (error: any) {
    console.error('❌ AI竞品分析失败:', error.message)
    return getEmptyCompetitorAnalysis()
  }
}

/**
 * 计算价格竞争力
 */
function calculatePricePosition(
  ourProduct: { price: number | null },
  competitors: CompetitorProduct[]
): PricePosition | null {
  const ourPrice = ourProduct.price
  if (!ourPrice) return null

  const competitorPrices = competitors
    .map(c => c.price)
    .filter((p): p is number => p !== null && p > 0)

  if (competitorPrices.length === 0) return null

  const avgPrice = competitorPrices.reduce((sum, p) => sum + p, 0) / competitorPrices.length
  const minPrice = Math.min(...competitorPrices)
  const maxPrice = Math.max(...competitorPrices)

  // 计算价格百分位
  const lowerCount = competitorPrices.filter(p => p < ourPrice).length
  const pricePercentile = Math.round((lowerCount / competitorPrices.length) * 100)

  // 判断价格优势
  let priceAdvantage: PricePosition['priceAdvantage']
  if (ourPrice <= minPrice) {
    priceAdvantage = 'lowest'
  } else if (ourPrice < avgPrice * 0.9) {
    priceAdvantage = 'below_average'
  } else if (ourPrice <= avgPrice * 1.1) {
    priceAdvantage = 'average'
  } else if (ourPrice <= avgPrice * 1.3) {
    priceAdvantage = 'above_average'
  } else {
    priceAdvantage = 'premium'
  }

  // 计算节省金额
  const savingsVsAvg = ourPrice < avgPrice
    ? `Save $${(avgPrice - ourPrice).toFixed(2)} vs average competitor`
    : null

  const savingsVsMin = ourPrice > minPrice
    ? `Only $${(ourPrice - minPrice).toFixed(2)} more than cheapest`
    : null

  return {
    ourPrice,
    avgCompetitorPrice: parseFloat(avgPrice.toFixed(2)),
    minCompetitorPrice: minPrice,
    maxCompetitorPrice: maxPrice,
    pricePercentile,
    priceAdvantage,
    savingsVsAvg,
    savingsVsMin,
  }
}

/**
 * 计算评分竞争力
 */
function calculateRatingPosition(
  ourProduct: { rating: number | null },
  competitors: CompetitorProduct[]
): RatingPosition | null {
  const ourRating = ourProduct.rating
  if (!ourRating) return null

  const competitorRatings = competitors
    .map(c => c.rating)
    .filter((r): r is number => r !== null && r > 0)

  if (competitorRatings.length === 0) return null

  const avgRating = competitorRatings.reduce((sum, r) => sum + r, 0) / competitorRatings.length
  const minRating = Math.min(...competitorRatings)
  const maxRating = Math.max(...competitorRatings)

  // 计算评分百分位
  const lowerCount = competitorRatings.filter(r => r < ourRating).length
  const ratingPercentile = Math.round((lowerCount / competitorRatings.length) * 100)

  // 判断评分优势
  let ratingAdvantage: RatingPosition['ratingAdvantage']
  if (ourRating >= maxRating - 0.1) {
    ratingAdvantage = 'top_rated'
  } else if (ourRating >= avgRating + 0.2) {
    ratingAdvantage = 'above_average'
  } else if (ourRating >= avgRating - 0.2) {
    ratingAdvantage = 'average'
  } else {
    ratingAdvantage = 'below_average'
  }

  return {
    ourRating,
    avgCompetitorRating: parseFloat(avgRating.toFixed(1)),
    maxCompetitorRating: maxRating,
    minCompetitorRating: minRating,
    ratingPercentile,
    ratingAdvantage,
  }
}

/**
 * 获取空的竞品分析结果（当无竞品或分析失败时使用）
 */
function getEmptyCompetitorAnalysis(): CompetitorAnalysisResult {
  return {
    competitors: [],
    totalCompetitors: 0,
    pricePosition: null,
    ratingPosition: null,
    featureComparison: [],
    uniqueSellingPoints: [],
    competitorAdvantages: [],
    overallCompetitiveness: 50,
    analyzedAt: new Date().toISOString(),
  }
}

// ==================== 辅助函数 ====================

/**
 * 提取竞品分析中最有价值的洞察（用于广告创意生成）
 *
 * @param analysis 竞品分析结果
 * @returns 结构化的洞察摘要
 */
export function extractCompetitiveInsights(analysis: CompetitorAnalysisResult): {
  headlineSuggestions: string[]     // 适合用作广告标题的优势
  descriptionHighlights: string[]   // 适合用作广告描述的差异化点
  calloutSuggestions: string[]      // 适合用作Callouts的对比优势
  sitelinkSuggestions: string[]     // 适合用作Sitelinks的对比主题
} {
  const insights = {
    headlineSuggestions: [] as string[],
    descriptionHighlights: [] as string[],
    calloutSuggestions: [] as string[],
    sitelinkSuggestions: [] as string[],
  }

  // 从价格优势提取标题建议
  if (analysis.pricePosition) {
    const pp = analysis.pricePosition
    if (pp.priceAdvantage === 'lowest') {
      insights.headlineSuggestions.push('Lowest Price Guaranteed')
      insights.calloutSuggestions.push('Best Value')
    } else if (pp.priceAdvantage === 'below_average' && pp.savingsVsAvg) {
      insights.headlineSuggestions.push(pp.savingsVsAvg)
      insights.calloutSuggestions.push('Better Price')
    }
  }

  // 从评分优势提取标题建议
  if (analysis.ratingPosition) {
    const rp = analysis.ratingPosition
    if (rp.ratingAdvantage === 'top_rated') {
      insights.headlineSuggestions.push(`Top Rated - ${rp.ourRating}★`)
      insights.calloutSuggestions.push('Highest Rating')
    } else if (rp.ratingAdvantage === 'above_average') {
      insights.headlineSuggestions.push(`${rp.ourRating}★ Rated`)
      insights.calloutSuggestions.push('Above Average Rating')
    }
  }

  // 从独特卖点提取描述亮点和Callouts
  analysis.uniqueSellingPoints
    .filter(usp => usp.significance === 'high' || usp.significance === 'medium')
    .slice(0, 3)
    .forEach(usp => {
      insights.descriptionHighlights.push(usp.usp)
      insights.calloutSuggestions.push(usp.usp.substring(0, 25)) // Callouts限制25字符
    })

  // 从竞品优势提取Sitelink主题
  insights.sitelinkSuggestions.push('Why Choose Us')
  insights.sitelinkSuggestions.push('vs Competitors')

  if (analysis.pricePosition) {
    insights.sitelinkSuggestions.push('Price Comparison')
  }

  if (analysis.uniqueSellingPoints.length > 0) {
    insights.sitelinkSuggestions.push('Unique Features')
  }

  return insights
}
