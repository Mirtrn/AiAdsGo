import { getDatabase, getSQLiteDatabase } from './db'
import type {
  GeneratedAdCreativeData,
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
import type { Offer } from './offers'
import { creativeCache, generateCreativeCacheKey } from './cache'
import { getKeywordSearchVolumes } from './keyword-planner'
import { generateContent, getGeminiMode } from './gemini'
import { generateNegativeKeywords } from './keyword-generator'  // 🎯 新增：导入否定关键词生成函数

// Keyword with search volume data
export interface KeywordWithVolume {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
}

/**
 * AI广告创意生成器
 * 优先使用Vertex AI，其次使用Gemini API
 */

interface AIConfig {
  type: 'vertex-ai' | 'gemini-api' | null
  vertexAI?: {
    projectId: string
    location: string
    model: string
  }
  geminiAPI?: {
    apiKey: string
    model: string
  }
}

/**
 * 获取AI配置（从settings表）
 * 优先级：用户配置 > 全局配置
 */
async function getAIConfig(userId?: number): Promise<AIConfig> {
  const db = getSQLiteDatabase()

  // 1. 先尝试获取用户特定配置（优先级最高）
  let userSettings: Record<string, string> = {}
  if (userId) {
    const userRows = db.prepare(`
      SELECT config_key, config_value FROM system_settings
      WHERE user_id = ? AND config_key IN (
        'vertex_ai_model', 'gcp_project_id', 'gcp_location',
        'gemini_api_key', 'gemini_model', 'use_vertex_ai'
      )
    `).all(userId) as Array<{ config_key: string; config_value: string }>

    userSettings = userRows.reduce((acc, { config_key, config_value }) => {
      acc[config_key] = config_value
      return acc
    }, {} as Record<string, string>)
  }

  // 2. 获取全局配置（作为备选）
  const globalRows = db.prepare(`
    SELECT config_key, config_value FROM system_settings
    WHERE user_id IS NULL AND config_key IN (
      'VERTEX_AI_PROJECT_ID', 'VERTEX_AI_LOCATION', 'VERTEX_AI_MODEL',
      'GEMINI_API_KEY', 'GEMINI_MODEL'
    )
  `).all() as Array<{ config_key: string; config_value: string }>

  const globalSettings = globalRows.reduce((acc, { config_key, config_value }) => {
    acc[config_key] = config_value
    return acc
  }, {} as Record<string, string>)

  // 3. 检查用户是否配置了使用Vertex AI
  const useVertexAI = userSettings['use_vertex_ai'] === 'true'

  // 4. 合并配置：用户配置优先
  const projectId = userSettings['gcp_project_id'] || globalSettings['VERTEX_AI_PROJECT_ID']
  const location = userSettings['gcp_location'] || globalSettings['VERTEX_AI_LOCATION']
  // 关键：用户的vertex_ai_model或gemini_model优先于全局VERTEX_AI_MODEL
  const model = userSettings['vertex_ai_model'] || userSettings['gemini_model'] || globalSettings['VERTEX_AI_MODEL']

  // 5. 检查Vertex AI配置（用户设置use_vertex_ai=true时优先）
  if (useVertexAI && projectId && location && model) {
    console.log(`🤖 使用Vertex AI: 项目=${projectId}, 区域=${location}, 模型=${model}`)
    return {
      type: 'vertex-ai',
      vertexAI: {
        projectId,
        location,
        model
      }
    }
  }

  // 6. 检查Gemini API配置
  const apiKey = userSettings['gemini_api_key'] || globalSettings['GEMINI_API_KEY']
  const geminiModel = userSettings['gemini_model'] || globalSettings['GEMINI_MODEL']

  if (apiKey && geminiModel) {
    console.log(`🤖 使用Gemini API: 模型=${geminiModel}`)
    return {
      type: 'gemini-api',
      geminiAPI: {
        apiKey,
        model: geminiModel
      }
    }
  }

  return { type: null }
}

/**
 * 获取语言指令 - 确保 AI 生成指定语言的内容
 */
function getLanguageInstruction(targetLanguage: string): string {
  const lang = targetLanguage.toLowerCase()

  if (lang.includes('italian') || lang === 'it') {
    return `🔴 IMPORTANT: Generate ALL content in ITALIAN ONLY.
- Headlines: Italian
- Descriptions: Italian
- Keywords: Italian (e.g., "robot aspirapolvere", "aspirapolvere intelligente", not "robot vacuum")
- Callouts: Italian
- Sitelinks: Italian
Do NOT use English words or mix languages. Every single word must be in Italian.`
  } else if (lang.includes('spanish') || lang === 'es') {
    return `🔴 IMPORTANT: Generate ALL content in SPANISH ONLY.
- Headlines: Spanish
- Descriptions: Spanish
- Keywords: Spanish (e.g., "robot aspirador", "aspirador inteligente", not "robot vacuum")
- Callouts: Spanish
- Sitelinks: Spanish
Do NOT use English words or mix languages. Every single word must be in Spanish.`
  } else if (lang.includes('french') || lang === 'fr') {
    return `🔴 IMPORTANT: Generate ALL content in FRENCH ONLY.
- Headlines: French
- Descriptions: French
- Keywords: French (e.g., "robot aspirateur", "aspirateur intelligent", not "robot vacuum")
- Callouts: French
- Sitelinks: French
Do NOT use English words or mix languages. Every single word must be in French.`
  } else if (lang.includes('german') || lang === 'de') {
    return `🔴 IMPORTANT: Generate ALL content in GERMAN ONLY.
- Headlines: German
- Descriptions: German
- Keywords: German (e.g., "Staubsauger-Roboter", "intelligenter Staubsauger", not "robot vacuum")
- Callouts: German
- Sitelinks: German
Do NOT use English words or mix languages. Every single word must be in German.`
  } else if (lang.includes('portuguese') || lang === 'pt') {
    return `🔴 IMPORTANT: Generate ALL content in PORTUGUESE ONLY.
- Headlines: Portuguese
- Descriptions: Portuguese
- Keywords: Portuguese (e.g., "robô aspirador", "aspirador inteligente", not "robot vacuum")
- Callouts: Portuguese
- Sitelinks: Portuguese
Do NOT use English words or mix languages. Every single word must be in Portuguese.`
  } else if (lang.includes('japanese') || lang === 'ja') {
    return `🔴 IMPORTANT: Generate ALL content in JAPANESE ONLY.
- Headlines: Japanese
- Descriptions: Japanese
- Keywords: Japanese (e.g., "ロボット掃除機", "スマート掃除機", not "robot vacuum")
- Callouts: Japanese
- Sitelinks: Japanese
Do NOT use English words or mix languages. Every single word must be in Japanese.`
  } else if (lang.includes('korean') || lang === 'ko') {
    return `🔴 IMPORTANT: Generate ALL content in KOREAN ONLY.
- Headlines: Korean
- Descriptions: Korean
- Keywords: Korean (e.g., "로봇 청소기", "스마트 청소기", not "robot vacuum")
- Callouts: Korean
- Sitelinks: Korean
Do NOT use English words or mix languages. Every single word must be in Korean.`
  } else if (lang.includes('russian') || lang === 'ru') {
    return `🔴 IMPORTANT: Generate ALL content in RUSSIAN ONLY.
- Headlines: Russian
- Descriptions: Russian
- Keywords: Russian (e.g., "робот-пылесос", "умный пылесос", not "robot vacuum")
- Callouts: Russian
- Sitelinks: Russian
Do NOT use English words or mix languages. Every single word must be in Russian.`
  } else if (lang.includes('arabic') || lang === 'ar') {
    return `🔴 IMPORTANT: Generate ALL content in ARABIC ONLY.
- Headlines: Arabic
- Descriptions: Arabic
- Keywords: Arabic (e.g., "روبوت مكنسة", "مكنسة ذكية", not "robot vacuum")
- Callouts: Arabic
- Sitelinks: Arabic
Do NOT use English words or mix languages. Every single word must be in Arabic.`
  } else if (lang.includes('chinese') || lang === 'zh') {
    return `🔴 IMPORTANT: Generate ALL content in CHINESE ONLY.
- Headlines: Chinese
- Descriptions: Chinese
- Keywords: Chinese (e.g., "扫地机器人", "智能吸尘器", not "robot vacuum")
- Callouts: Chinese
- Sitelinks: Chinese
Do NOT use English words or mix languages. Every single word must be in Chinese.`
  } else if (lang.includes('swedish') || lang === 'sv') {
    return `🔴 IMPORTANT: Generate ALL content in SWEDISH ONLY.
- Headlines: Swedish
- Descriptions: Swedish
- Keywords: Swedish (e.g., "robotdammsugare", "smart dammsugare", not "robot vacuum")
- Callouts: Swedish
- Sitelinks: Swedish
Do NOT use English words or mix languages. Every single word must be in Swedish.`
  } else if (lang.includes('swiss german') || lang === 'de-ch') {
    return `🔴 IMPORTANT: Generate ALL content in SWISS GERMAN ONLY.
- Headlines: Swiss German
- Descriptions: Swiss German
- Keywords: Swiss German (e.g., "Roboter-Staubsauger", "intelligenter Staubsauger", not "robot vacuum")
- Callouts: Swiss German
- Sitelinks: Swiss German
Do NOT use English words or mix languages. Every single word must be in Swiss German.`
  }

  // Default to English
  return `Generate content in English.`
}

/**
 * 生成广告创意的Prompt（优化版 - 减少40%+ token消耗）
 * 🎯 需求34: 新增 extractedElements 参数，包含从爬虫阶段提取的关键词、标题、描述
 */
function buildAdCreativePrompt(
  offer: any,
  theme?: string,
  referencePerformance?: any,
  excludeKeywords?: string[],
  extractedElements?: {
    keywords?: Array<{ keyword: string; searchVolume: number; source: string; priority: string }>
    headlines?: string[]
    descriptions?: string[]
  }
): string {
  // 基础产品信息（精简格式）
  const targetLanguage = offer.target_language || 'English'
  const languageInstruction = getLanguageInstruction(targetLanguage)

  let prompt = `${languageInstruction}

Generate Google Ads creative for ${offer.brand} (${offer.category || 'product'}).

PRODUCT: ${offer.brand_description || offer.unique_selling_points || 'Quality product'}
USPs: ${offer.unique_selling_points || offer.product_highlights || 'Premium quality'}
AUDIENCE: ${offer.target_audience || 'General'}
COUNTRY: ${offer.target_country} | LANGUAGE: ${targetLanguage}
`

  // 🔥 P0优化：增强数据 - 添加真实折扣、促销、排名、徽章等爬虫抓取的数据
  const extras: string[] = []

  // 价格信息（优先使用爬虫数据的原始字段）
  let currentPrice = null
  let originalPrice = null
  let discount = null

  if (offer.pricing) {
    try {
      const pricing = JSON.parse(offer.pricing)
      currentPrice = pricing.current || pricing.price
      originalPrice = pricing.original
      discount = pricing.discount
    } catch {}
  }

  if (currentPrice) {
    extras.push(`PRICE: ${currentPrice}`)
  }
  if (originalPrice && discount) {
    extras.push(`ORIGINAL: ${originalPrice} | DISCOUNT: ${discount}`)
  }

  // 促销信息（优先使用爬虫数据）
  let promotion = null
  if (offer.promotions) {
    try {
      const promos = JSON.parse(offer.promotions)
      promotion = promos.current
    } catch {}
  }
  if (promotion) {
    extras.push(`PROMOTION: ${promotion}`)
  }

  // 🔥 P0-2: 销售排名和徽章（社会证明）
  let salesRank = null
  let badge = null
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      salesRank = scrapedData.salesRank
      badge = scrapedData.badge
    } catch {}
  }
  if (salesRank) {
    // 提取排名数字，例如 "#1,234 in Electronics" → "#1,234"
    const rankMatch = salesRank.match(/#[\d,]+/)
    if (rankMatch) {
      extras.push(`SALES RANK: ${rankMatch[0]}`)
    }
  }
  if (badge) {
    extras.push(`BADGE: ${badge}`)
  }

  // 🔥 P0-3: Prime资格和库存状态
  let primeEligible = false
  let availability = null
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      primeEligible = scrapedData.primeEligible || scrapedData.isPrime || false
      availability = scrapedData.availability
    } catch {}
  }
  if (primeEligible) {
    extras.push(`PRIME: Yes`)
  }
  if (availability) {
    extras.push(`STOCK: ${availability}`)
  }

  // 🔥 P1-1: 用户评论洞察（基础）
  let reviewHighlights: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      reviewHighlights = scrapedData.reviewHighlights || []
    } catch {}
  }
  if (reviewHighlights.length > 0) {
    extras.push(`REVIEW INSIGHTS: ${reviewHighlights.slice(0, 5).join(', ')}`)
  }

  // 🔥 P1-1+: 用户评论深度分析（增强版 - 充分利用所有评论分析字段）
  let commonPraises: string[] = []
  let purchaseReasons: string[] = []
  let useCases: string[] = []
  let commonPainPoints: string[] = []
  // 🆕 新增字段
  let topPositiveKeywords: Array<{keyword: string; frequency: number; context?: string}> = []
  let topNegativeKeywords: Array<{keyword: string; frequency: number; context?: string}> = []
  let userProfiles: Array<{profile: string; indicators?: string[]}> = []
  let sentimentDistribution: {positive: number; neutral: number; negative: number} | null = null
  let totalReviews: number = 0
  let averageRating: number = 0

  if (offer.review_analysis) {
    try {
      const reviewAnalysis = JSON.parse(offer.review_analysis)
      // 原有字段
      commonPraises = reviewAnalysis.commonPraises || []
      purchaseReasons = (reviewAnalysis.purchaseReasons || []).map((r: any) =>
        typeof r === 'string' ? r : r.reason || r
      )
      useCases = (reviewAnalysis.realUseCases || reviewAnalysis.useCases || []).map((u: any) =>
        typeof u === 'string' ? u : u.scenario || u
      )
      commonPainPoints = (reviewAnalysis.commonPainPoints || []).map((p: any) =>
        typeof p === 'string' ? p : p.issue || p
      )
      // 🆕 新增字段提取
      topPositiveKeywords = reviewAnalysis.topPositiveKeywords || []
      topNegativeKeywords = reviewAnalysis.topNegativeKeywords || []
      userProfiles = reviewAnalysis.userProfiles || []
      sentimentDistribution = reviewAnalysis.sentimentDistribution || null
      totalReviews = reviewAnalysis.totalReviews || 0
      averageRating = reviewAnalysis.averageRating || 0
    } catch {}
  }

  // 将深度评论分析数据添加到Prompt
  if (commonPraises.length > 0) {
    extras.push(`USER PRAISES: ${commonPraises.slice(0, 3).join(', ')}`)
  }
  if (purchaseReasons.length > 0) {
    extras.push(`WHY BUY: ${purchaseReasons.slice(0, 3).join(', ')}`)
  }
  if (useCases.length > 0) {
    extras.push(`USE CASES: ${useCases.slice(0, 3).join(', ')}`)
  }
  if (commonPainPoints.length > 0) {
    extras.push(`AVOID: ${commonPainPoints.slice(0, 2).join(', ')}`)
  }

  // 🆕 新增：正面关键词作为关键词参考（高频用户好评词）
  if (topPositiveKeywords.length > 0) {
    const positiveKWs = topPositiveKeywords
      .slice(0, 5)
      .map(k => `"${k.keyword}"(${k.frequency}x)`)
      .join(', ')
    extras.push(`POSITIVE KEYWORDS: ${positiveKWs}`)
  }

  // 🆕 新增：情感分布作为社会证明（高好评率）
  if (sentimentDistribution && totalReviews > 0) {
    const positiveRate = sentimentDistribution.positive
    if (positiveRate >= 80) {
      extras.push(`SOCIAL PROOF: ${positiveRate}% positive reviews from ${totalReviews} customers${averageRating ? `, ${averageRating} stars` : ''}`)
    } else if (positiveRate >= 60) {
      extras.push(`REVIEWS: ${totalReviews} customer reviews${averageRating ? `, ${averageRating} avg rating` : ''}`)
    }
  }

  // 🆕 新增：用户画像用于受众定制
  if (userProfiles.length > 0) {
    const profiles = userProfiles.slice(0, 3).map(p => p.profile).join(', ')
    extras.push(`TARGET PERSONAS: ${profiles}`)
  }

  // 🔥 P1-2: 技术规格（关键参数）
  let technicalDetails: Record<string, string> = {}
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      technicalDetails = scrapedData.technicalDetails || {}
    } catch {}
  }
  if (Object.keys(technicalDetails).length > 0) {
    // 提取前3个最重要的技术参数
    const topSpecs = Object.entries(technicalDetails)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ')
    extras.push(`SPECS: ${topSpecs}`)
  }

  // 🔥 P1-3: Store热销数据（新增优化 - 用于Amazon Store或独立站店铺页）
  let hotInsights: { avgRating: number; avgReviews: number; topProductsCount: number } | null = null
  let topProducts: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      hotInsights = scrapedData.hotInsights || null
      // 提取热销产品名称（如果有products数组）
      if (scrapedData.products && Array.isArray(scrapedData.products)) {
        topProducts = scrapedData.products
          .slice(0, 5)
          .map((p: any) => p.name || p.productName)
          .filter(Boolean)
      }
    } catch {}
  }

  // 如果是Store页面，添加热销洞察到Prompt
  if (hotInsights && topProducts.length > 0) {
    extras.push(`STORE HOT PRODUCTS: ${topProducts.slice(0, 3).join(', ')} (Avg: ${hotInsights.avgRating.toFixed(1)}⭐, ${hotInsights.avgReviews} reviews)`)
  }

  if (extras.length) prompt += '\n' + extras.join(' | ') + '\n'

  // 主题要求（精简版）
  if (theme) {
    prompt += `\n**THEME: ${theme}** - All content must reflect this theme. 60%+ headlines should directly embody theme.\n`
  }

  // 历史表现参考（精简版）
  if (referencePerformance) {
    if (referencePerformance.best_headlines?.length) {
      prompt += `TOP HEADLINES: ${referencePerformance.best_headlines.slice(0, 3).join(', ')}\n`
    }
    if (referencePerformance.top_keywords?.length) {
      prompt += `TOP KEYWORDS: ${referencePerformance.top_keywords.slice(0, 5).join(', ')}\n`
    }
  }

  // 🎯 需求34: 提取的广告元素作为参考（从爬虫阶段获取）
  if (extractedElements) {
    if (extractedElements.keywords && extractedElements.keywords.length > 0) {
      const topKeywords = extractedElements.keywords
        .filter(k => k.searchVolume >= 500)
        .slice(0, 10)
        .map(k => `"${k.keyword}" (${k.searchVolume}/mo, ${k.source})`)
      if (topKeywords.length > 0) {
        prompt += `\n**EXTRACTED KEYWORDS** (from product data, validated by Keyword Planner):\n${topKeywords.join(', ')}\n`
      }
    }

    if (extractedElements.headlines && extractedElements.headlines.length > 0) {
      prompt += `\n**EXTRACTED HEADLINES** (from product titles, ≤30 chars):\n${extractedElements.headlines.slice(0, 5).join(', ')}\n`
    }

    if (extractedElements.descriptions && extractedElements.descriptions.length > 0) {
      prompt += `\n**EXTRACTED DESCRIPTIONS** (from product features, ≤90 chars):\n${extractedElements.descriptions.slice(0, 2).join('; ')}\n`
    }

    prompt += `\n**INSTRUCTION**: Use above extracted elements as reference. You can refine, expand, or create variations, but prioritize extracted keywords (they have real search volume). Generate complete 15 headlines and 4 descriptions as required.\n`
  }

  // 核心要求（增强版 - 指导如何使用真实数据）
  prompt += `
## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:${offer.brand}} Official" - Must be EXACTLY this format, no extra words
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format. All other 14 headlines MUST NOT contain {KeyWord:...} or any DKI syntax.

**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two headlines
- Each headline must have a UNIQUE angle, focus, or emotional trigger
- NO headline should repeat more than 2 words from another headline
- Each headline should use DIFFERENT primary keywords or features
- Vary sentence structure: statements, questions, commands, exclamations
- Use DIFFERENT emotional triggers: trust, urgency, value, curiosity, exclusivity, social proof

Remaining 14 headlines - Types (must cover all 5):
- Brand (2): ${badge ? `Use BADGE if available (e.g., "${badge} Brand")` : '"Trusted Brand"'}, ${salesRank ? `Use SALES RANK if available (e.g., "#1 Best Seller")` : `"#1 ${offer.category || 'Choice'}"`}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: For stores with hot products, create "Best Seller Collection" headlines featuring top products (e.g., "Best ${topProducts[0]?.split(' ').slice(0, 2).join(' ')} Collection")` : ''}${sentimentDistribution && sentimentDistribution.positive >= 80 ? `. **SOCIAL PROOF**: Use high approval rate: "${sentimentDistribution.positive}% Love It", "Rated ${averageRating} Stars"` : ''}
  * IMPORTANT: Make these 2 brand headlines COMPLETELY DIFFERENT in focus and wording
  * Example 1: "Official ${offer.brand} Store" (trust focus)
  * Example 2: "#1 Trusted ${offer.brand}" (social proof focus)
  * ❌ AVOID: "Official ${offer.brand}", "Official ${offer.brand} Brand" (too similar)

- Feature (4): ${Object.keys(technicalDetails).length > 0 ? 'Use SPECS data for technical features' : 'Core product benefits'}${reviewHighlights.length > 0 ? `, incorporate REVIEW INSIGHTS (e.g., "${reviewHighlights[0]}")` : ''}${commonPraises.length > 0 ? `. **USER PRAISES**: Use authentic features: ${commonPraises.slice(0, 2).join(', ')}` : ''}${topPositiveKeywords.length > 0 ? `. **POSITIVE KEYWORDS**: Incorporate high-frequency praise words: ${topPositiveKeywords.slice(0, 3).map(k => k.keyword).join(', ')}` : ''}
  * IMPORTANT: Each of the 4 feature headlines must focus on a DIFFERENT feature or benefit
  * Example 1: "4K Resolution Display" (technical spec)
  * Example 2: "Extended Battery Life" (performance benefit)
  * Example 3: "Smart Navigation System" (functionality)
  * Example 4: "Eco-Friendly Design" (sustainability)
  * ❌ AVOID: "4K Display", "4K Resolution", "High Resolution" (too similar)

- Promo (3): ${discount || promotion ? `MUST use real DISCOUNT/PROMOTION data: ${discount ? `"${discount}"` : ''}${promotion ? ` or "${promotion}"` : ''}` : 'Numbers/% required - "Save 40%", "$50 Off"'}
  * IMPORTANT: Each promo headline must use a DIFFERENT promotional angle
  * Example 1: "Save 40% Today" (discount focus)
  * Example 2: "$100 Off This Week" (amount focus)
  * Example 3: "Limited Time Offer" (urgency focus)
  * ❌ AVOID: "Save 40%", "40% Off", "40% Discount" (too similar)

- CTA (3): "Shop Now", "Get Yours Today"${primeEligible ? ', "Prime Eligible"' : ''}${purchaseReasons.length > 0 ? `. **WHY BUY**: Incorporate purchase motivations: ${purchaseReasons.slice(0, 2).join(', ')}` : ''}
  * IMPORTANT: Each CTA headline must use a DIFFERENT call-to-action verb or angle
  * Example 1: "Shop Now" (direct action)
  * Example 2: "Get Yours Today" (possession focus)
  * Example 3: "Claim Your Deal" (exclusivity focus)
  * ❌ AVOID: "Shop Now", "Shop Today", "Buy Now" (too similar)

- Urgency (2): ${availability && availability.includes('left') ? `Use real STOCK data: "${availability}"` : '"Limited Time", "Ends Soon"'}
  * IMPORTANT: Each urgency headline must use a DIFFERENT urgency signal
  * Example 1: "Only 5 Left in Stock" (scarcity focus)
  * Example 2: "Ends Tomorrow" (time limit focus)
  * ❌ AVOID: "Limited Stock", "Limited Time", "Limited Offer" (too similar)

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity between ANY two headlines

### DESCRIPTIONS (4 required, ≤90 chars each)
**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording
**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two descriptions
- Each description must have a COMPLETELY DIFFERENT focus and angle
- NO description should repeat more than 2 words from another description
- Use DIFFERENT emotional triggers and value propositions
- Vary the structure: benefit-focused, action-focused, feature-focused, proof-focused

- **Description 1 (Value-Driven)**: Lead with the PRIMARY benefit or competitive advantage${badge ? `. MUST mention BADGE: "${badge}"` : ''}${salesRank ? `. MUST mention SALES RANK` : ''}
  * Focus: What makes this product/brand special (unique value proposition)
  * Example: "Award-Winning Tech. Rated 4.8 stars by 50K+ Happy Customers."
  * ❌ AVOID: Repeating "shop", "buy", "get" from other descriptions

- **Description 2 (Action-Oriented)**: Strong CTA with immediate incentive${primeEligible ? ' + Prime eligibility' : ''}
  * Focus: Urgency + convenience + trust signal (action-focused)
  * Example: "Shop Now for Fast, Free Delivery. Easy Returns Guaranteed."
  * ❌ AVOID: Using the same CTA verb as Description 1 or 3

- **Description 3 (Feature-Rich)**: Specific product features or use cases${useCases.length > 0 ? `. **USE CASES**: Reference real scenarios: ${useCases.slice(0, 2).join(', ')}` : ''}${userProfiles.length > 0 ? `. **TARGET PERSONAS**: Speak to: ${userProfiles.slice(0, 2).map(p => p.profile).join(', ')}` : ''}
  * Focus: Technical specs, capabilities, or versatility (feature-focused)
  * Example: "4K Resolution. Solar Powered. Works Rain or Shine."
  * ❌ AVOID: Mentioning "award", "rated", "trusted" from other descriptions

- **Description 4 (Trust + Social Proof)**: Customer validation or support${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: Mention product variety and quality (Avg: ${hotInsights.avgRating.toFixed(1)} stars from ${hotInsights.avgReviews}+ reviews)` : ''}${sentimentDistribution && totalReviews > 0 ? `. **SOCIAL PROOF DATA**: ${sentimentDistribution.positive}% positive from ${totalReviews} reviews${averageRating ? `, ${averageRating} stars` : ''}` : ''}
  * Focus: Reviews, ratings, guarantees, customer service (proof-focused)
  * Example: "Trusted by 100K+ Buyers. 30-Day Money-Back Promise."
  * ❌ AVOID: Repeating "fast", "free", "easy" from other descriptions

**CRITICAL DIVERSITY CHECKLIST**:
- ✓ Description 1 focuses on VALUE (what makes it special)
- ✓ Description 2 focuses on ACTION (what to do now)
- ✓ Description 3 focuses on FEATURES (what it can do)
- ✓ Description 4 focuses on PROOF (why to trust it)
- ✓ Each uses DIFFERENT keywords and phrases
- ✓ Each has a DIFFERENT emotional trigger
- ✓ Maximum 20% similarity between any two descriptions
**LEVERAGE DATA**:${reviewHighlights.length > 0 ? ` Review insights: ${reviewHighlights.slice(0, 3).join(', ')}` : ''}${commonPraises.length > 0 ? ` User praises: ${commonPraises.slice(0, 2).join(', ')}` : ''}${topPositiveKeywords.length > 0 ? ` Positive keywords: ${topPositiveKeywords.slice(0, 3).map(k => k.keyword).join(', ')}` : ''}${commonPainPoints.length > 0 ? ` (Address pain points indirectly - don't highlight negatives): ${commonPainPoints.slice(0, 2).join(', ')}` : ''}


### KEYWORDS (20-30 required)
**🎯 关键词生成策略（重要！确保高搜索量关键词优先）**:
**⚠️ 强制约束：所有关键词必须使用目标语言 ${offer.target_language || 'English'}，不能使用英文！**

**第一优先级 - 品牌短尾词 (必须生成8-10个)**:
- 格式: [品牌名] + [产品核心词]（2-3个单词）
- ✅ 必须包含的品牌短尾词（基于 ${offer.brand}）:
  - "${offer.brand} ${offer.category || 'products'}"（品牌+品类）
  - "${offer.brand} official"（品牌+官方）
  - "${offer.brand} store"（品牌+商店）
  - "${offer.brand} [型号/系列]"（如有型号信息）
  - "${offer.brand} buy"（品牌+购买）
  - "${offer.brand} price"（品牌+价格）
  - "${offer.brand} review"（品牌+评测）
  - "${offer.brand} [主要特性]"（品牌+特性）
- ✅ 示例 (英文): "eufy robot vacuum", "eufy c20", "eufy cleaner", "eufy official", "eufy buy", "eufy price"
- ✅ 示例 (意大利语): "eufy robot aspirapolvere", "eufy c20", "eufy pulitore", "eufy ufficiale", "eufy acquista", "eufy prezzo"
- ❌ 避免: 仅品牌名单词（过于宽泛）

**第二优先级 - 产品核心词 (必须生成6-8个)**:
- 格式: [产品功能] + [类别]（2-3个单词）
- ✅ 示例 (英文): "robot vacuum mop", "self emptying vacuum", "cordless vacuum cleaner", "smart vacuum", "app controlled vacuum"
- ✅ 示例 (意大利语): "robot aspirapolvere e lavapavimenti", "aspirapolvere svuotamento automatico", "aspirapolvere senza fili", "aspirapolvere intelligente", "aspirapolvere controllata da app"
- ✅ 为什么优秀: 高搜索量（通常5000-50000/月），匹配用户搜索意图

**第三优先级 - 购买意图词 (必须生成3-5个)**:
- 格式: [购买动词] + [品牌/产品]
- ✅ 示例 (英文): "buy ${offer.brand}", "shop ${offer.brand}", "best ${offer.brand} price", "${offer.brand} deals", "where to buy ${offer.brand}"
- ✅ 示例 (意大利语): "acquista ${offer.brand}", "negozio ${offer.brand}", "miglior prezzo ${offer.brand}", "offerte ${offer.brand}", "dove acquistare ${offer.brand}"

**第四优先级 - 长尾精准词 (必须生成3-7个)**:
- 格式: [具体场景] + [产品]（3-5个单词）
- ✅ 示例 (英文): "best robot vacuum for pet hair", "robot vacuum for hardwood floors", "quiet robot vacuum", "robot vacuum with mop"
- ✅ 示例 (意大利语): "miglior aspirapolvere per peli di animali", "aspirapolvere per pavimenti in legno", "aspirapolvere silenzioso", "aspirapolvere con funzione lavapavimenti"
- ⚠️ 注意: 长尾词可以超过总关键词数的25%

**🔴 强制语言要求**:
- 关键词必须使用目标语言 ${offer.target_language || 'English'}
- 如果目标语言是意大利语，所有关键词必须是意大利语
- 如果目标语言是西班牙语，所有关键词必须是西班牙语
- 不能混合使用英文和目标语言
- 不能使用英文关键词
**质量要求**:
- 每个关键词2-4个单词（最优搜索量范围）
- 关键词总数: 20-30个
- 搜索量目标: 品牌词>1000/月，核心词>500/月，长尾词>100/月
**🚫 禁止**:
- 无意义词: "unknown", "null", "undefined"
- 单一通用词: "camera", "phone", "vacuum"
- 与${offer.brand}无关的关键词
${excludeKeywords?.length ? `- 已用关键词: ${excludeKeywords.slice(0, 10).join(', ')}` : ''}

### CALLOUTS (4-6, ≤25 chars)
${primeEligible ? '- **MUST include**: "Prime Free Shipping"' : '- Free Shipping'}
${availability && !availability.toLowerCase().includes('out of stock') ? '- **MUST include**: "In Stock Now"' : ''}
${badge ? `- **MUST include**: "${badge}"` : ''}
- 24/7 Support, Money Back Guarantee, etc.

### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)
- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description
- Focus on different product features, benefits, or use cases
- Avoid repeating similar phrases across sitelinks
- Examples: "Free 2-Day Prime Delivery", "30-Day Money Back Promise", "Expert Tech Support 24/7"

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
  * Use text alternatives instead: "stars" or "star rating" instead of ★
  * Use "Rated 4.8 stars" NOT "4.8★"
  * Use "Top Choice" NOT "Top Choice ✓"
**❌ Excessive Punctuation**: "!!!", "???", "...", repeated exclamation marks

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool}...],
  "descriptions": [{"text":"...", "type":"value|cta", "length":N, "hasCTA":bool, "keywords":[]}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_relevance_score":N, "estimated_ad_strength":"EXCELLENT"}
}`

  return prompt
}

/**
 * 使用Vertex AI生成广告创意
 */
async function generateWithVertexAI(
  config: NonNullable<AIConfig['vertexAI']>,
  prompt: string
): Promise<GeneratedAdCreativeData> {
  const { VertexAI } = await import('@google-cloud/vertexai')

  const vertexAI = new VertexAI({
    project: config.projectId,
    location: config.location,
  })

  const model = vertexAI.getGenerativeModel({
    model: config.model,
  })

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 16384,  // 增加以容纳完整创意（含完整metadata）
    },
  })

  const response = result.response
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text || ''

  // 调试信息：检查响应是否被截断
  const finishReason = response.candidates?.[0]?.finishReason
  console.log(`🔍 Vertex AI finishReason: ${finishReason}`)
  if (finishReason === 'MAX_TOKENS') {
    console.warn('⚠️ 响应因达到token上限而被截断!')
  }

  return parseAIResponse(text)
}

/**
 * 使用Gemini API生成广告创意
 */
async function generateWithGeminiAPI(
  config: NonNullable<AIConfig['geminiAPI']>,
  prompt: string
): Promise<GeneratedAdCreativeData> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')

  const genAI = new GoogleGenerativeAI(config.apiKey)
  const model = genAI.getGenerativeModel({ model: config.model })

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 16384,  // 增加以容纳完整创意（含完整metadata）
    },
  })

  const response = result.response
  const text = response.text()

  return parseAIResponse(text)
}

/**
 * 规范化非ASCII数字为ASCII数字
 * 将Bengali、Arabic、Devanagari等语言的数字转换为ASCII 0-9
 */
function normalizeDigits(text: string): string {
  // 映射：非ASCII数字 → ASCII数字
  const digitMap: Record<string, string> = {
    // Bengali digits (০-৯)
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
    // Arabic-Indic digits (٠-٩)
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    // Persian/Extended Arabic-Indic digits (۰-۹)
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    // Devanagari digits (०-९)
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
  }

  let normalized = text
  for (const [nonAscii, ascii] of Object.entries(digitMap)) {
    normalized = normalized.replace(new RegExp(nonAscii, 'g'), ascii)
  }
  return normalized
}

/**
 * 解析AI响应
 */
function parseAIResponse(text: string): GeneratedAdCreativeData {
  console.log('🔍 AI原始响应长度:', text.length)
  console.log('🔍 AI原始响应前500字符:', text.substring(0, 500))

  // 移除可能的markdown代码块标记
  let jsonText = text.trim()
  jsonText = jsonText.replace(/^```json\n?/, '')
  jsonText = jsonText.replace(/^```\n?/, '')
  jsonText = jsonText.replace(/\n?```$/, '')
  jsonText = jsonText.trim()

  console.log('🔍 清理markdown后长度:', jsonText.length)
  console.log('🔍 清理markdown后前200字符:', jsonText.substring(0, 200))

  // 尝试提取JSON对象（如果AI在JSON前后加了其他文本）
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    jsonText = jsonMatch[0]
    console.log('✅ 成功提取JSON对象，长度:', jsonText.length)
  } else {
    console.warn('⚠️ 未能通过正则提取JSON对象')
  }

  // 修复常见的JSON格式错误
  // 1. 移除尾部逗号（数组和对象中）
  jsonText = jsonText.replace(/,\s*([}\]])/g, '$1')
  // 2. 修复智能引号（替换为标准ASCII引号）
  jsonText = jsonText.replace(/[""]/g, '"')  // 花引号 " " → 直引号 "
  jsonText = jsonText.replace(/['']/g, "'")  // 花单引号 ' ' → 直单引号 '
  // 3. 移除JSON中的非法标识符行（如 LAGGS_CALLOUTS 等调试输出）
  jsonText = jsonText.replace(/],\s*[A-Z_]+\s*\n\s*"/g, '],\n  "')
  // 4. 移除JSON字符串值中的换行符（保留结构性换行）
  // 只处理字符串值内部的换行（字母/标点后跟换行再跟字母）
  jsonText = jsonText.replace(/([a-zA-Z,.])\s*\n\s*([a-zA-Z])/g, '$1 $2')
  // 5. 规范化非ASCII数字为ASCII数字（修复Bengali等其他语言的数字）
  jsonText = normalizeDigits(jsonText)

  console.log('🔍 修复后JSON前200字符:', jsonText.substring(0, 200))

  // 临时调试：将JSON写入stderr以便检查
  console.error('🐛 JSON前1000字符:', jsonText.substring(0, 1000))
  console.error('🐛 JSON后500字符:', jsonText.substring(Math.max(0, jsonText.length - 500)))

  try {
    const data = JSON.parse(jsonText)

    // 验证必需字段
    if (!data.headlines || !Array.isArray(data.headlines) || data.headlines.length < 3) {
      throw new Error('Headlines格式无效或数量不足')
    }

    if (!data.descriptions || !Array.isArray(data.descriptions) || data.descriptions.length < 2) {
      throw new Error('Descriptions格式无效或数量不足')
    }

    if (!data.keywords || !Array.isArray(data.keywords)) {
      throw new Error('Keywords格式无效')
    }

    // 处理headlines格式（支持新旧格式）
    let headlinesArray: string[]
    let headlinesWithMetadata: HeadlineAsset[] | undefined

    // 检测格式：第一个元素是string还是object
    const isNewFormat = data.headlines.length > 0 && typeof data.headlines[0] === 'object'

    if (isNewFormat) {
      // 新格式：对象数组（带metadata）
      headlinesWithMetadata = data.headlines as HeadlineAsset[]
      headlinesArray = headlinesWithMetadata.map(h => h.text)
      console.log('✅ 检测到新格式headlines（带metadata）')
    } else {
      // 旧格式：字符串数组
      headlinesArray = data.headlines as string[]
      console.log('✅ 检测到旧格式headlines（字符串数组）')
    }

    // 处理descriptions格式
    let descriptionsArray: string[]
    let descriptionsWithMetadata: DescriptionAsset[] | undefined

    const isDescNewFormat = data.descriptions.length > 0 && typeof data.descriptions[0] === 'object'

    if (isDescNewFormat) {
      descriptionsWithMetadata = data.descriptions as DescriptionAsset[]
      descriptionsArray = descriptionsWithMetadata.map(d => d.text)
      console.log('✅ 检测到新格式descriptions（带metadata）')
    } else {
      descriptionsArray = data.descriptions as string[]
      console.log('✅ 检测到旧格式descriptions（字符串数组）')
    }

    // 验证字符长度
    const invalidHeadlines = headlinesArray.filter((h: string) => h.length > 30)
    if (invalidHeadlines.length > 0) {
      console.warn(`警告: ${invalidHeadlines.length}个headline超过30字符限制`)
      // 截断过长的headlines
      headlinesArray = headlinesArray.map((h: string) => h.substring(0, 30))

      // 同步更新metadata中的text
      if (headlinesWithMetadata) {
        headlinesWithMetadata = headlinesWithMetadata.map(h => ({
          ...h,
          text: h.text.substring(0, 30),
          length: Math.min(h.length || h.text.length, 30)
        }))
      }
    }

    // 🔥 修复Ad Customizer标签格式（DKI语法验证）
    // 问题：AI可能生成 "{KeyWord:Text" 缺少结束符 "}"
    const fixDKISyntax = (text: string): string => {
      // 检测未闭合的 {KeyWord: 标签
      const unclosedPattern = /\{KeyWord:([^}]*?)$/i
      if (unclosedPattern.test(text)) {
        // 尝试修复：如果只是缺少结束符，添加它
        const match = text.match(unclosedPattern)
        if (match) {
          const defaultText = match[1].trim()
          // Google Ads headline限制30字符，DKI的defaultText也应支持到30字符
          if (defaultText.length > 0 && defaultText.length <= 30) {
            // 合理的默认文本长度，添加结束符
            console.log(`🔧 修复DKI标签: "${text}" → "${text}}"`)
            return text + '}'
          } else {
            // 默认文本过长或为空，移除整个DKI标签
            const fixedText = text.replace(unclosedPattern, match[1].trim() || '')
            console.log(`🔧 移除无效DKI标签（defaultText长度${defaultText.length}）: "${text}" → "${fixedText}"`)
            return fixedText
          }
        }
      }
      return text
    }

    // 🔥 过滤Google Ads禁止的符号（Policy Violation防御）
    const removeProhibitedSymbols = (text: string): string => {
      // Google Ads禁止的符号列表（基于SYMBOLS policy）
      const prohibitedSymbols = [
        '★', '☆', '⭐', '🌟', '✨',  // 星星符号
        '©', '®', '™',              // 版权商标符号
        '•', '●', '◆', '▪',         // 项目符号
        '→', '←', '↑', '↓',         // 箭头符号
        '✓', '✔', '✗', '✘',         // 勾选符号
        '❤', '♥',                    // 心形符号
        '⚡', '🔥', '💎',            // 装饰性emoji
        '👍', '👎'                   // 手势emoji
      ]

      let cleaned = text
      let removedSymbols: string[] = []

      for (const symbol of prohibitedSymbols) {
        if (cleaned.includes(symbol)) {
          removedSymbols.push(symbol)
          // 替换规则：星星符号替换为 "star(s)"，其他符号直接删除
          if (['★', '☆', '⭐', '🌟', '✨'].includes(symbol)) {
            cleaned = cleaned.replace(new RegExp(symbol, 'g'), 'stars')
          } else if (['✓', '✔'].includes(symbol)) {
            cleaned = cleaned.replace(new RegExp(symbol, 'g'), '')  // 直接删除
          } else {
            cleaned = cleaned.replace(new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
          }
        }
      }

      if (removedSymbols.length > 0) {
        console.log(`🛡️ 移除违规符号: "${text}" → "${cleaned}" (移除: ${removedSymbols.join(', ')})`)
      }

      return cleaned.trim()
    }

    // 应用DKI修复到所有headlines
    const originalHeadlines = [...headlinesArray]
    headlinesArray = headlinesArray.map((h: string) => fixDKISyntax(h))
    const fixedCount = headlinesArray.filter((h: string, i: number) => h !== originalHeadlines[i]).length
    if (fixedCount > 0) {
      console.log(`✅ 修复了${fixedCount}个DKI标签格式问题`)
    }

    // 🔥 新增：应用符号过滤到所有headlines和descriptions
    headlinesArray = headlinesArray.map((h: string) => removeProhibitedSymbols(h))
    descriptionsArray = descriptionsArray.map((d: string) => removeProhibitedSymbols(d))

    const invalidDescriptions = descriptionsArray.filter((d: string) => d.length > 90)
    if (invalidDescriptions.length > 0) {
      console.warn(`警告: ${invalidDescriptions.length}个description超过90字符限制`)
      // 截断过长的descriptions
      descriptionsArray = descriptionsArray.map((d: string) => d.substring(0, 90))

      // 同步更新metadata中的text
      if (descriptionsWithMetadata) {
        descriptionsWithMetadata = descriptionsWithMetadata.map(d => ({
          ...d,
          text: d.text.substring(0, 90),
          length: Math.min(d.length || d.text.length, 90)
        }))
      }
    }

    // ============================================================================
    // 验证 Callouts 长度 (≤25 字符)
    // ============================================================================
    let calloutsArray = Array.isArray(data.callouts) ? data.callouts : []
    const invalidCallouts = calloutsArray.filter((c: string) => c && c.length > 25)
    if (invalidCallouts.length > 0) {
      console.warn(`警告: ${invalidCallouts.length}个callout超过25字符限制`)
      console.warn(`  超长callouts: ${invalidCallouts.map((c: string) => `"${c}"(${c.length}字符)`).join(', ')}`)
      // 截断过长的callouts
      calloutsArray = calloutsArray.map((c: string) => {
        if (c && c.length > 25) {
          const truncated = c.substring(0, 25)
          console.warn(`  截断: "${c}" → "${truncated}"`)
          return truncated
        }
        return c
      })
    }

    // ============================================================================
    // 验证 Sitelinks 长度 (text≤25, desc≤35)
    // ============================================================================
    let sitelinksArray = Array.isArray(data.sitelinks) ? data.sitelinks : []
    const invalidSitelinks = sitelinksArray.filter((s: any) =>
      s && (s.text?.length > 25 || s.description?.length > 35)
    )
    if (invalidSitelinks.length > 0) {
      console.warn(`警告: ${invalidSitelinks.length}个sitelink超过长度限制`)
      invalidSitelinks.forEach((s: any) => {
        if (s.text?.length > 25) {
          console.warn(`  Sitelink文本超长: "${s.text}"(${s.text.length}字符 > 25)`)
        }
        if (s.description?.length > 35) {
          console.warn(`  Sitelink描述超长: "${s.description}"(${s.description.length}字符 > 35)`)
        }
      })
      // 截断过长的sitelinks
      sitelinksArray = sitelinksArray.map((s: any) => {
        if (!s) return s
        const truncated = { ...s }
        if (s.text && s.text.length > 25) {
          truncated.text = s.text.substring(0, 25)
          console.warn(`  截断文本: "${s.text}" → "${truncated.text}"`)
        }
        if (s.description && s.description.length > 35) {
          truncated.description = s.description.substring(0, 35)
          console.warn(`  截断描述: "${s.description}" → "${truncated.description}"`)
        }
        return truncated
      })
    }

    // ============================================================================
    // 验证关键词长度 (1-4 个单词)
    // 注: 品牌词通常是1个单词，所以允许1-4个单词的关键词
    // ============================================================================
    let keywordsArray = Array.isArray(data.keywords) ? data.keywords : []
    const invalidKeywords = keywordsArray.filter((k: string) => {
      if (!k) return false
      const wordCount = k.trim().split(/\s+/).length
      return wordCount < 1 || wordCount > 4
    })
    if (invalidKeywords.length > 0) {
      console.warn(`警告: ${invalidKeywords.length}个keyword不符合1-4单词要求`)
      invalidKeywords.forEach((k: string) => {
        const wordCount = k.trim().split(/\s+/).length
        console.warn(`  "${k}"(${wordCount}个单词)`)
      })
      // 过滤不符合要求的关键词
      const originalCount = keywordsArray.length
      keywordsArray = keywordsArray.filter((k: string) => {
        if (!k) return false
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 4
      })
      console.warn(`  过滤后: ${originalCount} → ${keywordsArray.length}个关键词`)
    }

    // 解析quality_metrics（如果存在）
    const qualityMetrics = data.quality_metrics ? {
      headline_diversity_score: data.quality_metrics.headline_diversity_score,
      keyword_relevance_score: data.quality_metrics.keyword_relevance_score,
      estimated_ad_strength: data.quality_metrics.estimated_ad_strength
    } : undefined

    if (qualityMetrics) {
      console.log('📊 Ad Strength预估:', qualityMetrics.estimated_ad_strength)
      console.log('📊 Headline多样性:', qualityMetrics.headline_diversity_score)
      console.log('📊 关键词相关性:', qualityMetrics.keyword_relevance_score)
    }

    return {
      // 核心字段（向后兼容）
      headlines: headlinesArray,
      descriptions: descriptionsArray,
      keywords: keywordsArray, // 使用验证后的关键词
      callouts: calloutsArray, // 使用验证后的 callouts
      sitelinks: sitelinksArray, // 使用验证后的 sitelinks
      theme: data.theme || '通用广告',
      explanation: data.explanation || '基于产品信息生成的广告创意',

      // 新增字段（可选）
      headlinesWithMetadata,
      descriptionsWithMetadata,
      qualityMetrics
    }
  } catch (error) {
    console.error('解析AI响应失败:', error)
    console.error('原始响应:', jsonText)
    throw new Error(`AI响应解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}

/**
 * 主函数：生成广告创意（带缓存）
 */
export async function generateAdCreative(
  offerId: number,
  userId?: number,
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
    excludeKeywords?: string[] // 需要排除的关键词（用于多次生成时避免重复）
  }
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  // 生成缓存键
  const cacheKey = generateCreativeCacheKey(offerId, options)

  // 检查缓存（除非显式跳过）
  if (!options?.skipCache) {
    const cached = creativeCache.get(cacheKey)
    if (cached) {
      console.log('✅ 使用缓存的广告创意')
      console.log(`   - Cache Key: ${cacheKey}`)
      console.log(`   - Headlines: ${cached.headlines.length}个`)
      console.log(`   - Descriptions: ${cached.descriptions.length}个`)
      return cached
    }
  }

  const db = getSQLiteDatabase()

  // 获取Offer数据（包含提取的广告元素）
  const offer = db.prepare(`
    SELECT * FROM offers WHERE id = ?
  `).get(offerId)

  if (!offer) {
    throw new Error('Offer不存在')
  }

  // 🎯 需求34: 读取已提取的广告元素（从爬虫阶段保存的数据）
  let extractedElements: {
    keywords?: Array<{ keyword: string; searchVolume: number; source: string; priority: string }>
    headlines?: string[]
    descriptions?: string[]
  } = {}

  try {
    if ((offer as any).extracted_keywords) {
      extractedElements.keywords = JSON.parse((offer as any).extracted_keywords)
      console.log(`📦 读取到 ${extractedElements.keywords?.length || 0} 个提取的关键词`)
    }
    if ((offer as any).extracted_headlines) {
      extractedElements.headlines = JSON.parse((offer as any).extracted_headlines)
      console.log(`📦 读取到 ${extractedElements.headlines?.length || 0} 个提取的标题`)
    }
    if ((offer as any).extracted_descriptions) {
      extractedElements.descriptions = JSON.parse((offer as any).extracted_descriptions)
      console.log(`📦 读取到 ${extractedElements.descriptions?.length || 0} 个提取的描述`)
    }
  } catch (parseError: any) {
    console.warn('⚠️ 解析提取的广告元素失败，将使用AI全新生成:', parseError.message)
  }

  // 构建Prompt（传入提取的元素作为参考）
  const prompt = buildAdCreativePrompt(
    offer,
    options?.theme,
    options?.referencePerformance,
    options?.excludeKeywords,
    extractedElements  // 🎯 新增：传入提取的元素
  )

  // 使用统一AI入口（优先Vertex AI，自动降级到Gemini API）
  if (!userId) {
    throw new Error('生成广告创意需要用户ID，请确保已登录')
  }
  const aiMode = getGeminiMode(userId)
  console.log(`🤖 使用统一AI入口生成广告创意 (${aiMode})...`)

  console.time('⏱️ AI生成创意')
  const aiResponse = await generateContent({
    model: 'gemini-2.5-pro',  // 最优选择：稳定质量+最快速度（62秒）
    prompt,
    temperature: 0.9,
    maxOutputTokens: 16384,  // 增加以容纳完整创意（含完整metadata）
  }, userId)
  console.timeEnd('⏱️ AI生成创意')

  // 解析AI响应
  console.time('⏱️ 解析AI响应')
  const result: GeneratedAdCreativeData = parseAIResponse(aiResponse.text)
  const aiModel = `${aiMode}:${aiResponse.model}`
  console.timeEnd('⏱️ 解析AI响应')

  // 🔥 强制第一个headline为DKI品牌Official格式
  const brandName = (offer as { brand?: string }).brand || 'Brand'
  const requiredFirstHeadline = `{KeyWord:${brandName}} Official`

  if (result.headlines.length > 0) {
    // 检查第一个headline是否符合要求
    if (result.headlines[0] !== requiredFirstHeadline) {
      console.log(`🔧 强制第一个headline: "${result.headlines[0]}" → "${requiredFirstHeadline}"`)
      result.headlines[0] = requiredFirstHeadline
    } else {
      console.log(`✅ 第一个headline已符合要求: "${requiredFirstHeadline}"`)
    }
  }

  console.log('✅ 广告创意生成成功')
  console.log(`   - Headlines: ${result.headlines.length}个`)
  console.log(`   - Descriptions: ${result.descriptions.length}个`)
  console.log(`   - Keywords: ${result.keywords.length}个`)

  // Enrich keywords with search volume data
  console.time('⏱️ 获取关键词搜索量')
  let keywordsWithVolume: KeywordWithVolume[] = []
  try {
    const country = (offer as { target_country?: string }).target_country || 'US'
    // Extract language from target_language or default to 'en'
    const targetLanguage = (offer as { target_language?: string }).target_language || 'English'
    const lang = targetLanguage.toLowerCase().substring(0, 2)
    const language = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : lang === 'es' ? 'es' : lang === 'it' ? 'it' : lang === 'fr' ? 'fr' : lang === 'de' ? 'de' : lang === 'pt' ? 'pt' : lang === 'ja' ? 'ja' : lang === 'ko' ? 'ko' : lang === 'ru' ? 'ru' : lang === 'ar' ? 'ar' : 'en'

    console.log(`🔍 获取关键词搜索量: ${result.keywords.length}个关键词, 国家=${country}, 语言=${language} (${targetLanguage})`)
    const volumes = await getKeywordSearchVolumes(result.keywords, country, language, userId)

    keywordsWithVolume = volumes.map(v => ({
      keyword: v.keyword,
      searchVolume: v.avgMonthlySearches,
      competition: v.competition,
      competitionIndex: v.competitionIndex
    }))
    console.log(`✅ 关键词搜索量获取完成`)
  } catch (error) {
    console.warn('⚠️ 获取关键词搜索量失败，使用默认值:', error)
    keywordsWithVolume = result.keywords.map(kw => ({ keyword: kw, searchVolume: 0 }))
  }
  console.timeEnd('⏱️ 获取关键词搜索量')

  // 🎯 新的过滤规则：
  // 1. 保留品牌词（不管搜索量）
  // 2. 过滤掉搜索量 < 500 的非品牌词
  const originalKeywordCount = result.keywords.length
  const brandNameForFilter = (offer as { brand?: string }).brand || ''
  const brandNameLower = brandNameForFilter.toLowerCase()

  const validKeywords = keywordsWithVolume.filter(kw => {
    const keywordLower = kw.keyword.toLowerCase()
    const isBrandKeyword = keywordLower.includes(brandNameLower)

    // ✅ 规则1: 保留品牌词（不管搜索量）
    if (isBrandKeyword) {
      return true
    }

    // ✅ 规则2: 过滤掉搜索量 < 500 的非品牌词
    if (kw.searchVolume < 500) {
      console.log(`🔧 过滤低搜索量关键词: "${kw.keyword}" (搜索量: ${kw.searchVolume}/月)`)
      return false
    }

    // ✅ 保留搜索量 >= 500 的关键词
    return true
  })

  // 更新关键词列表
  const removedCount = originalKeywordCount - validKeywords.length

  if (removedCount > 0) {
    console.log(`🔧 已过滤 ${removedCount} 个低搜索量关键词 (< 500/月)`)
    console.log(`📊 剩余关键词: ${validKeywords.length}/${originalKeywordCount}`)
  }

  // 按搜索量从高到低排序
  validKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  result.keywords = validKeywords.map(kw => kw.keyword)
  keywordsWithVolume = validKeywords

  // 🎯 通过Keyword Planner扩展高搜索量关键词（多角度3轮查询策略）
  // 策略: 使用不同角度的种子词进行3轮查询，最大化获取高搜索量关键词提示
  try {
    if (brandName && userId) {
      console.log(`🔍 启动Keyword Planner多角度3轮查询策略`)
      console.time('⏱️ Keyword Planner扩展')

      // 获取Google Ads账号信息
      const { getKeywordIdeas } = await import('@/lib/google-ads-keyword-planner')
      const { getGoogleAdsCredentials } = await import('@/lib/google-ads-oauth')
      const { getSQLiteDatabase } = await import('@/lib/db')
      const db = getSQLiteDatabase()

      // 查询用户的Google Ads账号
      const adsAccount = db.prepare(`
        SELECT id, customer_id FROM google_ads_accounts
        WHERE user_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 1
      `).get(userId) as { id: number; customer_id: string } | undefined

      if (adsAccount) {
        // 获取OAuth凭证
        const credentials = await getGoogleAdsCredentials(userId)

        if (credentials) {
          const country = (offer as { target_country?: string }).target_country || 'US'
          const targetLanguage = (offer as { target_language?: string }).target_language || 'English'
          const lang = targetLanguage.toLowerCase().substring(0, 2)
          const language = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : lang === 'es' ? 'es' : lang === 'it' ? 'it' : lang === 'fr' ? 'fr' : lang === 'de' ? 'de' : lang === 'pt' ? 'pt' : lang === 'ja' ? 'ja' : lang === 'ko' ? 'ko' : lang === 'ru' ? 'ru' : lang === 'ar' ? 'ar' : 'en'

          console.log(`🌍 Keyword Planner 查询语言: ${language} (${targetLanguage})`)

          const existingKeywordsSet = new Set(result.keywords.map(kw => kw.toLowerCase()))
          let totalNewKeywords = 0

          // 🎯 准备3轮不同角度的种子关键词
          // 第1轮：产品通用词（高搜索量非品牌词）
          const genericKeywords = keywordsWithVolume
            .filter(kw => kw.searchVolume > 500 && !kw.keyword.toLowerCase().includes(brandName.toLowerCase()))
            .sort((a, b) => b.searchVolume - a.searchVolume)
            .slice(0, 5)
            .map(kw => kw.keyword)

          // 第2轮：品牌组合词（品牌名 + 产品类别）
          const brandCombinations: string[] = []
          // 从现有关键词中提取产品类别词
          const productCategories = keywordsWithVolume
            .filter(kw => !kw.keyword.toLowerCase().includes(brandName.toLowerCase()))
            .map(kw => kw.keyword.split(' ').slice(0, 2).join(' ')) // 取前两个词作为产品类别
            .filter((v, i, a) => a.indexOf(v) === i) // 去重
            .slice(0, 3)
          productCategories.forEach(cat => {
            brandCombinations.push(`${brandName} ${cat}`)
          })
          // 添加品牌词本身
          if (!brandCombinations.some(kw => kw.toLowerCase() === brandName.toLowerCase())) {
            brandCombinations.unshift(brandName)
          }

          // 第3轮：从前两轮结果中选择高搜索量词（动态生成）
          // 这一轮的种子词将在前两轮完成后确定

          const roundSeeds: { round: number; name: string; seeds: string[] }[] = [
            { round: 1, name: '产品通用词', seeds: genericKeywords },
            { round: 2, name: '品牌组合词', seeds: brandCombinations },
            { round: 3, name: '扩展词（动态）', seeds: [] } // 第3轮种子将动态生成
          ]

          console.log(`\n📋 3轮查询种子词准备:`)
          console.log(`   第1轮 [产品通用词]: ${genericKeywords.length > 0 ? genericKeywords.join(', ') : '(无)'}`)
          console.log(`   第2轮 [品牌组合词]: ${brandCombinations.join(', ')}`)
          console.log(`   第3轮 [扩展词]: (根据前两轮结果动态生成)`)

          // 收集所有轮次新增的高搜索量关键词，用于第3轮
          const allNewHighVolumeKeywords: string[] = []

          // 执行3轮查询
          for (let roundIndex = 0; roundIndex < 3; roundIndex++) {
            const roundInfo = roundSeeds[roundIndex]
            let seedKeywords = roundInfo.seeds

            // 第3轮：使用前两轮新增的高搜索量关键词作为种子
            if (roundIndex === 2) {
              seedKeywords = allNewHighVolumeKeywords.slice(0, 5) // 取前5个
              roundInfo.seeds = seedKeywords
              if (seedKeywords.length === 0) {
                // 如果前两轮没有新增关键词，使用所有现有高搜索量关键词
                seedKeywords = keywordsWithVolume
                  .filter(kw => kw.searchVolume > 1000)
                  .sort((a, b) => b.searchVolume - a.searchVolume)
                  .slice(0, 5)
                  .map(kw => kw.keyword)
              }
            }

            if (seedKeywords.length === 0) {
              console.log(`\n📍 第 ${roundInfo.round} 轮 [${roundInfo.name}]: 跳过（无种子关键词）`)
              continue
            }

            console.log(`\n📍 第 ${roundInfo.round} 轮 [${roundInfo.name}] Keyword Planner 查询`)
            console.log(`   种子关键词 (${seedKeywords.length}个): ${seedKeywords.join(', ')}`)

            // 调用Keyword Planner API获取关键词创意
            const keywordIdeas = await getKeywordIdeas({
              customerId: adsAccount.customer_id,
              refreshToken: credentials.refresh_token,
              seedKeywords: seedKeywords,
              targetCountry: country,
              targetLanguage: language,
              accountId: adsAccount.id,
              userId
            })

            console.log(`   📊 返回 ${keywordIdeas.length} 个关键词创意`)

            // 过滤：只保留搜索量 > 500 的新关键词
            const expandedKeywords = keywordIdeas
              .filter(idea => idea.avgMonthlySearches > 500)
              .map(idea => ({
                keyword: idea.text,
                searchVolume: idea.avgMonthlySearches,
                competition: idea.competition,
                competitionIndex: idea.competitionIndex,
                source: 'KEYWORD_EXPANSION'
              }))

            console.log(`   ✅ 筛选出 ${expandedKeywords.length} 个搜索量 > 500 的关键词`)

            // 去重：排除已存在的关键词
            const newExpandedKeywords = expandedKeywords.filter(kw =>
              !existingKeywordsSet.has(kw.keyword.toLowerCase())
            )

            if (newExpandedKeywords.length > 0) {
              console.log(`   🆕 添加 ${newExpandedKeywords.length} 个新的扩展关键词:`)
              newExpandedKeywords.slice(0, 10).forEach(kw => {
                console.log(`      - "${kw.keyword}" (搜索量: ${kw.searchVolume.toLocaleString()}/月)`)
              })
              if (newExpandedKeywords.length > 10) {
                console.log(`      ... 及其他 ${newExpandedKeywords.length - 10} 个关键词`)
              }

              // 添加到已存在集合
              newExpandedKeywords.forEach(kw => {
                existingKeywordsSet.add(kw.keyword.toLowerCase())
              })

              // 添加到关键词列表
              result.keywords = [...result.keywords, ...newExpandedKeywords.map(kw => kw.keyword)]
              keywordsWithVolume = [...keywordsWithVolume, ...newExpandedKeywords]
              totalNewKeywords += newExpandedKeywords.length

              // 收集高搜索量关键词用于下一轮
              const highVolumeNew = newExpandedKeywords
                .filter(kw => kw.searchVolume > 1000)
                .map(kw => kw.keyword)
              allNewHighVolumeKeywords.push(...highVolumeNew)
            } else {
              console.log(`   ℹ️ 未发现新的扩展关键词`)
            }
          }

          console.log(`\n📊 Keyword Planner 扩展完成: 共进行 3 轮查询，新增 ${totalNewKeywords} 个关键词`)
          console.log(`   当前关键词总数: ${keywordsWithVolume.length} 个`)
        } else {
          console.warn('⚠️ 未找到Google Ads OAuth凭证，跳过Keyword Planner扩展')
        }
      } else {
        console.warn('⚠️ 未找到激活的Google Ads账号，跳过Keyword Planner扩展')
      }

      console.timeEnd('⏱️ Keyword Planner扩展')
    } else {
      if (!brandName || !userId) {
        console.log('ℹ️ Offer缺少品牌名或userId，跳过Keyword Planner扩展')
      }
    }
  } catch (plannerError: any) {
    // Keyword Planner扩展失败不影响主流程
    console.warn('⚠️ Keyword Planner扩展失败（非致命错误）:', plannerError.message)
  }

  // 🎯 最终关键词过滤：强制约束
  console.log('\n🔍 执行最终关键词过滤 (强制约束)...')
  const beforeFilterCount = keywordsWithVolume.length
  const offerBrand = (offer as { brand?: string }).brand || 'Unknown'
  const targetCountry = (offer as { target_country?: string }).target_country || 'US'
  const brandKeywordLower = offerBrand.toLowerCase()

  // 第1步：分离品牌词（单独的品牌名）和非品牌词
  // 品牌词定义：关键词 === 品牌名（精确匹配，不包括品牌组合词）
  const brandKeywords: typeof keywordsWithVolume = []
  const nonBrandKeywords: typeof keywordsWithVolume = []

  keywordsWithVolume.forEach(kw => {
    // 精确匹配：只有完全等于品牌名的才是品牌词
    const isBrandKeyword = kw.keyword.toLowerCase() === brandKeywordLower
    if (isBrandKeyword) {
      brandKeywords.push(kw)
    } else {
      nonBrandKeywords.push(kw)
    }
  })

  // 第2步：过滤非品牌词（只保留搜索量 >= 500）
  const filteredNonBrandKeywords = nonBrandKeywords.filter(kw => kw.searchVolume >= 500)

  // 第3步：强制约束1 - 品牌词必须添加（并确保有搜索量数据）
  console.log(`\n📌 强制约束1: 品牌词 "${offerBrand}" 必须添加（需查询搜索量）`)

  // 检查品牌词是否已存在于关键词列表中
  const existingBrandKeyword = brandKeywords.find(kw => kw.searchVolume > 0)

  if (existingBrandKeyword) {
    // 品牌词已存在且有搜索量
    console.log(`   ✅ 找到品牌词: ${brandKeywords.length} 个`)
    brandKeywords.forEach(kw => {
      console.log(`   - "${kw.keyword}" (搜索量: ${kw.searchVolume}/月)`)
    })
  } else {
    // 品牌词不存在或搜索量为0，需要查询搜索量
    console.log(`   ⚠️ 品牌词 "${offerBrand}" 需要查询搜索量...`)
    let brandSearchVolume = 0

    try {
      const { getSQLiteDatabase } = await import('./db')
      const db = getSQLiteDatabase()
      const targetLanguage = (offer as { target_language?: string }).target_language || 'English'
      const langCode = targetLanguage.toLowerCase().substring(0, 2)

      // 步骤1: 尝试从全局缓存查询（不区分大小写）
      console.log(`   📦 步骤1: 查询全局缓存...`)
      const stmt = db.prepare(`
        SELECT keyword, search_volume
        FROM global_keywords
        WHERE LOWER(keyword) = LOWER(?) AND country = ?
        ORDER BY search_volume DESC
        LIMIT 1
      `)
      const row = stmt.get(offerBrand, targetCountry) as { keyword: string; search_volume: number } | undefined

      if (row && row.search_volume > 0) {
        brandSearchVolume = row.search_volume
        console.log(`   ✅ 全局缓存查询到搜索量: ${brandSearchVolume}/月`)
      } else {
        // 步骤2: 缓存中没有，通过Keyword Planner API查询
        console.log(`   📡 步骤2: 全局缓存无数据，调用Keyword Planner API查询...`)
        const volumes = await getKeywordSearchVolumes([offerBrand], targetCountry, langCode, userId)
        if (volumes.length > 0 && volumes[0].avgMonthlySearches > 0) {
          brandSearchVolume = volumes[0].avgMonthlySearches
          console.log(`   ✅ Keyword Planner API查询到搜索量: ${brandSearchVolume}/月`)
        } else {
          console.log(`   ⚠️ Keyword Planner API未返回搜索量数据`)
        }
      }
    } catch (err: any) {
      console.warn(`   ⚠️ 查询品牌词搜索量失败: ${err.message}`)
    }

    // 🎯 无论是否有搜索量，品牌词都必须添加
    // 清空之前可能存在的搜索量为0的品牌词
    brandKeywords.length = 0
    brandKeywords.push({
      keyword: offerBrand,
      searchVolume: brandSearchVolume
    })

    if (brandSearchVolume > 0) {
      console.log(`   ✅ 品牌词 "${offerBrand}" 已添加 (搜索量: ${brandSearchVolume}/月)`)
    } else {
      console.log(`   ⚠️ 品牌词 "${offerBrand}" 已添加 (搜索量: 未知，建议手动验证)`)
    }
  }

  // 第4步：强制约束2 - 非品牌词搜索量必须 >= 500
  console.log(`\n📌 强制约束2: 非品牌词搜索量必须 >= 500`)
  console.log(`   - 搜索量 >= 500 的非品牌词: ${filteredNonBrandKeywords.length} 个`)

  // 第5步：强制约束3 - 保留最少 10 个关键词（只补充有搜索量的）
  console.log(`\n📌 强制约束3: 保留最少 10 个关键词（只补充搜索量>0的关键词）`)
  let finalKeywords = [...brandKeywords, ...filteredNonBrandKeywords]

  if (finalKeywords.length < 10) {
    // 如果不足 10 个，从被过滤的非品牌词中补充（按搜索量从高到低，但必须>0）
    const needMore = 10 - finalKeywords.length
    const supplementaryKeywords = nonBrandKeywords
      .filter(kw => !finalKeywords.some(fk => fk.keyword === kw.keyword))
      .filter(kw => kw.searchVolume > 0)  // 🎯 只补充有搜索量的关键词
      .sort((a, b) => b.searchVolume - a.searchVolume)
      .slice(0, needMore)

    if (supplementaryKeywords.length > 0) {
      console.log(`   ⚠️ 关键词不足 10 个，补充 ${supplementaryKeywords.length} 个低搜索量关键词 (搜索量>0):`)
      supplementaryKeywords.forEach(kw => {
        console.log(`   - "${kw.keyword}" (搜索量: ${kw.searchVolume}/月) [补充]`)
      })
      finalKeywords = [...finalKeywords, ...supplementaryKeywords]
    } else {
      console.log(`   ℹ️ 没有更多有搜索量的关键词可补充，当前关键词数: ${finalKeywords.length}`)
    }
  }

  // 🎯 第6步：最终过滤 - 移除所有搜索量为0或null的关键词
  console.log(`\n📌 强制约束4: 移除所有搜索量为0或null的关键词`)
  const beforeFinalFilter = finalKeywords.length
  finalKeywords = finalKeywords.filter(kw => kw.searchVolume > 0)
  const removedZeroVolume = beforeFinalFilter - finalKeywords.length
  if (removedZeroVolume > 0) {
    console.log(`   ⚠️ 已移除 ${removedZeroVolume} 个搜索量为0的关键词`)
  }
  console.log(`   ✅ 最终保留 ${finalKeywords.length} 个有搜索量的关键词`)

  // 第6步：按搜索量从高到低排序
  // 需求: 高搜索量的非品牌词优先级 > 低搜索量的品牌组合词
  // 排序规则: 完全按搜索量排序，不特殊处理品牌词位置
  finalKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  console.log(`\n📊 关键词排序规则: 按搜索量从高到低（高搜索量非品牌词 > 低搜索量品牌组合词）`)

  keywordsWithVolume = finalKeywords
  const afterFilterCount = keywordsWithVolume.length
  const filteredOutCount = beforeFilterCount - afterFilterCount

  console.log(`\n✅ 过滤完成:`)
  console.log(`   原始关键词: ${beforeFilterCount} 个`)
  console.log(`   最终保留: ${afterFilterCount} 个`)
  console.log(`   - 品牌词 "${offerBrand}" (搜索量>0): ${brandKeywords.filter(kw => kw.searchVolume > 0).length} 个`)
  console.log(`   - 非品牌词 (搜索量 >= 500): ${filteredNonBrandKeywords.length} 个`)
  const supplementCount = afterFilterCount - brandKeywords.filter(kw => kw.searchVolume > 0).length - filteredNonBrandKeywords.length
  if (supplementCount > 0) {
    console.log(`   - 补充词 (0 < 搜索量 < 500): ${supplementCount} 个`)
  }

  // 更新 result.keywords 为过滤后的关键词
  result.keywords = keywordsWithVolume.map(kw => kw.keyword)

  // 最终验证 - 确保所有关键词都有搜索量
  const finalKeywordCount = result.keywords.length
  const allHaveVolume = keywordsWithVolume.every(kw => kw.searchVolume > 0)
  const hasBrandKeyword = keywordsWithVolume.some(kw => kw.keyword.toLowerCase() === brandKeywordLower && kw.searchVolume > 0)

  console.log(`\n🎯 最终验证:`)
  console.log(`   ✅ 关键词总数: ${finalKeywordCount} 个`)
  console.log(`   ${allHaveVolume ? '✅' : '❌'} 所有关键词都有搜索量数据 (searchVolume > 0)`)
  console.log(`   ${hasBrandKeyword ? '✅' : 'ℹ️'} 品牌词 "${offerBrand}" ${hasBrandKeyword ? '有搜索量' : '无搜索量数据，已排除'}`)

  if (!allHaveVolume) {
    const zeroVolumeKeywords = keywordsWithVolume.filter(kw => kw.searchVolume <= 0)
    console.warn(`⚠️ 警告: 仍有 ${zeroVolumeKeywords.length} 个关键词搜索量为0`)
    zeroVolumeKeywords.forEach(kw => console.warn(`   - "${kw.keyword}"`))
  }
  if (finalKeywordCount < 5) {
    console.warn(`⚠️ 警告: 关键词数量 ${finalKeywordCount} < 5，可能影响广告效果`)
  }

  // 修正 sitelinks URL 为真实的 offer URL
  // 需求优化：所有sitelinks统一使用offer的主URL，避免虚构的子路径
  if (result.sitelinks && result.sitelinks.length > 0) {
    // 优先使用final_url（推广链接解析后的真实URL），否则使用url
    const offerUrl = (offer as { final_url?: string; url?: string }).final_url || (offer as { url?: string }).url
    if (offerUrl) {
      result.sitelinks = result.sitelinks.map(link => {
        // 所有sitelinks统一使用offer的主URL（不拼接子路径）
        // 这确保所有链接都是真实可访问的
        return {
          ...link,
          url: offerUrl  // 优先使用final_url，避免推广链接
        }
      })

      console.log(`🔗 修正 ${result.sitelinks.length} 个附加链接URL为真实offer URL (${offerUrl.substring(0, 50)}...)`)
    }
  }

  // 🎯 生成否定关键词（排除不相关流量）
  let negativeKeywords: string[] = []
  try {
    console.log('🔍 生成否定关键词...')
    console.time('⏱️ 否定关键词生成')
    negativeKeywords = await generateNegativeKeywords(offer as Offer, userId)
    console.timeEnd('⏱️ 否定关键词生成')
    console.log(`✅ 生成${negativeKeywords.length}个否定关键词:`, negativeKeywords.slice(0, 5).join(', '), '...')
  } catch (negError: any) {
    // 否定关键词生成失败不影响主流程
    console.warn('⚠️ 否定关键词生成失败（非致命错误）:', negError.message)
  }

  const fullResult = {
    ...result,
    keywordsWithVolume,
    negativeKeywords,  // 🎯 新增：添加否定关键词到结果
    ai_model: aiModel
  }

  // 缓存结果（1小时TTL）
  creativeCache.set(cacheKey, fullResult)
  console.log(`💾 已缓存广告创意: ${cacheKey}`)

  return fullResult
}

/**
 * 并行生成多个广告创意（优化延迟）
 *
 * @param offerId Offer ID
 * @param count 生成数量（1-3个）
 * @param options 生成选项
 * @returns 生成的创意数组
 */
export async function generateAdCreativesBatch(
  offerId: number,
  userId?: number,
  count: number = 3,
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
  }
): Promise<Array<GeneratedAdCreativeData & { ai_model: string }>> {
  // 限制数量在1-3之间
  const validCount = Math.max(1, Math.min(3, count))

  console.log(`🎨 并行生成 ${validCount} 个广告创意...`)

  // 为每个创意生成不同的主题变体（如果没有指定主题）
  // 增强差异性：使用更具体和对比鲜明的主题
  const themes = options?.theme
    ? [options.theme]
    : [
        'Premium Brand & Trust - 强调官方商城、品牌信任度、客户评价、权威认证。Headlines必须包含品牌名、信任标志（Official、Trusted、Certified），Descriptions强调品质保证',
        'Value & Promotions - 强调折扣优惠、限时促销、性价比。Headlines必须包含具体折扣数字（30% Off、$50 Off），Descriptions突出立即购买的紧迫性',
        'Product Features & Innovation - 强调独特功能、技术参数、使用场景。Headlines突出产品特性（TSA Lock、360° Wheels、Waterproof），Descriptions详细说明功能优势'
      ]

  // 创建并行生成任务
  const tasks = Array.from({ length: validCount }, (_, index) => {
    const taskOptions = {
      ...options,
      theme: themes[index % themes.length],
      skipCache: options?.skipCache || false
    }

    return generateAdCreative(offerId, userId, taskOptions)
  })

  // 并行执行所有任务
  const startTime = Date.now()
  const results = await Promise.all(tasks)
  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`✅ ${validCount} 个广告创意生成完成，耗时 ${duration}秒`)
  console.log(`   平均每个: ${(parseFloat(duration) / validCount).toFixed(2)}秒`)

  return results
}

/**
 * ============================================================================
 * 自动多样性检查和重新生成
 * ============================================================================
 * 生成多个创意时，自动检查相似度，不符合要求则重新生成
 */

/**
 * 计算两个文本的相似度 (0-1)
 * 使用加权多算法
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  // 1. Jaccard 相似度 (词集合) - 30%
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 0))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 0))

  if (words1.size === 0 && words2.size === 0) return 1
  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0

  // 2. 简单的词频相似度 - 30%
  const allWords = new Set([...words1, ...words2])
  let dotProduct = 0
  let mag1 = 0
  let mag2 = 0

  for (const word of allWords) {
    const count1 = text1.toLowerCase().split(word).length - 1
    const count2 = text2.toLowerCase().split(word).length - 1
    dotProduct += count1 * count2
    mag1 += count1 * count1
    mag2 += count2 * count2
  }

  const cosineSimilarity = mag1 > 0 && mag2 > 0 ? dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2)) : 0

  // 3. 编辑距离相似度 - 20%
  const maxLen = Math.max(text1.length, text2.length)
  const editDistance = calculateEditDistance(text1, text2)
  const levenshteinSimilarity = maxLen > 0 ? 1 - editDistance / maxLen : 0

  // 4. N-gram 相似度 - 20%
  const ngrams1 = getNgrams(text1, 2)
  const ngrams2 = getNgrams(text2, 2)
  const ngramIntersection = ngrams1.filter(ng => ngrams2.includes(ng)).length
  const ngramUnion = new Set([...ngrams1, ...ngrams2]).size
  const ngramSimilarity = ngramUnion > 0 ? ngramIntersection / ngramUnion : 0

  // 加权平均
  const weightedSimilarity =
    jaccardSimilarity * 0.3 +
    cosineSimilarity * 0.3 +
    levenshteinSimilarity * 0.2 +
    ngramSimilarity * 0.2

  return Math.min(1, Math.max(0, weightedSimilarity))
}

/**
 * 计算编辑距离 (Levenshtein Distance)
 */
function calculateEditDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

/**
 * 提取 N-gram
 */
function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const ngrams: string[] = []

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '))
  }

  return ngrams
}

/**
 * 检查创意集合中的多样性
 * 返回相似度过高的创意对
 */
function validateCreativeDiversity(
  creatives: GeneratedAdCreativeData[],
  maxSimilarity: number = 0.2
): {
  valid: boolean
  issues: string[]
  similarities: Array<{
    creative1Index: number
    creative2Index: number
    similarity: number
    type: 'headline' | 'description' | 'keyword'
  }>
} {
  const issues: string[] = []
  const similarities: any[] = []

  for (let i = 0; i < creatives.length; i++) {
    for (let j = i + 1; j < creatives.length; j++) {
      // 检查标题相似度
      const headlineSimilarity = calculateCreativeHeadlineSimilarity(
        creatives[i].headlines,
        creatives[j].headlines
      )

      if (headlineSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i + 1} 和 ${j + 1} 的标题相似度过高: ${(headlineSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: headlineSimilarity,
          type: 'headline'
        })
      }

      // 检查描述相似度
      const descriptionSimilarity = calculateCreativeDescriptionSimilarity(
        creatives[i].descriptions,
        creatives[j].descriptions
      )

      if (descriptionSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i + 1} 和 ${j + 1} 的描述相似度过高: ${(descriptionSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: descriptionSimilarity,
          type: 'description'
        })
      }

      // 检查关键词相似度
      const keywordSimilarity = calculateCreativeKeywordSimilarity(
        creatives[i].keywords,
        creatives[j].keywords
      )

      if (keywordSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i + 1} 和 ${j + 1} 的关键词相似度过高: ${(keywordSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: keywordSimilarity,
          type: 'keyword'
        })
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    similarities
  }
}

/**
 * 计算两个创意的标题相似度
 */
function calculateCreativeHeadlineSimilarity(
  headlines1: string[],
  headlines2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const h1 of headlines1.slice(0, 3)) {
    for (const h2 of headlines2.slice(0, 3)) {
      totalSimilarity += calculateTextSimilarity(h1, h2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的描述相似度
 */
function calculateCreativeDescriptionSimilarity(
  descriptions1: string[],
  descriptions2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const d1 of descriptions1) {
    for (const d2 of descriptions2) {
      totalSimilarity += calculateTextSimilarity(d1, d2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的关键词相似度
 */
function calculateCreativeKeywordSimilarity(
  keywords1: string[],
  keywords2: string[]
): number {
  const set1 = new Set(keywords1.map(k => k.toLowerCase()))
  const set2 = new Set(keywords2.map(k => k.toLowerCase()))

  const intersection = new Set([...set1].filter(k => set2.has(k)))
  const union = new Set([...set1, ...set2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * 生成多个创意，确保多样性
 * 如果相似度过高，自动重新生成
 */
export async function generateMultipleCreativesWithDiversityCheck(
  offerId: number,
  userId?: number,
  count: number = 3,
  maxSimilarity: number = 0.2,
  maxRetries: number = 3,
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
    excludeKeywords?: string[]
  }
): Promise<{
  creatives: GeneratedAdCreativeData[]
  diversityCheck: {
    valid: boolean
    issues: string[]
    similarities: any[]
  }
  stats: {
    totalAttempts: number
    successfulCreatives: number
    failedAttempts: number
    totalTime: number
  }
}> {
  const creatives: GeneratedAdCreativeData[] = []
  let totalAttempts = 0
  let failedAttempts = 0
  const startTime = Date.now()

  console.log(`\n🎯 开始生成 ${count} 个多样化创意 (最大相似度: ${maxSimilarity * 100}%)`)

  while (creatives.length < count && failedAttempts < maxRetries) {
    totalAttempts++
    console.log(`\n📝 生成创意 ${creatives.length + 1}/${count} (尝试 ${totalAttempts})...`)

    try {
      // 生成新创意
      const newCreative = await generateAdCreative(offerId, userId, {
        ...options,
        skipCache: true
      })

      // 检查与现有创意的多样性
      if (creatives.length === 0) {
        // 第一个创意直接添加
        creatives.push(newCreative)
        console.log(`✅ 创意 1 已添加`)
      } else {
        // 检查与现有创意的相似度
        const tempCreatives = [...creatives, newCreative]
        const diversityCheck = validateCreativeDiversity(tempCreatives, maxSimilarity)

        if (diversityCheck.valid) {
          // 通过多样性检查
          creatives.push(newCreative)
          console.log(`✅ 创意 ${creatives.length} 通过多样性检查`)
        } else {
          // 未通过多样性检查
          failedAttempts++
          console.warn(`⚠️  创意未通过多样性检查，原因:`)
          diversityCheck.issues.forEach(issue => {
            console.warn(`   - ${issue}`)
          })

          if (failedAttempts < maxRetries) {
            console.log(`   重新生成... (${failedAttempts}/${maxRetries})`)
          }
        }
      }
    } catch (error) {
      failedAttempts++
      console.error(`❌ 生成创意失败:`, error instanceof Error ? error.message : '未知错误')

      if (failedAttempts >= maxRetries) {
        console.warn(`⚠️  达到最大重试次数 (${maxRetries})`)
      }
    }
  }

  const totalTime = (Date.now() - startTime) / 1000

  // 最终多样性检查
  const finalDiversityCheck = validateCreativeDiversity(creatives, maxSimilarity)

  console.log(`\n📊 生成完成:`)
  console.log(`   ✅ 成功创意: ${creatives.length}/${count}`)
  console.log(`   ❌ 失败尝试: ${failedAttempts}`)
  console.log(`   📈 总尝试数: ${totalAttempts}`)
  console.log(`   ⏱️  总耗时: ${totalTime.toFixed(2)}秒`)

  if (finalDiversityCheck.valid) {
    console.log(`\n✅ 所有创意通过多样性检查！`)
  } else {
    console.log(`\n⚠️  部分创意未通过多样性检查:`)
    finalDiversityCheck.issues.forEach(issue => {
      console.log(`   - ${issue}`)
    })
  }

  return {
    creatives,
    diversityCheck: finalDiversityCheck,
    stats: {
      totalAttempts,
      successfulCreatives: creatives.length,
      failedAttempts,
      totalTime
    }
  }
}
