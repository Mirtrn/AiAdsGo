/**
 * LiteLLM Gateway 适配器
 *
 * 职责：封装 LiteLLM Gateway 的 OpenAI 兼容 API，输出格式与 GeminiGenerateResult 保持一致
 * 支持模型：gemma4-26b, qwen-coder-32b, qwen3.5-27b, mistral-small-24b
 *
 * LiteLLM 暴露标准 OpenAI Chat Completions 格式，只需替换 base_url + api_key
 */

import { getUserOnlySetting } from './settings'
import { normalizeLiteLLMModel, LITELLM_DEFAULT_BASE_URL, LITELLM_DEFAULT_MODEL, type LiteLLMModel } from './gemini-models'

const DEFAULT_TIMEOUT_MS = 180_000 // LiteLLM 模型响应较慢，给 3 分钟超时

export interface LiteLLMGenerateParams {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  operationType?: string
}

export interface LiteLLMGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
  apiType: 'litellm'
}

/**
 * 检查用户是否配置了 LiteLLM API Key
 */
export async function isLiteLLMConfigured(userId: number): Promise<boolean> {
  try {
    const apiKeySetting = await getUserOnlySetting('ai', 'litellm_api_key', userId)
    return !!apiKeySetting?.value?.trim()
  } catch {
    return false
  }
}

/**
 * 调用 LiteLLM Gateway（OpenAI 兼容格式）
 */
export async function generateContent(
  params: LiteLLMGenerateParams,
  userId: number
): Promise<LiteLLMGenerateResult> {
  if (!userId || userId <= 0) {
    throw new Error('LiteLLM 调用失败：缺少有效的用户 ID')
  }

  const {
    model: requestedModel,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    operationType,
  } = params

  // 读取用户配置（base_url 固定为 openllmapi.com，不允许自定义）
  const [apiKeySetting, modelSetting] = await Promise.all([
    getUserOnlySetting('ai', 'litellm_api_key', userId),
    getUserOnlySetting('ai', 'litellm_model', userId),
  ])

  const apiKey = apiKeySetting?.value?.trim()
  if (!apiKey) {
    throw new Error(
      `用户(ID=${userId})未配置 LiteLLM API Key。请在设置页面配置您的 LiteLLM Gateway API Key。`
    )
  }

  // base_url 固定为官方网关，不允许用户自定义
  const baseUrl = LITELLM_DEFAULT_BASE_URL
  const endpoint = `${baseUrl}/v1/chat/completions`

  // 优先使用调用时传入的模型，否则用用户保存的，最后兜底默认
  const finalModel: LiteLLMModel = normalizeLiteLLMModel(
    requestedModel || modelSetting?.value
  )

  console.log(`🤖 LiteLLM 调用 (User ${userId}): ${operationType || 'unknown'} → ${finalModel} @ ${baseUrl}`)

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
    response = await fetch(endpoint, {
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
    // 504/502 等网关错误可能返回 HTML 页面，直接展示 HTML 体验极差，改为友好提示
    const isHtmlResponse = errorText.trimStart().startsWith('<')
    let friendlyError: string
    if (response.status === 504 || response.status === 502) {
      friendlyError = `LiteLLM 网关超时 (${response.status})：请求超时，请稍后重试或检查网关服务状态。`
    } else if (isHtmlResponse) {
      friendlyError = `LiteLLM API 请求失败 (${response.status})：服务器返回了非预期响应，请检查网关地址和 API Key 配置。`
    } else {
      friendlyError = `LiteLLM API 请求失败 (${response.status}): ${errorText.substring(0, 300)}`
    }
    throw new Error(friendlyError)
  }

  const data = await response.json()

  // OpenAI 兼容格式：choices[0].message.content
  const text: string = data.choices?.[0]?.message?.content || ''

  if (!text || text.trim() === '') {
    throw new Error(
      `LiteLLM 模型 ${finalModel} 返回了空内容（finish_reason=${data.choices?.[0]?.finish_reason}）。` +
      `请尝试切换其他模型或检查网关配置。`
    )
  }

  const inputTokens = data.usage?.prompt_tokens ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0
  const usage = {
    inputTokens,
    outputTokens,
    totalTokens: data.usage?.total_tokens ?? (inputTokens + outputTokens),
  }

  const returnedModel: string = data.model || finalModel

  console.log(
    `✅ LiteLLM 完成 (User ${userId}): ${operationType || 'unknown'} ` +
    `→ ${returnedModel}, tokens=${usage.totalTokens}`
  )

  return {
    text,
    usage,
    model: returnedModel,
    apiType: 'litellm',
  }
}

/**
 * 检查 LiteLLM 连接状态（ping）
 *
 * @param userId  用户 ID（从 DB 读取配置）
 * @param apiKey  可选，直接指定 API Key（用于验证时尚未保存到 DB 的场景）
 * @param baseUrl 可选，直接指定网关地址
 */
export async function checkLiteLLMConnection(
  userId: number,
  apiKey?: string,
  baseUrl?: string,
  model?: string
): Promise<boolean> {
  try {
    if (apiKey) {
      const resolvedBase = (baseUrl || LITELLM_DEFAULT_BASE_URL).replace(/\/$/, '')
      const endpoint = `${resolvedBase}/v1/chat/completions`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      const testModel = model ? normalizeLiteLLMModel(model) : LITELLM_DEFAULT_MODEL
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: testModel,
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
          signal: controller.signal,
        })
        // 只有 2xx 才视为连接成功；400 表示服务端拒绝（模型未配置/路由缺失），不算成功
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          console.warn(`LiteLLM 验证失败 (${resp.status}) model=${testModel}: ${errText.substring(0, 200)}`)
          return false
        }
        return true
      } finally {
        clearTimeout(timer)
      }
    }

    // 用 userId 从 DB 读取配置做连接测试
    await generateContent(
      { prompt: 'Hello', maxOutputTokens: 10, operationType: 'connection_test' },
      userId
    )
    return true
  } catch (error) {
    console.error(`用户(ID=${userId})的 LiteLLM 连接检查失败:`, error)
    return false
  }
}
