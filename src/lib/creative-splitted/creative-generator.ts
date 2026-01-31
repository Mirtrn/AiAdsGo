/**
 * 🔥 创意生成器 AI 调用模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 与 AI 模型交互、调用、解析、错误处理
 * 遵循 KISS 原则: 单一职责，清晰的错误处理
 */

import type { AIConfig, AIResponse, GenerateAdCreativeOptions } from './creative-types'
import { getGeminiMode, generateContent } from '../gemini'
import { recordTokenUsage, estimateTokenCost } from '../ai-token-tracker'

/**
 * 获取 AI 配置
 * 从数据库读取用户或全局 AI 配置
 */
export async function getAIConfig(userId?: number): Promise<AIConfig> {
  // 这里应该从数据库读取配置
  // 为了简化，直接返回 Gemini 配置
  return {
    type: 'gemini-api',
    geminiAPI: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: 'gemini-pro'
    }
  }
}

/**
 * 调用 AI 模型
 * 统一的 AI 调用接口
 */
export async function callAI(prompt: string, config: AIConfig, userId?: number): Promise<AIResponse> {
  try {
    console.log('[callAI] 开始调用 AI 模型')

    // 使用 Gemini API - 正确的参数格式
    const model = config.geminiAPI?.model || 'gemini-pro'
    const response = await generateContent({
      operationType: 'ad_creative_generation_main',
      prompt,
      temperature: 0.9,
      maxOutputTokens: 24576
    }, userId || 0) // 提供默认值

    // TODO: 追踪 token 使用（需要根据实际 API 调整）
    // if (response.usageMetadata) {
    //   await recordTokenUsage({
    //     model,
    //     promptTokens: response.usageMetadata.promptTokenCount,
    //     completionTokens: response.usageMetadata.candidatesTokenCount,
    //     totalTokens: response.usageMetadata.totalTokenCount,
    //     estimatedCost: estimateTokenCost(model, response.usageMetadata.totalTokenCount)
    //   })
    // }

    console.log('[callAI] AI 调用成功')

    return {
      success: true,
      data: response,
      model
    }
  } catch (error: any) {
    console.error('[callAI] AI 调用失败:', error)

    return {
      success: false,
      error: error.message || '未知错误'
    }
  }
}

/**
 * 解析 AI 响应
 * 将 AI 返回的数据转换为创意格式
 */
export async function parseAIResponse(
  response: any,
  options: GenerateAdCreativeOptions
): Promise<any> {
  try {
    console.log('[parseAIResponse] 开始解析 AI 响应')

    // 假设 AI 返回的是结构化数据
    // 实际实现需要根据具体的 AI 响应格式调整

    const result = {
      headlines: response.candidates?.[0]?.content?.parts?.[0]?.text || '',
      descriptions: '',
      // 其他字段...
    }

    console.log('[parseAIResponse] 解析成功')

    return result
  } catch (error: any) {
    console.error('[parseAIResponse] 解析失败:', error)
    throw new Error(`AI 响应解析失败: ${error.message}`)
  }
}

/**
 * AI 错误处理
 * 根据错误类型决定是否重试
 */
function handleAIError(error: any): { retryable: boolean; message: string } {
  // TODO: 根据具体错误类型判断是否可重试
  return {
    retryable: false,
    message: error.message || '未知错误'
  }
}

/**
 * 重试逻辑
 * 可重试的错误自动重试
 */
export async function callAIWithRetry(
  prompt: string,
  config: AIConfig,
  maxRetries: number = 3
): Promise<AIResponse> {
  let lastError: any

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await callAI(prompt, config)

      if (response.success) {
        return response
      }

      lastError = response.error

      // 检查是否可重试
      const { retryable } = handleAIError(lastError)
      if (!retryable) {
        break
      }

      console.log(`[callAIWithRetry] 第 ${attempt} 次尝试失败，2秒后重试...`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error: any) {
      lastError = error
      console.error(`[callAIWithRetry] 第 ${attempt} 次尝试异常:`, error)
    }
  }

  return {
    success: false,
    error: lastError?.message || '所有重试均失败'
  }
}
