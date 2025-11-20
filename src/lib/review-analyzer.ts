/**
 * P0高级优化：用户评论深度分析
 *
 * 功能：
 * 1. 抓取Amazon产品评论（30-50条）
 * 2. AI智能分析：情感分布、高频关键词、真实场景、痛点挖掘
 * 3. 为广告创意生成提供真实用户洞察
 *
 * 预期效果：
 * - CTR提升: +20-30%（使用用户真实语言）
 * - 转化率提升: +15-25%（解决用户痛点）
 * - 广告相关性评分: +25%（匹配用户搜索意图）
 */

import { generateContent } from './gemini'

// ==================== 数据结构定义 ====================

/**
 * 单条评论原始数据
 */
export interface RawReview {
  rating: string | null           // "5.0 out of 5 stars"
  title: string | null             // 评论标题
  body: string | null              // 评论正文
  helpful: string | null           // "125 people found this helpful"
  verified: boolean                // 是否为认证购买
  date?: string | null             // 评论日期
  author?: string | null           // 评论者
}

/**
 * 情感分布
 */
export interface SentimentDistribution {
  positive: number    // 正面评论占比 (4-5星) 0-100
  neutral: number     // 中性评论占比 (3星) 0-100
  negative: number    // 负面评论占比 (1-2星) 0-100
}

/**
 * 高频关键词
 */
export interface KeywordInsight {
  keyword: string          // "easy setup", "clear image"
  frequency: number        // 出现次数
  sentiment: 'positive' | 'negative'
  context?: string         // 上下文说明
}

/**
 * 真实使用场景
 */
export interface UseCase {
  scenario: string         // "monitoring backyard", "baby monitor"
  mentions: number         // 被提及次数
  examples?: string[]      // 具体评论片段
}

/**
 * 购买动机
 */
export interface PurchaseReason {
  reason: string           // "replace old camera", "home security upgrade"
  frequency: number        // 频次
}

/**
 * 用户画像
 */
export interface UserProfile {
  profile: string          // "tech-savvy homeowner", "small business owner"
  indicators: string[]     // 判断依据
}

/**
 * 痛点分析
 */
export interface PainPoint {
  issue: string            // "difficult installation", "subscription required"
  severity: 'critical' | 'moderate' | 'minor'
  affectedUsers: number    // 受影响用户数
  workarounds?: string[]   // 用户提到的解决方法
}

/**
 * 完整的评论分析结果
 */
export interface ReviewAnalysisResult {
  // 基础数据
  totalReviews: number
  averageRating: number

  // 情感分析
  sentimentDistribution: SentimentDistribution

  // 关键词洞察
  topPositiveKeywords: KeywordInsight[]
  topNegativeKeywords: KeywordInsight[]

  // 使用场景
  realUseCases: UseCase[]

  // 购买动机
  purchaseReasons: PurchaseReason[]

  // 用户画像
  userProfiles: UserProfile[]

  // 痛点挖掘
  commonPainPoints: PainPoint[]

  // 原始数据统计
  analyzedReviewCount: number      // 实际分析的评论数
  verifiedReviewCount: number      // 认证购买评论数
}

// ==================== 评论抓取逻辑 ====================

/**
 * 从Playwright页面对象中抓取Amazon产品评论
 *
 * @param page Playwright页面对象
 * @param limit 抓取评论数量上限（默认50）
 * @returns 评论数组
 */
export async function scrapeAmazonReviews(
  page: any,
  limit: number = 50
): Promise<RawReview[]> {
  console.log(`📝 开始抓取评论，目标数量: ${limit}`)

  try {
    // 尝试导航到评论页面（如果当前在产品页）
    const currentUrl = page.url()
    const isProductPage = currentUrl.includes('/dp/') || currentUrl.includes('/product/')

    if (isProductPage) {
      // 尝试点击"See all reviews"链接
      try {
        const seeAllReviewsSelector = 'a[data-hook="see-all-reviews-link-foot"], a:has-text("See all reviews")'
        const seeAllButton = await page.$(seeAllReviewsSelector)

        if (seeAllButton) {
          console.log('🔗 找到"See all reviews"链接，导航到评论页...')
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
            seeAllButton.click()
          ])
          console.log('✅ 已导航到评论页')
        } else {
          console.log('⚠️ 未找到"See all reviews"链接，在当前页面抓取评论')
        }
      } catch (navError) {
        console.log('⚠️ 导航到评论页失败，在当前页面抓取评论:', navError)
      }
    }

    // 等待评论加载
    await page.waitForSelector('[data-hook="review"], .review, [data-testid="review"]', { timeout: 5000 })
      .catch(() => console.log('⚠️ 评论选择器等待超时，继续尝试抓取'))

    // 抓取评论
    const reviews: RawReview[] = await page.evaluate((maxReviews: number) => {
      const reviewElements = document.querySelectorAll('[data-hook="review"], .review, [data-testid="review"]')
      const results: RawReview[] = []

      reviewElements.forEach((el, index) => {
        if (index >= maxReviews) return

        // 评分
        const ratingEl = el.querySelector('[data-hook="review-star-rating"], .a-icon-star, .review-rating')
        const rating = ratingEl?.textContent?.trim() ||
                       ratingEl?.getAttribute('aria-label') ||
                       null

        // 标题
        const titleEl = el.querySelector('[data-hook="review-title"], .review-title, [data-testid="review-title"]')
        const title = titleEl?.textContent?.trim() || null

        // 正文
        const bodyEl = el.querySelector('[data-hook="review-body"], .review-text, [data-testid="review-body"]')
        const body = bodyEl?.textContent?.trim() || null

        // 有用投票
        const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"], .review-votes')
        const helpful = helpfulEl?.textContent?.trim() || null

        // 认证购买
        const verifiedEl = el.querySelector('[data-hook="avp-badge"], .avp-badge, :has-text("Verified Purchase")')
        const verified = verifiedEl !== null

        // 日期
        const dateEl = el.querySelector('[data-hook="review-date"], .review-date')
        const date = dateEl?.textContent?.trim() || null

        // 作者
        const authorEl = el.querySelector('[data-hook="genome-widget"], .a-profile-name, .review-author')
        const author = authorEl?.textContent?.trim() || null

        // 只添加有实际内容的评论
        if (title || body) {
          results.push({
            rating,
            title,
            body,
            helpful,
            verified,
            date,
            author
          })
        }
      })

      return results
    }, limit)

    console.log(`✅ 成功抓取${reviews.length}条评论`)
    return reviews

  } catch (error: any) {
    console.error('❌ 评论抓取失败:', error.message)
    return []
  }
}

// ==================== AI分析逻辑 ====================

/**
 * 使用AI分析评论数据，提取深度洞察
 *
 * @param reviews 原始评论数组
 * @param productName 产品名称
 * @param targetCountry 目标国家（用于语言适配）
 * @param userId 用户ID（用于API配额管理）
 * @returns 分析结果
 */
export async function analyzeReviewsWithAI(
  reviews: RawReview[],
  productName: string,
  targetCountry: string = 'US',
  userId?: number
): Promise<ReviewAnalysisResult> {

  if (reviews.length === 0) {
    console.log('⚠️ 无评论数据，返回空分析结果')
    return getEmptyAnalysisResult()
  }

  console.log(`🤖 开始AI分析${reviews.length}条评论...`)

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

  // 计算基础统计
  const verifiedCount = reviews.filter(r => r.verified).length
  const ratingsArray = reviews
    .map(r => parseFloat(r.rating?.match(/[\d.]+/)?.[0] || '0'))
    .filter(rating => rating > 0)
  const avgRating = ratingsArray.length > 0
    ? ratingsArray.reduce((sum, r) => sum + r, 0) / ratingsArray.length
    : 0

  // 准备评论文本（限制长度避免超token）
  const reviewTexts = reviews.slice(0, 50).map((r, idx) => {
    const ratingNum = parseFloat(r.rating?.match(/[\d.]+/)?.[0] || '0')
    const parts = [
      `Review ${idx + 1}:`,
      `Rating: ${ratingNum} stars`,
      r.verified ? '[Verified Purchase]' : '',
      `Title: ${r.title || 'N/A'}`,
      `Body: ${(r.body || '').substring(0, 500)}`, // 限制每条评论最多500字符
    ]
    return parts.filter(p => p).join('\n')
  }).join('\n\n---\n\n')

  // 构建AI分析prompt
  const prompt = `You are a professional user review analyst. Please analyze the following Amazon product reviews to extract key insights for advertising creative generation.

Product Name: ${productName}
Total Reviews to Analyze: ${reviews.length}
Target Language: ${langName}

Review Data:
${reviewTexts}

Please perform deep analysis and return results in JSON format:
{
  "sentimentDistribution": {
    "positive": 75,  // Percentage of 4-5 star reviews (0-100)
    "neutral": 15,   // Percentage of 3 star reviews (0-100)
    "negative": 10   // Percentage of 1-2 star reviews (0-100)
  },

  "topPositiveKeywords": [
    {
      "keyword": "easy setup",
      "frequency": 15,
      "sentiment": "positive",
      "context": "Many users praised the quick and simple setup process"
    },
    {
      "keyword": "clear image",
      "frequency": 23,
      "sentiment": "positive",
      "context": "Image quality is consistently rated as excellent"
    }
    // Include top 5-8 positive keywords
  ],

  "topNegativeKeywords": [
    {
      "keyword": "wifi drops",
      "frequency": 8,
      "sentiment": "negative",
      "context": "Some users experienced intermittent WiFi connectivity issues"
    }
    // Include top 3-5 negative keywords (if any exist)
  ],

  "realUseCases": [
    {
      "scenario": "home security monitoring",
      "mentions": 35,
      "examples": ["monitoring backyard", "front door surveillance", "driveway security"]
    },
    {
      "scenario": "baby monitoring",
      "mentions": 12,
      "examples": ["nursery camera", "checking on baby while sleeping"]
    }
    // Include top 3-5 real use cases extracted from reviews
  ],

  "purchaseReasons": [
    {
      "reason": "upgrade from old camera",
      "frequency": 18
    },
    {
      "reason": "recommended by friend",
      "frequency": 9
    }
    // Include top 3-5 purchase motivations
  ],

  "userProfiles": [
    {
      "profile": "tech-savvy homeowner",
      "indicators": ["mentions router settings", "understands IP cameras", "discusses technical specs"]
    },
    {
      "profile": "non-technical user",
      "indicators": ["values simplicity", "needs help from family", "focuses on ease of use"]
    }
    // Include 2-4 distinct user profiles
  ],

  "commonPainPoints": [
    {
      "issue": "app occasionally crashes",
      "severity": "moderate",
      "affectedUsers": 12,
      "workarounds": ["reinstall app", "restart phone", "clear cache"]
    },
    {
      "issue": "subscription required for cloud storage",
      "severity": "minor",
      "affectedUsers": 8,
      "workarounds": ["use SD card instead", "local storage option"]
    }
    // Include top 3-5 pain points (if any)
  ]
}

Analysis Requirements:
1. ALL text outputs (context, scenarios, issues, etc.) MUST be in ${langName}
2. Extract insights ONLY from the actual review content provided, do not fabricate
3. Prioritize high-frequency keywords and scenarios (mentioned by multiple users)
4. Pain points must be based on real negative reviews, with accurate severity assessment
5. User profiles should be based on language style and needs expressed in reviews
6. Sentiment distribution should accurately reflect the star rating distribution
7. If negative keywords or pain points are minimal or absent, return empty arrays
8. Return ONLY the JSON object, no other text or markdown formatting

IMPORTANT: Focus on actionable insights that can improve advertising creative quality.`

  try {
    // 使用Gemini AI进行分析
    const text = await generateContent({
      model: 'gemini-2.5-pro',
      prompt,
      temperature: 0.5,  // 降低温度确保更准确的提取
      maxOutputTokens: 4096,  // 较大的token限制以容纳完整分析
    }, userId)

    // 提取JSON内容
    let jsonText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('❌ AI返回格式错误，未找到JSON')
      return getEmptyAnalysisResult()
    }

    const analysisData = JSON.parse(jsonMatch[0])

    // 构建完整结果
    const result: ReviewAnalysisResult = {
      totalReviews: reviews.length,
      averageRating: parseFloat(avgRating.toFixed(1)),
      sentimentDistribution: analysisData.sentimentDistribution || { positive: 0, neutral: 0, negative: 0 },
      topPositiveKeywords: analysisData.topPositiveKeywords || [],
      topNegativeKeywords: analysisData.topNegativeKeywords || [],
      realUseCases: analysisData.realUseCases || [],
      purchaseReasons: analysisData.purchaseReasons || [],
      userProfiles: analysisData.userProfiles || [],
      commonPainPoints: analysisData.commonPainPoints || [],
      analyzedReviewCount: reviews.length,
      verifiedReviewCount: verifiedCount,
    }

    console.log('✅ AI评论分析完成')
    console.log(`   - 正面关键词: ${result.topPositiveKeywords.length}个`)
    console.log(`   - 负面关键词: ${result.topNegativeKeywords.length}个`)
    console.log(`   - 使用场景: ${result.realUseCases.length}个`)
    console.log(`   - 痛点: ${result.commonPainPoints.length}个`)

    return result

  } catch (error: any) {
    console.error('❌ AI评论分析失败:', error.message)
    return getEmptyAnalysisResult()
  }
}

/**
 * 获取空的分析结果（当无评论或分析失败时使用）
 */
function getEmptyAnalysisResult(): ReviewAnalysisResult {
  return {
    totalReviews: 0,
    averageRating: 0,
    sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
    topPositiveKeywords: [],
    topNegativeKeywords: [],
    realUseCases: [],
    purchaseReasons: [],
    userProfiles: [],
    commonPainPoints: [],
    analyzedReviewCount: 0,
    verifiedReviewCount: 0,
  }
}

// ==================== 辅助函数 ====================

/**
 * 提取评论分析中最有价值的洞察（用于广告创意生成）
 *
 * @param analysis 评论分析结果
 * @returns 结构化的洞察摘要
 */
export function extractAdCreativeInsights(analysis: ReviewAnalysisResult): {
  headlineSuggestions: string[]     // 适合用作广告标题的关键词
  descriptionHighlights: string[]   // 适合用作广告描述的卖点
  painPointAddressing: string[]     // 需要在广告中解决的痛点
  targetAudienceHints: string[]     // 目标受众描述
} {
  const insights = {
    headlineSuggestions: [] as string[],
    descriptionHighlights: [] as string[],
    painPointAddressing: [] as string[],
    targetAudienceHints: [] as string[],
  }

  // 从正面关键词提取标题建议（高频 + 情感积极）
  insights.headlineSuggestions = analysis.topPositiveKeywords
    .filter(kw => kw.frequency >= 5)  // 至少被提及5次
    .slice(0, 5)
    .map(kw => kw.keyword)

  // 从使用场景和正面关键词提取描述亮点
  insights.descriptionHighlights = [
    ...analysis.realUseCases
      .filter(uc => uc.mentions >= 3)
      .slice(0, 3)
      .map(uc => uc.scenario),
    ...analysis.topPositiveKeywords
      .slice(0, 3)
      .map(kw => kw.keyword)
  ]

  // 从痛点提取需要解决的问题（用于差异化广告）
  insights.painPointAddressing = analysis.commonPainPoints
    .filter(pp => pp.severity === 'critical' || pp.severity === 'moderate')
    .slice(0, 3)
    .map(pp => pp.issue)

  // 从用户画像提取目标受众提示
  insights.targetAudienceHints = analysis.userProfiles
    .slice(0, 3)
    .map(up => up.profile)

  return insights
}
