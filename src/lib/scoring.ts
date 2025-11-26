import { generateContent } from './gemini'
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
}> {
  try {
    // 🎯 获取创意中的关键词和否定关键词数据
    const creativeKeywords = creative.keywords || []
    const negativeKeywords = (creative as any).negativeKeywords || []  // 否定关键词列表
    const keywordsWithVolume = (creative as any).keywordsWithVolume || []  // 带搜索量和竞争度的关键词

    const prompt = `你是一个专业的Google Ads投放评估专家。请分析以下广告投放计划，并从5个维度进行评分。

# 产品信息
品牌名称：${offer.brand}
目标国家：${offer.target_country}
产品分类：${offer.category || '未知'}
品牌描述：${offer.brand_description || '无'}
独特卖点：${offer.unique_selling_points || '无'}
产品亮点：${offer.product_highlights || '无'}
目标受众：${offer.target_audience || '无'}
着陆页URL：${offer.url}
联盟链接：${offer.affiliate_link || '无'}

# 广告创意
标题列表：${creative.headlines.slice(0, 3).join(', ')}
描述列表：${creative.descriptions.join(', ')}
关键词：${creativeKeywords.join(', ')}
否定关键词：${negativeKeywords.length > 0 ? negativeKeywords.join(', ') : '❌ 未设置（重要缺失！）'}
最终URL：${creative.final_url}

# 关键词数据分析
${keywordsWithVolume.length > 0 ?
  `关键词竞争度数据（0-100，数值越高竞争越激烈）：\n${
    keywordsWithVolume.slice(0, 10).map((kw: any) =>
      `- ${kw.keyword}: 搜索量${kw.searchVolume || 0}/月, 竞争度${kw.competitionIndex || 0}, 竞争级别${kw.competition || '未知'}`
    ).join('\n')
  }`
  : '⚠️ 缺少关键词竞争度数据'
}

# 评分要求
请从以下5个维度进行评分（总分100分）：

## 1. 关键词质量评分（30分满分）
评估要点：
- 标题和描述中关键词的相关性和匹配度
- 关键词的搜索意图匹配
- 长尾关键词vs热门关键词的平衡
- **🎯 是否设置了否定关键词（重要！）**
  - 未设置否定关键词扣5-10分
  - 否定关键词数量不足（<10个）扣3-5分

**注意：关键词竞争度仅作为参考信息，不影响评分。高竞争度的核心关键词是正常现象。**

## 2. 市场契合度评分（25分满分）
评估要点：
- 产品与目标国家市场的匹配度
- 目标受众定位的准确性
- 地理位置的相关性
- 季节性和时效性因素

## 3. 着陆页质量评分（20分满分）
评估要点：
- URL的可信度和专业性
- 预估的页面加载速度（基于URL结构）
- 域名的可信度（品牌官网 vs 第三方平台）
- 移动端优化预估

## 4. 预算合理性评分（15分满分）
评估要点：
- 预估的CPC成本合理性
- **🎯 关键词竞争度与预算的匹配**
  - 高竞争度关键词需要更高预算
  - 低竞争度关键词可降低预算
- 投放目标的现实性
- ROI潜力预估

## 5. 内容创意质量评分（10分满分）
评估要点：
- 标题的吸引力和清晰度
- 描述的说服力和行动召唤
- 创意与产品的一致性
- 创意的独特性和差异化

# 输出格式
请严格按照以下JSON格式输出评分结果：

{
  "keywordAnalysis": {
    "score": 0-30之间的整数,
    "relevance": 0-100,
    "competition": "低|中|高",
    "issues": [
      ${negativeKeywords.length === 0 ? '"❌ 缺少否定关键词列表，可能导致广告展示给意图不符的用户（如搜索\\"维修\\"、\\"评论\\"、\\"免费\\"等）",' : ''}
      "其他问题..."
    ],
    "suggestions": [
      ${negativeKeywords.length === 0 ? '"建议添加否定关键词：free, repair, review, broken, crack, torrent, download等",' : ''}
      "其他建议..."
    ]
  },
  "marketFitAnalysis": {
    "score": 0-25之间的整数,
    "targetAudienceMatch": 0-100,
    "geographicRelevance": 0-100,
    "competitorPresence": "少|中|多",
    "issues": ["问题1", "问题2"],
    "suggestions": ["建议1", "建议2"]
  },
  "landingPageAnalysis": {
    "score": 0-20之间的整数,
    "loadSpeed": 0-100,
    "mobileOptimization": true/false,
    "contentRelevance": 0-100,
    "callToAction": true/false,
    "trustSignals": 0-100,
    "issues": ["问题1", "问题2"],
    "suggestions": ["建议1", "建议2"]
  },
  "budgetAnalysis": {
    "score": 0-15之间的整数,
    "estimatedCpc": 估算的CPC（美元）,
    "competitiveness": "低|中|高",
    "roi": 预估ROI百分比,
    "issues": ["问题1", "问题2"],
    "suggestions": ["建议1", "建议2"]
  },
  "contentAnalysis": {
    "score": 0-10之间的整数,
    "headlineQuality": 0-100,
    "descriptionQuality": 0-100,
    "keywordAlignment": 0-100,
    "uniqueness": 0-100,
    "issues": ["问题1", "问题2"],
    "suggestions": ["建议1", "建议2"]
  },
  "overallRecommendations": [
    "总体建议1",
    "总体建议2",
    "总体建议3"
  ]
}

要求：
1. 评分必须客观、基于实际分析
2. **🎯 必须严格检查否定关键词，这是评分的关键因素（注意：关键词竞争度不扣分，仅供参考）**
3. 每个维度都要给出具体的问题和改进建议
4. 总体建议要具有可操作性
5. 所有文字使用中文
6. 只返回JSON，不要其他内容`

    // 需求12：使用Gemini 2.5 Pro稳定版模型（带代理支持 + 自动降级）
    const text = await generateContent({
      model: 'gemini-2.5-pro',
      prompt,
      temperature: 0.7,
      maxOutputTokens: 8192, // 增加到8192以确保完整的JSON响应
    }, userId)

    // 提取JSON内容
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    const rawAnalysis = JSON.parse(jsonMatch[0]) as ScoreAnalysis

    // 验证评分范围
    validateScores(rawAnalysis)

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
      recommendations: rawAnalysis.overallRecommendations
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
    const prompt = `你是一个专业的Google Ads广告创意评估专家。请评估以下广告创意的质量，给出0-100分的评分。

# 广告创意信息
品牌名称：${creative.brand}
广告导向：${creative.orientation === 'brand' ? '品牌导向' : creative.orientation === 'product' ? '产品导向' : '促销导向'}

标题1：${creative.headline1}
标题2：${creative.headline2}
标题3：${creative.headline3}

描述1：${creative.description1}
描述2：${creative.description2}

# 评分标准（总分100分）

## 1. 标题质量（40分）
- 标题是否吸引眼球、简洁有力（15分）
- 标题长度是否符合Google Ads规范（最多30个字符）（10分）
- 三个标题之间是否有差异化和互补性（10分）
- 标题中关键词使用是否自然（5分）

## 2. 描述质量（30分）
- 描述是否清晰、有说服力（15分）
- 描述长度是否符合Google Ads规范（最多90个字符）（10分）
- 描述是否包含有效的行动召唤（5分）

## 3. 整体吸引力（20分）
- 创意是否符合广告导向（品牌/产品/促销）（10分）
- 创意是否能引起目标受众兴趣（10分）

## 4. 符合规范（10分）
- 是否避免使用夸张、误导性语言（5分）
- 是否避免违反Google Ads政策的内容（5分）

# 输出格式
请只返回一个0-100之间的整数，代表这个广告创意的质量评分。
不要返回其他任何文字，只返回数字。

例如：
92`

    // 使用Gemini 2.5 Pro进行评分（优先Vertex AI）
    if (!userId) {
      throw new Error('创意质量评分需要用户ID，请确保已登录')
    }
    const text = await generateContent({
      model: 'gemini-2.5-pro',
      prompt,
      temperature: 0.3, // 降低温度以获得更稳定的评分
      maxOutputTokens: 256, // 增加以容纳Gemini 2.5的思考tokens + 实际输出
    }, userId)

    // 提取数字
    const scoreMatch = text.trim().match(/\d+/)
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

