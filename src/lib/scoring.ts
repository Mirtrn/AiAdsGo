import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { loadPrompt, interpolateTemplate } from './prompt-loader'
import type { ScoreAnalysis } from './launch-scores'
import type { Offer } from './offers'
import type { AdCreative, HeadlineAsset, DescriptionAsset } from './ad-creative'
import {
  evaluateAdStrength,
  type AdStrengthEvaluation,
  type AdStrengthRating
} from './ad-strength-evaluator'
import {
  getAdStrength,
  validateExcellentStandard,
  type GoogleAdStrengthResponse
} from './google-ads-strength-api'

/**
 * 计算Launch Score - 5维度评分系统
 *
 * 维度权重：
 * - 关键词质量：30分
 * - 市场契合度：25分
 * - 着陆页质量：20分
 * - 预算合理性：15分
 * - 内容创意质量：10分
 */
export async function calculateLaunchScore(
  offer: Offer,
  creative: AdCreative,
  userId: number
): Promise<{
  totalScore: number
  analysis: {
    keywordsQuality: { score: number; issues?: string[]; suggestions?: string[] }
    marketFit: { score: number; issues?: string[]; suggestions?: string[] }
    landingPageQuality: { score: number; issues?: string[]; suggestions?: string[] }
    budgetRationality: { score: number; issues?: string[]; suggestions?: string[] }
    contentCreativeQuality: { score: number; issues?: string[]; suggestions?: string[] }
  }
  recommendations: string[]
  scoreAnalysis: ScoreAnalysis  // Add ScoreAnalysis for createLaunchScore
}> {
  try {
    // 🎯 获取创意中的关键词和否定关键词数据
    const creativeKeywords = creative.keywords || []
    const negativeKeywords = (creative as any).negativeKeywords || []  // 否定关键词列表
    const keywordsWithVolume = (creative as any).keywordsWithVolume || []  // 带搜索量和竞争度的关键词

    // 📦 从数据库加载prompt模板 (版本管理)
    const promptTemplate = await loadPrompt('launch_score_evaluation')

    // 🔧 准备模板变量
    const keywordsWithVolumeText = keywordsWithVolume.length > 0
      ? `关键词竞争度数据（0-100，数值越高竞争越激烈）：\n${
          keywordsWithVolume.slice(0, 10).map((kw: any) =>
            `- ${kw.keyword}: 搜索量${kw.searchVolume || 0}/月, 竞争度${kw.competitionIndex || 0}, 竞争级别${kw.competition || '未知'}`
          ).join('\n')
        }`
      : '⚠️ 缺少关键词竞争度数据'

    const negativeKeywordsText = negativeKeywords.length > 0
      ? negativeKeywords.join(', ')
      : '❌ 未设置（重要缺失！）'

    // 🎨 插值替换模板变量
    const prompt = promptTemplate
      .replace('{{offer.brand}}', offer.brand)
      .replace('{{offer.target_country}}', offer.target_country)
      .replace('{{offer.category}}', offer.category || '未知')
      .replace('{{offer.brand_description}}', offer.brand_description || '无')
      .replace('{{offer.unique_selling_points}}', offer.unique_selling_points || '无')
      .replace('{{offer.product_highlights}}', offer.product_highlights || '无')
      .replace('{{offer.target_audience}}', offer.target_audience || '无')
      .replace('{{offer.url}}', offer.url)
      .replace('{{offer.affiliate_link}}', offer.affiliate_link || '无')
      .replace('{{creative.headlines}}', creative.headlines.slice(0, 3).join(', '))
      .replace('{{creative.descriptions}}', creative.descriptions.join(', '))
      .replace('{{creative.keywords}}', creativeKeywords.join(', '))
      .replace('{{creative.negativeKeywords}}', negativeKeywordsText)
      .replace('{{creative.final_url}}', creative.final_url)
      .replace('{{keywordsWithVolume}}', keywordsWithVolumeText)

    // 智能模型选择：Launch Score计算使用Pro模型
    const aiResponse = await generateContent({
      operationType: 'launch_score_calculation',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 8192, // 增加到8192以确保完整的JSON响应
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
        operationType: 'launch_score_calculation',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 提取JSON内容
    const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    // Sanitize JSON: remove trailing commas, fix common JSON errors
    let jsonString = jsonMatch[0]
      .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
      .replace(/\r?\n/g, ' ')          // Remove newlines
      .replace(/\s+/g, ' ')            // Normalize whitespace

    const rawAnalysis = JSON.parse(jsonString) as ScoreAnalysis

    // 验证评分范围
    validateScores(rawAnalysis)

    // 🎯 Post-processing: Add negative keyword warnings if missing
    if (negativeKeywords.length === 0) {
      // Prepend critical warning to keyword analysis
      rawAnalysis.keywordAnalysis.issues = [
        '❌ 缺少否定关键词列表，可能导致广告展示给意图不符的用户（如搜索"维修"、"评论"、"免费"等）',
        ...(rawAnalysis.keywordAnalysis.issues || [])
      ]
      rawAnalysis.keywordAnalysis.suggestions = [
        '建议添加否定关键词：free, repair, review, broken, crack, torrent, download等',
        ...(rawAnalysis.keywordAnalysis.suggestions || [])
      ]
    }

    // 🎯 转换为route.ts期望的格式
    const totalScore =
      rawAnalysis.keywordAnalysis.score +
      rawAnalysis.marketFitAnalysis.score +
      rawAnalysis.landingPageAnalysis.score +
      rawAnalysis.budgetAnalysis.score +
      rawAnalysis.contentAnalysis.score

    return {
      totalScore,
      analysis: {
        keywordsQuality: {
          score: rawAnalysis.keywordAnalysis.score,
          issues: rawAnalysis.keywordAnalysis.issues,
          suggestions: rawAnalysis.keywordAnalysis.suggestions
        },
        marketFit: {
          score: rawAnalysis.marketFitAnalysis.score,
          issues: rawAnalysis.marketFitAnalysis.issues,
          suggestions: rawAnalysis.marketFitAnalysis.suggestions
        },
        landingPageQuality: {
          score: rawAnalysis.landingPageAnalysis.score,
          issues: rawAnalysis.landingPageAnalysis.issues,
          suggestions: rawAnalysis.landingPageAnalysis.suggestions
        },
        budgetRationality: {
          score: rawAnalysis.budgetAnalysis.score,
          issues: rawAnalysis.budgetAnalysis.issues,
          suggestions: rawAnalysis.budgetAnalysis.suggestions
        },
        contentCreativeQuality: {
          score: rawAnalysis.contentAnalysis.score,
          issues: rawAnalysis.contentAnalysis.issues,
          suggestions: rawAnalysis.contentAnalysis.suggestions
        }
      },
      recommendations: rawAnalysis.overallRecommendations,
      scoreAnalysis: rawAnalysis  // Return ScoreAnalysis for createLaunchScore
    }
  } catch (error: any) {
    console.error('计算Launch Score失败:', error)
    throw new Error(`计算Launch Score失败: ${error.message}`)
  }
}

/**
 * 验证评分是否在合理范围内
 */
function validateScores(analysis: ScoreAnalysis): void {
  if (analysis.keywordAnalysis.score < 0 || analysis.keywordAnalysis.score > 30) {
    throw new Error('关键词评分超出范围(0-30)')
  }
  if (analysis.marketFitAnalysis.score < 0 || analysis.marketFitAnalysis.score > 25) {
    throw new Error('市场契合度评分超出范围(0-25)')
  }
  if (analysis.landingPageAnalysis.score < 0 || analysis.landingPageAnalysis.score > 20) {
    throw new Error('着陆页评分超出范围(0-20)')
  }
  if (analysis.budgetAnalysis.score < 0 || analysis.budgetAnalysis.score > 15) {
    throw new Error('预算评分超出范围(0-15)')
  }
  if (analysis.contentAnalysis.score < 0 || analysis.contentAnalysis.score > 10) {
    throw new Error('内容评分超出范围(0-10)')
  }
}

/**
 * 计算广告创意质量评分（需求17：100分制）
 *
 * 评分维度：
 * - 标题质量：40分
 * - 描述质量：30分
 * - 整体吸引力：20分
 * - 符合规范：10分
 */
export async function calculateCreativeQualityScore(creative: {
  headline1: string
  headline2: string
  headline3: string
  description1: string
  description2: string
  brand: string
  orientation: 'brand' | 'product' | 'promo'
}, userId?: number): Promise<number> {
  try {
    // 📦 从数据库加载prompt模板 (版本管理)
    const promptTemplate = await loadPrompt('creative_quality_scoring')

    // 🎨 准备模板变量
    const orientationText = creative.orientation === 'brand' ? '品牌导向'
      : creative.orientation === 'product' ? '产品导向'
      : '促销导向'

    // 🎨 插值替换模板变量
    const prompt = promptTemplate
      .replace('{{creative.brand}}', creative.brand)
      .replace('{{creative.orientationText}}', orientationText)
      .replace('{{creative.headline1}}', creative.headline1)
      .replace('{{creative.headline2}}', creative.headline2)
      .replace('{{creative.headline3}}', creative.headline3)
      .replace('{{creative.description1}}', creative.description1)
      .replace('{{creative.description2}}', creative.description2)

    // 使用Gemini 2.5 Pro进行评分（优先Vertex AI）
    if (!userId) {
      throw new Error('创意质量评分需要用户ID，请确保已登录')
    }
    // 智能模型选择：创意质量评分使用Flash模型（简单评分任务）
    const aiResponse = await generateContent({
      operationType: 'creative_quality_scoring',
      prompt,
      temperature: 0.3, // 降低温度以获得更稳定的评分
      maxOutputTokens: 256, // 增加以容纳Gemini 2.5的思考tokens + 实际输出
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
        operationType: 'creative_quality_scoring',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 提取数字
    const scoreMatch = aiResponse.text.trim().match(/\d+/)
    if (!scoreMatch) {
      throw new Error('AI返回格式错误，未找到评分数字')
    }

    const score = parseInt(scoreMatch[0], 10)

    // 验证评分范围
    if (score < 0 || score > 100) {
      throw new Error(`评分超出范围: ${score}`)
    }

    return score
  } catch (error: any) {
    console.error('计算创意质量评分失败:', error)
    // 降级方案：如果AI评分失败，返回基于规则的评分
    return calculateFallbackQualityScore(creative)
  }
}

/**
 * 降级方案：基于规则的质量评分
 */
function calculateFallbackQualityScore(creative: {
  headline1: string
  headline2: string
  headline3: string
  description1: string
  description2: string
}): number {
  let score = 60 // 基础分

  // 标题质量检查（最多+20分）
  const headlines = [creative.headline1, creative.headline2, creative.headline3]
  headlines.forEach((headline) => {
    if (headline.length > 0 && headline.length <= 30) score += 2
    if (headline.length >= 10 && headline.length <= 25) score += 2
  })

  // 描述质量检查（最多+15分）
  const descriptions = [creative.description1, creative.description2]
  descriptions.forEach((desc) => {
    if (desc.length > 0 && desc.length <= 90) score += 3
    if (desc.length >= 30 && desc.length <= 80) score += 2
  })

  // 差异化检查（最多+5分）
  const uniqueHeadlines = new Set(headlines)
  if (uniqueHeadlines.size === headlines.length) score += 5

  return Math.min(100, Math.max(60, score)) // 确保在60-100之间
}

/**
 * 获取评分等级和颜色
 */
export function getScoreGrade(totalScore: number): {
  grade: string
  color: string
  label: string
} {
  if (totalScore >= 85) {
    return { grade: 'A', color: 'green', label: '优秀' }
  } else if (totalScore >= 70) {
    return { grade: 'B', color: 'blue', label: '良好' }
  } else if (totalScore >= 60) {
    return { grade: 'C', color: 'yellow', label: '及格' }
  } else if (totalScore >= 50) {
    return { grade: 'D', color: 'orange', label: '需改进' }
  } else {
    return { grade: 'F', color: 'red', label: '不建议投放' }
  }
}

/**
 * ========================================
 * Ad Strength评估系统（NEW）
 * 结合本地算法 + Google Ads API验证
 * ========================================
 */

/**
 * 综合评估结果（本地 + Google API）
 */
export interface ComprehensiveAdStrengthResult {
  // 本地评估结果
  localEvaluation: AdStrengthEvaluation

  // Google API验证结果（可选）
  googleValidation?: {
    adStrength: AdStrengthRating
    isExcellent: boolean
    recommendations: string[]
    assetPerformance?: {
      bestHeadlines: string[]
      bestDescriptions: string[]
      lowPerformingAssets: string[]
    }
  }

  // 最终评级（优先使用Google API结果，否则使用本地结果）
  finalRating: AdStrengthRating
  finalScore: number

  // 综合建议
  combinedSuggestions: string[]
}

/**
 * 评估广告创意的Ad Strength（支持本地评估 + Google API验证）
 *
 * @param headlines Headline资产数组（带metadata）
 * @param descriptions Description资产数组（带metadata）
 * @param keywords 关键词列表
 * @param options 可选配置
 * @returns 综合评估结果
 */
export async function evaluateCreativeAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  options?: {
    // Google API验证配置（可选）
    googleValidation?: {
      customerId: string
      campaignId: string
      userId: number
    }
    // 品牌搜索量配置（可选）
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    userId?: number
  }
): Promise<ComprehensiveAdStrengthResult> {
  console.log('🎯 开始Ad Strength评估...')

  // 1. 本地评估（快速，无需API调用）
  const localEvaluation = await evaluateAdStrength(headlines, descriptions, keywords, {
    brandName: options?.brandName,
    targetCountry: options?.targetCountry,
    targetLanguage: options?.targetLanguage,
    userId: options?.userId
  })

  console.log(`📊 本地评估: ${localEvaluation.rating} (${localEvaluation.overallScore}分)`)

  // 2. Google API验证（可选）
  let googleValidation: ComprehensiveAdStrengthResult['googleValidation'] | undefined

  if (options?.googleValidation) {
    try {
      console.log('🔍 正在调用Google Ads API验证...')

      const { customerId, campaignId, userId } = options.googleValidation

      const validationResult = await validateExcellentStandard(
        customerId,
        campaignId,
        userId
      )

      googleValidation = {
        adStrength: validationResult.currentStrength,
        isExcellent: validationResult.isExcellent,
        recommendations: validationResult.recommendations,
        assetPerformance: validationResult.assetPerformance
      }

      console.log(`✅ Google API验证: ${validationResult.currentStrength}`)
    } catch (error) {
      console.warn('⚠️ Google API验证失败，使用本地评估结果:', error)
    }
  }

  // 3. 确定最终评级（优先Google API）
  const finalRating = googleValidation?.adStrength || localEvaluation.rating
  const finalScore = localEvaluation.overallScore

  // 4. 合并建议
  const combinedSuggestions = [
    ...localEvaluation.suggestions,
    ...(googleValidation?.recommendations || [])
  ]

  // 去重建议
  const uniqueSuggestions = Array.from(new Set(combinedSuggestions))

  console.log(`🎯 最终评级: ${finalRating} (${finalScore}分)`)
  console.log(`💡 改进建议: ${uniqueSuggestions.length}条`)

  return {
    localEvaluation,
    googleValidation,
    finalRating,
    finalScore,
    combinedSuggestions: uniqueSuggestions
  }
}

/**
 * 简化版：仅返回Ad Strength评级（用于快速评估）
 *
 * @param headlines Headline资产数组
 * @param descriptions Description资产数组
 * @param keywords 关键词列表
 * @param brandOptions 品牌搜索量配置（可选）
 * @returns Ad Strength评级
 */
export async function getQuickAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  brandOptions?: {
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    userId?: number
  }
): Promise<AdStrengthRating> {
  const evaluation = await evaluateAdStrength(headlines, descriptions, keywords, brandOptions)
  return evaluation.rating
}

/**
 * 转换旧格式创意为新格式（向后兼容）
 *
 * @param creative 旧格式创意
 * @returns 新格式的headlines和descriptions
 */
export function convertLegacyCreativeFormat(creative: {
  headline1: string
  headline2: string
  headline3: string
  description1: string
  description2: string
}): {
  headlines: HeadlineAsset[]
  descriptions: DescriptionAsset[]
} {
  const headlines: HeadlineAsset[] = [
    { text: creative.headline1, length: creative.headline1.length },
    { text: creative.headline2, length: creative.headline2.length },
    { text: creative.headline3, length: creative.headline3.length }
  ]

  const descriptions: DescriptionAsset[] = [
    { text: creative.description1, length: creative.description1.length },
    { text: creative.description2, length: creative.description2.length }
  ]

  return { headlines, descriptions }
}

