/**
 * A/B测试创意选择器
 *
 * 功能：
 * 1. 基于Ad Strength自动选择最优创意组合
 * 2. 智能分配测试流量
 * 3. 动态调整策略（基于实时数据）
 */

import type { AdStrengthEvaluation, AdStrengthRating } from './ad-strength-evaluator'

/**
 * 创意变体（用于A/B测试）
 */
export interface CreativeVariant {
  id: string
  creativeId: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]

  // Ad Strength评估结果
  adStrength?: {
    rating: AdStrengthRating
    score: number
    evaluation: AdStrengthEvaluation
  }

  // A/B测试配置
  testConfig?: {
    trafficWeight: number // 流量权重 0-1
    variant: 'A' | 'B' | 'C' | 'D' | 'E'
  }

  // 历史性能数据（可选）
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    ctr: number
    cvr: number
    cost: number
  }
}

/**
 * A/B测试策略
 */
export type ABTestStrategy =
  | 'ad_strength_based' // 基于Ad Strength评分分配流量
  | 'equal_split' // 均等分配流量
  | 'champion_challenger' // 冠军挑战者模式（80/20）
  | 'performance_based' // 基于历史性能分配
  | 'multi_armed_bandit' // 多臂老虎机算法

/**
 * A/B测试选择结果
 */
export interface ABTestSelection {
  // 选中的创意变体
  variants: CreativeVariant[]

  // 测试策略
  strategy: ABTestStrategy

  // 流量分配
  trafficAllocation: {
    [variantId: string]: {
      variant: string
      weight: number
      reason: string
    }
  }

  // 推荐理由
  reasoning: string[]

  // 预期效果
  expectedOutcome: {
    estimatedCTR: number
    estimatedCVR: number
    confidenceLevel: number
  }
}

/**
 * 基于Ad Strength选择A/B测试创意
 *
 * @param variants 候选创意变体（已评估Ad Strength）
 * @param strategy A/B测试策略
 * @param options 可选配置
 */
export function selectABTestCreatives(
  variants: CreativeVariant[],
  strategy: ABTestStrategy = 'ad_strength_based',
  options?: {
    maxVariants?: number // 最多选择几个变体（默认3）
    minAdStrength?: AdStrengthRating // 最低Ad Strength要求（默认GOOD）
    includeChampion?: boolean // 是否包含历史最佳（默认true）
  }
): ABTestSelection {
  const maxVariants = options?.maxVariants || 3
  const minAdStrength = options?.minAdStrength || 'GOOD'
  const includeChampion = options?.includeChampion !== false

  console.log(`🧪 开始A/B测试选择 (策略: ${strategy}, 候选: ${variants.length}个)`)

  // 1. 过滤不符合最低Ad Strength的创意
  const qualifiedVariants = filterByAdStrength(variants, minAdStrength)

  if (qualifiedVariants.length === 0) {
    throw new Error(`没有符合最低Ad Strength要求（${minAdStrength}）的创意`)
  }

  console.log(`✅ 符合要求的创意: ${qualifiedVariants.length}个`)

  // 2. 根据策略选择创意
  let selectedVariants: CreativeVariant[] = []
  let trafficAllocation: ABTestSelection['trafficAllocation'] = {}
  let reasoning: string[] = []

  switch (strategy) {
    case 'ad_strength_based':
      ;({ selectedVariants, trafficAllocation, reasoning } =
        selectByAdStrength(qualifiedVariants, maxVariants))
      break

    case 'equal_split':
      ;({ selectedVariants, trafficAllocation, reasoning } =
        selectEqualSplit(qualifiedVariants, maxVariants))
      break

    case 'champion_challenger':
      ;({ selectedVariants, trafficAllocation, reasoning } =
        selectChampionChallenger(qualifiedVariants, includeChampion))
      break

    case 'performance_based':
      ;({ selectedVariants, trafficAllocation, reasoning } =
        selectByPerformance(qualifiedVariants, maxVariants))
      break

    case 'multi_armed_bandit':
      ;({ selectedVariants, trafficAllocation, reasoning } =
        selectMultiArmedBandit(qualifiedVariants, maxVariants))
      break

    default:
      throw new Error(`不支持的策略: ${strategy}`)
  }

  // 3. 计算预期效果
  const expectedOutcome = calculateExpectedOutcome(selectedVariants)

  console.log(`🎯 已选择 ${selectedVariants.length} 个创意用于A/B测试`)

  return {
    variants: selectedVariants,
    strategy,
    trafficAllocation,
    reasoning,
    expectedOutcome
  }
}

/**
 * 策略1: 基于Ad Strength评分分配流量
 */
function selectByAdStrength(
  variants: CreativeVariant[],
  maxVariants: number
) {
  // 按Ad Strength评分降序排序
  const sorted = [...variants].sort((a, b) => {
    const scoreA = a.adStrength?.score || 0
    const scoreB = b.adStrength?.score || 0
    return scoreB - scoreA
  })

  // 选择Top N
  const selectedVariants = sorted.slice(0, maxVariants)

  // 计算总分
  const totalScore = selectedVariants.reduce(
    (sum, v) => sum + (v.adStrength?.score || 0),
    0
  )

  // 基于评分分配流量权重
  const trafficAllocation: ABTestSelection['trafficAllocation'] = {}
  const variantLabels = ['A', 'B', 'C', 'D', 'E']

  selectedVariants.forEach((variant, index) => {
    const score = variant.adStrength?.score || 0
    const weight = score / totalScore

    variant.testConfig = {
      trafficWeight: weight,
      variant: variantLabels[index] as any
    }

    trafficAllocation[variant.id] = {
      variant: variantLabels[index],
      weight: Math.round(weight * 100),
      reason: `Ad Strength评分 ${score}分，占总分 ${((weight * 100).toFixed(1))}%`
    }
  })

  const reasoning = [
    `选择评分最高的 ${maxVariants} 个创意`,
    `流量权重按Ad Strength评分比例分配`,
    `平均评分: ${(totalScore / selectedVariants.length).toFixed(1)}分`
  ]

  return { selectedVariants, trafficAllocation, reasoning }
}

/**
 * 策略2: 均等分配流量
 */
function selectEqualSplit(
  variants: CreativeVariant[],
  maxVariants: number
) {
  // 随机选择N个创意（或按Ad Strength排序后选择）
  const sorted = [...variants].sort((a, b) => {
    const scoreA = a.adStrength?.score || 0
    const scoreB = b.adStrength?.score || 0
    return scoreB - scoreA
  })

  const selectedVariants = sorted.slice(0, maxVariants)
  const equalWeight = 1 / selectedVariants.length

  const trafficAllocation: ABTestSelection['trafficAllocation'] = {}
  const variantLabels = ['A', 'B', 'C', 'D', 'E']

  selectedVariants.forEach((variant, index) => {
    variant.testConfig = {
      trafficWeight: equalWeight,
      variant: variantLabels[index] as any
    }

    trafficAllocation[variant.id] = {
      variant: variantLabels[index],
      weight: Math.round(equalWeight * 100),
      reason: '均等分配流量'
    }
  })

  const reasoning = [
    `选择 ${maxVariants} 个创意进行均等测试`,
    `每个创意分配 ${(equalWeight * 100).toFixed(1)}% 流量`,
    '适合早期探索，获取真实数据'
  ]

  return { selectedVariants, trafficAllocation, reasoning }
}

/**
 * 策略3: 冠军挑战者模式（80/20）
 */
function selectChampionChallenger(
  variants: CreativeVariant[],
  includeChampion: boolean
) {
  // 找到历史最佳（Champion）
  const champion = includeChampion
    ? variants.find(v => v.performance && v.performance.conversions > 0)
    : null

  // 找到Ad Strength最高的挑战者
  const challengers = champion
    ? variants.filter(v => v.id !== champion.id)
    : variants

  const bestChallenger = challengers.sort((a, b) => {
    const scoreA = a.adStrength?.score || 0
    const scoreB = b.adStrength?.score || 0
    return scoreB - scoreA
  })[0]

  const selectedVariants = champion
    ? [champion, bestChallenger]
    : [bestChallenger, challengers[1]].filter(Boolean)

  const trafficAllocation: ABTestSelection['trafficAllocation'] = {}

  if (champion && bestChallenger) {
    // 冠军80%，挑战者20%
    champion.testConfig = { trafficWeight: 0.8, variant: 'A' }
    bestChallenger.testConfig = { trafficWeight: 0.2, variant: 'B' }

    trafficAllocation[champion.id] = {
      variant: 'A',
      weight: 80,
      reason: '历史最佳创意（Champion）'
    }

    trafficAllocation[bestChallenger.id] = {
      variant: 'B',
      weight: 20,
      reason: `Ad Strength最高的挑战者（${bestChallenger.adStrength?.score}分）`
    }
  } else {
    // 无历史数据，50/50分配
    selectedVariants.forEach((variant, index) => {
      variant.testConfig = {
        trafficWeight: 0.5,
        variant: index === 0 ? 'A' : 'B'
      }

      trafficAllocation[variant.id] = {
        variant: index === 0 ? 'A' : 'B',
        weight: 50,
        reason: index === 0 ? '当前最佳创意' : '挑战者创意'
      }
    })
  }

  const reasoning = champion
    ? [
        '使用冠军挑战者模式（80/20）',
        '冠军：历史最佳创意，保证稳定效果',
        '挑战者：Ad Strength最高创意，探索提升空间'
      ]
    : [
        '无历史数据，使用均等分配',
        '选择Ad Strength最高的2个创意'
      ]

  return { selectedVariants, trafficAllocation, reasoning }
}

/**
 * 策略4: 基于历史性能分配
 */
function selectByPerformance(
  variants: CreativeVariant[],
  maxVariants: number
) {
  // 过滤有性能数据的创意
  const withPerformance = variants.filter(v => v.performance)

  if (withPerformance.length === 0) {
    // 回退到Ad Strength策略
    return selectByAdStrength(variants, maxVariants)
  }

  // 按CVR降序排序
  const sorted = withPerformance.sort((a, b) => {
    const cvrA = a.performance?.cvr || 0
    const cvrB = b.performance?.cvr || 0
    return cvrB - cvrA
  })

  const selectedVariants = sorted.slice(0, maxVariants)

  // 基于CVR分配流量
  const totalCVR = selectedVariants.reduce(
    (sum, v) => sum + (v.performance?.cvr || 0),
    0
  )

  const trafficAllocation: ABTestSelection['trafficAllocation'] = {}
  const variantLabels = ['A', 'B', 'C', 'D', 'E']

  selectedVariants.forEach((variant, index) => {
    const cvr = variant.performance?.cvr || 0
    const weight = totalCVR > 0 ? cvr / totalCVR : 1 / selectedVariants.length

    variant.testConfig = {
      trafficWeight: weight,
      variant: variantLabels[index] as any
    }

    trafficAllocation[variant.id] = {
      variant: variantLabels[index],
      weight: Math.round(weight * 100),
      reason: `历史CVR ${(cvr * 100).toFixed(2)}%`
    }
  })

  const reasoning = [
    `基于历史转化率（CVR）选择 ${maxVariants} 个创意`,
    `流量权重按CVR比例分配`,
    `平均CVR: ${((totalCVR / selectedVariants.length) * 100).toFixed(2)}%`
  ]

  return { selectedVariants, trafficAllocation, reasoning }
}

/**
 * 策略5: 多臂老虎机算法（Thompson Sampling）
 */
function selectMultiArmedBandit(
  variants: CreativeVariant[],
  maxVariants: number
) {
  // 简化版Thompson Sampling
  const selectedVariants = variants
    .map(variant => {
      const performance = variant.performance
      const alpha = performance ? performance.conversions + 1 : 1
      const beta = performance
        ? performance.impressions - performance.conversions + 1
        : 1

      // Beta分布采样（简化版：使用期望值）
      const expectedCVR = alpha / (alpha + beta)

      return {
        ...variant,
        sampledValue: expectedCVR
      }
    })
    .sort((a, b) => b.sampledValue - a.sampledValue)
    .slice(0, maxVariants)

  // Softmax分配流量
  const expValues = selectedVariants.map(v => Math.exp(v.sampledValue * 10))
  const sumExp = expValues.reduce((sum, val) => sum + val, 0)

  const trafficAllocation: ABTestSelection['trafficAllocation'] = {}
  const variantLabels = ['A', 'B', 'C', 'D', 'E']

  selectedVariants.forEach((variant, index) => {
    const weight = expValues[index] / sumExp

    variant.testConfig = {
      trafficWeight: weight,
      variant: variantLabels[index] as any
    }

    trafficAllocation[variant.id] = {
      variant: variantLabels[index],
      weight: Math.round(weight * 100),
      reason: `多臂老虎机采样值: ${variant.sampledValue.toFixed(4)}`
    }
  })

  const reasoning = [
    '使用多臂老虎机算法（Thompson Sampling）',
    '自动平衡探索（Exploration）与利用（Exploitation）',
    '随着数据积累，自动调整流量分配'
  ]

  return { selectedVariants, trafficAllocation, reasoning }
}

/**
 * 按Ad Strength过滤创意
 */
function filterByAdStrength(
  variants: CreativeVariant[],
  minRating: AdStrengthRating
): CreativeVariant[] {
  const ratingOrder: AdStrengthRating[] = [
    'PENDING',
    'POOR',
    'AVERAGE',
    'GOOD',
    'EXCELLENT'
  ]

  const minIndex = ratingOrder.indexOf(minRating)

  return variants.filter(variant => {
    if (!variant.adStrength) return false
    const currentIndex = ratingOrder.indexOf(variant.adStrength.rating)
    return currentIndex >= minIndex
  })
}

/**
 * 计算预期效果
 */
function calculateExpectedOutcome(variants: CreativeVariant[]) {
  // 基于Ad Strength评分预估CTR和CVR
  const avgScore =
    variants.reduce((sum, v) => sum + (v.adStrength?.score || 0), 0) /
    variants.length

  // 简化的预估公式（实际需要历史数据训练）
  const estimatedCTR = (avgScore / 100) * 0.05 // 假设100分对应5% CTR
  const estimatedCVR = (avgScore / 100) * 0.02 // 假设100分对应2% CVR

  // 置信水平基于样本数
  const confidenceLevel = Math.min(0.95, 0.5 + variants.length * 0.1)

  return {
    estimatedCTR,
    estimatedCVR,
    confidenceLevel
  }
}
