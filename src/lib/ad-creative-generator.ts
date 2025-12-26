import { getDatabase } from './db'
import type {
  GeneratedAdCreativeData,
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
import type { Offer } from './offers'
import { creativeCache, generateCreativeCacheKey } from './cache'
import { getKeywordSearchVolumes } from './keyword-planner'
import { clusterKeywordsByIntent } from './offer-keyword-pool'  // 🔥 AI语义分类
import { generateContent, getGeminiMode } from './gemini'
import { generateNegativeKeywords } from './keyword-generator'  // 🎯 新增：导入否定关键词生成函数
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'  // 🎯 新增：导入token追踪函数
import { loadPrompt } from './prompt-loader'  // 🎯 v3.0: 导入数据库prompt加载函数
import { calculateIntentScore, getIntentLevel } from './keyword-priority-classifier'  // 🎯 购买意图评分
import {
  normalizeGoogleAdsKeyword,
  deduplicateKeywordsWithPriority,
  logDuplicateKeywords
} from './google-ads-keyword-normalizer'  // 🔥 优化：Google Ads关键词标准化去重

// Keyword with search volume data
// 🎯 数据来源说明：统一使用Historical Metrics API的精确搜索量
// 🎯 意图分类（3类）
export type IntentCategory = 'brand' | 'scenario' | 'function'

export interface KeywordWithVolume {
  keyword: string
  searchVolume: number // 精确搜索量（来自Historical Metrics API）
  competition?: string
  competitionIndex?: number
  lowTopPageBid?: number // 页首最低出价（用于动态CPC）
  highTopPageBid?: number // 页首最高出价（用于动态CPC）
  source?: 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED' // 数据来源标记
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD' // 匹配类型（可选）
  intentCategory?: IntentCategory // 🔥 意图分类（品牌/场景/功能）
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
  const db = await getDatabase()

  // 1. 先尝试获取用户特定配置（优先级最高）
  let userSettings: Record<string, string> = {}
  if (userId) {
    const userRows = await db.query(`
      SELECT key, value FROM system_settings
      WHERE user_id = ? AND key IN (
        'vertex_ai_model', 'gcp_project_id', 'gcp_location',
        'gemini_api_key', 'gemini_model', 'use_vertex_ai'
      )
    `, [userId]) as Array<{ key: string; value: string }>

    userSettings = userRows.reduce((acc, { key, value }) => {
      acc[key] = value
      return acc
    }, {} as Record<string, string>)
  }

  // 2. 获取全局配置（作为备选）
  const globalRows = await db.query(`
    SELECT key, value FROM system_settings
    WHERE user_id IS NULL AND key IN (
      'VERTEX_AI_PROJECT_ID', 'VERTEX_AI_LOCATION', 'VERTEX_AI_MODEL',
      'GEMINI_API_KEY', 'GEMINI_MODEL'
    )
  `, []) as Array<{ key: string; value: string }>

  const globalSettings = globalRows.reduce((acc, { key, value }) => {
    acc[key] = value
    return acc
  }, {} as Record<string, string >)

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
 *
 * @version v2.8 (2025-12-04)
 * @changes P3优化 - badge徽章突出展示
 *   - Headlines Brand: badge优先级提升，明确指令使用完整badge文本
 *   - Callouts: badge改为P3 CRITICAL级别（与P2促销同级）
 * @previous v2.7 - P2 promotion促销强化
 *
 * @previous v2.6 - P1优化（availability紧迫感 + primeEligible验证）
 */
async function buildAdCreativePrompt(
  offer: any,
  theme?: string,
  referencePerformance?: any,
  excludeKeywords?: string[],
  extractedElements?: {
    keywords?: Array<{ keyword: string; searchVolume: number; source: string; priority: string }>
    headlines?: string[]
    descriptions?: string[]
    // 🎯 P0/P1/P2/P3优化：增强数据字段
    productInfo?: { features?: string[]; benefits?: string[]; useCases?: string[] }
    reviewAnalysis?: { sentiment?: string; themes?: string[]; insights?: string[] }
    localization?: { currency?: string; culturalNotes?: string[]; localKeywords?: string[] }
    brandAnalysis?: {
      positioning?: string
      voice?: string
      competitors?: string[]
      // 🔥 修复（2025-12-11）：添加店铺分析新字段
      hotProducts?: Array<{
        name: string
        productHighlights?: string[]
        successFactors?: string[]
      }>
      reviewAnalysis?: {
        overallSentiment?: string
        positives?: string[]
        concerns?: string[]
        customerUseCases?: string[]
        trustIndicators?: string[]
      }
      sellingPoints?: string[]
    }
    qualityScore?: number
    // 🆕 v4.10: 关键词池桶信息
    bucketInfo?: {
      bucket: string
      intent?: string
      intentEn?: string
      keywordCount: number
    }
  }
): Promise<string> {
  // 🎯 v3.0 REFACTOR: Load template from database (migration 056)
  const promptTemplate = await loadPrompt('ad_creative_generation')

  // Build variables map for simple substitution
  // Build variables map for basic product information
  const targetLanguage = offer.target_language || 'English'
  const languageInstruction = getLanguageInstruction(targetLanguage)

  // 🆕 v4.16: 确定链接类型
  const linkType = (offer.page_type as 'product' | 'store') || 'product'

  const variables: Record<string, string> = {
    language_instruction: languageInstruction,
    brand: offer.brand,
    category: offer.category || 'product',
    product_title: offer.product_title || offer.name || offer.title || 'Product',
    product_name: offer.product_name || offer.product_title || offer.name || offer.brand,
    product_description: offer.brand_description || offer.unique_selling_points || 'Quality product',
    unique_selling_points: offer.unique_selling_points || offer.product_highlights || 'Premium quality',
    target_audience: offer.target_audience || 'General',
    target_country: offer.target_country,
    target_language: targetLanguage
  }

  // Build conditional sections as complete strings
  let enhanced_features_section = ''
  let localization_section = ''
  let brand_analysis_section = ''
  // 🆕 v4.10: 关键词池桶section
  let keyword_bucket_section = ''
  // 🆕 v4.16: 链接类型section
  let link_type_section = ''
  let link_type_instructions = ''
  let store_creative_instructions = ''

  // 🆕 v4.16: 添加链接类型信息
  if (linkType === 'store') {
    link_type_section = `
## 🏪 STORE LINK MODE
This is a STORE link - the creative should drive users to explore the entire store rather than purchase a specific product.

**Store Context:**
- Target: {{brand}} official store
- Goal: Drive store visits and exploration
- Audience: Users looking for brand assurance and variety
`
    link_type_instructions = `
**⚠️ 店铺链接关键词使用规则：**
- 品牌词使用比例可适当提高（80%+品牌词）
- 场景词和品类词用于描述使用场景
- 强调店铺信誉、官方授权、售后保障
- 避免过于具体的购买意图词汇`
    // 🆕 v4.16: 店铺创意特殊指令
    store_creative_instructions = `
## 🏪 店铺链接创意特殊规则

### 创意类型A（品牌信任导向）- 桶A
**目标**: 建立品牌权威和官方形象
- 强调官方授权、正品保障
- 使用品牌词比例: 80%
- 关键CTA: "Visit Official Store", "Shop Brand Direct"
- 信任信号: "Authorized Dealer", "Official Warranty"

### 创意类型B（场景解决导向）- 桶B
**目标**: 展示产品如何解决用户问题
- 突出使用场景和解决方案
- 使用场景词比例: 60%
- 关键CTA: "Find Your Solution", "Explore Options"
- 场景示例: "Home Security", "Baby Monitor", "Pet Watching"

### 创意类型C（精选推荐导向）- 桶C
**目标**: 展示店铺热销和推荐产品
- 强调热门、评分、推荐
- 使用热销词比例: 40%
- 关键CTA: "See Best Sellers", "Discover Top Rated"
- 信号词: "Best Seller", "Top Rated", "Customer Favorite"

### 创意类型D（信任信号导向）- 桶D
**目标**: 建立用户信任和购买信心
- 突出评价、售后、保障
- 使用信任词比例: 40%
- 关键CTA: "Read Reviews", "Learn More"
- 信号词: "Warranty", "Guarantee", "Support"

### 创意类型S（店铺全景导向）- 桶S
**目标**: 全面展示店铺，吸引探索
- 整合所有店铺亮点
- 品牌词: 50%, 场景词: 30%, 品类词: 20%
- 关键CTA: "Explore Store", "View All Products"
- 覆盖各种用户搜索意图`
  } else {
    link_type_section = `
## 🏷️ PRODUCT LINK MODE
This is a PRODUCT link - the creative should drive users to purchase a specific product.

**Product Context:**
- Target: {{product_name || brand + '' product}}
- Goal: Drive immediate purchase
- Audience: Users with purchase intent`
    link_type_instructions = `
**⚠️ 单品链接关键词使用规则：**
- 品牌词和非品牌词均衡使用（约50%/50%）
- 根据创意类型选择对应桶的关键词
- 强调产品特性和购买优势
- 明确CTA引导购买行为`
  }

  // 🆕 v4.10: 添加关键词池桶指令
  if (extractedElements?.bucketInfo) {
    const { bucket, intent, intentEn, keywordCount } = extractedElements.bucketInfo

    // 🆕 v4.16: 店铺链接特殊桶处理
    if (linkType === 'store') {
      const storeBucketInstructions: Record<string, string> = {
        'A': `
**🏪 店铺桶A - 品牌信任导向**
- 核心主题: 官方授权、品牌保障
- 关键词策略: 80%品牌词 + 10%场景词 + 10%品类词
- 创意重点: 强调品牌权威和正品保证`,
        'B': `
**🏪 店铺桶B - 场景解决导向**
- 核心主题: 解决用户问题
- 关键词策略: 20%品牌词 + 60%场景词 + 20%品类词
- 创意重点: 展示产品如何解决用户需求`,
        'C': `
**🏪 店铺桶C - 精选推荐导向**
- 核心主题: 店铺热销推荐
- 关键词策略: 40%品牌词 + 20%场景词 + 30%品类词 + 10%信任词
- 创意重点: 强调热门产品和用户好评`,
        'D': `
**🏪 店铺桶D - 信任信号导向**
- 核心主题: 建立购买信心
- 关键词策略: 30%品牌词 + 10%场景词 + 20%品类词 + 40%信任词
- 创意重点: 突出评价、售后和保障`,
        'S': `
**🏪 店铺桶S - 店铺全景导向**
- 核心主题: 全面展示店铺
- 关键词策略: 50%品牌词 + 30%场景词 + 20%品类词
- 创意重点: 整合所有店铺亮点，覆盖广泛用户群`
      }
      keyword_bucket_section = storeBucketInstructions[bucket] || `
**📦 STORE KEYWORD POOL BUCKET ${bucket} - ${intent || intentEn}**
This store creative focuses on "${intent || intentEn}" user intent.
- ${keywordCount} pre-selected keywords for this intent
- Keywords optimized for store-level marketing`
    }
    // 🆕 2025-12-16: 综合创意（S桶）的特殊指令（产品链接）
    else if (bucket === 'S') {
      keyword_bucket_section = `
**🔮 SYNTHETIC CREATIVE - MAXIMUM AD STRENGTH OPTIMIZATION**
This is a SYNTHETIC creative that must achieve the HIGHEST possible Ad Strength rating ("Excellent").

**CRITICAL REQUIREMENTS:**
1. **Single Product Focus (MOST IMPORTANT)**: ALL creative elements MUST focus on ONE specific product
   - Product Name: {{product_name}}
   - Mention the specific product model/name in ALL headlines
   - Describe THIS product's features, NOT generic product categories
   - ❌ FORBIDDEN: "Shop All", "Browse Collection", "Full Lineup", "Cameras & Doorbells"
2. **Brand Coverage**: Include ALL brand-related keywords naturally in headlines and descriptions
3. **High-Volume Keywords**: Prioritize the top-performing non-brand keywords by search volume
4. **Keyword-Copy Alignment**: Every headline and description MUST contain at least one keyword
5. **Diversity**: Use ALL 15 headlines and ALL 4 descriptions - no shortcuts
6. **Ad Strength Optimization**:
   - Include brand name in at least 3 headlines
   - Use power words (Buy, Shop, Save, Free, Official, etc.)
   - Include numbers and statistics when possible
   - Use Dynamic Keyword Insertion: {KeyWord:${offer.brand}} in first headline
   - Each headline should be unique and address different user intents
   - Descriptions should complement headlines, not repeat them

**KEYWORD PRIORITY (from ${keywordCount} pre-selected keywords):**
- Brand keywords: MUST be included (highest priority)
- High-volume generic keywords: Include top performers
- Long-tail variations: Use for diversity

**AD STRENGTH CHECKLIST:**
☑️ 15 unique headlines with varied messaging
☑️ 4 compelling descriptions with clear CTAs
☑️ Strong keyword density without keyword stuffing
☑️ Mix of branded and generic appeal
☑️ Clear value propositions
☑️ Urgency elements (limited time, exclusive, etc.)
☑️ Trust signals (official, authorized, warranty, etc.)`
    } else {
      // 🆕 v4.18: 为每个产品链接桶添加单品聚焦约束
      const productBucketInstructions: Record<string, string> = {
        'A': `
**📦 产品桶A - 具体产品导向 (Product-Specific)**
**🎯 核心主题**: 突出具体产品的型号和参数
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 必须提到具体产品名称/型号: {{product_name}}
- ✅ 必须突出产品的具体规格/功能 (如 "1500W", "1070Wh", "2K resolution")
- ✅ 所有创意元素必须聚焦于这一个产品
- ❌ 禁止: "Shop All Products", "Browse Collection", "Cameras & Doorbells"
- ❌ 禁止: 提及同品牌其他品类产品
- 关键词策略: 30%品牌词 + 50%产品型号词 + 20%功能词
- 创意重点: 让用户一眼识别这就是TA要找的产品`,
        'B': `
**📦 产品桶B - 购买意向导向 (Purchase-Intent)**
**🎯 核心主题**: 促使用户立即购买
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 围绕这一个产品描述购买优势和CTA
- ✅ 强调具体价格/折扣 (如 "41% Off", "$839")
- ✅ 使用明确的购买CTA: "Shop Now", "Buy Today", "Order Now"
- ❌ 禁止: "Explore Store", "View All Products" (这是店铺级文案)
- ❌ 禁止: 暗示多产品选择
- 关键词策略: 20%品牌词 + 30%产品型号词 + 10%功能词 + 40%价格词
- 创意重点: 消除购买犹豫，推动立即行动`,
        'C': `
**📦 产品桶C - 功能特性导向 (Feature-Focused)**
**🎯 核心主题**: 展示产品的独特功能和优势
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 详细描述这一个产品的具体功能 (如 "AI Detection", "Solar Powered")
- ✅ 使用产品的高价值特性作为卖点
- ✅ 避免泛化的品类描述，聚焦单品细节
- ❌ 禁止: "Smart Home Solutions" (太通用)
- ❌ 禁止: 提及"完整产品线"或"多种选择"
- 关键词策略: 20%品牌词 + 20%产品型号词 + 60%功能词
- 创意重点: 用产品独特功能说服用户`,
        'D': `
**📦 产品桶D - 紧迫促销导向 (Urgency-Promo)**
**🎯 核心主题**: 利用紧迫感和促销推动转化
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 为这一个产品创造紧迫感 (如 "Limited Time", "Today Only")
- ✅ 强调该产品的专属优惠
- ✅ 使用倒计时/限时语言
- ❌ 禁止: "Shop the Full Collection" (店铺级文案)
- ❌ 禁止: 暗示"多款促销"
- 关键词策略: 20%品牌词 + 20%产品型号词 + 20%功能词 + 40%促销词
- 创意重点: 让用户感觉"现在不买就错过这个产品"`
      }
      keyword_bucket_section = productBucketInstructions[bucket] || `
**📦 KEYWORD POOL BUCKET ${bucket} - ${intent || intentEn}**
**⚠️ 单品聚焦规则 (CRITICAL)**:
- This creative MUST focus on ONE specific product: {{product_name}}
- ALL headlines and descriptions must reference this specific product
- Do NOT use generic brand/store descriptions
- Do NOT mention other products or product categories

This creative focuses on "${intent || intentEn}" user intent.
- You have ${keywordCount} pre-selected keywords optimized for this intent
- Prioritize these KEYWORD_POOL keywords over others (they appear first in the keyword list)
- Ensure headlines and descriptions align with the "${intent || intentEn}" messaging strategy
- Do NOT mix intents - stay focused on this single theme
- Stay focused on ONE product - do not generalize to product categories`
    }
  }

  // 🎯 P0优化：使用增强产品信息
  if (extractedElements?.productInfo) {
    const { features, benefits, useCases } = extractedElements.productInfo
    if (features && features.length > 0) {
      enhanced_features_section += `\n**✨ ENHANCED FEATURES**: ${features.slice(0, 5).join(', ')}`
    }
    if (benefits && benefits.length > 0) {
      enhanced_features_section += `\n**✨ KEY BENEFITS**: ${benefits.slice(0, 3).join(', ')}`
    }
    if (useCases && useCases.length > 0) {
      enhanced_features_section += `\n**✨ USE CASES**: ${useCases.slice(0, 3).join(', ')}`
    }
  }

  // 🎯 P2优化：使用本地化适配数据
  if (extractedElements?.localization) {
    const { currency, culturalNotes, localKeywords } = extractedElements.localization
    if (currency) {
      // 🔥 修复（2025-12-23）：明确指定货币符号，确保AI生成正确格式
      const currencySymbolMap: Record<string, string> = {
        'GBP': '£ (British Pound Sterling - UK market)',
        'USD': '$ (US Dollar)',
        'EUR': '€ (Euro)',
        'JPY': '¥ (Japanese Yen)',
        'AUD': 'A$ (Australian Dollar)',
        'CAD': 'C$ (Canadian Dollar)',
        'CHF': 'CHF (Swiss Franc)',
      }
      const currencySymbol = currencySymbolMap[currency] || currency
      localization_section += `\n**🌍 LOCAL CURRENCY**: ${currencySymbol}`
      // 🔥 重要：添加明确指令，要求所有价格使用正确符号
      localization_section += `\n**🔴 CRITICAL**: ALL prices in headlines and descriptions MUST use the correct currency symbol (${currencySymbol}).`
      localization_section += `\nExamples for ${currency}: "Save £170", "Only £499", "£XXX off" - NEVER use "$" or "€" for UK market.`
    }
    if (culturalNotes && culturalNotes.length > 0) {
      localization_section += `\n**🌍 CULTURAL NOTES**: ${culturalNotes.join('; ')}`
    }
    if (localKeywords && localKeywords.length > 0) {
      localization_section += `\n**🌍 LOCAL KEYWORDS**: ${localKeywords.slice(0, 5).join(', ')}`
    }
  }

  // 🎯 P3优化：使用品牌分析数据
  if (extractedElements?.brandAnalysis) {
    const { positioning, voice, competitors, hotProducts, reviewAnalysis: storeReviewAnalysis, sellingPoints } = extractedElements.brandAnalysis
    if (positioning) {
      brand_analysis_section += `\n**🏷️ BRAND POSITIONING**: ${positioning}`
    }
    if (voice) {
      brand_analysis_section += `\n**🏷️ BRAND VOICE**: ${voice}`
    }
    if (competitors && competitors.length > 0) {
      brand_analysis_section += `\n**🏷️ KEY COMPETITORS**: ${competitors.slice(0, 3).join(', ')}`
    }
    // 🔥 修复（2025-12-11）：添加店铺卖点
    if (sellingPoints && sellingPoints.length > 0) {
      brand_analysis_section += `\n**🏷️ BRAND SELLING POINTS**: ${sellingPoints.slice(0, 5).join(', ')}`
    }
    // 🔥 修复（2025-12-11）：添加热销商品产品亮点
    if (hotProducts && hotProducts.length > 0) {
      const allHighlights: string[] = []
      hotProducts.slice(0, 3).forEach(p => {
        if (p.productHighlights && p.productHighlights.length > 0) {
          allHighlights.push(...p.productHighlights.slice(0, 3))
        }
      })
      if (allHighlights.length > 0) {
        brand_analysis_section += `\n**🔥 HOT PRODUCT HIGHLIGHTS**: ${[...new Set(allHighlights)].slice(0, 8).join(', ')}`
      }
    }
    // 🔥 修复（2025-12-11）：添加店铺评论分析
    if (storeReviewAnalysis) {
      if (storeReviewAnalysis.overallSentiment) {
        brand_analysis_section += `\n**📊 STORE SENTIMENT**: ${storeReviewAnalysis.overallSentiment}`
      }
      if (storeReviewAnalysis.positives && storeReviewAnalysis.positives.length > 0) {
        brand_analysis_section += `\n**👍 CUSTOMER PRAISES**: ${storeReviewAnalysis.positives.slice(0, 4).join(', ')}`
      }
      if (storeReviewAnalysis.concerns && storeReviewAnalysis.concerns.length > 0) {
        brand_analysis_section += `\n**⚠️ CUSTOMER CONCERNS**: ${storeReviewAnalysis.concerns.slice(0, 3).join(', ')}`
      }
      if (storeReviewAnalysis.customerUseCases && storeReviewAnalysis.customerUseCases.length > 0) {
        brand_analysis_section += `\n**🎯 REAL USE CASES**: ${storeReviewAnalysis.customerUseCases.slice(0, 4).join(', ')}`
      }
      if (storeReviewAnalysis.trustIndicators && storeReviewAnalysis.trustIndicators.length > 0) {
        brand_analysis_section += `\n**✅ TRUST INDICATORS**: ${storeReviewAnalysis.trustIndicators.slice(0, 4).join(', ')}`
      }
    }
  }

  // 🔥 P0优化：增强数据 - 添加真实折扣、促销、排名、徽章等爬虫抓取的数据
  const extras: string[] = []

  // 价格信息（优先使用爬虫数据的原始字段）
  let currentPrice = null
  let originalPrice = null
  let discount = null

  // 🔧 修复: 从scraped_data提取价格和折扣（offer.pricing已删除）
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      currentPrice = scrapedData.productPrice
      originalPrice = scrapedData.originalPrice
      discount = scrapedData.discount
    } catch {}
  }

  if (currentPrice) {
    extras.push(`PRICE: ${currentPrice}`)
  }
  if (originalPrice && discount) {
    extras.push(`ORIGINAL: ${originalPrice} | DISCOUNT: ${discount}`)
  }

  // 🔥 促销信息（优化版 - 完整提取active数组）
  interface PromotionItem {
    description: string
    code?: string | null
    validUntil?: string | null
    conditions?: string | null
  }
  let activePromotions: PromotionItem[] = []

  if (offer.promotions) {
    try {
      const promos = JSON.parse(offer.promotions)
      if (promos.active && Array.isArray(promos.active) && promos.active.length > 0) {
        activePromotions = promos.active
      }
    } catch (error) {
      console.warn('Failed to parse promotions:', error)
    }
  }

  // 在extras中展示主促销
  if (activePromotions.length > 0) {
    const mainPromo = activePromotions[0]
    let promoText = `PROMO: ${mainPromo.description}`
    if (mainPromo.code) {
      promoText += ` | CODE: ${mainPromo.code}`
    }
    if (mainPromo.validUntil) {
      promoText += ` | VALID UNTIL: ${mainPromo.validUntil}`
    }
    if (mainPromo.conditions) {
      promoText += ` | ${mainPromo.conditions}`
    }
    extras.push(promoText)

    // 次要促销
    if (activePromotions.length > 1) {
      const secondaryPromo = activePromotions[1]
      extras.push(`EXTRA PROMO: ${secondaryPromo.description}`)
    }
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

  // 🎯 P0优化: topReviews热门评论（真实用户引用）
  let topReviews: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      topReviews = scrapedData.topReviews || []
    } catch {}
  }
  if (topReviews.length > 0) {
    // 只使用前2条最优质评论（避免prompt过长）
    extras.push(`TOP REVIEWS (Use for credibility): ${topReviews.slice(0, 2).join(' | ')}`)

    // 🔥 v4.1优化：提取用户语言模式（常用表达词汇）
    // 从评论中提取2-4词的短语作为自然语言参考
    const userPhrases: string[] = []
    topReviews.slice(0, 5).forEach(review => {
      // 匹配常见的用户表达模式
      const patterns = [
        /very ([\w\s]+)/gi,           // "very easy to use"
        /really ([\w\s]+)/gi,         // "really quiet"
        /so ([\w]+)/gi,               // "so powerful"
        /love the ([\w\s]+)/gi,       // "love the design"
        /great ([\w\s]+)/gi,          // "great battery life"
        /perfect for ([\w\s]+)/gi,    // "perfect for pets"
        /works ([\w\s]+)/gi,          // "works perfectly"
        /easy to ([\w]+)/gi,          // "easy to clean"
      ]
      patterns.forEach(pattern => {
        const matches = review.match(pattern)
        if (matches) {
          matches.slice(0, 2).forEach(m => {
            const cleaned = m.toLowerCase().trim()
            if (cleaned.length > 5 && cleaned.length < 30) {
              userPhrases.push(cleaned)
            }
          })
        }
      })
    })
    const uniquePhrases = [...new Set(userPhrases)].slice(0, 6)
    if (uniquePhrases.length > 0) {
      extras.push(`USER LANGUAGE PATTERNS: ${uniquePhrases.join(', ')}`)
    }
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
  // 🔥 v3.2新增：量化数据亮点
  let quantitativeHighlights: Array<{metric: string; value: string; adCopy: string}> = []
  let competitorMentions: Array<{brand: string; comparison: string; sentiment: string}> = []

  // 🎯 合并基础和增强评论分析数据
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
      // 🔥 v3.2新增字段
      quantitativeHighlights = reviewAnalysis.quantitativeHighlights || []
      competitorMentions = reviewAnalysis.competitorMentions || []
    } catch {}
  }

  // 🎯 P1优化：合并增强评论分析数据（如果有）
  if (extractedElements?.reviewAnalysis) {
    const enhanced = extractedElements.reviewAnalysis
    if (enhanced.themes && enhanced.themes.length > 0) {
      // themes 作为额外的洞察合并到 commonPraises
      commonPraises = [...new Set([...commonPraises, ...enhanced.themes])]
    }
    if (enhanced.insights && enhanced.insights.length > 0) {
      // insights 作为额外的购买理由
      purchaseReasons = [...new Set([...purchaseReasons, ...enhanced.insights])]
    }
    // sentiment 可以补充 sentimentDistribution
    if (enhanced.sentiment && !sentimentDistribution) {
      // 简单映射：positive/negative/neutral
      const sentimentMap: any = {
        positive: { positive: 70, neutral: 20, negative: 10 },
        negative: { positive: 10, neutral: 20, negative: 70 },
        neutral: { positive: 30, neutral: 50, negative: 20 }
      }
      sentimentDistribution = sentimentMap[enhanced.sentiment.toLowerCase()] || null
    }
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

  // 🔥 v3.2新增：量化数据亮点（评论中的具体数字 - 最有说服力的广告素材）
  // 例如："8小时续航"、"2000Pa吸力"、"覆盖2000平方英尺"
  if (quantitativeHighlights.length > 0) {
    const topHighlights = quantitativeHighlights
      .slice(0, 5)
      .map(q => q.adCopy)
      .join(' | ')
    extras.push(`PROVEN CLAIMS: ${topHighlights}`)
  }

  // 🔥 v3.2新增：竞品对比优势（用户自发的竞品比较）
  if (competitorMentions.length > 0) {
    // 只提取正面对比（用户认为我们比竞品更好的地方）
    const positiveComparisons = competitorMentions
      .filter(c => c.sentiment === 'positive')
      .slice(0, 3)
      .map(c => `vs ${c.brand}: ${c.comparison}`)
      .join(' | ')
    if (positiveComparisons) {
      extras.push(`COMPETITIVE EDGE: ${positiveComparisons}`)
    }
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

  // 🔥 2025-12-10优化：提取features和aboutThisItem（产品核心卖点）
  let productFeatures: string[] = []
  let aboutThisItem: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      productFeatures = scrapedData.features || []
      aboutThisItem = scrapedData.aboutThisItem || []
    } catch {}
  }
  // 优先使用aboutThisItem（更详细），其次使用features
  const featureSource = aboutThisItem.length > 0 ? aboutThisItem : productFeatures
  if (featureSource.length > 0) {
    // 提取前5个最重要的产品特点（限制每条100字符避免过长）
    const topFeatures = featureSource
      .slice(0, 5)
      .map((f: string) => f.length > 100 ? f.substring(0, 100) + '...' : f)
      .join(' | ')
    extras.push(`PRODUCT FEATURES: ${topFeatures}`)
  }

  // 🔥 P1-3: Store热销数据（新增优化 - 用于Amazon Store或独立站店铺页）
  let hotInsights: { avgRating: number; avgReviews: number; topProductsCount: number } | null = null
  let topProducts: string[] = []
  // 🔥 2025-12-10优化：提取销售热度数据
  let storeSalesVolumes: string[] = []
  let storeDiscounts: string[] = []

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

        // 🔥 2025-12-10优化：提取销量数据（"1K+ bought in past month"等）
        storeSalesVolumes = scrapedData.products
          .filter((p: any) => p.salesVolume)
          .slice(0, 3)
          .map((p: any) => `${(p.name || '').substring(0, 20)}... (${p.salesVolume})`)

        // 🔥 2025-12-10优化：提取折扣数据（"-20%"等）
        storeDiscounts = scrapedData.products
          .filter((p: any) => p.discount)
          .slice(0, 3)
          .map((p: any) => p.discount)
        storeDiscounts = [...new Set(storeDiscounts)] // 去重
      }
    } catch {}
  }

  // 如果是Store页面，添加热销洞察到Prompt
  if (hotInsights && topProducts.length > 0) {
    extras.push(`STORE HOT PRODUCTS: ${topProducts.slice(0, 3).join(', ')} (Avg: ${hotInsights.avgRating.toFixed(1)} stars, ${hotInsights.avgReviews} reviews)`)
  }

  // 🔥 2025-12-10优化：添加销售热度数据到Prompt（强社会证明信号）
  if (storeSalesVolumes.length > 0) {
    extras.push(`🔥 SALES MOMENTUM: ${storeSalesVolumes.join(' | ')}`)
  }

  // 🔥 2025-12-10优化：添加折扣数据到Prompt（促销信号）
  if (storeDiscounts.length > 0) {
    extras.push(`ACTIVE DISCOUNTS: ${storeDiscounts.join(', ')}`)
  }

  // 🔥 v4.1优化（2025-12-09）：提取店铺深度抓取数据
  let storeAggregatedReviews: string[] = []
  let storeAggregatedFeatures: string[] = []
  let storeHotBadges: string[] = []
  let storeCategoryKeywords: string[] = []

  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)

      // 1. 提取深度抓取的聚合数据
      if (scrapedData.deepScrapeResults) {
        const dsr = scrapedData.deepScrapeResults
        storeAggregatedReviews = dsr.aggregatedReviews || []
        storeAggregatedFeatures = dsr.aggregatedFeatures || []

        // 从热销商品提取徽章
        if (dsr.topProducts && Array.isArray(dsr.topProducts)) {
          dsr.topProducts.forEach((tp: any) => {
            if (tp.productData?.badge) {
              storeHotBadges.push(tp.productData.badge)
            }
          })
          storeHotBadges = [...new Set(storeHotBadges)] // 去重
        }
      }

      // 2. 提取产品分类作为关键词来源
      if (scrapedData.productCategories?.primaryCategories) {
        storeCategoryKeywords = scrapedData.productCategories.primaryCategories
          .slice(0, 5)
          .map((c: any) => c.name)
          .filter(Boolean)
      }

      // 3. 从热销商品提取徽章（备选路径）
      if (storeHotBadges.length === 0 && scrapedData.products) {
        scrapedData.products.forEach((p: any) => {
          if (p.badge) storeHotBadges.push(p.badge)
        })
        storeHotBadges = [...new Set(storeHotBadges)].slice(0, 3)
      }
    } catch {}
  }

  // 添加店铺深度数据到extras
  if (storeAggregatedFeatures.length > 0) {
    extras.push(`STORE HOT FEATURES: ${storeAggregatedFeatures.slice(0, 8).join(' | ')}`)
  }
  if (storeAggregatedReviews.length > 0) {
    extras.push(`STORE USER VOICES: ${storeAggregatedReviews.slice(0, 5).join(' | ')}`)
  }
  if (storeHotBadges.length > 0) {
    extras.push(`STORE TRUST BADGES: ${storeHotBadges.join(', ')}`)
  }
  if (storeCategoryKeywords.length > 0) {
    extras.push(`STORE CATEGORIES: ${storeCategoryKeywords.join(', ')}`)
  }

  // 🎯 v3.2优化（2025-12-08）：读取v3.2差异化分析数据
  let v32Analysis: {
    storeQualityLevel?: string
    categoryDiversification?: { level: string; categories?: string[]; primaryCategory?: string }
    hotInsights?: { avgRating?: number; avgReviews?: number; topProductsCount?: number; bestSeller?: string; priceRange?: { min: number; max: number } }
    marketFit?: { score: number; level: string; strengths?: string[]; gaps?: string[] }
    credibilityLevel?: { score: number; level: string; factors?: string[] }
    categoryPosition?: { rank?: string; percentile?: number; competitors?: number }
    pageType?: 'store' | 'product'
  } | null = null

  if (offer.ai_analysis_v32) {
    try {
      v32Analysis = JSON.parse(offer.ai_analysis_v32)
      console.log(`[AdCreativeGenerator] 🎯 使用v3.2分析数据: pageType=${v32Analysis?.pageType}`)
    } catch (error) {
      console.error('[AdCreativeGenerator] ❌ 解析ai_analysis_v32失败:', error)
    }
  }

  // 店铺页面特殊处理（v3.2增强）
  if (v32Analysis?.pageType === 'store') {
    // 店铺质量等级
    if (v32Analysis.storeQualityLevel) {
      extras.push(`STORE QUALITY: ${v32Analysis.storeQualityLevel} Tier`)
    }
    // 分类多样化
    if (v32Analysis.categoryDiversification) {
      const catDiv = v32Analysis.categoryDiversification
      extras.push(`CATEGORY FOCUS: ${catDiv.level}${catDiv.primaryCategory ? ` - Primary: ${catDiv.primaryCategory}` : ''}`)
      if (catDiv.categories && catDiv.categories.length > 0) {
        extras.push(`PRODUCT RANGE: ${catDiv.categories.slice(0, 4).join(', ')}`)
      }
    }
    // 增强热销洞察
    if (v32Analysis.hotInsights) {
      const hi = v32Analysis.hotInsights
      if (hi.bestSeller) {
        extras.push(`BEST SELLER: ${hi.bestSeller}`)
      }
      if (hi.priceRange) {
        extras.push(`PRICE RANGE: $${hi.priceRange.min} - $${hi.priceRange.max}`)
      }
    }
  }

  // 单品页面特殊处理（v3.2增强）
  if (v32Analysis?.pageType === 'product') {
    // 市场契合度
    if (v32Analysis.marketFit) {
      const mf = v32Analysis.marketFit
      extras.push(`MARKET FIT: ${mf.level} (${mf.score}/100)`)
      if (mf.strengths && mf.strengths.length > 0) {
        extras.push(`PRODUCT STRENGTHS: ${mf.strengths.slice(0, 3).join(', ')}`)
      }
    }
    // 可信度评级
    if (v32Analysis.credibilityLevel) {
      const cl = v32Analysis.credibilityLevel
      extras.push(`CREDIBILITY: ${cl.level} (${cl.score}/100)`)
      if (cl.factors && cl.factors.length > 0) {
        extras.push(`TRUST FACTORS: ${cl.factors.slice(0, 3).join(', ')}`)
      }
    }
    // 品类排名
    if (v32Analysis.categoryPosition) {
      const cp = v32Analysis.categoryPosition
      if (cp.rank) {
        extras.push(`CATEGORY RANK: ${cp.rank}`)
      }
      if (cp.percentile) {
        extras.push(`TOP ${100 - cp.percentile}% IN CATEGORY`)
      }
    }
  }

  // 🔥 P0优化：竞品分析数据（差异化定位关键）
  if (offer.competitor_analysis) {
    try {
      const compAnalysis = JSON.parse(offer.competitor_analysis)

      // 1. 价格定位营销标签（🔥 v4.2优化：完整价格区间定位）
      if (compAnalysis.pricePosition) {
        const pricePos = compAnalysis.pricePosition
        // 价格节省信息
        if (pricePos.savingsVsAvg) {
          extras.push(`COMPETITIVE PRICE: ${pricePos.savingsVsAvg}`)
        }
        // 🔥 新增：完整价格区间营销标签
        switch (pricePos.priceAdvantage) {
          case 'lowest':
            extras.push(`MARKET POSITION: [BEST VALUE] Lowest priced in category`)
            break
          case 'below_average':
            const percentile = pricePos.pricePercentile || 0
            extras.push(`MARKET POSITION: [VALUE PICK] Top ${percentile}% most affordable`)
            break
          case 'average':
            extras.push(`MARKET POSITION: [BALANCED] Competitive price with quality features`)
            break
          case 'above_average':
            extras.push(`MARKET POSITION: [QUALITY] Premium features at fair price`)
            break
          case 'premium':
            extras.push(`MARKET POSITION: [FLAGSHIP] Top-tier quality and performance`)
            break
        }
      }

      // 🔥 新增：评分优势营销标签
      if (compAnalysis.ratingPosition) {
        const ratingPos = compAnalysis.ratingPosition
        switch (ratingPos.ratingAdvantage) {
          case 'top_rated':
            extras.push(`RATING ADVANTAGE: [TOP RATED] Highest customer satisfaction (${ratingPos.ourRating} stars)`)
            break
          case 'above_average':
            extras.push(`RATING ADVANTAGE: [HIGHLY RATED] Above average at ${ratingPos.ourRating} stars`)
            break
        }
      }

      // 2. 独特卖点（竞品没有的优势）
      if (compAnalysis.uniqueSellingPoints && compAnalysis.uniqueSellingPoints.length > 0) {
        const highSignificanceUSPs = compAnalysis.uniqueSellingPoints
          .filter((u: any) => u.significance === 'high')
          .map((u: any) => u.usp)
        if (highSignificanceUSPs.length > 0) {
          extras.push(`UNIQUE ADVANTAGES: ${highSignificanceUSPs.join('; ')}`)
        }
      }

      // 3. 如何应对竞品优势（定位策略）
      if (compAnalysis.competitorAdvantages && compAnalysis.competitorAdvantages.length > 0) {
        const counterStrategies = compAnalysis.competitorAdvantages
          .slice(0, 2) // 只取前2个最重要的
          .map((a: any) => a.howToCounter)
        if (counterStrategies.length > 0) {
          extras.push(`POSITIONING STRATEGY: ${counterStrategies.join('; ')}`)
        }
      }

      // 4. 我们有且竞品也有的功能（强化竞争力）
      if (compAnalysis.featureComparison && compAnalysis.featureComparison.length > 0) {
        const ourAdvantages = compAnalysis.featureComparison
          .filter((f: any) => f.weHave && f.ourAdvantage)
          .map((f: any) => f.feature)
        if (ourAdvantages.length > 0) {
          extras.push(`COMPETITIVE FEATURES: ${ourAdvantages.slice(0, 3).join(', ')}`)
        }
      }

      // 🔥 v3.2新增：竞品弱点（转化为我们的差异化卖点）
      // 这是最有说服力的广告素材 - 直接点出竞品问题，暗示我们解决了这些问题
      if (compAnalysis.competitorWeaknesses && compAnalysis.competitorWeaknesses.length > 0) {
        // 提取高频竞品弱点的adCopy
        const highFreqWeaknesses = compAnalysis.competitorWeaknesses
          .filter((w: any) => w.frequency === 'high' || w.frequency === 'medium')
          .slice(0, 3)
          .map((w: any) => w.adCopy)
          .filter((ad: string) => ad && ad.length > 0)
        if (highFreqWeaknesses.length > 0) {
          extras.push(`COMPETITOR WEAKNESSES (use to differentiate): ${highFreqWeaknesses.join(' | ')}`)
        }

        // 单独提取详细弱点描述，用于更深度的广告创意
        const weaknessDetails = compAnalysis.competitorWeaknesses
          .slice(0, 2)
          .map((w: any) => `${w.weakness} → We offer: ${w.ourAdvantage}`)
        if (weaknessDetails.length > 0) {
          extras.push(`AVOID COMPETITOR ISSUES: ${weaknessDetails.join(' | ')}`)
        }
      }

      // 🔥 v4.1优化：提取竞品特性用于差异化关键词
      if (compAnalysis.competitors && Array.isArray(compAnalysis.competitors)) {
        // 收集所有竞品特性
        const competitorFeatures: string[] = []
        compAnalysis.competitors.forEach((comp: any) => {
          if (comp.features && Array.isArray(comp.features)) {
            competitorFeatures.push(...comp.features.slice(0, 3))
          }
        })
        // 去重并取前10个
        const uniqueCompFeatures = [...new Set(competitorFeatures)].slice(0, 10)
        if (uniqueCompFeatures.length > 0) {
          extras.push(`COMPETITOR FEATURES (for differentiation): ${uniqueCompFeatures.join(' | ')}`)
        }
      }

      console.log('✅ 已加载竞品分析数据到Prompt')
    } catch (parseError: any) {
      console.warn('⚠️ 解析竞品分析数据失败（非致命错误）:', parseError.message)
    }
  }

  // Build extras_data section
  variables.extras_data = extras.length ? '\n' + extras.join(' | ') + '\n' : ''

  // 🔥 Build promotion_section（v2.1新增）
  let promotion_section = ''
  if (activePromotions.length > 0) {
    const mainPromo = activePromotions[0]
    promotion_section = `\n🔥 **CRITICAL PROMOTION EMPHASIS**:
This product has ${activePromotions.length} active promotion(s). YOU MUST highlight these in your creative:

**MAIN PROMOTION**: ${mainPromo.description}${mainPromo.code ? ` (Code: ${mainPromo.code})` : ''}
${mainPromo.validUntil ? `**VALID UNTIL**: ${mainPromo.validUntil}` : ''}
${mainPromo.conditions ? `**CONDITIONS**: ${mainPromo.conditions}` : ''}

**REQUIREMENTS**:
✅ Include promotion in at least 3-5 headlines (e.g., "20% Off Today", "Use Code ${mainPromo.code || 'SAVE20'}", "Limited Time Offer")
✅ Mention promotion in 2-3 descriptions with urgency (e.g., "Don't miss out", "Offer ends soon")
✅ Add promotion-related keywords (e.g., "discount", "sale", "promo code", "limited offer")
✅ Use callouts to emphasize savings (e.g., "20% Off First Order", "Free Shipping Available")
`

    if (activePromotions.length > 1) {
      const secondaryPromo = activePromotions[1]
      promotion_section += `\n**SECONDARY PROMOTION**: ${secondaryPromo.description}${secondaryPromo.code ? ` (Code: ${secondaryPromo.code})` : ''}\n`
    }

    promotion_section += `
**PROMOTION CREATIVE EXAMPLES**:
- Headline: "Get 20% Off - Use Code ${mainPromo.code || 'SAVE20'} | ${offer.brand}"
- Headline: "${offer.brand} - Limited Time Offer | Shop Now"
- Headline: "Save on ${offer.brand_description || offer.brand} - Deal Ends Soon"
- Description: "Shop now and save with code ${mainPromo.code || 'SAVE20'}. ${mainPromo.description}. Limited time!"
- Description: "${offer.brand_description || offer.brand} at special price. ${mainPromo.description}${offer.final_url ? '. Free shipping available.' : ''}"
- Callout: "${mainPromo.description}"
- Callout: "Limited Time Deal"

`
  }
  variables.promotion_section = promotion_section

  // Build theme_section
  let theme_section = ''
  if (theme) {
    theme_section = `\n**THEME: ${theme}** - All content must reflect this theme. 60%+ headlines should directly embody theme.\n`
  }
  variables.theme_section = theme_section

  // Build reference_performance_section
  let reference_performance_section = ''
  if (referencePerformance) {
    if (referencePerformance.best_headlines?.length) {
      reference_performance_section += `TOP HEADLINES: ${referencePerformance.best_headlines.slice(0, 3).join(', ')}\n`
    }
    if (referencePerformance.top_keywords?.length) {
      reference_performance_section += `TOP KEYWORDS: ${referencePerformance.top_keywords.slice(0, 5).join(', ')}\n`
    }
  }
  variables.reference_performance_section = reference_performance_section

  // 🎯 Build extracted_elements_section
  let extracted_elements_section = ''
  if (extractedElements) {
    if (extractedElements.keywords && extractedElements.keywords.length > 0) {
      // 🔥 修复(2025-12-16): 从10个提升到100个，充分利用有真实搜索量的关键词
      // 原问题：高搜索量关键词仅使用10个，大量被浪费
      const topKeywords = extractedElements.keywords
        .filter(k => k.searchVolume >= 500)
        .slice(0, 100)
        .map(k => `"${k.keyword}" (${k.searchVolume}/mo, ${k.source})`)
      if (topKeywords.length > 0) {
        extracted_elements_section += `\n**EXTRACTED KEYWORDS** (from product data, validated by Keyword Planner):\n${topKeywords.join(', ')}\n`
      }
    }

    if (extractedElements.headlines && extractedElements.headlines.length > 0) {
      extracted_elements_section += `\n**EXTRACTED HEADLINES** (from product titles, ≤30 chars):\n${extractedElements.headlines.slice(0, 5).join(', ')}\n`
    }

    if (extractedElements.descriptions && extractedElements.descriptions.length > 0) {
      extracted_elements_section += `\n**EXTRACTED DESCRIPTIONS** (from product features, ≤90 chars):\n${extractedElements.descriptions.slice(0, 2).join('; ')}\n`
    }

    extracted_elements_section += `\n**INSTRUCTION**: Use above extracted elements as reference. You can refine, expand, or create variations, but prioritize extracted keywords (they have real search volume). Generate complete 15 headlines and 4 descriptions as required.\n`
  }
  variables.extracted_elements_section = extracted_elements_section

  // 🔧 P0修复（2025-12-08）：添加缺失的section变量赋值
  variables.enhanced_features_section = enhanced_features_section
  variables.localization_section = localization_section
  variables.brand_analysis_section = brand_analysis_section

  // Build all dynamic guidance sections
  variables.headline_brand_guidance = buildHeadlineBrandGuidance(badge, salesRank, offer, hotInsights, topProducts, sentimentDistribution, averageRating)
  variables.headline_feature_guidance = buildHeadlineFeatureGuidance(technicalDetails, reviewHighlights, commonPraises, topPositiveKeywords, featureSource)
  variables.headline_promo_guidance = buildHeadlinePromoGuidance(discount, activePromotions)
  variables.headline_cta_guidance = buildHeadlineCTAGuidance(primeEligible, purchaseReasons)
  variables.headline_urgency_guidance = buildHeadlineUrgencyGuidance(availability)

  variables.description_1_guidance = buildDescription1Guidance(badge, salesRank)
  variables.description_2_guidance = buildDescription2Guidance(primeEligible, activePromotions)
  variables.description_3_guidance = buildDescription3Guidance(useCases, userProfiles)
  variables.description_4_guidance = buildDescription4Guidance(topReviews, hotInsights, topProducts, sentimentDistribution, totalReviews, averageRating)

  // 🎯 P0优化（2025-12-07）：利用新增AI数据字段
  let aiKeywords: string[] = []
  let aiCompetitiveEdges: any = null
  let aiReviews: any = null

  // 读取AI增强的关键词数据
  if (offer.ai_keywords) {
    try {
      aiKeywords = JSON.parse(offer.ai_keywords)
      console.log(`[AdCreativeGenerator] 🎯 使用AI生成关键词: ${aiKeywords.length}个`)
    } catch (error) {
      console.error('[AdCreativeGenerator] ❌ 解析ai_keywords失败:', error)
      aiKeywords = []
    }
  }

  // 读取AI竞争优势数据
  if (offer.ai_competitive_edges) {
    try {
      aiCompetitiveEdges = JSON.parse(offer.ai_competitive_edges)
      console.log(`[AdCreativeGenerator] 🏆 使用AI竞争优势数据:`, aiCompetitiveEdges)
    } catch (error) {
      console.error('[AdCreativeGenerator] ❌ 解析ai_competitive_edges失败:', error)
      aiCompetitiveEdges = null
    }
  }

  // 读取AI评论洞察数据
  if (offer.ai_reviews) {
    try {
      aiReviews = JSON.parse(offer.ai_reviews)
      console.log(`[AdCreativeGenerator] ⭐ 使用AI评论洞察: rating=${aiReviews.rating}, sentiment=${aiReviews.sentiment}`)
    } catch (error) {
      console.error('[AdCreativeGenerator] ❌ 解析ai_reviews失败:', error)
      aiReviews = null
    }
  }

  // 优先使用AI增强数据，fallback到原有数据
  variables.review_data_summary = buildReviewDataSummary(
    reviewHighlights,
    commonPraises,
    topPositiveKeywords,
    commonPainPoints,
    aiReviews
  )

  variables.callout_guidance = buildCalloutGuidance(salesRank, primeEligible, availability, badge, activePromotions)
  variables.exclude_keywords_section = excludeKeywords?.length ? `- 已用关键词: ${excludeKeywords.slice(0, 10).join(', ')}` : ''

  // 🎯 新增：AI关键词section
  // 🔥 修复(2025-12-17): 优先使用mergedData中的关键词池数据，而非旧的ai_keywords字段
  const keywordsForPrompt = extractedElements?.keywords && extractedElements.keywords.length > 0
    ? extractedElements.keywords.slice(0, 50).map((kw: any) => typeof kw === 'string' ? kw : kw.keyword)  // 使用关键词池数据（最多50个）
    : aiKeywords.slice(0, 15)  // fallback到旧的ai_keywords

  if (keywordsForPrompt && keywordsForPrompt.length > 0) {
    variables.ai_keywords_section = `\n**高价值关键词池** (已验证搜索量):\n${keywordsForPrompt.join(', ')}\n`
    console.log(`[Prompt] 🔑 提供给AI的关键词数量: ${keywordsForPrompt.length}个 (来源: ${extractedElements?.keywords && extractedElements.keywords.length > 0 ? '关键词池' : 'ai_keywords'})`)
  } else {
    variables.ai_keywords_section = ''
  }

  // 🎯 新增：AI竞争优势section
  let ai_competitive_section = ''
  if (aiCompetitiveEdges) {
    if (aiCompetitiveEdges.badges && aiCompetitiveEdges.badges.length > 0) {
      ai_competitive_section += `\n**产品认证/优势标识**: ${aiCompetitiveEdges.badges.join(', ')}\n`
    }
    if (aiCompetitiveEdges.primeEligible) {
      ai_competitive_section += `\n**物流优势**: Prime Eligible（快速配送）\n`
    }
    if (aiCompetitiveEdges.stockStatus) {
      ai_competitive_section += `\n**库存状态**: ${aiCompetitiveEdges.stockStatus}\n`
    }
    if (aiCompetitiveEdges.salesRank) {
      ai_competitive_section += `\n**销售排名**: ${aiCompetitiveEdges.salesRank}\n`
    }
  }
  variables.ai_competitive_section = ai_competitive_section

  // 🎯 新增：AI评论洞察section
  let ai_reviews_section = ''
  if (aiReviews) {
    if (aiReviews.rating) {
      ai_reviews_section += `\n**用户评分**: ${aiReviews.rating}/5.0`
      if (aiReviews.count) {
        ai_reviews_section += ` (${aiReviews.count}条评价)`
      }
    }
    if (aiReviews.sentiment) {
      ai_reviews_section += `\n**整体评价**: ${aiReviews.sentiment}`
    }
    if (aiReviews.positives && aiReviews.positives.length > 0) {
      ai_reviews_section += `\n**用户好评亮点**: ${aiReviews.positives.slice(0, 3).join(', ')}\n`
    }
    if (aiReviews.useCases && aiReviews.useCases.length > 0) {
      ai_reviews_section += `\n**主要使用场景**: ${aiReviews.useCases.slice(0, 2).join(', ')}\n`
    }
  }
  variables.ai_reviews_section = ai_reviews_section

  // Build competitive_guidance_section（保留原有逻辑，但增强AI数据）
  let competitive_guidance_section = ''
  if (offer.competitor_analysis) {
    try {
      const compAnalysis = JSON.parse(offer.competitor_analysis)
      competitive_guidance_section = buildCompetitiveGuidance(compAnalysis)
    } catch {}
  }
  variables.competitive_guidance_section = competitive_guidance_section

  // 🆕 v4.10: 添加关键词池桶相关变量
  // 这些变量名需要与 prompt 模板中的占位符匹配
  if (extractedElements?.bucketInfo) {
    const { bucket, intent, intentEn, keywordCount } = extractedElements.bucketInfo
    variables.bucket_type = bucket
    variables.bucket_intent = intent || intentEn || ''
    variables.bucket_info_section = `
**📦 当前创意桶：${bucket} - ${intent || intentEn}**
- 桶主题：${intent || intentEn}
- 预选关键词数量：${keywordCount}
- 文案风格要求：所有 Headlines 和 Descriptions 必须与"${intent || intentEn}"主题一致`
  } else {
    // 未使用关键词池时的默认值
    variables.bucket_type = ''
    variables.bucket_intent = ''
    variables.bucket_info_section = ''
  }
  // 兼容性：保留旧的占位符名称
  variables.keyword_bucket_section = keyword_bucket_section

  // 🆕 v4.16: 添加链接类型策略 section
  // 根据 offer.page_type 区分单品链接和店铺链接，使用不同的创意策略
  // 注意：linkType 已在第307行声明
  if (linkType === 'store') {
    variables.link_type_section = `
## 📍 当前链接类型：店铺页面 (Store Page)
**目标**：最大化进店，扩大品牌认知

**桶类型与关键词分布**:
| 桶 | 类型 | 品牌词 | 场景词 | 品类词 | 信任词 |
|----|------|:-----:|:-----:|:-----:|:-----:|
| A | Brand-Trust | **80%** | 10% | 10% | 0% |
| B | Scene-Solution | 20% | **60%** | 20% | 0% |
| C | Collection-Highlight | 40% | 20% | **30%** | 10% |
| D | Trust-Signals | 30% | 10% | 20% | **40%** |
| S | Store-Overview | **50%** | 30% | 20% | 0% |

**核心要求**:
- 强调品牌官方地位和可信度
- 突出店铺热销产品和高评价
- 展示店铺的独特卖点和售后保障
- 使用店铺层面的社会证明（评分、评价数、销量）
`
  } else {
    // 默认：单品链接策略
    variables.link_type_section = `
## 📍 当前链接类型：产品页面 (Product Page)
**目标**：最大化转化，让用户购买这个具体产品

**桶类型与关键词分布**:
| 桶 | 类型 | 品牌词 | 产品型号词 | 功能词 | 价格词 |
|----|------|:-----:|:---------:|:-----:|:-----:|
| A | Product-Specific | 30% | **50%** | 20% | 0% |
| B | Purchase-Intent | 20% | 30% | 10% | **40%** |
| C | Feature-Focused | 20% | 20% | **60%** | 0% |
| D | Urgency-Promo | 20% | 20% | 20% | 20% |
| S | Comprehensive | 40% | 30% | 30% | 0% |

**核心要求**:
- 标题必须与具体产品相关联
- 至少 2 个标题包含具体产品型号或参数
- 至少 2 个描述包含具体价格或折扣信息
`
  }

  // 🆕 v4.17: 添加链接类型相关变量到模板
  variables.link_type_instructions = link_type_instructions
  variables.store_creative_instructions = store_creative_instructions

  // 🆕 v4.17: 添加输出格式要求（解决AI返回非JSON格式问题）
  variables.output_format_section = `
## 📋 OUTPUT (JSON only, no markdown):

\`\`\`json
{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}
\`\`\`

**IMPORTANT**: You MUST return ONLY valid JSON. Do not add any explanations, German text, or markdown formatting outside the JSON code block. All headlines must be in the target language ({{target_language}}) and the JSON must be parseable.`

  // Substitute all placeholders and return
  return substitutePlaceholders(promptTemplate, variables)
}

/**
 * 🆕 v4.16: 获取下一个需要生成的创意类型
 * 根据已生成的创意类型，自动选择下一个未生成的类型
 * 顺序：A → B → C → D → S
 *
 * @param offer - Offer 对象，必须包含 page_type 和 generated_buckets 字段
 * @returns 下一个创意类型（BucketType）
 */
export type BucketType = 'A' | 'B' | 'C' | 'D' | 'S'

export function getNextCreativeType(offer: {
  page_type: 'product' | 'store'
  generated_buckets?: string | null
}): BucketType {
  const typeOrder: BucketType[] = ['A', 'B', 'C', 'D', 'S']

  // 解析已生成的 bucket 列表
  let generatedBuckets: BucketType[] = []
  if (offer.generated_buckets) {
    try {
      generatedBuckets = JSON.parse(offer.generated_buckets) as BucketType[]
    } catch {
      console.warn('[getNextCreativeType] 解析 generated_buckets 失败:', offer.generated_buckets)
      generatedBuckets = []
    }
  }

  // 找到第一个未生成的类型
  const nextType = typeOrder.find(type => !generatedBuckets.includes(type))

  // 如果所有类型都已生成，返回 S（综合创意）
  return nextType || 'S'
}

/**
 * 🆕 v4.16: 根据 bucket 和链接类型获取对应的 theme 描述
 *
 * @param bucket - 创意类型（A/B/C/D/S）
 * @param linkType - 链接类型（'product' | 'store'）
 * @returns theme 描述字符串
 */
export function getThemeByBucket(bucket: BucketType, linkType: 'product' | 'store'): string {
  if (linkType === 'store') {
    const themes: Record<BucketType, string> = {
      'A': '品牌信任导向 - 强调官方正品和品牌权威',
      'B': '场景解决方案 - 突出使用场景和痛点解决',
      'C': '精选推荐导向 - 展示热销产品和店铺特色',
      'D': '信任信号导向 - 突出评价、退换货、售后',
      'S': '店铺全景 - 全面展示店铺产品线'
    }
    return themes[bucket]
  } else {
    const themes: Record<BucketType, string> = {
      'A': '产品型号导向 - 标题必须包含具体产品型号参数',
      'B': '购买意图导向 - 描述必须包含价格和折扣信息',
      'C': '功能特性导向 - 突出核心功能和技术参数',
      'D': '紧迫促销导向 - 包含限时/限量/立即行动元素',
      'S': '综合推广 - 平衡所有意图，Ad Strength 最大化'
    }
    return themes[bucket]
  }
}

/**
 * 🆕 v4.16: 更新 offer 的 generated_buckets 字段
 * 在成功生成创意后调用，记录已生成的类型
 *
 * @param db - 数据库连接
 * @param offerId - Offer ID
 * @param bucket - 新生成的创意类型
 */
export async function markBucketGenerated(
  db: any,
  offerId: number,
  bucket: BucketType
): Promise<void> {
  // 获取当前已生成的 bucket 列表
  const [offer] = await db.query('SELECT generated_buckets FROM offers WHERE id = ?', [offerId]) as Array<{ generated_buckets: string | null }>

  let generatedBuckets: BucketType[] = []
  if (offer?.generated_buckets) {
    try {
      generatedBuckets = JSON.parse(offer.generated_buckets) as BucketType[]
    } catch {
      generatedBuckets = []
    }
  }

  // 如果还没有这个 bucket，添加它
  if (!generatedBuckets.includes(bucket)) {
    generatedBuckets.push(bucket)
    await db.query(
      'UPDATE offers SET generated_buckets = ? WHERE id = ?',
      [JSON.stringify(generatedBuckets), offerId]
    )
    console.log(`[markBucketGenerated] Offer ${offerId}: 已记录 bucket ${bucket}, 总计: ${generatedBuckets.length}/5`)
  }
}

/**
 * Helper functions to build dynamic guidance sections
 */
function buildHeadlineBrandGuidance(badge: string | null, salesRank: string | null, offer: any, hotInsights: any, topProducts: string[], sentimentDistribution: any, averageRating: number): string {
  return `- Brand (2): ${badge ? `🎯 **P3 CRITICAL - MUST use complete BADGE text**: "${badge}" (e.g., "${badge} | ${offer.brand}", "${badge} - Trusted Quality")` : '"Trusted Brand"'}, ${salesRank ? `Use SALES RANK if available (e.g., "#1 Best Seller")` : `"#1 ${offer.category || 'Choice'}"`}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: For stores with hot products, create "Best Seller Collection" headlines featuring top products (e.g., "Best ${topProducts[0]?.split(' ').slice(0, 2).join(' ')} Collection")` : ''}${sentimentDistribution && sentimentDistribution.positive >= 80 ? `. **SOCIAL PROOF**: Use high approval rate: "${sentimentDistribution.positive}% Love It", "Rated ${averageRating} Stars"` : ''}
  * IMPORTANT: Make these 2 brand headlines COMPLETELY DIFFERENT in focus and wording
  * Example 1: "Official ${offer.brand} Store" (trust focus)
  * Example 2: "#1 Trusted ${offer.brand}" (social proof focus)
  * ❌ AVOID: "Official ${offer.brand}", "Official ${offer.brand} Brand" (too similar)
`
}

function buildHeadlineFeatureGuidance(technicalDetails: Record<string, string>, reviewHighlights: string[], commonPraises: string[], topPositiveKeywords: Array<{keyword: string; frequency: number}>, productFeatures: string[] = []): string {
  // 🔥 2025-12-10优化：整合productFeatures到guidance中
  const featureExamples = productFeatures.length > 0
    ? `\n  * **SCRAPED FEATURES** (use these for authentic headlines): ${productFeatures.slice(0, 3).map(f => `"${f.substring(0, 30)}..."`).join(', ')}`
    : ''
  return `- Feature (4): ${Object.keys(technicalDetails).length > 0 ? 'Use SPECS data for technical features' : 'Core product benefits'}${reviewHighlights.length > 0 ? `, incorporate REVIEW INSIGHTS (e.g., "${reviewHighlights[0]}")` : ''}${commonPraises.length > 0 ? `. **USER PRAISES**: Use authentic features: ${commonPraises.slice(0, 2).join(', ')}` : ''}${topPositiveKeywords.length > 0 ? `. **POSITIVE KEYWORDS**: Incorporate high-frequency praise words: ${topPositiveKeywords.slice(0, 3).map(k => k.keyword).join(', ')}` : ''}${featureExamples}
  * IMPORTANT: Each of the 4 feature headlines must focus on a DIFFERENT feature or benefit
  * Example 1: "4K Resolution Display" (technical spec)
  * Example 2: "Extended Battery Life" (performance benefit)
  * Example 3: "Smart Navigation System" (functionality)
  * Example 4: "Eco-Friendly Design" (sustainability)
  * ❌ AVOID: "4K Display", "4K Resolution", "High Resolution" (too similar)
`
}

function buildHeadlinePromoGuidance(discount: string | null, activePromotions: any[]): string {
  // 🔥 修复（2025-12-23）：强化价格优势量化，必须使用具体金额
  let promoGuidance = ''

  if (discount) {
    // 解析折扣信息
    const percentMatch = discount.match(/(\d+)%/)
    const amountMatch = discount.match(/[£$€]?\s*(\d+\.?\d*)/)

    promoGuidance = `- Promo (3): 🎯 **P0 CRITICAL**: MUST use QUANTIFIED savings in headlines

  * 🎯 **PRIMARY REQUIREMENT**: At least 2 headlines MUST use SPECIFIC savings amounts, NOT just percentages
  * ✅ GOOD examples:
  *   - "Save £170 Today" (specific amount)
  *   - "Only £499 - Save £170" (current price + savings)
  *   - "£170 Off This Week" (discount amount)
  *   - "Was £669, Now £499" (original + current price)
  * ❌ BAD examples:
  *   - "20% Off" (no specific amount)
  *   - "Save 20%" (no specific amount)
  *   - "Discount Applied" (vague)

  * 🎯 If discount >15% OR has specific savings amount:
  *   - "Save £170 Today" (savings amount focus)
  *   - "Reolink NVR Kit: Save £170" (brand + savings)
  *   - "8 Camera 4K System - Only £499" (product + price)

  * 🎯 If only percentage discount:
  *   - MUST calculate or estimate a specific savings amount based on typical product price range
  *   - Example: "Save 20% - £170 Off" (percentage + amount)

  * 🎯 **PRICE COMPARISON**: Use price anchoring when possible:
  *   - "Was £669, Now £499"
  *   - "Save £170 (25% Off) - Only £499"
  *   - "Best Value: £499 vs £669 elsewhere"`
  } else if (activePromotions.length > 0) {
    promoGuidance = `- Promo (3): 🎯 **P0 CRITICAL**: MUST quantify savings for promotion "${activePromotions[0].description}"
  * Example: "Save £170 with ${activePromotions[0].description || 'this offer'}" or "${activePromotions[0].description} - Save £170"
  * Must include specific savings amount when possible`
  } else {
    promoGuidance = `- Promo (3): **P1 REQUIRED**: ALL promo headlines MUST include QUANTIFIED savings
  * Use specific amounts: "Save £170", "£100 Off", "Only £499"
  * Avoid vague terms: "Discount", "Sale", "Off" alone`
  }

  promoGuidance += `
  * IMPORTANT: Each promo headline must use a DIFFERENT promotional angle
  * ✅ Different angles:
  *   - "Save £170 Today" (savings amount)
  *   - "Was £669, Now £499" (price anchoring)
  *   - "Best Price: £499 - Save £170" (value focus)
  * ❌ Too similar (avoid):
  *   - "Save £170", "Save 20%", "£170 Off" (mix percentage vs amount)
  *   - "Save £170", "Save £170 Today", "Save £170 Now" (too similar)
`

  return promoGuidance
}

function buildHeadlineCTAGuidance(primeEligible: boolean, purchaseReasons: string[]): string {
  return `- CTA (3): "Shop Now", "Get Yours Today"${primeEligible ? ', "Prime Eligible"' : ''}${purchaseReasons.length > 0 ? `. **WHY BUY**: Incorporate purchase motivations: ${purchaseReasons.slice(0, 2).join(', ')}` : ''}
  * IMPORTANT: Each CTA headline must use a DIFFERENT call-to-action verb or angle
  * Example 1: "Shop Now" (direct action)
  * Example 2: "Get Yours Today" (possession focus)
  * Example 3: "Claim Your Deal" (exclusivity focus)
  * ❌ AVOID: "Shop Now", "Shop Today", "Buy Now" (too similar)
`
}

function buildHeadlineUrgencyGuidance(availability: string | null): string {
  let urgencyText = ''
  let isCritical = false

  if (availability) {
    const stockMatch = availability.match(/(\d+)\s*left/i)
    if (stockMatch) {
      const stockLevel = parseInt(stockMatch[1])
      if (stockLevel < 10) {
        urgencyText = `🎯 **P1 CRITICAL - MUST use real STOCK data**: "${availability}" (Low stock detected: ${stockLevel} units)`
        isCritical = true
      }
    }
    if (!isCritical) {
      const lowStockKeywords = ['low stock', 'limited quantity', 'almost gone', 'running low', 'few left']
      const hasLowStockKeyword = lowStockKeywords.some(kw => availability.toLowerCase().includes(kw))
      if (hasLowStockKeyword) {
        urgencyText = `🎯 **P1 CRITICAL - MUST use URGENCY**: "${availability}" or "Limited Stock - Act Fast"`
        isCritical = true
      }
    }
  }

  // 🔥 修复（2025-12-23）：紧迫感是所有广告的必要元素，必须始终包含
  if (!urgencyText) {
    urgencyText = `**P1 CRITICAL FOR ALL ADS**: "Order Now", "Limited Time Offer", "Ends Soon", "Today's Deal", "Don't Miss Out"`
  }

  return `- Urgency (2-3): ${urgencyText}
  * 🎯 **P1 CRITICAL**: ALL ads MUST include urgency elements. At least 2-3 headlines MUST create urgency.
  * Examples of strong urgency signals:
  * - "Order Now" (immediate action)
  * - "Limited Time Offer" (time scarcity)
  * - "Only 5 Left in Stock" (scarcity - if stock data available)
  * - "Today's Deal" (daily focus)
  * - "Don't Miss Out" (FOMO)
  * - "Ends Soon" (deadline)
  * - "Act Fast" (prompt action)
  * IMPORTANT: Each urgency headline must use a DIFFERENT urgency signal
  * ❌ AVOID: "Limited Stock", "Limited Time", "Limited Offer" (too similar)
`
}

function buildDescription1Guidance(badge: string | null, salesRank: string | null): string {
  return `- **Description 1 (Value-Driven)**: Lead with the PRIMARY benefit or competitive advantage${badge ? `. MUST mention BADGE: "${badge}"` : ''}${salesRank ? `. MUST mention SALES RANK` : ''}
  * Focus: What makes this product/brand special (unique value proposition)
  * Example: "Award-Winning Tech. Rated 4.8 stars by 50K+ Happy Customers."
  * ❌ AVOID: Repeating "shop", "buy", "get" from other descriptions
`
}

function buildDescription2Guidance(primeEligible: boolean, activePromotions: any[]): string {
  return `- **Description 2 (Action-Oriented)**: Strong CTA with immediate incentive${primeEligible ? ' + Prime eligibility' : ''}${activePromotions.length > 0 ? `. 🎯 **P2 CRITICAL**: MUST mention promotion "${activePromotions[0].description}"${activePromotions[0].code ? ` with code "${activePromotions[0].code}"` : ''}. Example: "Save ${activePromotions[0].description} - Shop Now!"` : ''}
  * Focus: Urgency + convenience + trust signal (action-focused)
  * Example: "Shop Now for Fast, Free Delivery. Easy Returns Guaranteed."
  * ❌ AVOID: Using the same CTA verb as Description 1 or 3
`
}

function buildDescription3Guidance(useCases: string[], userProfiles: Array<{profile: string; indicators?: string[]}>): string {
  return `- **Description 3 (Feature-Rich)**: Specific product features or use cases${useCases.length > 0 ? `. **USE CASES**: Reference real scenarios: ${useCases.slice(0, 2).join(', ')}` : ''}${userProfiles.length > 0 ? `. **TARGET PERSONAS**: Speak to: ${userProfiles.slice(0, 2).map(p => p.profile).join(', ')}` : ''}
  * Focus: Technical specs, capabilities, or versatility (feature-focused)
  * Example: "4K Resolution. Solar Powered. Works Rain or Shine."
  * ❌ AVOID: Mentioning "award", "rated", "trusted" from other descriptions
`
}

function buildDescription4Guidance(topReviews: string[], hotInsights: any, topProducts: string[], sentimentDistribution: any, totalReviews: number, averageRating: number): string {
  return `- **Description 4 (Trust + Social Proof)**: Customer validation or support${topReviews.length > 0 ? `. 🎯 **P0 OPTIMIZATION - TOP REVIEWS**: MUST quote 1-2 real customer reviews for credibility: ${topReviews.slice(0, 2).map(r => `"${r.length > 50 ? r.substring(0, 47) + '...' : r}"`).join(' or ')}` : ''}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: Mention product variety and quality (Avg: ${hotInsights.avgRating.toFixed(1)} stars from ${hotInsights.avgReviews}+ reviews)` : ''}${sentimentDistribution && totalReviews > 0 ? `. **SOCIAL PROOF DATA**: ${sentimentDistribution.positive}% positive from ${totalReviews} reviews${averageRating ? `, ${averageRating} stars` : ''}` : ''}
  * 🎯 **P0 CRITICAL**: If TOP REVIEWS available, incorporate authentic customer quotes for credibility (keep ≤90 chars)
  * Focus: Reviews, ratings, guarantees, customer service (proof-focused)
  * Example with review: "Works perfectly!" - 5★ Review. Trusted by 10K+ Buyers.
  * Example without review: "Trusted by 100K+ Buyers. 30-Day Money-Back Promise."
  * ❌ AVOID: Repeating "fast", "free", "easy" from other descriptions
`
}

function buildReviewDataSummary(
  reviewHighlights: string[],
  commonPraises: string[],
  topPositiveKeywords: Array<{keyword: string; frequency: number}>,
  commonPainPoints: string[],
  aiReviews?: any
): string {
  const parts: string[] = []

  // 🎯 P0优化：优先使用AI增强的评论数据
  if (aiReviews) {
    if (aiReviews.rating) {
      parts.push(`AI分析评分: ${aiReviews.rating}/5.0`)
    }
    if (aiReviews.sentiment) {
      parts.push(`用户情感倾向: ${aiReviews.sentiment}`)
    }
    if (aiReviews.positives && aiReviews.positives.length > 0) {
      parts.push(`用户好评要点: ${aiReviews.positives.slice(0, 3).join(', ')}`)
    }
    if (aiReviews.concerns && aiReviews.concerns.length > 0) {
      parts.push(`用户关注点: ${aiReviews.concerns.slice(0, 2).join(', ')}`)
    }
    if (aiReviews.useCases && aiReviews.useCases.length > 0) {
      parts.push(`主要使用场景: ${aiReviews.useCases.slice(0, 2).join(', ')}`)
    }
  }

  // Fallback到原有数据（向后兼容）
  if (reviewHighlights.length > 0) parts.push(`Review insights: ${reviewHighlights.slice(0, 3).join(', ')}`)
  if (commonPraises.length > 0) parts.push(`User praises: ${commonPraises.slice(0, 2).join(', ')}`)
  if (topPositiveKeywords.length > 0) parts.push(`Positive keywords: ${topPositiveKeywords.slice(0, 3).map(k => k.keyword).join(', ')}`)
  if (commonPainPoints.length > 0) parts.push(`(Address pain points indirectly - don't highlight negatives): ${commonPainPoints.slice(0, 2).join(', ')}`)

  return parts.length > 0 ? parts.join('; ') : ''
}

function buildCalloutGuidance(salesRank: string | null, primeEligible: boolean, availability: string | null, badge: string | null, activePromotions: any[]): string {
  const parts: string[] = []

  if (salesRank) {
    const rankMatch = salesRank.match(/#(\d+,?\d*)/)
    if (rankMatch) {
      const rankNum = parseInt(rankMatch[1].replace(/,/g, ''))
      if (rankNum < 100) {
        parts.push(`- 🎯 **P0 CRITICAL - MUST include**: "Best Seller" or "#1 in Category" or "Top Rated" (salesRank ${salesRank} indicates top product)`)
      }
    }
  }

  parts.push(primeEligible ? '- **MUST include**: "Prime Free Shipping"' : '- Free Shipping')

  if (availability && !availability.toLowerCase().includes('out of stock')) {
    parts.push('- **MUST include**: "In Stock Now"')
  }

  if (badge) {
    parts.push(`- 🎯 **P3 CRITICAL - MUST include**: "${badge}"`)
  }

  if (activePromotions.length > 0) {
    parts.push(`- 🎯 **P2 CRITICAL - MUST include**: Promotion callout (e.g., "${activePromotions[0].description.substring(0, 22)}..." or "Limited Deal")`)
  }

  parts.push('- 24/7 Support, Money Back Guarantee, etc.')

  return parts.join('\n')
}

function buildCompetitiveGuidance(compAnalysis: any): string {
  let guidance = '\n**🎯 COMPETITIVE POSITIONING GUIDANCE (CRITICAL - Use competitor analysis data)**:\n'

  if (compAnalysis.pricePosition && compAnalysis.pricePosition.priceAdvantage === 'below_average') {
    guidance += `- **PRICE ADVANTAGE**: Emphasize value and affordability. Use phrases like "Best Value", "Affordable Premium", "Save vs Competitors"\n`
  }

  if (compAnalysis.uniqueSellingPoints && compAnalysis.uniqueSellingPoints.length > 0) {
    const usps = compAnalysis.uniqueSellingPoints.filter((u: any) => u.significance === 'high')
    if (usps.length > 0) {
      guidance += `- **UNIQUE ADVANTAGES**: Highlight these differentiators that competitors DON'T have:\n`
      usps.forEach((u: any) => {
        guidance += `  * "${u.usp}" - ${u.differentiator}\n`
      })
    }
  }

  if (compAnalysis.competitorAdvantages && compAnalysis.competitorAdvantages.length > 0) {
    guidance += `- **COUNTER COMPETITOR STRENGTHS**: Apply these positioning strategies:\n`
    compAnalysis.competitorAdvantages.slice(0, 2).forEach((a: any) => {
      guidance += `  * vs "${a.advantage}" → ${a.howToCounter}\n`
    })
  }

  if (compAnalysis.featureComparison) {
    const ourAdvantages = compAnalysis.featureComparison.filter((f: any) => f.weHave && f.ourAdvantage)
    if (ourAdvantages.length > 0) {
      guidance += `- **COMPETITIVE FEATURES**: Emphasize these features where we lead:\n`
      ourAdvantages.slice(0, 3).forEach((f: any) => {
        guidance += `  * ${f.feature}\n`
      })
    }
  }

  return guidance
}

/**
 * Substitute placeholders in template with actual values
 */
function substitutePlaceholders(template: string, variables: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value)
  }
  return result
}

/**
 * AI广告创意生成器原有函数继续
 * 以下是 parseAIResponse 及其他函数...
 */
async function oldBuildAdCreativePrompt_DELETED_v2_8(offer: any, theme?: string, referencePerformance?: any, excludeKeywords?: string[], extractedElements?: any): Promise<string> {
  // 这个函数已经被重构为上面的 buildAdCreativePrompt，这里保留注释说明历史版本
  // v2.0-v2.8: 硬编码在源代码中（违反架构规则）
  // v3.0: 数据库模板 + 占位符替换系统
  throw new Error('This function has been replaced by buildAdCreativePrompt v3.0')
}

// 删除旧的hardcoded prompt代码（lines 732-989）
// 以下代码已被上面的helper functions替换

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

  // 尝试提取JSON对象或数组（如果AI在JSON前后加了其他文本）
  // 支持 { ... } 和 [ ... ] 两种格式
  const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/)
  const jsonArrayMatch = jsonText.match(/\[[\s\S]*\]/)

  if (jsonObjectMatch && jsonArrayMatch) {
    // 两者都存在时，选择更长的那个
    jsonText = jsonObjectMatch[0].length > jsonArrayMatch[0].length ? jsonObjectMatch[0] : jsonArrayMatch[0]
  } else if (jsonObjectMatch) {
    jsonText = jsonObjectMatch[0]
  } else if (jsonArrayMatch) {
    jsonText = jsonArrayMatch[0]
  } else {
    console.warn('⚠️ 未能通过正则提取JSON对象或数组')
  }

  if (jsonObjectMatch || jsonArrayMatch) {
    console.log('✅ 成功提取JSON，长度:', jsonText.length)
  }

  // 清理提取后可能残留的markdown标记
  jsonText = jsonText.replace(/\n?```$/, '').trim()

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
  // 6. 移除_comment字段（AI可能添加注释但不是有效JSON）
  // Strategy: Replace _comment lines but preserve surrounding commas correctly
  // Case 1: , _comment: "...", → ,
  jsonText = jsonText.replace(/,\s*_comment\s*:\s*["'][^"']*["']\s*,/g, ',')
  // Case 2: , _comment: "..." → (remove entirely)
  jsonText = jsonText.replace(/,\s*_comment\s*:\s*["'][^"']*["']/g, '')
  // Case 3: _comment: "...", → (remove entirely - handles first property case)
  jsonText = jsonText.replace(/_comment\s*:\s*["'][^"']*["']\s*,/g, '')
  // 7. 清理可能产生的重复逗号或空对象/数组中的逗号
  jsonText = jsonText.replace(/,\s*,/g, ',')  // Double commas
  jsonText = jsonText.replace(/([{\[]),/g, '$1')  // Comma after { or [
  jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1')  // Comma before } or ]
  // 8. 修复错误的赋值运算符（:= 或 == 改为 :）
  jsonText = jsonText.replace(/:\s*=/g, ':')  // Fix := to :
  jsonText = jsonText.replace(/=\s*:/g, ':')  // Fix =: to :

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
    // 验证关键词长度 (1-10 个单词)
    // 🔧 修复(2025-12-25): 放宽到10个单词，符合Google Ads实际限制
    // Google Ads允许最多10个单词的关键词
    // ============================================================================
    let keywordsArray = Array.isArray(data.keywords) ? data.keywords : []
    const invalidKeywords = keywordsArray.filter((k: string) => {
      if (!k) return false
      const wordCount = k.trim().split(/\s+/).length
      return wordCount < 1 || wordCount > 10
    })
    if (invalidKeywords.length > 0) {
      console.warn(`警告: ${invalidKeywords.length}个keyword不符合1-10单词要求`)
      invalidKeywords.forEach((k: string) => {
        const wordCount = k.trim().split(/\s+/).length
        console.warn(`  "${k}"(${wordCount}个单词)`)
      })
      // 过滤不符合要求的关键词
      const originalCount = keywordsArray.length
      keywordsArray = keywordsArray.filter((k: string) => {
        if (!k) return false
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 10
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

    // 🆕 v4.7: 解析 Display Path (path1/path2)
    let path1: string | undefined = data.path1
    let path2: string | undefined = data.path2

    // 验证并截断 path1/path2 (最多15字符)
    if (path1 && path1.length > 15) {
      console.warn(`⚠️ path1 超过15字符限制: "${path1}" (${path1.length}字符)`)
      path1 = path1.substring(0, 15)
      console.log(`  截断为: "${path1}"`)
    }
    if (path2 && path2.length > 15) {
      console.warn(`⚠️ path2 超过15字符限制: "${path2}" (${path2.length}字符)`)
      path2 = path2.substring(0, 15)
      console.log(`  截断为: "${path2}"`)
    }

    // 移除path中的空格（Google Ads Display Path不允许空格）
    if (path1) {
      path1 = path1.replace(/\s+/g, '-')
    }
    if (path2) {
      path2 = path2.replace(/\s+/g, '-')
    }

    if (path1 || path2) {
      console.log(`📍 Display Path: ${path1 || '(无)'}/${path2 || '(无)'}`)
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

      // 🆕 v4.7: RSA Display Path
      path1,
      path2,

      // 新增字段（可选）
      headlinesWithMetadata,
      descriptionsWithMetadata,
      qualityMetrics
    }
  } catch (error) {
    console.error('解析AI响应失败:', error)
    console.error('原始响应前500字符:', text.substring(0, 500))
    throw new Error(`AI响应解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
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
      maxOutputTokens: 16384,  // 🔧 修复：Gemini 2.5 Pro思考过程消耗~6K tokens，需要16384确保输出完整
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
      maxOutputTokens: 16384,  // 🔧 修复：Gemini 2.5 Pro思考过程消耗~6K tokens，需要16384确保输出完整
    },
  })

  const response = result.response
  const text = response.text()

  return parseAIResponse(text)
}


/**
 * 主函数：生成广告创意（带缓存）
 *
 * ✅ 安全修复：userId改为必需参数，确保用户只能访问自己的Offer
 */
export async function generateAdCreative(
  offerId: number,
  userId: number,  // ✅ 修复：改为必需参数
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
    excludeKeywords?: string[] // 需要排除的关键词（用于多次生成时避免重复）
    // 🆕 v4.10: 关键词池参数
    keywordPool?: any  // OfferKeywordPool
    bucket?: 'A' | 'B' | 'C' | 'S' | 'D'  // 🔥 2025-12-22: 添加D（高购买意图）桶支持
    bucketKeywords?: string[]
    bucketIntent?: string
    bucketIntentEn?: string
    // 🆕 2025-12-16: 综合创意专用参数
    isSyntheticCreative?: boolean  // 是否为综合创意
    syntheticKeywordsWithVolume?: Array<{ keyword: string; searchVolume: number; isBrand: boolean }>  // 带搜索量的综合关键词
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

  const db = await getDatabase()

  // ✅ 安全修复：获取Offer数据时验证user_id，防止跨用户访问
  const offer = await db.queryOne(`
    SELECT * FROM offers WHERE id = ? AND user_id = ?
  `, [offerId, userId])

  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  // 🎯 需求34: 读取已提取的广告元素（从爬虫阶段保存的数据）
  let extractedElements: {
    keywords?: Array<{ keyword: string; searchVolume: number; source: string; priority: string }>
    headlines?: string[]
    descriptions?: string[]
  } = {}

  // 🎯 P0/P1/P2/P3优化: 读取AI增强的提取数据
  let enhancedData: {
    keywords?: Array<{ keyword: string; volume: number; competition: string; score: number }>
    productInfo?: { features?: string[]; benefits?: string[]; useCases?: string[] }
    reviewAnalysis?: { sentiment?: string; themes?: string[]; insights?: string[] }
    qualityScore?: number
    headlines?: string[]
    descriptions?: string[]
    localization?: { currency?: string; culturalNotes?: string[]; localKeywords?: string[] }
    brandAnalysis?: {
      positioning?: string
      voice?: string
      competitors?: string[]
      // 🔥 修复（2025-12-11）：添加店铺分析新字段
      hotProducts?: Array<{
        name: string
        productHighlights?: string[]
        successFactors?: string[]
      }>
      reviewAnalysis?: {
        overallSentiment?: string
        positives?: string[]
        concerns?: string[]
        customerUseCases?: string[]
        trustIndicators?: string[]
      }
      sellingPoints?: string[]
    }
  } = {}

  try {
    // 🔥 修复(2025-12-26): 优先从关键词池获取关键词，而非使用旧的extracted_keywords
    // 关键词池已经过Keyword Planner扩展验证，包含高质量关键词
    const { getKeywordPoolByOfferId } = await import('./offer-keyword-pool')
    const keywordPool = await getKeywordPoolByOfferId(offer.id)

    if (keywordPool && keywordPool.totalKeywords > 0) {
      // 根据bucket类型选择关键词
      const bucket = options?.bucket || 'A'
      let poolKeywords: any[] = []

      switch (bucket) {
        case 'A':
          poolKeywords = [...keywordPool.brandKeywords, ...keywordPool.bucketAKeywords]
          break
        case 'B':
          poolKeywords = [...keywordPool.brandKeywords, ...keywordPool.bucketBKeywords]
          break
        case 'C':
          poolKeywords = [...keywordPool.brandKeywords, ...keywordPool.bucketCKeywords]
          break
        case 'S':
        default:
          // 综合桶：包含所有桶的关键词
          poolKeywords = [
            ...keywordPool.brandKeywords,
            ...keywordPool.bucketAKeywords,
            ...keywordPool.bucketBKeywords,
            ...keywordPool.bucketCKeywords
          ]
      }

      // 转换为extractedElements格式
      extractedElements.keywords = poolKeywords.map(kw => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: 'KEYWORD_POOL',
        priority: kw.priority || 'HIGH'
      }))

      console.log(`🎯 从关键词池#${keywordPool.id} 获取 ${poolKeywords.length} 个关键词 (bucket ${bucket})`)
    } else if ((offer as any).extracted_keywords) {
      // Fallback: 关键词池不存在时，使用旧的extracted_keywords
      const rawKeywords = JSON.parse((offer as any).extracted_keywords)

      // 🔧 修复(2025-12-17): 兼容两种数据格式
      // 格式1: 字符串数组 ["Reolink", "reolink camera", ...]
      // 格式2: 对象数组 [{keyword: "Reolink", searchVolume: 90500}, ...]
      if (Array.isArray(rawKeywords) && rawKeywords.length > 0) {
        if (typeof rawKeywords[0] === 'string') {
          // 字符串数组 → 转换为对象数组（searchVolume设为0，后续会查询真实数据）
          extractedElements.keywords = rawKeywords.map(kw => ({
            keyword: kw,
            searchVolume: 0,
            source: 'EXTRACTED',
            priority: 'MEDIUM'
          }))
          console.log(`📦 读取到 ${extractedElements.keywords?.length || 0} 个提取的关键词（字符串格式，待查询搜索量）`)
        } else if (rawKeywords[0]?.keyword !== undefined) {
          // 对象数组 → 直接使用
          extractedElements.keywords = rawKeywords
          console.log(`📦 读取到 ${extractedElements.keywords.length} 个提取的关键词（对象格式）`)
        } else {
          console.warn(`⚠️ extracted_keywords格式未知，跳过`)
        }
      }
    }
    if ((offer as any).extracted_headlines) {
      extractedElements.headlines = JSON.parse((offer as any).extracted_headlines)
      console.log(`📦 读取到 ${extractedElements.headlines?.length || 0} 个提取的标题`)
    }
    if ((offer as any).extracted_descriptions) {
      extractedElements.descriptions = JSON.parse((offer as any).extracted_descriptions)
      console.log(`📦 读取到 ${extractedElements.descriptions?.length || 0} 个提取的描述`)
    }

    // 🎯 读取增强数据（优先使用，因为质量更高）
    if ((offer as any).enhanced_keywords) {
      enhancedData.keywords = JSON.parse((offer as any).enhanced_keywords)
      console.log(`✨ 读取到 ${enhancedData.keywords?.length || 0} 个增强关键词`)
    }
    if ((offer as any).enhanced_product_info) {
      enhancedData.productInfo = JSON.parse((offer as any).enhanced_product_info)
      console.log(`✨ 读取到增强产品信息`)
    }
    if ((offer as any).enhanced_review_analysis) {
      enhancedData.reviewAnalysis = JSON.parse((offer as any).enhanced_review_analysis)
      console.log(`✨ 读取到增强评论分析`)
    }
    if ((offer as any).extraction_quality_score) {
      enhancedData.qualityScore = (offer as any).extraction_quality_score
      console.log(`✨ 提取质量评分: ${enhancedData.qualityScore}/100`)
    }
    if ((offer as any).enhanced_headlines) {
      enhancedData.headlines = JSON.parse((offer as any).enhanced_headlines)
      console.log(`✨ 读取到 ${enhancedData.headlines?.length || 0} 个增强标题`)
    }
    if ((offer as any).enhanced_descriptions) {
      enhancedData.descriptions = JSON.parse((offer as any).enhanced_descriptions)
      console.log(`✨ 读取到 ${enhancedData.descriptions?.length || 0} 个增强描述`)
    }
    if ((offer as any).localization_adapt) {
      enhancedData.localization = JSON.parse((offer as any).localization_adapt)
      console.log(`✨ 读取到本地化适配数据`)
    }
    if ((offer as any).brand_analysis) {
      enhancedData.brandAnalysis = JSON.parse((offer as any).brand_analysis)
      console.log(`✨ 读取到品牌分析数据`)
    }
  } catch (parseError: any) {
    console.warn('⚠️ 解析提取的广告元素失败，将使用AI全新生成:', parseError.message)
  }

  // 🎯 合并数据：将enhanced和extracted数据合并（去重）
  // 统一关键词格式为extracted格式（因为buildAdCreativePrompt期望这个格式）
  const normalizedEnhancedKeywords = (enhancedData.keywords || []).map(kw => ({
    keyword: kw.keyword,
    searchVolume: kw.volume || 0,
    source: 'AI_ENHANCED',
    priority: kw.score > 80 ? 'HIGH' : kw.score > 60 ? 'MEDIUM' : 'LOW'
  }))

  // 🆕 v4.10: 如果传入了桶关键词，将其作为最高优先级关键词
  let bucketKeywordsNormalized: Array<{ keyword: string; searchVolume: number; source: string; priority: string }> = []

  // 🆕 v4.16: 如果没有传入桶关键词，根据链接类型和bucket自动获取
  if (options?.bucketKeywords && options.bucketKeywords.length > 0) {
    bucketKeywordsNormalized = options.bucketKeywords.map(kw => ({
      keyword: kw,
      searchVolume: 0, // 搜索量会在后续步骤中填充
      source: 'KEYWORD_POOL',
      priority: 'HIGH' // 桶关键词优先级最高
    }))
    console.log(`📦 v4.10 关键词池: 使用桶 ${options.bucket} (${options.bucketIntent}) 的 ${bucketKeywordsNormalized.length} 个关键词`)
  } else if (options?.bucket && offer.page_type) {
    // 🆕 v4.16: 自动根据链接类型和bucket获取关键词
    const { getKeywordsByLinkTypeAndBucket } = await import('./offer-keyword-pool')

    const linkType = offer.page_type as 'product' | 'store'
    const bucketType = options.bucket as 'A' | 'B' | 'C' | 'D' | 'S'

    const keywordResult = await getKeywordsByLinkTypeAndBucket(offerId, linkType, bucketType)

    if (keywordResult.keywords.length > 0) {
      bucketKeywordsNormalized = keywordResult.keywords.map(kw => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: 'KEYWORD_POOL',
        priority: 'HIGH'
      }))
      console.log(`📦 v4.16 关键词池: ${linkType}链接 - 桶 ${bucketType} (${keywordResult.intent}) 的 ${bucketKeywordsNormalized.length} 个关键词`)
    } else {
      console.log(`📦 v4.16 关键词池: ${linkType}链接 - 桶 ${bucketType} 暂无关键词，将使用默认关键词`)
    }
  }

  // 🔥 2025-12-16修复：统一extracted关键词格式（可能是字符串数组或对象数组）
  const normalizedExtractedKeywords = (extractedElements.keywords || []).map((kw: any) => {
    // 如果是字符串，转换为对象格式
    if (typeof kw === 'string') {
      return {
        keyword: kw,
        searchVolume: 0,
        source: 'EXTRACTED',
        priority: 'MEDIUM'
      }
    }
    // 已经是对象格式
    return {
      keyword: String(kw.keyword || ''),
      searchVolume: kw.searchVolume || kw.volume || 0,
      source: kw.source || 'EXTRACTED',
      priority: kw.priority || 'MEDIUM'
    }
  }).filter((kw: { keyword: string }) => kw.keyword.length > 0)

  // 🆕 v4.10: 桶关键词优先，然后是增强关键词，最后是基础关键词
  // 🔥 优化(2025-12-22): 使用Google Ads标准化规则去重
  const mergedKeywords = [...bucketKeywordsNormalized, ...normalizedEnhancedKeywords, ...normalizedExtractedKeywords]

  // 🔥 优化：使用Google Ads标准化进行去重，保留最高优先级的关键词
  const uniqueKeywords = deduplicateKeywordsWithPriority(
    mergedKeywords,
    kw => kw.keyword,
    kw => {
      // 优先级：桶关键词 > 增强关键词 > 基础关键词
      if (kw.source === 'KEYWORD_POOL') return 100
      if (kw.source === 'AI_ENHANCED') return 50
      return 10 // 'EXTRACTED' 或其他
    }
  )

  // 🔥 调试：打印去重信息
  logDuplicateKeywords(mergedKeywords.map(kw => kw.keyword), '合并前关键词')

  // 标题和描述合并
  const mergedHeadlines = [...(enhancedData.headlines || []), ...(extractedElements.headlines || [])]
  const mergedDescriptions = [...(enhancedData.descriptions || []), ...(extractedElements.descriptions || [])]

  // 标题和描述去重
  const uniqueHeadlines = [...new Set(mergedHeadlines)]
  const uniqueDescriptions = [...new Set(mergedDescriptions)]

  const mergedData = {
    keywords: uniqueKeywords,
    headlines: uniqueHeadlines,
    descriptions: uniqueDescriptions,
    productInfo: enhancedData.productInfo,
    reviewAnalysis: enhancedData.reviewAnalysis,
    localization: enhancedData.localization,
    brandAnalysis: enhancedData.brandAnalysis,
    qualityScore: enhancedData.qualityScore,
    // 🆕 v4.10: 添加桶信息到合并数据中
    bucketInfo: options?.bucket ? {
      bucket: options.bucket,
      intent: options.bucketIntent,
      intentEn: options.bucketIntentEn,
      keywordCount: bucketKeywordsNormalized.length
    } : undefined
  }

  console.log('📊 合并后的数据:')
  if (options?.bucket) {
    console.log(`   - 🆕 关键词池桶: ${options.bucket} (${options.bucketIntent})`)
    console.log(`   - 关键词: ${mergedData.keywords?.length || 0}个 (桶${bucketKeywordsNormalized.length} + 增强${enhancedData.keywords?.length || 0} + 基础${extractedElements.keywords?.length || 0})`)
  } else {
    console.log(`   - 关键词: ${mergedData.keywords?.length || 0}个 (基础${extractedElements.keywords?.length || 0} + 增强${enhancedData.keywords?.length || 0})`)
  }
  console.log(`   - 标题: ${mergedData.headlines?.length || 0}个 (基础${extractedElements.headlines?.length || 0} + 增强${enhancedData.headlines?.length || 0})`)
  console.log(`   - 描述: ${mergedData.descriptions?.length || 0}个 (基础${extractedElements.descriptions?.length || 0} + 增强${enhancedData.descriptions?.length || 0})`)
  console.log(`   - 产品信息: ${mergedData.productInfo ? '有✨' : '无'}`)
  console.log(`   - 本地化: ${mergedData.localization ? '有✨' : '无'}`)
  console.log(`   - 品牌分析: ${mergedData.brandAnalysis ? '有✨' : '无'}`)

  // 构建Prompt（传入合并后的数据）
  const prompt = await buildAdCreativePrompt(
    offer,
    options?.theme,
    options?.referencePerformance,
    options?.excludeKeywords,
    mergedData  // 🎯 传入合并后的增强数据
  )

  // 使用统一AI入口（优先Vertex AI，自动降级到Gemini API）
  if (!userId) {
    throw new Error('生成广告创意需要用户ID，请确保已登录')
  }
  const aiMode = await getGeminiMode(userId)
  console.log(`🤖 使用统一AI入口生成广告创意 (${aiMode})...`)

  console.time('⏱️ AI生成创意')
  // 智能模型选择：广告创意生成使用Pro模型（核心创意任务）
  const aiResponse = await generateContent({
    operationType: 'ad_creative_generation_main',
    prompt,
    temperature: 0.9,
    maxOutputTokens: 16384,  // 🔧 修复：Gemini 2.5 Pro思考过程消耗~6K tokens，需要16384确保输出完整
  }, userId)
  console.timeEnd('⏱️ AI生成创意')

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
      operationType: 'ad_creative_generation_main',
      inputTokens: aiResponse.usage.inputTokens,
      outputTokens: aiResponse.usage.outputTokens,
      totalTokens: aiResponse.usage.totalTokens,
      cost,
      apiType: aiResponse.apiType
    })
  }

  // 解析AI响应
  console.time('⏱️ 解析AI响应')
  const result: GeneratedAdCreativeData = parseAIResponse(aiResponse.text)
  const aiModel = `${aiMode}:${aiResponse.model}`
  console.timeEnd('⏱️ 解析AI响应')

  // 🔥 强制第一个headline为DKI品牌格式（自动处理30字符限制）
  const brandName = (offer as { brand?: string }).brand || 'Brand'
  const HEADLINE_MAX_LENGTH = 30

  // 优先使用完整格式 "{KeyWord:Brand} Official"，超过30字符则去除 "Official"
  const fullDKIHeadline = `{KeyWord:${brandName}} Official`
  const shortDKIHeadline = `{KeyWord:${brandName}}`

  const requiredFirstHeadline = fullDKIHeadline.length <= HEADLINE_MAX_LENGTH
    ? fullDKIHeadline
    : shortDKIHeadline

  // 如果短格式仍超过限制，截断品牌名
  let finalFirstHeadline = requiredFirstHeadline
  if (finalFirstHeadline.length > HEADLINE_MAX_LENGTH) {
    // 计算可用的品牌名长度: 30 - "{KeyWord:}".length = 30 - 10 = 20
    const maxBrandLength = HEADLINE_MAX_LENGTH - 10
    const truncatedBrand = brandName.substring(0, maxBrandLength)
    finalFirstHeadline = `{KeyWord:${truncatedBrand}}`
    console.log(`⚠️ DKI标题品牌名过长，截断: "${brandName}" → "${truncatedBrand}"`)
  }

  if (result.headlines.length > 0) {
    // 检查第一个headline是否符合要求
    if (result.headlines[0] !== finalFirstHeadline) {
      console.log(`🔧 强制第一个headline: "${result.headlines[0]}" → "${finalFirstHeadline}" (${finalFirstHeadline.length}字符)`)
      result.headlines[0] = finalFirstHeadline
    } else {
      console.log(`✅ 第一个headline已符合要求: "${finalFirstHeadline}" (${finalFirstHeadline.length}字符)`)
    }
  }

  console.log('✅ 广告创意生成成功')
  console.log(`   - Headlines: ${result.headlines.length}个`)
  console.log(`   - Descriptions: ${result.descriptions.length}个`)
  console.log(`   - Keywords: ${result.keywords.length}个`)

  // 🔄 使用统一关键词服务获取精确搜索量
  console.time('⏱️ 获取关键词搜索量')
  let keywordsWithVolume: KeywordWithVolume[] = []

  // 🔧 修复(2025-12-24): 提取到外层作用域，供后续clusterKeywordsByIntent使用
  const targetCountry = (offer as { target_country?: string }).target_country || 'US'
  const targetLanguage = (offer as { target_language?: string }).target_language || 'English'
  const lang = targetLanguage.toLowerCase().substring(0, 2)
  const language = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : lang === 'es' ? 'es' : lang === 'it' ? 'it' : lang === 'fr' ? 'fr' : lang === 'de' ? 'de' : lang === 'pt' ? 'pt' : lang === 'ja' ? 'ja' : lang === 'ko' ? 'ko' : lang === 'ru' ? 'ru' : lang === 'ar' ? 'ar' : 'en'

  try {
    console.log(`🔍 获取关键词精确搜索量: ${result.keywords.length}个关键词, 国家=${targetCountry}, 语言=${language} (${targetLanguage})`)

    // 🎯 使用统一服务：确保所有搜索量来自Historical Metrics API（精确匹配）
    const { getKeywordVolumesForExisting } = await import('@/lib/unified-keyword-service')
    const unifiedData = await getKeywordVolumesForExisting({
      baseKeywords: result.keywords,
      country: targetCountry,
      language,
      userId,
      brandName
    })

    // 🎯 修复：添加matchType字段（智能分配）+ lowTopPageBid/highTopPageBid竞价数据
    // 注意：这里仅做初始化，会在v4.16优化逻辑（行~2730）中根据品牌/非品牌/品牌相关分类重新分配
    const brandNameLower = brandName?.toLowerCase() || ''
    keywordsWithVolume = unifiedData.map(v => {
      const keywordLower = v.keyword.toLowerCase()
      // 🔥 修复(2025-12-18): 不在初始阶段做复杂的品牌分类，改为统一使用PHRASE
      // 这样可以在v4.16优化阶段（行2708-2758）准确地重新分配matchType
      // 纯品牌词 → EXACT
      // 品牌相关词 → PHRASE
      // 非品牌词 → PHRASE
      let matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'PHRASE' // 默认PHRASE，后续会根据品牌分类重新分配

      return {
        keyword: v.keyword,
        searchVolume: v.searchVolume,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowTopPageBid: v.lowTopPageBid || 0,  // 🆕 添加页首最低出价
        highTopPageBid: v.highTopPageBid || 0, // 🆕 添加页首最高出价
        matchType
      }
    })
    console.log(`✅ 关键词精确搜索量获取完成（来源: Historical Metrics API）`)
  } catch (error) {
    console.warn('⚠️ 获取关键词搜索量失败，使用默认值:', error)
    // 🎯 修复：即使失败也要添加matchType和竞价数据
    const brandNameLower = brandName?.toLowerCase() || ''
    keywordsWithVolume = result.keywords.map(kw => {
      const keywordLower = kw.toLowerCase()
      // 🔥 修复(2025-12-18): 同上，初始化时统一使用PHRASE，让v4.16优化逻辑处理分类
      let matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'PHRASE'

      return {
        keyword: kw,
        searchVolume: 0,
        lowTopPageBid: 0,  // 🆕 默认为0
        highTopPageBid: 0, // 🆕 默认为0
        matchType
      }
    })
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
      const { getDatabase } = await import('@/lib/db')
      const db = await getDatabase()

      // 🔧 PostgreSQL兼容性修复: is_active/is_manager_account在PostgreSQL中是BOOLEAN类型
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
      const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

      // 查询用户的Google Ads账号
      // 🔧 修复(2025-12-12): Keyword Planner API 必须使用客户账号，不能使用 MCC 账号
      const adsAccount = await db.queryOne(`
        SELECT id, customer_id FROM google_ads_accounts
        WHERE user_id = ?
          AND ${isActiveCondition}
          AND status = 'ENABLED'
          AND ${isManagerCondition}
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId]) as { id: number; customer_id: string } | undefined

      if (adsAccount) {
        // 🔧 修复(2025-12-25): 支持服务账号和OAuth两种认证方式
        const { getGoogleAdsConfig } = await import('@/lib/keyword-planner')
        const config = await getGoogleAdsConfig(userId)

        if (config) {
          const country = (offer as { target_country?: string }).target_country || 'US'
          const targetLanguage = (offer as { target_language?: string }).target_language || 'English'
          const lang = targetLanguage.toLowerCase().substring(0, 2)
          const language = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : lang === 'es' ? 'es' : lang === 'it' ? 'it' : lang === 'fr' ? 'fr' : lang === 'de' ? 'de' : lang === 'pt' ? 'pt' : lang === 'ja' ? 'ja' : lang === 'ko' ? 'ko' : lang === 'ru' ? 'ru' : lang === 'ar' ? 'ar' : 'en'

          console.log(`🌍 Keyword Planner 查询语言: ${language} (${targetLanguage})`)

          // 🔧 2025-12-17: 如果已传入特定桶的关键词，跳过从关键词池获取所有关键词
          // 这确保差异化创意只使用对应桶的关键词，而不是所有桶的关键词混合
          if (options?.bucketKeywords && options.bucketKeywords.length > 0) {
            console.log(`📦 已有桶 ${options.bucket} (${options.bucketIntent}) 的 ${options.bucketKeywords.length} 个关键词，跳过关键词池合并`)
          } else {
            // 🔥 统一架构(2025-12-16): 使用关键词池替代3轮Keyword Planner扩展
            console.log(`\n🔍 从关键词池获取关键词...`)
            const { getOrCreateKeywordPool } = await import('@/lib/offer-keyword-pool')

            const keywordPool = await getOrCreateKeywordPool(
              offer.id,
              userId
            )

            if (keywordPool) {
              const poolKeywords = [
                ...keywordPool.bucketAKeywords,
                ...keywordPool.bucketBKeywords,
                ...keywordPool.bucketCKeywords
              ]

              // 🔥 优化(2025-12-22): 使用Google Ads标准化去重
              const existingKeywordsSet = new Set(result.keywords.map(kw => normalizeGoogleAdsKeyword(kw)))
              const newKeywords = poolKeywords.filter(kw => !existingKeywordsSet.has(normalizeGoogleAdsKeyword(kw.keyword)))

              console.log(`📊 关键词池去重: ${poolKeywords.length} → ${newKeywords.length} (过滤掉 ${poolKeywords.length - newKeywords.length} 个重复)`)

            keywordsWithVolume = [
              ...keywordsWithVolume,
              ...newKeywords.map(kw => ({
                keyword: kw.keyword,
                searchVolume: kw.searchVolume,
                competition: kw.competition,
                competitionIndex: kw.competitionIndex,
                source: (kw.source === 'AI_GENERATED' || kw.source === 'KEYWORD_EXPANSION' || kw.source === 'MERGED') ? kw.source as 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED' : undefined,
                matchType: kw.matchType
              }))
            ]

            result.keywords = [...result.keywords, ...newKeywords.map(kw => kw.keyword)]
            console.log(`   ✅ 从关键词池获取 ${newKeywords.length} 个新关键词`)
            console.log(`   📊 当前关键词总数: ${keywordsWithVolume.length} 个`)
          } else {
            console.warn('   ⚠️ 关键词池不存在，跳过关键词扩展')
          }
          } // 闭合 bucketKeywords 条件检查的 else 块
        } else {
          console.warn('⚠️ 未找到Google Ads凭证（OAuth或服务账号），跳过Keyword Planner扩展')
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

  // 🔥 方案A优化(2025-12-16): 合并extracted_keywords到最终关键词列表
  // 原问题：31个高质量Google下拉词仅作为prompt参考，未直接使用
  // 解决方案：将已验证搜索量的extracted_keywords直接合并，确保100%利用
  // 🔥 优化(2025-12-16): 使用AI语义分类（keyword_intent_clustering prompt）
  if (extractedElements.keywords && extractedElements.keywords.length > 0) {
    console.log(`\n🔗 合并extracted_keywords到关键词列表...`)
    // 🔧 修复(2025-12-16): 过滤掉undefined/null的keyword，避免toLowerCase()报错
    const existingKeywordsLower = new Set(
      keywordsWithVolume
        .filter(k => k.keyword)
        .map(k => k.keyword.toLowerCase())
    )
    const brandNameLowerForMerge = brandName?.toLowerCase() || ''

    // 🔧 修复(2025-12-17): 为searchVolume=0的关键词查询真实搜索量
    const keywordsNeedVolume = (extractedElements.keywords || []).filter(kw =>
      kw.keyword && kw.searchVolume === 0 && !existingKeywordsLower.has(kw.keyword.toLowerCase())
    )

    if (keywordsNeedVolume.length > 0) {
      console.log(`   📊 查询 ${keywordsNeedVolume.length} 个关键词的搜索量...`)
      try {
        const volumes = await getKeywordSearchVolumes(
          keywordsNeedVolume.map(k => k.keyword),
          targetCountry,
          language,
          userId
        )
        // 更新searchVolume
        keywordsNeedVolume.forEach(kw => {
          const volumeData = volumes.find((v: any) => v.keyword.toLowerCase() === kw.keyword.toLowerCase())
          if (volumeData) {
            kw.searchVolume = volumeData.avgMonthlySearches
          }
        })
        console.log(`   ✅ 搜索量查询完成`)
      } catch (volumeError) {
        console.warn(`   ⚠️ 搜索量查询失败，使用默认值0:`, volumeError)
      }
    }

    // 1. 筛选需要合并的关键词（去重 + 搜索量过滤）
    const keywordsToMerge = extractedElements.keywords.filter(kw => {
      if (!kw.keyword) return false  // 🔧 过滤undefined/null
      const kwLower = kw.keyword.toLowerCase()
      if (existingKeywordsLower.has(kwLower)) return false  // 去重
      if (kw.searchVolume < 500) return false  // 质量过滤
      return true
    })

    if (keywordsToMerge.length === 0) {
      console.log(`   ℹ️ 无新关键词需要合并（全部重复或搜索量不足）`)
    } else {
      // 2. 调用AI语义分类
      let intentMap = new Map<string, IntentCategory>()
      const productCategory = (offer as { category?: string }).category || '未分类'

      try {
        console.log(`   🤖 调用AI语义分类: ${keywordsToMerge.length} 个关键词`)
        const buckets = await clusterKeywordsByIntent(
          keywordsToMerge.map(k => k.keyword).filter(Boolean),  // 🔧 过滤undefined
          brandName || '',
          productCategory,
          userId!,
          targetCountry,  // 🔧 修复(2025-12-24): 传递目标国家
          language,  // 🔧 修复(2025-12-24): 传递目标语言
          'product'  // 🔧 修复(2025-12-24): 传递页面类型
        )

        // 3. 构建反向映射: keyword → intentCategory
        // 🔧 修复(2025-12-16): 添加空值检查
        buckets.bucketA.keywords.filter(Boolean).forEach(k => intentMap.set(k.toLowerCase(), 'brand'))
        buckets.bucketB.keywords.filter(Boolean).forEach(k => intentMap.set(k.toLowerCase(), 'scenario'))
        buckets.bucketC.keywords.filter(Boolean).forEach(k => intentMap.set(k.toLowerCase(), 'function'))

        console.log(`   ✅ AI分类完成:`)
        console.log(`      品牌导向: ${buckets.bucketA.keywords.length} 个`)
        console.log(`      场景导向: ${buckets.bucketB.keywords.length} 个`)
        console.log(`      功能导向: ${buckets.bucketC.keywords.length} 个`)
      } catch (clusterError: any) {
        // 🔥 统一架构(2025-12-16): AI分类失败时使用默认分类
        console.warn(`   ⚠️ AI语义分类失败，使用默认分类: ${clusterError.message}`)
        // 默认将所有关键词标记为function类型
        keywordsToMerge.forEach(kw => {
          if (kw.keyword) intentMap.set(kw.keyword.toLowerCase(), 'function')
        })
      }

      // 4. 添加关键词到列表（带intentCategory）
      let mergedCount = 0
      keywordsToMerge.forEach(kw => {
        const kwLower = kw.keyword.toLowerCase()

        // matchType逻辑保持不变
        const isBrandKeyword = kwLower === brandNameLowerForMerge || kwLower.startsWith(brandNameLowerForMerge + ' ')
        const wordCount = kw.keyword.split(' ').length
        let matchType: 'BROAD' | 'PHRASE' | 'EXACT'

        if (isBrandKeyword) {
          matchType = 'EXACT'
        } else if (wordCount >= 3) {
          matchType = 'PHRASE'
        } else {
          matchType = 'BROAD'
        }

        // 添加到关键词列表（含intentCategory）
        keywordsWithVolume.push({
          keyword: kw.keyword,
          searchVolume: kw.searchVolume,
          // 🔥 修复(2025-12-18): 为合并的关键词提供默认竞争度，避免competitionLevel = UNKNOWN
          competition: (kw as any).competition || 'MEDIUM', // 使用原始数据中的competition，或默认为MEDIUM
          competitionIndex: (kw as any).competitionIndex || 0.5,  // 默认竞争度指数为0.5（中等）
          lowTopPageBid: 0,
          highTopPageBid: 0,
          matchType,
          intentCategory: intentMap.get(kwLower) || 'function',
          source: 'MERGED'
        })
        existingKeywordsLower.add(kwLower)
        mergedCount++
      })

      const skippedCount = extractedElements.keywords.length - keywordsToMerge.length
      console.log(`   ✅ 合并完成: 新增 ${mergedCount} 个关键词 (跳过 ${skippedCount} 个重复/低质量)`)
      console.log(`   📊 当前关键词总数: ${keywordsWithVolume.length} 个`)

      // 按意图分类统计
      const brandCount = keywordsToMerge.filter(k => intentMap.get(k.keyword.toLowerCase()) === 'brand').length
      const scenarioCount = keywordsToMerge.filter(k => intentMap.get(k.keyword.toLowerCase()) === 'scenario').length
      const functionCount = keywordsToMerge.filter(k => intentMap.get(k.keyword.toLowerCase()) === 'function').length
      console.log(`   📊 意图分类: 品牌=${brandCount}, 场景=${scenarioCount}, 功能=${functionCount}`)
    }
  }

  // 🎯 最终关键词过滤：强制约束
  console.log('\n🔍 执行最终关键词过滤 (强制约束)...')
  const beforeFilterCount = keywordsWithVolume.length
  const offerBrand = (offer as { brand?: string }).brand || 'Unknown'
  // targetCountry 已在外层作用域定义 (line 2767)
  const brandKeywordLower = offerBrand.toLowerCase()

  // 第1步：分离品牌词、品牌相关词和非品牌词
  // 🔧 修复(2025-12-16): 品牌相关词（包含品牌名）也应该被保留，不受搜索量过滤
  // - 纯品牌词：关键词 === 品牌名（精确匹配）
  // - 品牌相关词：关键词包含品牌名（如 "Waterdrop filter"）
  // - 非品牌词：不包含品牌名的关键词
  const pureBrandKeywords: typeof keywordsWithVolume = []      // 精确匹配品牌名
  const brandRelatedKeywords: typeof keywordsWithVolume = []   // 包含品牌名
  const nonBrandKeywords: typeof keywordsWithVolume = []       // 不含品牌名

  keywordsWithVolume.forEach(kw => {
    const kwLower = kw.keyword.toLowerCase()
    const isPureBrand = kwLower === brandKeywordLower
    const isBrandRelated = !isPureBrand && kwLower.includes(brandKeywordLower)

    if (isPureBrand) {
      pureBrandKeywords.push(kw)
    } else if (isBrandRelated) {
      brandRelatedKeywords.push(kw)
    } else {
      nonBrandKeywords.push(kw)
    }
  })

  console.log(`   📊 关键词分类结果:`)
  console.log(`      🏷️ 纯品牌词: ${pureBrandKeywords.length} 个`)
  console.log(`      🔗 品牌相关词: ${brandRelatedKeywords.length} 个`)
  console.log(`      📝 非品牌词: ${nonBrandKeywords.length} 个`)

  // 合并品牌词（纯品牌 + 品牌相关）供后续使用
  const brandKeywords: typeof keywordsWithVolume = [...pureBrandKeywords, ...brandRelatedKeywords]

  // 🔥 新增(2025-12-18): 自动分配matchType（品牌词策略）
  console.log(`\n📌 自动分配matchType（品牌词策略）`)

  // Step 1: 纯品牌词 → EXACT
  pureBrandKeywords.forEach(kw => {
    kw.matchType = 'EXACT'
  })
  console.log(`   ✅ 纯品牌词(${pureBrandKeywords.length}个) → EXACT 精准匹配`)

  // Step 2: 品牌相关词 → PHRASE
  brandRelatedKeywords.forEach(kw => {
    kw.matchType = 'PHRASE'
  })
  console.log(`   ✅ 品牌相关词(${brandRelatedKeywords.length}个) → PHRASE 词组匹配`)

  // Step 3: 非品牌词 → 根据搜索量和竞争度动态决定
  // 当前阶段：统一使用PHRASE（后续Phase 2可基于数据优化为BROAD）
  nonBrandKeywords.forEach(kw => {
    // 暂时统一使用PHRASE，不使用BROAD（需要账户成熟后再考虑）
    kw.matchType = 'PHRASE'

    // 未来优化：可以根据搜索量和竞争度动态决定
    // if (kw.searchVolume < 1000 && (kw.competitionIndex || 0) < 0.5) {
    //   kw.matchType = 'BROAD'  // 低量低竞争 → 探索型广泛匹配
    // } else {
    //   kw.matchType = 'PHRASE'  // 默认词组匹配
    // }
  })
  console.log(`   ✅ 非品牌词(${nonBrandKeywords.length}个) → PHRASE 词组匹配（暂不使用BROAD）`)

  // 🆕 第2步：提取高价值通用词（搜索量 > 10000）
  console.log(`\n📌 高价值通用词提取`)
  const { extractGenericHighValueKeywords } = await import('@/lib/unified-keyword-service')

  // 识别竞品品牌（从全白名单过滤结果中提取）
  const competitorBrands: string[] = []
  try {
    // 尝试从之前的白名单过滤结果中获取竞品品牌信息
    // 如果没有，则使用空数组
    if (keywordsWithVolume.length > 0) {
      // 这里可以通过其他方式识别竞品品牌
      // 目前使用空数组，因为nonBrandKeywords已经过滤了竞品词
    }
  } catch (err) {
    console.warn(`   ⚠️ 竞品品牌识别失败，继续处理: ${err}`)
  }

  const extractedGenericKeywords = extractGenericHighValueKeywords(
    keywordsWithVolume,
    offerBrand,
    competitorBrands
  )

  // 🔥 新增(2025-12-18): 为提取的高价值通用词设置matchType
  extractedGenericKeywords.forEach(kw => {
    if (!kw.matchType) {
      kw.matchType = 'PHRASE'  // 高价值通用词使用PHRASE匹配
    }
  })

  console.log(`   🎯 提取到 ${extractedGenericKeywords.length} 个高价值通用词 (matchType=PHRASE)`)

  // 第2.5步：过滤非品牌词（只保留搜索量 >= 500）
  const filteredNonBrandKeywords = nonBrandKeywords.filter(kw => kw.searchVolume >= 500)

  // 合并品牌词和提取的通用词
  const enhancedNonBrandKeywords = [...filteredNonBrandKeywords, ...extractedGenericKeywords]

  // 第3步：强制约束1 - 纯品牌词必须添加（并确保有搜索量数据）
  console.log(`\n📌 强制约束1: 纯品牌词 "${offerBrand}" 必须添加`)

  // 检查纯品牌词是否已存在且有搜索量
  const existingPureBrand = pureBrandKeywords.find(kw => kw.searchVolume > 0)

  if (existingPureBrand) {
    // 纯品牌词已存在且有搜索量
    console.log(`   ✅ 纯品牌词已存在: "${existingPureBrand.keyword}" (${existingPureBrand.searchVolume}/月)`)
  } else {
    // 纯品牌词不存在或搜索量为0，需要查询搜索量
    console.log(`   ⚠️ 纯品牌词 "${offerBrand}" 需要查询搜索量...`)
    let brandSearchVolume = 0

    try {
      const { getDatabase } = await import('./db')
      const db = await getDatabase()
      const targetLanguage = (offer as { target_language?: string }).target_language || 'English'
      const langCode = targetLanguage.toLowerCase().substring(0, 2)

      // 步骤1: 尝试从全局缓存查询（不区分大小写）
      console.log(`   📦 步骤1: 查询全局缓存...`)
      const row = await db.queryOne(`
        SELECT keyword, search_volume
        FROM global_keywords
        WHERE LOWER(keyword) = LOWER(?) AND country = ?
        ORDER BY search_volume DESC
        LIMIT 1
      `, [offerBrand, targetCountry]) as { keyword: string; search_volume: number } | undefined

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
      console.warn(`   ⚠️ 查询纯品牌词搜索量失败: ${err.message}`)
    }

    // 添加纯品牌词到列表（无论搜索量）
    pureBrandKeywords.push({
      keyword: offerBrand,
      searchVolume: brandSearchVolume,
      matchType: 'EXACT'  // 🔥 新增(2025-12-18): 纯品牌词强制使用EXACT匹配
    })

    if (brandSearchVolume > 0) {
      console.log(`   ✅ 纯品牌词 "${offerBrand}" 已添加 (搜索量: ${brandSearchVolume}/月)`)
    } else {
      console.log(`   ⚠️ 纯品牌词 "${offerBrand}" 已添加 (搜索量: 未知，建议手动验证)`)
    }
  }

  // 打印品牌相关词统计
  if (brandRelatedKeywords.length > 0) {
    console.log(`\n   🔗 品牌相关词 (包含 "${offerBrand}"): ${brandRelatedKeywords.length} 个`)
    brandRelatedKeywords.slice(0, 10).forEach(kw => {
      console.log(`      - "${kw.keyword}" (${kw.searchVolume}/月)`)
    })
    if (brandRelatedKeywords.length > 10) {
      console.log(`      ... 还有 ${brandRelatedKeywords.length - 10} 个`)
    }
  }

  // 第4步：强制约束2 - 非品牌词搜索量必须 >= 500（或者是高价值提取词）
  console.log(`\n📌 强制约束2: 非品牌词搜索量 >= 500 或来自高价值词提取`)
  console.log(`   - 搜索量 >= 500 的非品牌词: ${filteredNonBrandKeywords.length} 个`)
  console.log(`   - 提取的高价值词 (>10000): ${extractedGenericKeywords.length} 个`)
  console.log(`   - 合计非品牌词: ${enhancedNonBrandKeywords.length} 个`)

  // 第5步：强制约束3 - 保留最少 10 个关键词（只补充有搜索量的）
  // 🔧 修复(2025-12-16): 品牌相关词不受>=500过滤限制，直接加入最终列表
  console.log(`\n📌 强制约束3: 保留最少 10 个关键词（只补充搜索量>0的关键词）`)

  // 合并所有品牌词（纯品牌 + 品牌相关）和增强的非品牌词（包括高价值词）
  const allBrandKeywords = [...pureBrandKeywords, ...brandRelatedKeywords.filter(kw => kw.searchVolume > 0)]
  let finalKeywords = [...allBrandKeywords, ...enhancedNonBrandKeywords]

  console.log(`   📊 初始合并: ${allBrandKeywords.length} 品牌词 + ${enhancedNonBrandKeywords.length} 非品牌词 = ${finalKeywords.length} 个`)

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
        // 🔥 新增(2025-12-18): 为补充关键词设置matchType（保持与原非品牌词一致）
        if (!kw.matchType) {
          kw.matchType = 'PHRASE'
        }
        console.log(`   - "${kw.keyword}" (搜索量: ${kw.searchVolume}/月) [补充]`)
      })
      finalKeywords = [...finalKeywords, ...supplementaryKeywords]
    } else {
      console.log(`   ℹ️ 没有更多有搜索量的关键词可补充，当前关键词数: ${finalKeywords.length}`)
    }
  }

  // 🎯 第6步：最终过滤 - 移除所有搜索量为0或null的关键词（品牌词除外）
  console.log(`\n📌 强制约束4: 移除所有搜索量为0或null的关键词（品牌词除外）`)
  const beforeFinalFilter = finalKeywords.length

  // 🔥 修复(2025-12-22): 品牌词即使搜索量为0也要保留（API可能未配置导致查询失败）
  const pureBrandKeywordTexts = pureBrandKeywords.map(kw => kw.keyword.toLowerCase())
  finalKeywords = finalKeywords.filter(kw => {
    // 保留条件：有搜索量 OR 是纯品牌词
    return kw.searchVolume > 0 || pureBrandKeywordTexts.includes(kw.keyword.toLowerCase())
  })

  const removedZeroVolume = beforeFinalFilter - finalKeywords.length
  if (removedZeroVolume > 0) {
    console.log(`   ⚠️ 已移除 ${removedZeroVolume} 个搜索量为0的关键词（保留品牌词）`)
  }
  console.log(`   ✅ 最终保留 ${finalKeywords.length} 个关键词（含搜索量数据或品牌词）`)

  // 打印保留的品牌词（即使搜索量为0）
  const retainedBrandWithZeroVolume = finalKeywords.filter(kw =>
    kw.searchVolume === 0 && pureBrandKeywordTexts.includes(kw.keyword.toLowerCase())
  )
  if (retainedBrandWithZeroVolume.length > 0) {
    console.log(`   ℹ️ 保留 ${retainedBrandWithZeroVolume.length} 个搜索量为0的品牌词:`)
    retainedBrandWithZeroVolume.forEach(kw => {
      console.log(`      - "${kw.keyword}" (品牌词，搜索量未知)`)
    })
  }

  // 🎯 第6.5步：购买意图评分过滤
  // 优化(2025-12-15): 过滤掉低购买意图关键词（信息查询类），避免浪费广告预算
  console.log(`\n📌 强制约束5: 购买意图评分过滤（移除纯信息查询词）`)
  const MIN_INTENT_SCORE = 20  // 最低意图分数阈值（低于此分数视为纯信息查询）
  const beforeIntentFilter = finalKeywords.length

  // 计算每个关键词的意图分数
  const keywordsWithIntent = finalKeywords.map(kw => ({
    ...kw,
    intentScore: calculateIntentScore(kw.keyword, brandName),  // 🔧 修复：传入brandName
    intentLevel: getIntentLevel(calculateIntentScore(kw.keyword, brandName))  // 🔧 修复：传入brandName
  }))

  // 分类统计
  const highIntentKws = keywordsWithIntent.filter(kw => kw.intentScore >= 80)
  const mediumIntentKws = keywordsWithIntent.filter(kw => kw.intentScore >= 50 && kw.intentScore < 80)
  const lowIntentKws = keywordsWithIntent.filter(kw => kw.intentScore >= 20 && kw.intentScore < 50)
  const infoIntentKws = keywordsWithIntent.filter(kw => kw.intentScore < 20)

  console.log(`   📊 意图分布统计:`)
  console.log(`      🟢 高购买意图 (≥80): ${highIntentKws.length} 个`)
  console.log(`      🟡 中等意图 (50-79): ${mediumIntentKws.length} 个`)
  console.log(`      🟠 低购买意图 (20-49): ${lowIntentKws.length} 个`)
  console.log(`      ⚪ 信息查询 (<20): ${infoIntentKws.length} 个`)

  // 过滤掉纯信息查询关键词（意图分数 < 20）
  if (infoIntentKws.length > 0) {
    console.log(`\n   ⚠️ 将移除 ${infoIntentKws.length} 个信息查询类关键词:`)
    infoIntentKws.slice(0, 5).forEach(kw => {
      console.log(`      - "${kw.keyword}" (意图分数: ${kw.intentScore}, ${kw.intentLevel.label})`)
    })
    if (infoIntentKws.length > 5) {
      console.log(`      ... 及其他 ${infoIntentKws.length - 5} 个`)
    }
  }

  // 应用过滤：移除信息查询类关键词
  finalKeywords = keywordsWithIntent
    .filter(kw => kw.intentScore >= MIN_INTENT_SCORE)
    .map(({ intentScore, intentLevel, ...rest }) => rest)  // 移除临时属性

  const removedByIntent = beforeIntentFilter - finalKeywords.length
  console.log(`   ✅ 意图过滤完成: 移除 ${removedByIntent} 个低意图词，保留 ${finalKeywords.length} 个`)

  // 🎯 第7步：品牌词优先排序 + 比例控制
  // 优化(2025-12-15): 确保品牌词至少占50%，避免被高搜索量通用词淹没
  console.log(`\n📊 关键词排序规则: 品牌词优先 + 比例控制（品牌词至少50%）`)

  // 7.1 分离品牌词和非品牌词（包含品牌名的关键词 vs 不包含的）
  const brandRelatedKws = finalKeywords.filter(kw =>
    kw.keyword.toLowerCase().includes(brandKeywordLower)
  )
  const genericKws = finalKeywords.filter(kw =>
    !kw.keyword.toLowerCase().includes(brandKeywordLower)
  )

  // 7.2 各自按搜索量排序
  brandRelatedKws.sort((a, b) => b.searchVolume - a.searchVolume)
  genericKws.sort((a, b) => b.searchVolume - a.searchVolume)

  // 7.3 品牌词比例控制（至少50%，最少15个）
  const totalCount = finalKeywords.length
  const targetBrandRatio = 0.50  // 品牌词目标比例50%
  const minBrandCount = 15       // 最少品牌词数量
  const targetBrandCount = Math.max(minBrandCount, Math.ceil(totalCount * targetBrandRatio))
  const actualBrandCount = Math.min(brandRelatedKws.length, targetBrandCount)
  const genericCount = Math.max(0, totalCount - actualBrandCount)

  console.log(`   🏷️ 品牌词: ${brandRelatedKws.length}个可用, 目标${targetBrandCount}个, 实际选取${actualBrandCount}个`)
  console.log(`   📦 通用词: ${genericKws.length}个可用, 选取${Math.min(genericKws.length, genericCount)}个`)

  // 7.4 组合最终关键词列表：品牌词在前，通用词在后
  finalKeywords = [
    ...brandRelatedKws.slice(0, actualBrandCount),
    ...genericKws.slice(0, genericCount)
  ]

  // 7.5 输出品牌词详情
  if (actualBrandCount > 0) {
    console.log(`\n   🏷️ 已选品牌词 TOP 5:`)
    brandRelatedKws.slice(0, Math.min(5, actualBrandCount)).forEach((kw, i) => {
      console.log(`      ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月)`)
    })
  }

  keywordsWithVolume = finalKeywords
  const afterFilterCount = keywordsWithVolume.length
  const filteredOutCount = beforeFilterCount - afterFilterCount

  // 计算最终品牌词比例
  const finalBrandCount = keywordsWithVolume.filter(kw =>
    kw.keyword.toLowerCase().includes(brandKeywordLower)
  ).length
  const brandRatio = afterFilterCount > 0 ? Math.round(finalBrandCount / afterFilterCount * 100) : 0

  console.log(`\n✅ 过滤完成:`)
  console.log(`   原始关键词: ${beforeFilterCount} 个`)
  console.log(`   最终保留: ${afterFilterCount} 个`)
  console.log(`   - 品牌相关词: ${finalBrandCount} 个 (${brandRatio}%)`)
  console.log(`   - 通用词: ${afterFilterCount - finalBrandCount} 个 (${100 - brandRatio}%)`)

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
 * ✅ 安全修复：userId改为必需参数
 *
 * @param offerId Offer ID
 * @param userId 用户ID（必需）
 * @param count 生成数量（1-3个）
 * @param options 生成选项
 * @returns 生成的创意数组
 */
export async function generateAdCreativesBatch(
  offerId: number,
  userId: number,  // ✅ 修复：改为必需参数
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
 * 🆕 2025-12-16: 生成综合广告创意（第4个创意）
 *
 * 综合创意特点：
 * 1. 包含所有品牌关键词（100%覆盖）
 * 2. 包含高搜索量的非品牌关键词（Top15）
 * 3. 优化Ad Strength评分（目标：Excellent）
 * 4. 标题/描述与关键词高度匹配
 *
 * @param offerId Offer ID
 * @param userId 用户ID
 * @param keywordPool 关键词池
 * @param options 可选配置
 * @returns 生成的综合创意
 */
export async function generateSyntheticCreative(
  offerId: number,
  userId: number,
  keywordPool: any,  // OfferKeywordPool
  options?: {
    skipCache?: boolean
    maxNonBrandKeywords?: number
    minSearchVolume?: number
  }
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  console.log(`\n🔮 开始生成综合广告创意 (Offer #${offerId})...`)

  // 1. 获取offer信息
  const db = await getDatabase()
  const offer = await db.queryOne('SELECT * FROM offers WHERE id = ? AND user_id = ?', [offerId, userId])
  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  // 2. 使用关键词池服务获取综合关键词
  const { getSyntheticBucketKeywords, DEFAULT_SYNTHETIC_CONFIG } = await import('./offer-keyword-pool')

  const config = {
    ...DEFAULT_SYNTHETIC_CONFIG,
    maxNonBrandKeywords: options?.maxNonBrandKeywords || DEFAULT_SYNTHETIC_CONFIG.maxNonBrandKeywords,
    minSearchVolume: options?.minSearchVolume || DEFAULT_SYNTHETIC_CONFIG.minSearchVolume,
  }

  const targetCountry = (offer as any).target_country || 'US'
  const syntheticKeywords = await getSyntheticBucketKeywords(
    keywordPool,
    userId,
    targetCountry,
    config
  )

  // 3. 提取关键词列表
  const bucketKeywords = syntheticKeywords.map(k => k.keyword)
  const brandKeywordCount = syntheticKeywords.filter(k => k.isBrand).length
  const nonBrandKeywordCount = syntheticKeywords.filter(k => !k.isBrand).length

  console.log(`📊 综合关键词准备完成:`)
  console.log(`   - 品牌词: ${brandKeywordCount}个`)
  console.log(`   - 高搜索量非品牌词: ${nonBrandKeywordCount}个`)
  console.log(`   - 总计: ${bucketKeywords.length}个`)

  // 4. 调用通用创意生成函数（带综合创意特殊参数）
  const result = await generateAdCreative(offerId, userId, {
    theme: '综合推广 - Synthetic Creative for Maximum Ad Strength',
    skipCache: options?.skipCache ?? true,  // 综合创意默认不使用缓存
    keywordPool,
    bucket: 'S',
    bucketKeywords,
    bucketIntent: '综合推广',
    bucketIntentEn: 'Synthetic',
    isSyntheticCreative: true,
    syntheticKeywordsWithVolume: syntheticKeywords,
  })

  console.log(`✅ 综合广告创意生成完成`)
  console.log(`   - Headlines: ${result.headlines?.length || 0}个`)
  console.log(`   - Descriptions: ${result.descriptions?.length || 0}个`)
  console.log(`   - Keywords: ${result.keywords?.length || 0}个`)

  return result
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
 *
 * ✅ 安全修复：userId改为必需参数
 */
export async function generateMultipleCreativesWithDiversityCheck(
  offerId: number,
  userId: number,  // ✅ 修复：改为必需参数
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
