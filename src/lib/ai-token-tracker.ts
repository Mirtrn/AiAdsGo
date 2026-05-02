/**
 * AI Token使用统计工具
 * 用于记录AI模型调用的token使用情况到数据库
 */

import { getDatabase } from './db'

/**
 * Token使用记录参数
 */
export interface RecordTokenUsageParams {
  userId: number
  model: string
  operationType: string // 例如: 'product_analysis', 'ad_creative_generation', 'brand_extraction'
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  apiType: 'direct-api' | 'litellm'
}

/**
 * 记录AI token使用到数据库
 *
 * @param params - Token使用参数
 * @returns Promise<void>
 */
export async function recordTokenUsage(params: RecordTokenUsageParams): Promise<void> {
  const {
    userId,
    model,
    operationType,
    inputTokens,
    outputTokens,
    totalTokens,
    cost,
    apiType
  } = params

  try {
    const db = await getDatabase()
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD格式

    await db.exec(
      `INSERT INTO ai_token_usage (
        user_id,
        model,
        operation_type,
        input_tokens,
        output_tokens,
        total_tokens,
        cost,
        api_type,
        date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, model, operationType, inputTokens, outputTokens, totalTokens, cost, apiType, today]
    )

    console.log(`✓ Token使用已记录: user=${userId}, model=${model}, tokens=${totalTokens}, cost=¥${cost.toFixed(4)}`)
  } catch (error) {
    console.error('记录token使用失败:', error)
    // 不抛出错误，避免影响主业务流程
  }
}

/**
 * 估算token成本（基于Google AI定价）
 *
 * Gemini定价（参考2024年标准）：
 * - Gemini 2.5 Pro:
 *   - Input: $0.00125 per 1K tokens
 *   - Output: $0.005 per 1K tokens
 * - Gemini 2.5 Flash:
 *   - Input: $0.000075 per 1K tokens
 *   - Output: $0.0003 per 1K tokens
 *
 * @param model - 模型名称
 * @param inputTokens - 输入token数
 * @param outputTokens - 输出token数
 * @returns 估算成本（美元）
 */
export function estimateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // 根据模型确定定价（美元 / 1K tokens）
  let inputCostPer1K: number
  let outputCostPer1K: number

  // ─── OpenAI 定价 ──────────────────────────────────────────────
  if (model.startsWith('gpt-4o-mini') || model.startsWith('gpt-4.1-mini')) {
    inputCostPer1K = 0.00015
    outputCostPer1K = 0.0006
  } else if (model.startsWith('gpt-4o') || model.startsWith('gpt-4.1')) {
    inputCostPer1K = 0.0025
    outputCostPer1K = 0.01
  } else if (model.startsWith('o3') || model.startsWith('o4')) {
    inputCostPer1K = 0.01
    outputCostPer1K = 0.04
  // ─── Anthropic 定价 ───────────────────────────────────────────
  } else if (model.includes('haiku')) {
    inputCostPer1K = 0.00025
    outputCostPer1K = 0.00125
  } else if (model.includes('sonnet')) {
    inputCostPer1K = 0.003
    outputCostPer1K = 0.015
  } else if (model.includes('opus')) {
    inputCostPer1K = 0.015
    outputCostPer1K = 0.075
  // ─── Gemini 定价 ──────────────────────────────────────────────
  } else if (model.includes('flash')) {
    inputCostPer1K = 0.000075
    outputCostPer1K = 0.0003
  } else if (model.includes('pro')) {
    inputCostPer1K = 0.00125
    outputCostPer1K = 0.005
  } else {
    // 默认使用 Pro 定价（保守估计）
    inputCostPer1K = 0.00125
    outputCostPer1K = 0.005
  }

  // 计算成本（美元）
  const inputCost = (inputTokens / 1000) * inputCostPer1K
  const outputCost = (outputTokens / 1000) * outputCostPer1K
  const totalCost = inputCost + outputCost

  // 转换为人民币（假设汇率1美元=7.2人民币）
  const costInCNY = totalCost * 7.2

  return costInCNY
}
