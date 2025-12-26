/**
 * 🔥 创意生成器类型定义模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 所有类型定义和接口
 * 遵循 KISS 原则: 单一职责，清晰命名
 */

/**
 * 意图分类（3类）
 */
export type IntentCategory = 'brand' | 'scenario' | 'function'

/**
 * 关键词数据结构
 */
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
 * AI 配置接口
 */
export interface AIConfig {
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
 * 创意生成选项
 */
export interface GenerateAdCreativeOptions {
  theme?: string
  referencePerformance?: any
  skipCache?: boolean
  excludeKeywords?: string[] // 需要排除的关键词（用于多次生成时避免重复）
  excludeHeadlines?: string[] // 🆕 需要避免的已生成headlines（用于批量生成多样性）
  diversityTheme?: string // 🆕 当前创意的差异化主题（价格/功能/评价/品牌）
  // 🆕 v4.10: 关键词池参数
  keywordPool?: any  // OfferKeywordPool
  bucket?: 'A' | 'B' | 'C' | 'S'  // 🆕 2025-12-16: 添加S（综合）桶支持
  bucketKeywords?: string[]
  bucketIntent?: string
  bucketIntentEn?: string
  // 🆕 2025-12-16: 综合创意专用参数
  isSyntheticCreative?: boolean  // 是否为综合创意
  syntheticKeywordsWithVolume?: Array<{ keyword: string; searchVolume: number; isBrand: boolean }>  // 带搜索量的综合关键词
}

/**
 * 批量生成选项
 */
export interface BatchGenerateOptions {
  theme?: string
  skipCache?: boolean
  excludeKeywords?: string[]
  keywordPool?: any
  isSyntheticCreative?: boolean
}

/**
 * AI 响应格式
 */
export interface AIResponse {
  success: boolean
  data?: any
  error?: string
  model?: string
  tokensUsed?: number
  estimatedCost?: number
}

/**
 * 提示构建变量
 */
export interface PromptVariables {
  offer_title: string
  offer_category: string
  product_features: string
  target_audience: string
  brand_name: string
  extracted_keywords_section: string
  ai_keywords_section: string
  market_analysis_section: string
  competitor_intelligence_section: string
  landing_page_insights_section: string
  cpc_recommendations_section: string
  negative_keywords_section: string
  creative_guidelines_section: string
  product_usps: string
  seasonal_trends: string
  market_positioning: string
  tone_of_voice: string
  call_to_action: string
}

/**
 * 缓存相关类型
 */
export interface CacheEntry {
  key: string
  value: any
  timestamp: number
  ttl: number
}

/**
 * 错误类型
 */
export interface CreativeGenerationError {
  code: string
  message: string
  details?: any
  retryable: boolean
}

/**
 * 质量评估指标
 */
export interface QualityMetrics {
  relevanceScore: number
  uniquenessScore: number
  complianceScore: number
  overallScore: number
}
