/**
 * OpenAI 官方 API 适配器
 *
 * 职责：封装 OpenAI Chat Completions API，输出格式与 GeminiGenerateResult 保持一致
 * 支持模型：gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, o3, o4-mini
 */

import { getUserOnlySetting } from './settings'
import { normalizeOpenAIModel, type OpenAIModel } from './gemini-models'

const OPENAI_API_BASE = 'https://api.openai.com/v1'
const DEFAULT_TIMEOUT_MS = 120_000

export interface OpenAIGenerateParams {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  operationType?: string
  /** 若为 'json'，在请求中启用 response_format: { type: 'json_object' } */
  responseFormat?: 'json'
}

export interface OpenAIGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
  apiType: 'openai'
}

/**
 * 检查用户是否配置了 OpenAI API Key
 */
export async function isOpenAIConfigured(userId: number): Promise<boolean> {
  try {
    const apiKeySetting = await getUserOnlySetting('ai', 'openai_api_key', userId)
    return !!apiKeySetting?.value?.trim()
  } catch {
    return false
  }
}

/**
 * 调用 OpenAI Chat Completions API
 */
export async function generateContent(
  params: OpenAIGenerateParams,
  userId: number
): Promise<OpenAIGenerateResult> {
  if (!userId || userId <= 0) {
    throw new Error('OpenAI 调用失败：缺少有效的用户 ID')
  }

  const {
    model: requestedModel,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    operationType,
    responseFormat,
  } = params

  // 读取用户 API Key 和模型
  const [apiKeySetting, modelSetting] = await Promise.all([
    getUserOnlySetting('ai', 'openai_api_key', userId),
    getUserOnlySetting('ai', 'openai_model', userId),
  ])

  const apiKey = apiKeySetting?.value?.trim()
  if (!apiKey) {
    throw new Error(
      `用户(ID=${userId})未配置 OpenAI API Key。请在设置页面配置您的 OpenAI API Key。`
    )
  }

  // 优先使用调用时传入的模型，否则用用户保存的模型，最后兜底默认
  const finalModel: OpenAIModel = normalizeOpenAIModel(
    requestedModel || modelSetting?.value
  )

  console.log(`🤖 OpenAI 调用 (User ${userId}): ${operationType || 'unknown'} → ${finalModel}`)

  const requestBody: Record<string, unknown> = {
    model: finalModel,
    messages: [
      { role: 'user', content: prompt },
    ],
    temperature,
    max_completion_tokens: maxOutputTokens,
    // 🆕 启用 JSON 模式（更稳定的结构化输出）
    ...(responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `OpenAI API 请求失败 (${response.status}): ${errorText.substring(0, 300)}`
    )
  }

  const data = await response.json()

  const text: string = data.choices?.[0]?.message?.content || ''
  if (!text) {
    throw new Error('OpenAI 返回了空内容')
  }

  const usage = data.usage
    ? {
        inputTokens: data.usage.prompt_tokens ?? 0,
        outputTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      }
    : undefined

  const returnedModel: string = data.model || finalModel

  console.log(
    `✅ OpenAI 完成 (User ${userId}): ${operationType || 'unknown'} ` +
    `→ ${returnedModel}, tokens=${usage?.totalTokens ?? 'N/A'}`
  )

  return {
    text,
    usage,
    model: returnedModel,
    apiType: 'openai',
  }
}

/**
 * 检查 OpenAI 连接状态（ping）
 *
 * @param userId  用户 ID（从 DB 读取 API Key）
 * @param apiKey  可选，直接指定 API Key（用于验证时尚未保存到 DB 的场景）
 */
export async function checkOpenAIConnection(userId: number, apiKey?: string): Promise<boolean> {
  try {
    if (apiKey) {
      // 直接用指定 key 做一次最小请求
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const resp = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
          }),
          signal: controller.signal,
        })
        return resp.ok || resp.status === 400 // 400 表示请求格式问题，但 key 有效
      } finally {
        clearTimeout(timer)
      }
    }
    await generateContent(
      { prompt: 'Hello', maxOutputTokens: 10, operationType: 'connection_test' },
      userId
    )
    return true
  } catch (error) {
    console.error(`用户(ID=${userId})的 OpenAI 连接检查失败:`, error)
    return false
  }
}
