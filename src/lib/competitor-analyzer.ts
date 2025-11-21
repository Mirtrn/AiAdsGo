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

// ==================== 竞品抓取逻辑 ====================

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

    // 策略2: 如果数量不足，从"Customers also viewed"抓取
    if (competitors.length < limit) {
      const alsoViewedCompetitors = await scrapeAlsoViewed(page, limit - competitors.length)
      if (alsoViewedCompetitors.length > 0) {
        console.log(`✅ 从Also Viewed抓取到${alsoViewedCompetitors.length}个竞品`)
        competitors.push(...alsoViewedCompetitors)
      }
    }

    // 策略3: 如果还是不足，从"Similar items"抓取
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
  userId?: number
): Promise<CompetitorAnalysisResult> {

  if (competitors.length === 0) {
    console.log('⚠️ 无竞品数据，返回空分析结果')
    return getEmptyCompetitorAnalysis()
  }

  console.log(`🤖 开始AI竞品分析，我们的产品vs ${competitors.length}个竞品...`)

  // 根据目标国家确定分析语言
  const languageConfig: Record<string, string> = {
    US: 'English',
    CN: '中文',
    JP: '日本語',
    KR: '한국어',
    DE: 'Deutsch',
    FR: 'Français',
    ES: 'Español',
  }
  const langName = languageConfig[targetCountry] || 'English'

  // 计算基础竞争力指标
  const pricePosition = calculatePricePosition(ourProduct, competitors)
  const ratingPosition = calculateRatingPosition(ourProduct, competitors)

  // 准备竞品数据（限制长度避免超token）
  const competitorSummaries = competitors.slice(0, 10).map((c, idx) => {
    return `Competitor ${idx + 1}:
- Name: ${c.name}
- Brand: ${c.brand || 'Unknown'}
- Price: ${c.priceText || 'N/A'}
- Rating: ${c.rating || 'N/A'} stars
- Reviews: ${c.reviewCount || 'N/A'}
- Source: ${c.source}`
  }).join('\n\n')

  // 构建AI分析prompt
  const prompt = `You are a professional competitive analysis expert. Please analyze the following product vs competitors to identify competitive advantages and unique selling points.

**Our Product:**
- Name: ${ourProduct.name}
- Price: ${ourProduct.price ? `$${ourProduct.price.toFixed(2)}` : 'N/A'}
- Rating: ${ourProduct.rating || 'N/A'} stars (${ourProduct.reviewCount || 0} reviews)
- Key Features: ${ourProduct.features.slice(0, 10).join('; ') || 'Not specified'}

**Price Position:** ${pricePosition?.priceAdvantage || 'unknown'} (${pricePosition?.pricePercentile || 0}th percentile)
**Rating Position:** ${ratingPosition?.ratingAdvantage || 'unknown'} (${ratingPosition?.ratingPercentile || 0}th percentile)

**Competitors (${competitors.length} total):**
${competitorSummaries}

Please return the following analysis in JSON format:
{
  "featureComparison": [
    {
      "feature": "4K Resolution",
      "weHave": true,
      "competitorsHave": 3,
      "ourAdvantage": false
    }
    // Top 5-8 key features to compare
  ],

  "uniqueSellingPoints": [
    {
      "usp": "Only solar-powered camera in this price range",
      "differentiator": "No battery replacement needed, eco-friendly, cost-saving",
      "competitorCount": 0,
      "significance": "high"
    }
    // Top 2-4 unique advantages we have
  ],

  "competitorAdvantages": [
    {
      "advantage": "Includes 1-year cloud storage subscription",
      "competitor": "Competitor 2",
      "howToCounter": "Emphasize our no-subscription model saves $120/year, local storage included"
    }
    // Top 2-3 competitor advantages we need to address
  ],

  "overallCompetitiveness": 75
  // 0-100 score based on price, rating, features, uniqueness
}

Analysis Requirements:
1. ALL text outputs (USPs, differentiators, counter-strategies) MUST be in ${langName}
2. Feature comparison should focus on IMPORTANT differentiators, not trivial differences
3. USPs must be genuinely unique or rare (competitorCount should be very low)
4. Competitor advantages must be REAL threats, not minor differences
5. Counter-strategies should be specific and actionable
6. Overall competitiveness score should objectively reflect our position (0-100)
7. If price/rating data is missing, focus on feature-based analysis
8. Return ONLY the JSON object, no other text or markdown

IMPORTANT: Focus on insights that will make advertising more effective and differentiated.`

  try {
    // 使用Gemini AI进行分析
    const text = await generateContent({
      model: 'gemini-2.5-pro',
      prompt,
      temperature: 0.6,  // 平衡创造性和准确性
      maxOutputTokens: 3072,
    }, userId)

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
