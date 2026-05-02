/**
 * 🔥 创意生成器 AI 调用模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 与 AI 模型交互、调用、解析、错误处理
 * 遵循 KISS 原则: 单一职责，清晰的错误处理
 */

import type { AIConfig, AIResponse, GenerateAdCreativeOptions } from './creative-types'
import { generateContent } from '../gemini'
import { resolveActiveAIConfig } from '../ai-runtime-config'
import { recordTokenUsage, estimateTokenCost } from '../ai-token-tracker'

/**
 * 获取 AI 配置
 * 支持 gemini / litellm 两种提供商
 */
export async function getAIConfig(userId?: number): Promise<AIConfig> {
  if (!userId || userId <= 0) {
    return { type: null }
  }

  const resolved = await resolveActiveAIConfig(userId)

  if (resolved.type === 'litellm') {
    return { type: 'litellm' }
  }

  return { type: null }
}

/**
 * 调用 AI 模型
 * 统一的 AI 调用接口
 */
export async function callAI(prompt: string, config: AIConfig, userId?: number, overrideProvider?: 'litellm'): Promise<AIResponse> {
  try {
    console.log('[callAI] 开始调用 AI 模型', overrideProvider ? `(临时覆盖 provider: ${overrideProvider})` : '')

    if (!userId || userId <= 0) {
      throw new Error('缺少有效 userId，无法执行用户级 AI 调用')
    }

    // 使用统一入口，模型由用户当前配置决定
    const response = await generateContent({
      operationType: 'ad_creative_generation_main',
      prompt,
      temperature: 0.7,  // 🔧 从0.9降到0.7：减少输出不稳定性
      maxOutputTokens: 32768,  // 保持较高值以防截断
      overrideProvider,
    }, userId)

    // 🔧 修复：实际记录 token 使用，不再注释掉
    if (response.usage) {
      const cost = estimateTokenCost(
        response.model,
        response.usage.inputTokens,
        response.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: response.model,
        operationType: 'ad_creative_generation',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        cost,
        apiType: response.apiType as 'direct-api' | 'litellm',
      }).catch((err) => {
        console.warn('[callAI] token 记录失败（不影响主流程）:', err?.message)
      })
    }

    console.log('[callAI] AI 调用成功')

    return {
      success: true,
      data: response,
      model: response.model,
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
 * 将 AI 返回的 GeminiGenerateResult 转换为广告创意数据格式
 *
 * 🔧 修复：原存根实现访问了不存在的 candidates 字段，且 descriptions 硬编码为空。
 *   正确做法：读取 response.text（GeminiGenerateResult 的实际字段），
 *   然后解析 JSON，提取 headlines / descriptions / callouts / sitelinks / keywords 等字段。
 */
export async function parseAIResponse(
  response: any,
  options: GenerateAdCreativeOptions
): Promise<any> {
  try {
    console.log('[parseAIResponse] 开始解析 AI 响应')

    // response 是 GeminiGenerateResult，实际内容在 response.text
    const rawText: string = typeof response?.text === 'string'
      ? response.text
      : (typeof response === 'string' ? response : '')

    if (!rawText) {
      throw new Error('AI 响应为空')
    }

    // 移除 markdown 代码块标记，提取 JSON 内容
    let jsonText = rawText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()

    // 找到 JSON 对象的起止位置
    const jsonStart = jsonText.indexOf('{')
    const jsonEnd = jsonText.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error('AI 响应中未找到有效的 JSON 对象')
    }
    jsonText = jsonText.substring(jsonStart, jsonEnd + 1)

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch (parseErr: any) {
      // 尝试修复尾部多余逗号后再解析
      const fixed = jsonText.replace(/,\s*([}\]])/g, '$1')
      parsed = JSON.parse(fixed)
    }

    const ensureStringArray = (val: any): string[] => {
      if (!val) return []
      if (Array.isArray(val)) return val.map(String)
      if (typeof val === 'string') return val.split('\n').filter(Boolean)
      return []
    }

    const result = {
      headlines: ensureStringArray(parsed.headlines),
      descriptions: ensureStringArray(parsed.descriptions),
      callouts: ensureStringArray(parsed.callouts),
      sitelinks: Array.isArray(parsed.sitelinks) ? parsed.sitelinks : [],
      keywords: ensureStringArray(parsed.keywords),
      theme: parsed.theme || parsed.adTheme || '',
      explanation: parsed.explanation || parsed.reasoning || '',
    }

    console.log(
      `[parseAIResponse] 解析成功: headlines=${result.headlines.length}, descriptions=${result.descriptions.length}`
    )

    return result
  } catch (error: any) {
    console.error('[parseAIResponse] 解析失败:', error)
    throw new Error(`AI 响应解析失败: ${error.message}`)
  }
}

/**
 * AI 错误处理
 * 根据错误类型决定是否重试
 *
 * 🔧 修复：原实现永远返回 retryable: false，导致重试逻辑完全无效。
 *   现在根据常见可重试的错误类型（网络超时、速率限制、服务器错误）判断。
 */
function handleAIError(error: any): { retryable: boolean; message: string } {
  const message: string = typeof error === 'string'
    ? error
    : (error?.message || '未知错误')

  const lower = message.toLowerCase()

  // 可重试的错误模式
  const isRetryable =
    lower.includes('timeout') ||
    lower.includes('超时') ||
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('500') ||
    lower.includes('service unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed') ||
    lower.includes('aborted')

  return {
    retryable: isRetryable,
    message,
  }
}

/**
 * 重试逻辑
 * 可重试的错误自动重试
 */
export async function callAIWithRetry(
  prompt: string,
  config: AIConfig,
  maxRetries: number = 3,
  userId?: number
): Promise<AIResponse> {
  let lastError: any

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await callAI(prompt, config, userId)

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
