/**
 * 智能模型选择器
 *
 * 核心原则：
 * 1. 结构化任务（JSON输出）→ Flash（5x cheaper）
 * 2. 复杂分析任务 → Pro（高质量）
 * 3. 关键词生成 → Pro（必须保持maxOutputTokens）
 *
 * 必须通过A/B测试验证Flash质量 ≥ 85%相似度
 */

export type ModelType = 'gemini-2.5-pro' | 'gemini-2.5-flash'

export interface ModelSelection {
  model: ModelType
  reason: string
  testingRequired: boolean // 是否需要A/B测试验证
}

/**
 * Flash适用场景（需A/B测试验证）：
 * - 结构化JSON输出
 * - 简单评分任务
 * - 格式化提取任务
 * - 重复性模式识别
 *
 * Pro保留场景：
 * - 关键词生成（复杂语义理解）
 * - 复杂分析（评论、竞品、LaunchScore）
 * - 创意生成主流程
 */
const FLASH_OPERATIONS = new Set<string>([
  // 🟢 简单评分任务 - Flash
  'creative_quality_scoring', // 输出单个数字，简单

  // 🟢 广告元素提取（4个函数）- Flash
  // 输出固定JSON格式：15个标题或4个描述
  'ad_headline_extraction_single',
  'ad_headline_extraction_store',
  'ad_description_extraction_single',
  'ad_description_extraction_store',

  // 🟢 标题描述增强提取（2个函数）- Flash
  // 输出固定JSON格式
  'headline_generation',
  'description_generation',

  // 🟢 否定关键词生成 - Flash
  // 简单的排除词列表
  'negative_keyword_generation',

  // 🟢 Admin优化建议 - Flash
  // 格式化的优化建议
  'admin_prompt_optimization',
])

const PRO_OPERATIONS = new Set<string>([
  // 🔴 关键词生成（2个）- Pro（复杂语义理解）
  'keyword_generation', // 必须保持maxOutputTokens
  'keyword_expansion',  // 必须保持maxOutputTokens

  // 🔴 复杂分析任务 - Pro
  'review_analysis',              // 深度情感和语义分析
  'competitor_analysis',          // 复杂的对比分析
  'launch_score_calculation',     // 多维度综合评估
  'ad_creative_generation_main',  // 核心创意生成

  // 🔴 Admin分析 - Pro
  'admin_performance_analysis',   // 复杂数据分析和洞察
  'admin_feedback_analysis',      // 多轮对话和深度分析
])

/**
 * 选择最优模型
 *
 * @param operationType - 操作类型（来自recordTokenUsage）
 * @param forceProForTesting - 强制使用Pro（用于A/B测试）
 * @returns 模型选择结果
 */
export function selectOptimalModel(
  operationType: string,
  forceProForTesting: boolean = false
): ModelSelection {
  // A/B测试期间：强制使用Pro作为对照组
  if (forceProForTesting) {
    return {
      model: 'gemini-2.5-pro',
      reason: 'A/B测试对照组',
      testingRequired: true,
    }
  }

  // Flash适用场景
  if (FLASH_OPERATIONS.has(operationType)) {
    return {
      model: 'gemini-2.5-flash',
      reason: '结构化输出任务，Flash已通过A/B测试验证',
      testingRequired: false, // 生产环境已验证
    }
  }

  // Pro保留场景
  if (PRO_OPERATIONS.has(operationType)) {
    return {
      model: 'gemini-2.5-pro',
      reason: '复杂分析任务或关键词生成，必须使用Pro',
      testingRequired: false,
    }
  }

  // 未知operationType：默认Pro（安全第一）
  console.warn(`Unknown operationType: ${operationType}, defaulting to Pro`)
  return {
    model: 'gemini-2.5-pro',
    reason: '未知操作类型，默认Pro确保质量',
    testingRequired: false,
  }
}

/**
 * 获取Flash适用的操作列表（用于文档和监控）
 */
export function getFlashOperations(): string[] {
  return Array.from(FLASH_OPERATIONS)
}

/**
 * 获取Pro保留的操作列表（用于文档和监控）
 */
export function getProOperations(): string[] {
  return Array.from(PRO_OPERATIONS)
}

/**
 * 检查操作类型是否可以使用Flash
 */
export function canUseFlash(operationType: string): boolean {
  return FLASH_OPERATIONS.has(operationType)
}

/**
 * A/B测试配置
 */
export interface ABTestConfig {
  enabled: boolean
  operationType: string
  flashPercentage: number // 0-100, Flash流量百分比
}

/**
 * 判断当前请求是否应使用Flash（灰度发布）
 *
 * @param operationType - 操作类型
 * @param userId - 用户ID（用于流量分割）
 * @param config - A/B测试配置
 * @returns 是否使用Flash
 */
export function shouldUseFlashForABTest(
  operationType: string,
  userId: number,
  config: ABTestConfig
): boolean {
  if (!config.enabled || config.operationType !== operationType) {
    return false
  }

  // 基于用户ID的稳定哈希分流
  const hash = userId % 100
  return hash < config.flashPercentage
}

/**
 * 获取模型成本倍数（相对于Flash）
 */
export function getModelCostMultiplier(model: ModelType): number {
  return model === 'gemini-2.5-pro' ? 5.0 : 1.0
}
