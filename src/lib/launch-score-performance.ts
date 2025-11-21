import { getDatabase } from './db'
import type { LaunchScore, ScoreAnalysis } from './launch-scores'

/**
 * Launch Score性能数据集成
 *
 * 将Launch Score的AI预测与实际Google Ads表现数据进行对比分析
 */

export interface PerformanceData {
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  totalCostUsd: number
  avgCtr: number
  avgCpcUsd: number
  conversionRate: number
  actualRoi: number | null
  dateRange: {
    start: string
    end: string
    days: number
  }
}

export interface PredictionComparison {
  metric: string
  predicted: number | string
  actual: number | string
  accuracy: number | null // 准确度百分比 (null表示无法计算)
  variance: string // 差异描述
}

export interface PerformanceEnhancedAnalysis {
  launchScore: LaunchScore
  performanceData: PerformanceData | null
  comparisons: PredictionComparison[]
  adjustedRecommendations: string[]
  accuracyScore: number // 整体预测准确度 (0-100)
}

/**
 * 获取Offer的实际性能数据
 */
export function getPerformanceDataForOffer(
  offerId: number,
  userId: number,
  daysBack: number = 30
): PerformanceData | null {
  const db = getDatabase()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const result = db.prepare(`
    SELECT
      SUM(impressions) as total_impressions,
      SUM(clicks) as total_clicks,
      SUM(conversions) as total_conversions,
      SUM(cost_micros) as total_cost_micros,
      AVG(ctr) as avg_ctr,
      AVG(conversion_rate) as avg_conversion_rate
    FROM ad_performance
    WHERE offer_id = ?
      AND user_id = ?
      AND date >= ?
      AND date <= ?
  `).get(offerId, userId, cutoffDateStr, today) as any

  if (!result || result.total_impressions === null || result.total_impressions === 0) {
    return null // 没有性能数据
  }

  const totalCostUsd = result.total_cost_micros ? result.total_cost_micros / 1000000 : 0
  const avgCpcUsd = result.total_clicks > 0
    ? totalCostUsd / result.total_clicks
    : 0

  // 计算实际ROI (需要假设平均订单价值)
  // 这里我们只返回null，实际ROI需要在API层面结合用户输入的平均订单价值计算
  const actualRoi = null

  return {
    totalImpressions: result.total_impressions || 0,
    totalClicks: result.total_clicks || 0,
    totalConversions: result.total_conversions || 0,
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    avgCtr: result.avg_ctr || 0,
    avgCpcUsd: Math.round(avgCpcUsd * 100) / 100,
    conversionRate: result.avg_conversion_rate || 0,
    actualRoi,
    dateRange: {
      start: cutoffDateStr,
      end: today,
      days: daysBack
    }
  }
}

/**
 * 对比Launch Score预测与实际表现
 */
export function comparePredictionVsActual(
  launchScore: LaunchScore,
  performanceData: PerformanceData,
  avgOrderValue?: number
): PredictionComparison[] {
  const analysis = parseLaunchScoreAnalysis(launchScore)
  const comparisons: PredictionComparison[] = []

  // 1. CPC对比
  if (analysis.budgetAnalysis.estimatedCpc !== undefined) {
    const predictedCpc = analysis.budgetAnalysis.estimatedCpc
    const actualCpc = performanceData.avgCpcUsd

    let accuracy: number | null = null
    let variance: string

    if (actualCpc > 0 && predictedCpc > 0) {
      // 计算准确度：1 - abs(预测-实际)/实际
      const error = Math.abs(predictedCpc - actualCpc) / actualCpc
      accuracy = Math.max(0, Math.min(100, (1 - error) * 100))

      const diff = ((actualCpc - predictedCpc) / predictedCpc * 100).toFixed(1)
      if (actualCpc > predictedCpc) {
        variance = `实际CPC比预测高${diff}%`
      } else {
        variance = `实际CPC比预测低${Math.abs(parseFloat(diff))}%`
      }
    } else {
      variance = '无法计算差异'
    }

    comparisons.push({
      metric: 'CPC (每次点击成本)',
      predicted: `$${predictedCpc.toFixed(2)}`,
      actual: `$${actualCpc.toFixed(2)}`,
      accuracy,
      variance
    })
  }

  // 2. CTR对比 (Launch Score没有预测CTR，这里显示实际值)
  comparisons.push({
    metric: 'CTR (点击率)',
    predicted: '未预测',
    actual: `${(performanceData.avgCtr * 100).toFixed(2)}%`,
    accuracy: null,
    variance: '实际表现数据'
  })

  // 3. 转化率对比
  comparisons.push({
    metric: '转化率',
    predicted: '未预测',
    actual: `${(performanceData.conversionRate * 100).toFixed(2)}%`,
    accuracy: null,
    variance: '实际表现数据'
  })

  // 4. ROI对比 (如果提供了平均订单价值)
  if (analysis.budgetAnalysis.roi !== undefined && avgOrderValue && avgOrderValue > 0) {
    const predictedRoi = analysis.budgetAnalysis.roi
    const revenue = performanceData.totalConversions * avgOrderValue
    const actualRoi = performanceData.totalCostUsd > 0
      ? ((revenue - performanceData.totalCostUsd) / performanceData.totalCostUsd) * 100
      : 0

    let accuracy: number | null = null
    let variance: string

    if (actualRoi !== 0 && predictedRoi !== 0) {
      const error = Math.abs(predictedRoi - actualRoi) / Math.abs(actualRoi)
      accuracy = Math.max(0, Math.min(100, (1 - error) * 100))

      const diff = actualRoi - predictedRoi
      if (diff > 0) {
        variance = `实际ROI比预测高${diff.toFixed(1)}个百分点`
      } else {
        variance = `实际ROI比预测低${Math.abs(diff).toFixed(1)}个百分点`
      }
    } else {
      variance = '无法计算差异'
    }

    comparisons.push({
      metric: 'ROI (投资回报率)',
      predicted: `${predictedRoi}%`,
      actual: `${actualRoi.toFixed(1)}%`,
      accuracy,
      variance
    })
  }

  // 5. 展示次数和点击次数 (实际值，无预测)
  comparisons.push({
    metric: '展示次数',
    predicted: '未预测',
    actual: performanceData.totalImpressions.toLocaleString(),
    accuracy: null,
    variance: '实际表现数据'
  })

  comparisons.push({
    metric: '点击次数',
    predicted: '未预测',
    actual: performanceData.totalClicks.toLocaleString(),
    accuracy: null,
    variance: '实际表现数据'
  })

  comparisons.push({
    metric: '转化次数',
    predicted: '未预测',
    actual: performanceData.totalConversions.toFixed(1),
    accuracy: null,
    variance: '实际表现数据'
  })

  comparisons.push({
    metric: '总花费',
    predicted: '未预测',
    actual: `$${performanceData.totalCostUsd.toFixed(2)}`,
    accuracy: null,
    variance: '实际表现数据'
  })

  return comparisons
}

/**
 * 计算整体预测准确度
 */
export function calculateOverallAccuracy(comparisons: PredictionComparison[]): number {
  const validAccuracies = comparisons
    .map(c => c.accuracy)
    .filter((a): a is number => a !== null)

  if (validAccuracies.length === 0) {
    return 0 // 没有可计算的准确度
  }

  const sum = validAccuracies.reduce((acc, val) => acc + val, 0)
  return Math.round(sum / validAccuracies.length)
}

/**
 * 生成基于实际表现的调整建议
 */
export function generatePerformanceAdjustedRecommendations(
  launchScore: LaunchScore,
  performanceData: PerformanceData,
  comparisons: PredictionComparison[]
): string[] {
  const recommendations: string[] = []
  const analysis = parseLaunchScoreAnalysis(launchScore)

  // 1. CPC分析
  const cpcComparison = comparisons.find(c => c.metric.includes('CPC'))
  if (cpcComparison && cpcComparison.accuracy !== null) {
    if (cpcComparison.accuracy < 70) {
      const predictedCpc = analysis.budgetAnalysis.estimatedCpc || 0
      const actualCpc = performanceData.avgCpcUsd

      if (actualCpc > predictedCpc * 1.5) {
        recommendations.push(`⚠️ 实际CPC ($${actualCpc.toFixed(2)}) 远高于预测 ($${predictedCpc.toFixed(2)})，建议优化关键词质量得分或降低出价`)
      } else if (actualCpc < predictedCpc * 0.5) {
        recommendations.push(`✅ 实际CPC ($${actualCpc.toFixed(2)}) 远低于预测，表现优秀！可以考虑提高出价以获取更多流量`)
      }
    }
  }

  // 2. CTR分析
  if (performanceData.avgCtr < 0.01) {
    recommendations.push(`📉 点击率过低 (${(performanceData.avgCtr * 100).toFixed(2)}%)，建议优化广告文案和标题吸引力`)
  } else if (performanceData.avgCtr > 0.05) {
    recommendations.push(`🎯 点击率表现优秀 (${(performanceData.avgCtr * 100).toFixed(2)}%)，继续保持创意质量`)
  }

  // 3. 转化率分析
  if (performanceData.conversionRate < 0.02) {
    recommendations.push(`🔧 转化率较低 (${(performanceData.conversionRate * 100).toFixed(2)}%)，建议检查着陆页体验和目标受众定位`)
  } else if (performanceData.conversionRate > 0.05) {
    recommendations.push(`🌟 转化率表现出色 (${(performanceData.conversionRate * 100).toFixed(2)}%)，可以考虑扩大预算规模`)
  }

  // 4. 预算使用分析
  if (performanceData.totalCostUsd > 100) {
    const costPerConversion = performanceData.totalConversions > 0
      ? performanceData.totalCostUsd / performanceData.totalConversions
      : 0

    if (costPerConversion > 0) {
      recommendations.push(`💰 每次转化成本: $${costPerConversion.toFixed(2)}，请评估是否在可接受范围内`)
    }
  }

  // 5. Launch Score维度反馈
  if (performanceData.avgCtr < 0.02 && analysis.contentAnalysis.score < 7) {
    recommendations.push(`📝 低点击率可能与内容创意得分较低有关 (${analysis.contentAnalysis.score}/10)，建议重新优化广告文案`)
  }

  if (performanceData.avgCpcUsd > (analysis.budgetAnalysis.estimatedCpc || 0) * 1.5
      && analysis.keywordAnalysis.score < 20) {
    recommendations.push(`🔑 高CPC可能与关键词质量得分较低有关 (${analysis.keywordAnalysis.score}/30)，建议优化关键词相关性`)
  }

  // 如果没有生成任何建议，添加默认建议
  if (recommendations.length === 0) {
    recommendations.push(`✅ 整体表现符合预期，继续监控并根据数据反馈进行优化`)
  }

  return recommendations
}

/**
 * 获取性能增强的Launch Score分析
 */
export function getPerformanceEnhancedAnalysis(
  launchScore: LaunchScore,
  userId: number,
  daysBack: number = 30,
  avgOrderValue?: number
): PerformanceEnhancedAnalysis {
  // 获取实际性能数据
  const performanceData = getPerformanceDataForOffer(
    launchScore.offerId,
    userId,
    daysBack
  )

  if (!performanceData) {
    // 没有性能数据，返回原始Launch Score
    return {
      launchScore,
      performanceData: null,
      comparisons: [],
      adjustedRecommendations: ['暂无实际投放数据，无法进行对比分析。请先投放广告后查看此功能。'],
      accuracyScore: 0
    }
  }

  // 对比预测与实际
  const comparisons = comparePredictionVsActual(launchScore, performanceData, avgOrderValue)

  // 计算整体准确度
  const accuracyScore = calculateOverallAccuracy(comparisons)

  // 生成调整后的建议
  const adjustedRecommendations = generatePerformanceAdjustedRecommendations(
    launchScore,
    performanceData,
    comparisons
  )

  return {
    launchScore,
    performanceData,
    comparisons,
    adjustedRecommendations,
    accuracyScore
  }
}

/**
 * 解析Launch Score的详细分析数据
 */
function parseLaunchScoreAnalysis(score: LaunchScore): ScoreAnalysis {
  return {
    keywordAnalysis: score.keywordAnalysisData ? JSON.parse(score.keywordAnalysisData) : {},
    marketFitAnalysis: score.marketAnalysisData ? JSON.parse(score.marketAnalysisData) : {},
    landingPageAnalysis: score.landingPageAnalysisData
      ? JSON.parse(score.landingPageAnalysisData)
      : {},
    budgetAnalysis: score.budgetAnalysisData ? JSON.parse(score.budgetAnalysisData) : {},
    contentAnalysis: score.contentAnalysisData ? JSON.parse(score.contentAnalysisData) : {},
    overallRecommendations: score.recommendations ? JSON.parse(score.recommendations) : [],
  } as ScoreAnalysis
}
