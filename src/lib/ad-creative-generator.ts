import { getDatabase, getSQLiteDatabase } from './db'
import type {
  GeneratedAdCreativeData,
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
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
  let prompt = `Generate Google Ads creative for ${offer.brand} (${offer.category || 'product'}).

PRODUCT: ${offer.brand_description || offer.unique_selling_points || 'Quality product'}
USPs: ${offer.unique_selling_points || offer.product_highlights || 'Premium quality'}
AUDIENCE: ${offer.target_audience || 'General'}
COUNTRY: ${offer.target_country} | LANGUAGE: ${offer.target_language || 'English'}
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

  // 🔥 P1-1+: 用户评论深度分析（新增优化）
  let commonPraises: string[] = []
  let purchaseReasons: string[] = []
  let useCases: string[] = []
  let commonPainPoints: string[] = []
  if (offer.review_analysis) {
    try {
      const reviewAnalysis = JSON.parse(offer.review_analysis)
      commonPraises = reviewAnalysis.commonPraises || []
      purchaseReasons = reviewAnalysis.purchaseReasons || []
      useCases = reviewAnalysis.realUseCases || reviewAnalysis.useCases || []
      commonPainPoints = reviewAnalysis.commonPainPoints || []
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

Remaining 14 headlines - Types (must cover all 5):
- Brand (2): ${badge ? `Use BADGE if available (e.g., "${badge} Brand")` : '"Trusted Brand"'}, ${salesRank ? `Use SALES RANK if available (e.g., "#1 Best Seller")` : `"#1 ${offer.category || 'Choice'}"`}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: For stores with hot products, create "Best Seller Collection" headlines featuring top products (e.g., "Best ${topProducts[0]?.split(' ').slice(0, 2).join(' ')} Collection")` : ''}
- Feature (4): ${Object.keys(technicalDetails).length > 0 ? 'Use SPECS data for technical features' : 'Core product benefits'}${reviewHighlights.length > 0 ? `, incorporate REVIEW INSIGHTS (e.g., "${reviewHighlights[0]}")` : ''}${commonPraises.length > 0 ? `. **NEW**: Use USER PRAISES for authentic features: ${commonPraises.slice(0, 2).join(', ')}` : ''}
- Promo (3): ${discount || promotion ? `MUST use real DISCOUNT/PROMOTION data: ${discount ? `"${discount}"` : ''}${promotion ? ` or "${promotion}"` : ''}` : 'Numbers/% required - "Save 40%", "$50 Off"'}
- CTA (3): "Shop Now", "Get Yours Today"${primeEligible ? ', "Prime Eligible"' : ''}${purchaseReasons.length > 0 ? `. **NEW**: Incorporate WHY BUY reasons: ${purchaseReasons.slice(0, 2).join(', ')}` : ''}
- Urgency (2): ${availability && availability.includes('left') ? `Use real STOCK data: "${availability}"` : '"Limited Time", "Ends Soon"'}
**Dynamic Keyword (DKI)**: 1 more headline using "{KeyWord:${offer.brand}}" format

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity

### DESCRIPTIONS (4 required, ≤90 chars each)
- Value (2): Why choose us? Benefits, USPs${badge ? `. MUST mention BADGE: "${badge}"` : ''}${salesRank ? `. MUST mention SALES RANK` : ''}${useCases.length > 0 ? `. **NEW**: Reference real USE CASES: ${useCases.slice(0, 2).join(', ')}` : ''}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: Mention product variety and quality (Avg: ${hotInsights.avgRating.toFixed(1)}⭐ from ${hotInsights.avgReviews}+ reviews)` : ''}
- CTA (2): Strong action verbs (Shop/Buy/Get/Order)${primeEligible ? ' + Prime eligibility' : ''} + immediate value${availability ? `. Mention STOCK status if urgent` : ''}
${reviewHighlights.length > 0 ? `- **USE REVIEW INSIGHTS**: Incorporate customer feedback keywords: ${reviewHighlights.slice(0, 3).join(', ')}` : ''}
${commonPainPoints.length > 0 ? `- **AVOID MENTIONING**: Address common pain points indirectly (don't highlight negatives): ${commonPainPoints.slice(0, 2).join(', ')}` : ''}

### KEYWORDS (10-15): Brand(1-2), Product(4-6), Feature(2-3), Long-tail(3-5)
**质量要求（重要！确保Launch Score >60分）**:
- 搜索量: 每个关键词≥1000/月（高流量潜力）
- 购买意图: 优先transactional关键词（buy, shop, store, best, price）
- 相关性: 与${offer.brand}品牌和${offer.category || '产品'}高度相关
${excludeKeywords?.length ? `AVOID duplicates: ${excludeKeywords.join(', ')}` : ''}

### CALLOUTS (4-6, ≤25 chars)
${primeEligible ? '- **MUST include**: "Prime Free Shipping"' : '- Free Shipping'}
${availability && !availability.toLowerCase().includes('out of stock') ? '- **MUST include**: "In Stock Now"' : ''}
${badge ? `- **MUST include**: "${badge}"` : ''}
- 24/7 Support, Money Back Guarantee, etc.

### SITELINKS (4): text≤25, desc≤35, url="/" (auto-replaced)

## FORBIDDEN: "100%", "best", "guarantee", "miracle", "!!!", ALL CAPS abuse

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

    // 应用DKI修复到所有headlines
    const originalHeadlines = [...headlinesArray]
    headlinesArray = headlinesArray.map((h: string) => fixDKISyntax(h))
    const fixedCount = headlinesArray.filter((h: string, i: number) => h !== originalHeadlines[i]).length
    if (fixedCount > 0) {
      console.log(`✅ 修复了${fixedCount}个DKI标签格式问题`)
    }

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
      keywords: data.keywords,
      callouts: data.callouts,
      sitelinks: data.sitelinks,
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
    if (offer.extracted_keywords) {
      extractedElements.keywords = JSON.parse(offer.extracted_keywords)
      console.log(`📦 读取到 ${extractedElements.keywords.length} 个提取的关键词`)
    }
    if (offer.extracted_headlines) {
      extractedElements.headlines = JSON.parse(offer.extracted_headlines)
      console.log(`📦 读取到 ${extractedElements.headlines.length} 个提取的标题`)
    }
    if (offer.extracted_descriptions) {
      extractedElements.descriptions = JSON.parse(offer.extracted_descriptions)
      console.log(`📦 读取到 ${extractedElements.descriptions.length} 个提取的描述`)
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
  const responseText = await generateContent({
    model: 'gemini-2.5-pro',  // 最优选择：稳定质量+最快速度（62秒）
    prompt,
    temperature: 0.9,
    maxOutputTokens: 16384,  // 增加以容纳完整创意（含完整metadata）
  }, userId)
  console.timeEnd('⏱️ AI生成创意')

  // 解析AI响应
  console.time('⏱️ 解析AI响应')
  const result: GeneratedAdCreativeData = parseAIResponse(responseText)
  const aiModel = `${aiMode}:gemini-2.5-pro`
  console.timeEnd('⏱️ 解析AI响应')

  // 🔥 强制第一个headline为DKI品牌Official格式
  const brandName = (offer as { brand?: string }).brand || 'Brand'
  const requiredFirstHeadline = `{KeyWord:${brandName}} Official`

  if (result.headlines.length > 0) {
    // 检查第一个headline是否符合要求
    if (result.headlines[0].text !== requiredFirstHeadline) {
      console.log(`🔧 强制第一个headline: "${result.headlines[0].text}" → "${requiredFirstHeadline}"`)
      result.headlines[0] = {
        text: requiredFirstHeadline,
        type: 'brand',
        length: requiredFirstHeadline.length,
        keywords: [brandName.toLowerCase()],
        hasNumber: false,
        hasUrgency: false
      }
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
    const lang = ((offer as { target_language?: string }).target_language || 'English').toLowerCase().substring(0, 2)
    const language = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : lang === 'es' ? 'es' : 'en'

    console.log(`🔍 获取关键词搜索量: ${result.keywords.length}个关键词, 国家=${country}, 语言=${language}`)
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

  // 🎯 过滤低搜索量关键词（Launch Score优化）
  const MIN_SEARCH_VOLUME = 1000  // 提高到1000/月，确保关键词质量
  const originalKeywordCount = result.keywords.length
  const filteredKeywordsWithVolume = keywordsWithVolume.filter(kw => {
    // 过滤低搜索量
    if (kw.searchVolume > 0 && kw.searchVolume < MIN_SEARCH_VOLUME) {
      console.log(`⚠️ 过滤低搜索量关键词: "${kw.keyword}" (搜索量: ${kw.searchVolume}/月)`)
      return false
    }
    return true
  })

  // 更新关键词列表
  const filteredKeywords = filteredKeywordsWithVolume.map(kw => kw.keyword)
  const removedCount = originalKeywordCount - filteredKeywords.length

  if (removedCount > 0) {
    console.log(`🔧 已过滤 ${removedCount} 个低搜索量关键词 (< ${MIN_SEARCH_VOLUME}/月)`)
    console.log(`📊 剩余关键词: ${filteredKeywords.length}/${originalKeywordCount}`)
    result.keywords = filteredKeywords
    keywordsWithVolume = filteredKeywordsWithVolume
  }

  // 🎯 通过Keyword Planner扩展品牌关键词
  try {
    const brandName = (offer as { brand?: string }).brand
    if (brandName && userId) {
      console.log(`🔍 使用Keyword Planner扩展品牌关键词: "${brandName}"`)
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
          const lang = ((offer as { target_language?: string }).target_language || 'English').toLowerCase().substring(0, 2)
          const language = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : lang === 'es' ? 'es' : 'en'

          // 调用Keyword Planner API获取关键词创意
          const keywordIdeas = await getKeywordIdeas({
            customerId: adsAccount.customer_id,
            refreshToken: credentials.refresh_token,
            seedKeywords: [brandName],
            targetCountry: country,
            targetLanguage: language,
            accountId: adsAccount.id,
            userId
          })

          console.log(`📊 Keyword Planner返回${keywordIdeas.length}个关键词创意`)

          // 过滤：只保留包含品牌名且搜索量>=500的关键词
          const brandKeywords = keywordIdeas
            .filter(idea => {
              const keywordText = idea.text.toLowerCase()
              const brandLower = brandName.toLowerCase()
              // 关键词必须包含品牌名
              if (!keywordText.includes(brandLower)) {
                return false
              }
              // 搜索量必须>=500
              if (idea.avgMonthlySearches < MIN_SEARCH_VOLUME) {
                console.log(`⚠️ 过滤低搜索量品牌关键词: "${idea.text}" (搜索量: ${idea.avgMonthlySearches}/月)`)
                return false
              }
              return true
            })
            .map(idea => ({
              keyword: idea.text,
              searchVolume: idea.avgMonthlySearches,
              competition: idea.competition,
              competitionIndex: idea.competitionIndex
            }))

          console.log(`✅ 筛选出${brandKeywords.length}个有效品牌关键词（搜索量>=${MIN_SEARCH_VOLUME}）`)

          // 去重：排除已存在的关键词
          const existingKeywordsSet = new Set(result.keywords.map(kw => kw.toLowerCase()))
          const newBrandKeywords = brandKeywords.filter(kw =>
            !existingKeywordsSet.has(kw.keyword.toLowerCase())
          )

          if (newBrandKeywords.length > 0) {
            console.log(`🆕 添加${newBrandKeywords.length}个新的品牌关键词:`)
            newBrandKeywords.forEach(kw => {
              console.log(`   - "${kw.keyword}" (搜索量: ${kw.searchVolume.toLocaleString()}/月)`)
            })

            // 添加到关键词列表
            result.keywords = [...result.keywords, ...newBrandKeywords.map(kw => kw.keyword)]
            keywordsWithVolume = [...keywordsWithVolume, ...newBrandKeywords]

            console.log(`📊 关键词总数: ${result.keywords.length}（原${filteredKeywords.length} + 新增${newBrandKeywords.length}）`)
          } else {
            console.log(`ℹ️ 未发现新的品牌关键词（所有Keyword Planner结果已存在）`)
          }
        } else {
          console.warn('⚠️ 未找到Google Ads OAuth凭证，跳过Keyword Planner扩展')
        }
      } else {
        console.warn('⚠️ 未找到激活的Google Ads账号，跳过Keyword Planner扩展')
      }

      console.timeEnd('⏱️ Keyword Planner扩展')
    } else {
      if (!brandName) {
        console.log('ℹ️ Offer缺少品牌名，跳过Keyword Planner扩展')
      }
      if (!userId) {
        console.log('ℹ️ 缺少userId，跳过Keyword Planner扩展')
      }
    }
  } catch (plannerError: any) {
    // Keyword Planner扩展失败不影响主流程
    console.warn('⚠️ Keyword Planner扩展失败（非致命错误）:', plannerError.message)
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
    negativeKeywords = await generateNegativeKeywords(offer, userId)
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
