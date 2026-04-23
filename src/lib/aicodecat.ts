/**
 * AiCodeCat Gateway 调用模块
 * - Claude/GPT/Codex 模型：OpenAI-compatible 协议 /v1/chat/completions
 * - Gemini 模型：Google 原生格式 /v1beta/models/{model}:generateContent
 * 注册链接: https://aicode.cat/register?ref=AIADSGO01
 */

import { getUserOnlySetting } from './settings'
import {
  AICODECAT_BASE_URL,
  AICODECAT_DEFAULT_MODEL,
  normalizeAiCodeCatModel,
  isAiCodeCatGeminiModel,
  type AiCodeCatModel,
} from './gemini-models'

const DEFAULT_TIMEOUT_MS = 60_000

export interface AiCodeCatGenerateParams {
  prompt: string
  model?: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  operationType?: string
}

export interface AiCodeCatGenerateResult {
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
  apiType: 'aicodecat'
}

export async function isAiCodeCatConfigured(userId: number): Promise<boolean> {
  try {
    const apiKeySetting = await getUserOnlySetting('ai', 'aicodecat_api_key', userId)
    return !!apiKeySetting?.value?.trim()
  } catch {
    return false
  }
}

// ─── 内部辅助：v1beta Gemini 原生格式调用 ──────────────────────────
async function callGeminiV1Beta(
  apiKey: string,
  model: string,
  prompt: string,
  maxOutputTokens: number,
  temperature: number,
  timeoutMs: number,
  signal: AbortSignal
): Promise<{ text: string; inputTokens: number; outputTokens: number; totalTokens: number; model: string }> {
  const endpoint = `${AICODECAT_BASE_URL}/v1beta/models/${model}:generateContent`
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens,
      temperature,
    },
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const isHtmlResponse = errorText.trimStart().startsWith('<')
    if (response.status === 504 || response.status === 502) {
      throw new Error(`AiCodeCat Gemini 网关超时 (${response.status})：请求超时，请稍后重试。`)
    } else if (isHtmlResponse) {
      throw new Error(`AiCodeCat Gemini API 请求失败 (${response.status})：服务器返回了非预期响应。`)
    } else {
      throw new Error(`AiCodeCat Gemini API 请求失败 (${response.status}): ${errorText.substring(0, 300)}`)
    }
  }

  const data = await response.json()

  // v1beta 响应格式：candidates[0].content.parts[0].text
  const parts = data.candidates?.[0]?.content?.parts as { text?: string; thoughtSignature?: string }[] | undefined
  const text: string = parts?.find(p => p.text != null)?.text || ''

  if (!text || text.trim() === '') {
    const finishReason = data.candidates?.[0]?.finishReason || 'unknown'
    throw new Error(
      `AiCodeCat Gemini 模型 ${model} 返回了空内容（finishReason=${finishReason}）。` +
      `请尝试切换其他模型或检查 API Key。`
    )
  }

  const usage = data.usageMetadata || {}
  const inputTokens: number = usage.promptTokenCount ?? 0
  const outputTokens: number = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
  const totalTokens: number = usage.totalTokenCount ?? (inputTokens + outputTokens)
  const returnedModel: string = data.modelVersion || model

  return { text, inputTokens, outputTokens, totalTokens, model: returnedModel }
}

// ─── 内部辅助：v1 OpenAI 格式调用（Claude / GPT）──────────────────
async function callV1ChatCompletions(
  apiKey: string,
  model: string,
  prompt: string,
  maxOutputTokens: number,
  temperature: number,
  signal: AbortSignal
): Promise<{ text: string; inputTokens: number; outputTokens: number; totalTokens: number; model: string }> {
  const endpoint = `${AICODECAT_BASE_URL}/v1/chat/completions`
  const requestBody = {
    model,
    max_tokens: maxOutputTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const isHtmlResponse = errorText.trimStart().startsWith('<')
    if (response.status === 504 || response.status === 502) {
      throw new Error(`AiCodeCat 网关超时 (${response.status})：请求超时，请稍后重试或检查网关服务状态。`)
    } else if (isHtmlResponse) {
      throw new Error(`AiCodeCat API 请求失败 (${response.status})：服务器返回了非预期响应，请检查网关地址和 API Key 配置。`)
    } else {
      throw new Error(`AiCodeCat API 请求失败 (${response.status}): ${errorText.substring(0, 300)}`)
    }
  }

  const data = await response.json()
  const text: string = data.choices?.[0]?.message?.content || ''

  if (!text || text.trim() === '') {
    throw new Error(
      `AiCodeCat 模型 ${model} 返回了空内容（finish_reason=${data.choices?.[0]?.finish_reason}）。` +
      `请尝试切换其他模型或检查 API Key。`
    )
  }

  const inputTokens: number = data.usage?.prompt_tokens ?? 0
  const outputTokens: number = data.usage?.completion_tokens ?? 0
  const totalTokens: number = data.usage?.total_tokens ?? (inputTokens + outputTokens)
  const returnedModel: string = data.model || model

  return { text, inputTokens, outputTokens, totalTokens, model: returnedModel }
}

export async function generateContent(
  params: AiCodeCatGenerateParams,
  userId: number
): Promise<AiCodeCatGenerateResult> {
  if (!userId || userId <= 0) {
    throw new Error('AiCodeCat 调用失败：缺少有效的用户 ID')
  }

  const {
    model: requestedModel,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    operationType,
  } = params

  const [apiKeySetting, modelSetting] = await Promise.all([
    getUserOnlySetting('ai', 'aicodecat_api_key', userId),
    getUserOnlySetting('ai', 'aicodecat_model', userId),
  ])

  const apiKey = apiKeySetting?.value?.trim()
  if (!apiKey) {
    throw new Error(
      `用户(ID=${userId})未配置 AiCodeCat API Key。请在设置页面配置您的 AiCodeCat API Key。`
    )
  }

  const finalModel: AiCodeCatModel = normalizeAiCodeCatModel(
    requestedModel || modelSetting?.value
  )

  const isGemini = isAiCodeCatGeminiModel(finalModel)
  console.log(
    `🐱 AiCodeCat 调用 (User ${userId}): ${operationType || 'unknown'} → ${finalModel} ` +
    `@ ${AICODECAT_BASE_URL} [${isGemini ? 'v1beta/Gemini原生' : 'v1/OpenAI格式'}]`
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let result: { text: string; inputTokens: number; outputTokens: number; totalTokens: number; model: string }

    if (isGemini) {
      result = await callGeminiV1Beta(apiKey, finalModel, prompt, maxOutputTokens, temperature, timeoutMs, controller.signal)
    } else {
      result = await callV1ChatCompletions(apiKey, finalModel, prompt, maxOutputTokens, temperature, controller.signal)
    }

    console.log(
      `✅ AiCodeCat 完成 (User ${userId}): ${operationType || 'unknown'} ` +
      `→ ${result.model}, tokens=${result.totalTokens}`
    )

    return {
      text: result.text,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
      },
      model: result.model,
      apiType: 'aicodecat',
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface AiCodeCatCheckResult {
  ok: boolean
  /** 失败原因描述，ok=false 时有值 */
  reason?: 'empty_content' | 'http_error' | 'parse_error' | 'network_error' | 'no_key'
  /** 供日志或 UI 展示的详细信息 */
  detail?: string
  /** 实际测试使用的模型 */
  model?: string
}

export async function checkAiCodeCatConnection(
  userId: number,
  apiKey?: string,
  baseUrl?: string,
  model?: string
): Promise<boolean> {
  const result = await checkAiCodeCatConnectionDetail(userId, apiKey, baseUrl, model)
  return result.ok
}

export async function checkAiCodeCatConnectionDetail(
  userId: number,
  apiKey?: string,
  _baseUrl?: string,
  model?: string
): Promise<AiCodeCatCheckResult> {
  try {
    const resolvedKey = apiKey || (await getUserOnlySetting('ai', 'aicodecat_api_key', userId))?.value
    if (!resolvedKey) {
      return { ok: false, reason: 'no_key', detail: '未配置 API Key' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const testModel = model ? normalizeAiCodeCatModel(model) : AICODECAT_DEFAULT_MODEL
    const isGemini = isAiCodeCatGeminiModel(testModel)

    try {
      if (isGemini) {
        // Gemini 走 v1beta
        const endpoint = `${AICODECAT_BASE_URL}/v1beta/models/${testModel}:generateContent`
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resolvedKey}`,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply OK' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
          signal: controller.signal,
        })
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          console.warn(`AiCodeCat Gemini 验证失败 (${resp.status}) model=${testModel}: ${errText.substring(0, 200)}`)
          // Key 分组与模型不匹配（Claude/GPT Key 用于 Gemini 模型）
          const isWrongKeyGroup = errText.includes('API key group platform is not gemini') ||
            errText.includes('not gemini')
          return {
            ok: false,
            reason: 'http_error',
            detail: isWrongKeyGroup
              ? `当前 API Key 不支持 Gemini 模型（Key 分组不匹配）。请在设置中换用 Gemini 专属 Key，或将模型切换为 Claude/GPT 系列后重试。`
              : `HTTP ${resp.status}：${errText.substring(0, 150)}`,
            model: testModel,
          }
        }
        let data: Record<string, unknown>
        try {
          data = await resp.json()
        } catch {
          return { ok: false, reason: 'parse_error', detail: '响应无法解析为 JSON', model: testModel }
        }
        const parts = (data.candidates as { content?: { parts?: { text?: string }[] } }[])?.[0]?.content?.parts
        const text: string = parts?.find(p => p.text != null)?.text || ''
        if (!text || text.trim() === '') {
          const finishReason = (data.candidates as { finishReason?: string }[])?.[0]?.finishReason || 'unknown'
          console.warn(`AiCodeCat Gemini 验证失败：model=${testModel} 返回了空内容（finishReason=${finishReason}）`)
          return {
            ok: false,
            reason: 'empty_content',
            detail: `Gemini 模型 ${testModel} 返回了空内容（finishReason=${finishReason}），请切换其他模型`,
            model: testModel,
          }
        }
        return { ok: true, model: testModel }
      } else {
        // Claude/GPT 走 v1
        const endpoint = `${AICODECAT_BASE_URL}/v1/chat/completions`
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resolvedKey}`,
          },
          body: JSON.stringify({
            model: testModel,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Reply with the word OK only.' }],
          }),
          signal: controller.signal,
        })
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          console.warn(`AiCodeCat 验证失败 (${resp.status}) model=${testModel}: ${errText.substring(0, 200)}`)
          return {
            ok: false,
            reason: 'http_error',
            detail: `HTTP ${resp.status}：${errText.substring(0, 150)}`,
            model: testModel,
          }
        }
        let data: Record<string, unknown>
        try {
          data = await resp.json()
        } catch {
          return { ok: false, reason: 'parse_error', detail: '响应无法解析为 JSON', model: testModel }
        }
        const text: string = (data.choices as { message?: { content?: string } }[])?.[0]?.message?.content || ''
        if (!text || text.trim() === '') {
          const finishReason = (data.choices as { finish_reason?: string }[])?.[0]?.finish_reason || 'unknown'
          console.warn(`AiCodeCat 验证失败：model=${testModel} 返回了空内容（finish_reason=${finishReason}）`)
          return {
            ok: false,
            reason: 'empty_content',
            detail: `模型 ${testModel} 返回了空内容（finish_reason=${finishReason}），请切换其他模型`,
            model: testModel,
          }
        }
        return { ok: true, model: testModel }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    console.error(`用户(ID=${userId})的 AiCodeCat 连接检查失败:`, error)
    const isAbort = error instanceof Error && (
      error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('abort')
    )
    return {
      ok: false,
      reason: 'network_error',
      detail: isAbort
        ? '连接超时（20s），AiCodeCat 网关响应缓慢，请稍后重试或切换其他模型'
        : (error instanceof Error ? error.message : '网络错误'),
    }
  }
}
