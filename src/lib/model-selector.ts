/**
 * 智能模型选择器（V2：支持用户Pro模型选择）
 *
 * 核心原则：
 * 1. 用户在/settings选择的"Gemini模型"决定Pro任务使用哪个高质量模型
 * 2. Flash任务始终使用gemini-2.5-flash（不受用户选择影响）
 * 3. 根据operationType智能路由到Pro或Flash
 *
 * 用户选择逻辑（仅影响Pro任务）：
 * - 用户选"Gemini 2.5 Pro"        → Pro任务用2.5-pro, Flash任务用2.5-flash
 * - 用户选"Gemini 3 Pro Preview"  → Pro任务用3-pro-preview, Flash任务用2.5-flash
 *
 * 注意：移除了"Gemini 2.5 Flash"选项（全Flash模式会降低广告创意质量）
 *
 * 必须通过A/B测试验证Flash质量 ≥ 85%相似度
 */

import { getUserOnlySetting } from './settings'

// 支持的Gemini Pro模型（Flash任务固定使用gemini-2.5-flash）
export type ModelType =
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gemini-3-pro-preview'

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

  // 🟢 否定关键词生成 - Flash
  // 简单的排除词列表
  'negative_keyword_generation',

  // 🟢 Admin优化建议 - Flash
  // 格式化的优化建议
  'admin_prompt_optimization',

  // 🟢 品牌名提取 - Flash
  // 简单的实体提取任务
  'brand_extraction',

  // 🟢 广告强度评估 - Flash
  // 结构化评分输出
  'ad_strength_evaluation',

  // 🟢 连接测试 - Flash
  // 简单的ping测试
  'connection_test',
])

const PRO_OPERATIONS = new Set<string>([
  // 🔴 关键词生成（2个）- Pro（复杂语义理解）
  'keyword_generation', // 必须保持maxOutputTokens
  'keyword_expansion',  // 必须保持maxOutputTokens

  // 🔴 复杂分析任务 - Pro
  'review_analysis',              // 深度情感和语义分析
  'competitor_analysis',          // 复杂的对比分析
  'competitor_summary',           // 🔴 竞品摘要 - 需要Pro模型准确理解和总结
  'launch_score_calculation',     // 多维度综合评估
  'ad_creative_generation_main',  // 核心创意生成
  'product_page_analysis',        // 产品页面深度分析

  // 🔴 创意生成任务 - Pro
  'headline_generation',          // 标题创意生成（需要准确性和创造力）
  'description_generation',       // 描述创意生成（需要准确性和创造力）

  // 🔴 Admin分析 - Pro
  'admin_performance_analysis',   // 复杂数据分析和洞察
  'admin_feedback_analysis',      // 多轮对话和深度分析
])

/**
 * 获取用户选择的Pro模型（仅影响Pro任务）
 *
 * @param userId - 用户ID
 * @returns 用户选择的Pro级别模型
 */
export async function getUserProModel(userId?: number): Promise<ModelType> {
  if (!userId) {
    return 'gemini-2.5-pro' // 默认Pro模型
  }

  try {
    const modelSetting = await getUserOnlySetting('ai', 'gemini_model', userId)
    const selectedModel = modelSetting?.value

    // 用户选择的模型决定Pro任务使用哪个模型
    if (selectedModel === 'gemini-3-pro-preview') {
      return 'gemini-3-pro-preview' // 使用最新预览版
    } else {
      return 'gemini-2.5-pro' // 默认Pro模型
    }
  } catch (error) {
    console.warn('⚠️ 获取用户Pro模型失败，使用默认:', error)
    return 'gemini-2.5-pro'
  }
}

/**
 * 选择最优模型（V2：支持用户Pro模型选择）
 *
 * @param operationType - 操作类型（来自recordTokenUsage）
 * @param userId - 用户ID（用于获取用户模型偏好）
 * @param forceProForTesting - 强制使用Pro（用于A/B测试）
 * @returns 模型选择结果
 */
export async function selectOptimalModel(
  operationType: string,
  userId?: number,
  forceProForTesting: boolean = false
): Promise<ModelSelection> {
  const userProModel = await getUserProModel(userId)

  // A/B测试期间：强制使用用户的Pro模型作为对照组
  if (forceProForTesting) {
    return {
      model: userProModel,
      reason: 'A/B测试对照组',
      testingRequired: true,
    }
  }

  // Flash适用场景：简单任务固定使用Flash（不受用户选择影响）
  if (FLASH_OPERATIONS.has(operationType)) {
    return {
      model: 'gemini-2.5-flash',
      reason: '结构化输出任务，使用Flash节省成本',
      testingRequired: false,
    }
  }

  // Pro保留场景：复杂任务使用用户选择的Pro模型
  if (PRO_OPERATIONS.has(operationType)) {
    return {
      model: userProModel,
      reason: `复杂分析任务，使用用户选择的Pro模型: ${userProModel}`,
      testingRequired: false,
    }
  }

  // 未知operationType：默认使用用户的Pro模型（安全第一）
  console.warn(`⚠️ Unknown operationType: ${operationType}, defaulting to user's Pro model: ${userProModel}`)
  return {
    model: userProModel,
    reason: '未知操作类型，使用用户Pro模型确保质量',
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
