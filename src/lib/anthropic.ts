/**
 * Anthropic Claude 官方 API 适配器
 *
 * 职责：封装 Anthropic Messages API，输出格式与 GeminiGenerateResult 保持一致
 * 支持模型：claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5, claude-3-7-sonnet-20250219
 */

import { getUserOnlySetting } from './settings'
import { normalizeAnthropicModel, type AnthropicModel } from './gemini-models'

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_API_VERSION = '2023-06-01'
const DEFAULT_TIMEOUT_MS = 120_000

export interface AnthropicGenerateParams {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  operationType?: string
}

export interface AnthropicGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
  apiType: 'anthropic'
}

/**
 * 检查用户是否配置了 Anthropic API Key
 */
export async function isAnthropicConfigured(userId: number): Promise<boolean> {
  try {
    const apiKeySetting = await getUserOnlySetting('ai', 'anthropic_api_key', userId)
    return !!apiKeySetting?.value?.trim()
  } catch {
    return false
  }
}

/**
 * 调用 Anthropic Messages API
 */
export async function generateContent(
  params: AnthropicGenerateParams,
  userId: number
): Promise<AnthropicGenerateResult> {
  if (!userId || userId <= 0) {
    throw new Error('Anthropic 调用失败：缺少有效的用户 ID')
  }

  const {
    model: requestedModel,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    operationType,
  } = params

  // 读取用户 API Key 和模型
  const [apiKeySetting, modelSetting] = await Promise.all([
    getUserOnlySetting('ai', 'anthropic_api_key', userId),
    getUserOnlySetting('ai', 'anthropic_model', userId),
  ])

  const apiKey = apiKeySetting?.value?.trim()
  if (!apiKey) {
    throw new Error(
      `用户(ID=${userId})未配置 Anthropic API Key。请在设置页面配置您的 Anthropic API Key（sk-ant-...）。`
    )
  }

  // 优先使用调用时传入的模型，否则用用户保存的模型，最后兜底默认
  const finalModel: AnthropicModel = normalizeAnthropicModel(
    requestedModel || modelSetting?.value
  )

  console.log(`🤖 Anthropic 调用 (User ${userId}): ${operationType || 'unknown'} → ${finalModel}`)

  const requestBody = {
    model: finalModel,
    max_tokens: maxOutputTokens,
    temperature,
    messages: [
      { role: 'user', content: prompt },
    ],
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
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
      `Anthropic API 请求失败 (${response.status}): ${errorText.substring(0, 300)}`
    )
  }

  const data = await response.json()

  // Anthropic 返回格式：content 是数组，取第一个 text 块
  const text: string = data.content
    ?.find((block: any) => block.type === 'text')
    ?.text || ''

  if (!text) {
    throw new Error('Anthropic 返回了空内容')
  }

  const inputTokens = data.usage?.input_tokens ?? 0
  const outputTokens = data.usage?.output_tokens ?? 0
  const usage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  }

  const returnedModel: string = data.model || finalModel

  console.log(
    `✅ Anthropic 完成 (User ${userId}): ${operationType || 'unknown'} ` +
    `→ ${returnedModel}, tokens=${usage.totalTokens}`
  )

  return {
    text,
    usage,
    model: returnedModel,
    apiType: 'anthropic',
  }
}

/**
 * 检查 Anthropic 连接状态（ping）
 *
 * @param userId  用户 ID（从 DB 读取 API Key）
 * @param apiKey  可选，直接指定 API Key（用于验证时尚未保存到 DB 的场景）
 */
export async function checkAnthropicConnection(userId: number, apiKey?: string): Promise<boolean> {
  try {
    if (apiKey) {
      // 直接用指定 key 做一次最小请求
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const resp = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }],
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
    console.error(`用户(ID=${userId})的 Anthropic 连接检查失败:`, error)
    return false
  }
}
