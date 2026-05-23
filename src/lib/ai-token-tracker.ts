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
 * 估算 token 成本（基于各提供商定价，仅供记账参考）
 *
 * 支持三渠道模型定价：
 *
 * OpenAI 官方（api.openai.com）：
 *  - GPT-5.5（旗舰推理）：$0.015/$0.06 per 1K tokens
 *  - GPT-5.4（高性能）：  $0.005/$0.02 per 1K tokens
 *  - GPT-5.4-mini/Codex： $0.00015/$0.0006 per 1K tokens
 *
 * Google Gemini 官方（generativelanguage.googleapis.com）：
 *  - Gemini 3.x Pro：  $0.00125/$0.005 per 1K tokens（参考 2.5 Pro 定价）
 *  - Gemini 3.x Flash：$0.000075/$0.0003 per 1K tokens（参考 2.5 Flash 定价）
 *
 * OpenLLM 中转（openllmapi.com）：
 *  - 按实际转发模型计费（同上方各提供商定价）
 *  - 中转附加费用已忽略（成本估算为近似值）
 *
 * @param model - 模型名称（来自 API 返回的 data.model 字段）
 * @param inputTokens - 输入 token 数
 * @param outputTokens - 输出 token 数
 * @returns 估算成本（人民币 CNY，按 1USD=7.2CNY 换算）
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
  // GPT-5 系列（2025/2026）
  if (model.startsWith('gpt-5.5')) {
    // GPT-5.5 旗舰推理模型，参考 OpenAI 最新定价
    inputCostPer1K = 0.015
    outputCostPer1K = 0.06
  } else if (model.startsWith('gpt-5.4-mini') || model.startsWith('gpt-5.3-codex')) {
    // GPT-5.4 Mini / Codex 轻量版
    inputCostPer1K = 0.00015
    outputCostPer1K = 0.0006
  } else if (model.startsWith('gpt-5.4') || model.startsWith('gpt-5')) {
    // GPT-5.4 及其他 GPT-5 系列（高性能）
    inputCostPer1K = 0.005
    outputCostPer1K = 0.02
  } else if (model.startsWith('gpt-4o-mini') || model.startsWith('gpt-4.1-mini')) {
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
