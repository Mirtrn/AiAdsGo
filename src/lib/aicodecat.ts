/**
 * AiCodeCat Gateway 调用模块
 * 复用 LiteLLM/OpenAI-compatible 协议，指向 aicode.cat 网关
 * 注册链接: https://aicode.cat/register?ref=AIADSGO01
 */

import { getUserOnlySetting } from './settings'
import {
  AICODECAT_BASE_URL,
  AICODECAT_DEFAULT_MODEL,
  normalizeAiCodeCatModel,
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

  const baseUrl = AICODECAT_BASE_URL
  const endpoint = `${baseUrl}/v1/chat/completions`

  const finalModel: AiCodeCatModel = normalizeAiCodeCatModel(
    requestedModel || modelSetting?.value
  )

  console.log(`🐱 AiCodeCat 调用 (User ${userId}): ${operationType || 'unknown'} → ${finalModel} @ ${baseUrl}`)

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
    const isHtmlResponse = errorText.trimStart().startsWith('<')
    let friendlyError: string
    if (response.status === 504 || response.status === 502) {
      friendlyError = `AiCodeCat 网关超时 (${response.status})：请求超时，请稍后重试或检查网关服务状态。`
    } else if (isHtmlResponse) {
      friendlyError = `AiCodeCat API 请求失败 (${response.status})：服务器返回了非预期响应，请检查网关地址和 API Key 配置。`
    } else {
      friendlyError = `AiCodeCat API 请求失败 (${response.status}): ${errorText.substring(0, 300)}`
    }
    throw new Error(friendlyError)
  }

  const data = await response.json()

  const text: string = data.choices?.[0]?.message?.content || ''

  if (!text || text.trim() === '') {
    throw new Error(
      `AiCodeCat 模型 ${finalModel} 返回了空内容（finish_reason=${data.choices?.[0]?.finish_reason}）。` +
      `请尝试切换其他模型或检查 API Key。`
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
    `✅ AiCodeCat 完成 (User ${userId}): ${operationType || 'unknown'} ` +
    `→ ${returnedModel}, tokens=${usage.totalTokens}`
  )

  return {
    text,
    usage,
    model: returnedModel,
    apiType: 'aicodecat',
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
  baseUrl?: string,
  model?: string
): Promise<AiCodeCatCheckResult> {
  try {
    const resolvedBase = (baseUrl || AICODECAT_BASE_URL).replace(/\/$/, '')
    const endpoint = `${resolvedBase}/v1/chat/completions`
    const resolvedKey = apiKey || (await getUserOnlySetting('ai', 'aicodecat_api_key', userId))?.value
    if (!resolvedKey) {
      return { ok: false, reason: 'no_key', detail: '未配置 API Key' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const testModel = model ? normalizeAiCodeCatModel(model) : AICODECAT_DEFAULT_MODEL
    try {
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
      // 🔧 额外检查：验证响应内容非空（防止 200 OK 但返回空内容的情况）
      let data: Record<string, unknown>
      try {
        data = await resp.json()
      } catch {
        console.warn(`AiCodeCat 验证失败：model=${testModel} 响应无法解析为 JSON`)
        return { ok: false, reason: 'parse_error', detail: '响应无法解析为 JSON', model: testModel }
      }
      const text: string = (data.choices as { message?: { content?: string } }[])?.[0]?.message?.content || ''
      if (!text || text.trim() === '') {
        const finishReason = (data.choices as { finish_reason?: string }[])?.[0]?.finish_reason || 'unknown'
        console.warn(
          `AiCodeCat 验证失败：model=${testModel} 返回了空内容（finish_reason=${finishReason}）。` +
          `模型可能不可用或账号权限不足，请切换其他模型。`
        )
        return {
          ok: false,
          reason: 'empty_content',
          detail: `模型 ${testModel} 返回了空内容（finish_reason=${finishReason}），请切换其他模型`,
          model: testModel,
        }
      }
      return { ok: true, model: testModel }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    console.error(`用户(ID=${userId})的 AiCodeCat 连接检查失败:`, error)
    return {
      ok: false,
      reason: 'network_error',
      detail: error instanceof Error ? error.message : '网络错误',
    }
  }
}
