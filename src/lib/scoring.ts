import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ScoreAnalysis } from './launch-scores'
import type { Offer } from './offers'
import type { Creative } from './creatives'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

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
  creative: Creative
): Promise<ScoreAnalysis> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

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
标题1：${creative.headline1}
标题2：${creative.headline2 || '无'}
标题3：${creative.headline3 || '无'}
描述1：${creative.description1}
描述2：${creative.description2 || '无'}
最终URL：${creative.finalUrl}

# 评分要求
请从以下5个维度进行评分（总分100分）：

## 1. 关键词质量评分（30分满分）
评估要点：
- 标题和描述中关键词的相关性和匹配度
- 关键词的搜索意图匹配
- 关键词的竞争程度预估
- 长尾关键词vs热门关键词的平衡

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
- 关键词竞争度与预算的匹配
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
    "issues": ["问题1", "问题2"],
    "suggestions": ["建议1", "建议2"]
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
2. 每个维度都要给出具体的问题和改进建议
3. 总体建议要具有可操作性
4. 所有文字使用中文
5. 只返回JSON，不要其他内容`

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    // 提取JSON内容
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    const analysis = JSON.parse(jsonMatch[0]) as ScoreAnalysis

    // 验证评分范围
    validateScores(analysis)

    return analysis
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
