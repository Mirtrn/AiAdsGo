/**
 * New-API / LiteLLM Gateway 适配器
 *
 * 职责：封装 New-API（openllmapi.com）的 OpenAI 兼容 API，输出格式与 GeminiGenerateResult 保持一致
 * 后端：calciumion/new-api + OpenRouter，支持 Kimi/DeepSeek/GPT/Claude/Gemini/Llama/Qwen 全系模型
 *
 * New-API 暴露标准 OpenAI Chat Completions 格式（/v1/chat/completions），只需替换 base_url + api_key
 */

import { getUserOnlySetting } from './settings'
import { normalizeLiteLLMModel, LITELLM_DEFAULT_BASE_URL, LITELLM_DEFAULT_MODEL, type LiteLLMModel } from './gemini-models'

const DEFAULT_TIMEOUT_MS = 80_000 // 必须 < Cloudflare 100s 超时，避免 Cloudflare 520

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
 * 
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

  // ─── 检测是否需要强制 stream 模式 ───────────────────────────────
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const requiresStream = errorText.includes('Stream must be set to true')

    if (requiresStream) {
      // 自动重试为流式请求，对调用方透明
      console.log(`🔄 LiteLLM (User ${userId}): 模型 ${finalModel} 要求 stream 模式，自动切换重试`)
      return generateContentStreaming(
        { ...params, model: finalModel },
        userId,
        apiKey,
        endpoint,
        timeoutMs
      )
    }

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
 * 流式请求辅助：当网关要求 stream=true 时调用，将 SSE chunks 拼合为完整文本后返回。
 * 对调用方与非流式接口完全透明。
 */
async function generateContentStreaming(
  params: LiteLLMGenerateParams & { model: string },
  userId: number,
  apiKey: string,
  endpoint: string,
  timeoutMs: number
): Promise<LiteLLMGenerateResult> {
  const { model, prompt, temperature = 0.7, maxOutputTokens = 8192, operationType } = params

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
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        temperature,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`LiteLLM 流式请求失败 (${response.status}): ${errorText.substring(0, 300)}`)
  }

  // 读取 SSE 流，拼合 delta.content
  const reader = response.body?.getReader()
  if (!reader) throw new Error('LiteLLM 流式响应无法读取（body 为空）')

  const decoder = new TextDecoder()
  let fullText = ''
  let returnedModel = model
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const jsonStr = trimmed.slice(5).trim()
        if (jsonStr === '[DONE]') break
        try {
          const parsed = JSON.parse(jsonStr)
          // 累积文本
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) fullText += delta
          // 捕获模型名
          if (parsed.model) returnedModel = parsed.model
          // 最后一个 chunk 携带 usage
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0
            outputTokens = parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0
            totalTokens = parsed.usage.total_tokens ?? (inputTokens + outputTokens)
          }
        } catch {
          // 忽略无法解析的 SSE 行
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!fullText.trim()) {
    throw new Error(
      `LiteLLM 流式模型 ${model} 返回了空内容。请尝试切换其他模型或检查网关配置。`
    )
  }

  console.log(
    `✅ LiteLLM 流式完成 (User ${userId}): ${operationType || 'unknown'} ` +
    `→ ${returnedModel}, tokens=${totalTokens}`
  )

  return {
    text: fullText,
    usage: { inputTokens, outputTokens, totalTokens },
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
        // 只有 2xx 才视为连接成功
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          // 若网关要求 stream 模式，改用流式 ping 重试
          if (errText.includes('Stream must be set to true')) {
            console.log(`🔄 LiteLLM 连接检测：模型 ${testModel} 要求 stream 模式，重试流式 ping`)
            const ctrl2 = new AbortController()
            const t2 = setTimeout(() => ctrl2.abort(), 20_000)
            try {
              const resp2 = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model: testModel,
                  max_tokens: 5,
                  stream: true,
                  messages: [{ role: 'user', content: 'Hi' }],
                }),
                signal: ctrl2.signal,
              })
              return resp2.ok
            } finally {
              clearTimeout(t2)
            }
          }
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
