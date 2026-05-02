/**
 * 统一的 AI 调用入口（仅 OpenLLM/LiteLLM）
 *
 * 重要：
 * - 只使用用户级配置，不回退全局
 * - AI API 调用不使用代理（代理仅用于网页爬取）
 */

import { getUserOnlySetting } from './settings'

/**
 * JSON Schema类型定义（符合OpenAPI 3.0规范）
 */
export interface ResponseSchema {
  type?: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT'
  format?: string
  description?: string
  nullable?: boolean
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  items?: ResponseSchema
  enum?: string[]
  properties?: {
    [key: string]: ResponseSchema
  }
  required?: string[]
  example?: unknown
}

/**
 * Gemini生成内容的参数接口
 */
export interface GeminiGenerateParams {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  operationType?: string
  enableAutoModelSelection?: boolean
  responseSchema?: ResponseSchema
  responseMimeType?: string
}

/**
 * Gemini生成内容的返回结果接口
 */
export interface GeminiGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
  apiType: 'direct-api'
}

/**
 * 统一的 AI 内容生成接口（仅 OpenLLM/LiteLLM）
 */
export async function generateContent(
  params: GeminiGenerateParams & { overrideProvider?: 'litellm' },
  userId: number
): Promise<GeminiGenerateResult> {
  if (!userId || typeof userId !== 'number' || userId <= 0) {
    throw new Error('AI调用失败：缺少有效的用户ID。每个AI操作必须关联到具体用户。')
  }

  const {
    model: requestedModel,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    timeoutMs,
    operationType,
  } = params

  console.log(`🔀 路由到 OpenLLM (User ${userId})`)
  const { generateContent: litellmGenerate } = await import('./litellm')
  const result = await litellmGenerate(
    { prompt, temperature, maxOutputTokens, timeoutMs, operationType, model: requestedModel },
    userId
  )
  return {
    text: result.text,
    usage: result.usage,
    model: result.model,
    apiType: 'direct-api' as const,
  }
}

/**
 * 检查用户的 AI 连接状态（使用 OpenLLM）
 */
export async function checkGeminiConnection(userId: number): Promise<boolean> {
  try {
    await generateContent(
      {
        prompt: 'Hello',
        maxOutputTokens: 10,
      },
      userId
    )
    return true
  } catch (error) {
    console.error(`用户(ID=${userId})的AI连接检查失败:`, error)
    return false
  }
}

/**
 * 获取用户当前 AI 模式（始终返回 direct-api，因为只支持 OpenLLM）
 */
export async function getGeminiMode(userId: number): Promise<'direct-api' | 'none'> {
  const { isLiteLLMConfigured } = await import('./litellm')
  if (await isLiteLLMConfigured(userId)) {
    return 'direct-api'
  }
  return 'none'
}
