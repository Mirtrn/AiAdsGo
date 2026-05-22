/**
 * New-API / LiteLLM Gateway 适配器
 *
 * 职责：封装 New-API（openllmapi.com）的 OpenAI 兼容 API，输出格式与 GeminiGenerateResult 保持一致
 * 后端：calciumion/new-api + OpenRouter，支持 Kimi/DeepSeek/GPT/Claude/Gemini/Llama/Qwen 全系模型
 *
 * New-API 暴露标准 OpenAI Chat Completions 格式（/v1/chat/completions），只需替换 base_url + api_key
 */

import { getUserOnlySetting } from './settings'
import { normalizeLiteLLMModel, LITELLM_DEFAULT_BASE_URL, LITELLM_DEFAULT_MODEL, getLiteLLMModelDisplayName, type LiteLLMModel } from './gemini-models'
import { getDatabase } from './db'

const DEFAULT_TIMEOUT_MS = 80_000 // 必须 < Cloudflare 100s 超时，避免 Cloudflare 520

/**
 * 从数据库获取启用的模型降级链
 * 按 sort_order 排序，is_enabled = 1
 * 这样 Admin 可以在后台动态管理降级顺序
 */
async function getLiteLLMFallbackChain(): Promise<string[]> {
  try {
    const db = getDatabase()
    
    // 查询所有启用的模型，按 sort_order 排序
    const models = await db.query<{ model_id: string }>(
      'SELECT model_id FROM ai_models WHERE is_enabled = ? ORDER BY sort_order ASC',
      [1]
    )
    
    return models.map(m => m.model_id)
  } catch (error) {
    console.error('获取降级链失败，使用默认:', error)
    // 降级到默认模型
    return ['google/gemini-3-flash-preview']
  }
}

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
 * 判断错误是否应该触发模型降级
 */
function shouldFallbackToNextModel(errorMessage: string, statusCode?: number): boolean {
  const lowerError = errorMessage.toLowerCase()
  
  // 触发降级的错误类型
  const fallbackTriggers = [
    'model_not_found',
    'no available channel',
    'model not found',
    'rate limit',
    'rate_limit',
    '503',
    'service unavailable',
  ]
  
  return (
    statusCode === 503 ||
    fallbackTriggers.some(trigger => lowerError.includes(trigger))
  )
}

/**
 * 获取模型的降级链（从数据库动态读取）
 * 如果用户指定模型不在链中，则将其作为第一个尝试，再跟上数据库的降级链
 */
async function getFallbackChain(requestedModel: string): Promise<string[]> {
  // 从数据库获取所有启用的模型（按 sort_order 排序）
  const dbChain = await getLiteLLMFallbackChain()
  
  // 如果请求的模型已经在链中，从该位置开始
  const indexInChain = dbChain.indexOf(requestedModel)
  if (indexInChain >= 0) {
    return dbChain.slice(indexInChain)
  }
  
  // 否则，将请求的模型放在最前面，后面跟上完整降级链
  return [requestedModel, ...dbChain]
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
  const requestedFinalModel: LiteLLMModel = normalizeLiteLLMModel(
    requestedModel || modelSetting?.value
  )

  // 获取降级链（从数据库动态读取）
  const fallbackChain = await getFallbackChain(requestedFinalModel)
  
  let lastError: Error | undefined
  let fallbackInfo: string | undefined

  // 尝试降级链中的每个模型
  for (let i = 0; i < fallbackChain.length; i++) {
    const currentModel = fallbackChain[i]
    const isFirstAttempt = i === 0
    const isLastAttempt = i === fallbackChain.length - 1

    if (isFirstAttempt) {
      console.log(`🤖 LiteLLM 调用 (User ${userId}): ${operationType || 'unknown'} → ${currentModel} @ ${baseUrl}`)
    } else {
      console.log(`🔄 LiteLLM 降级 (User ${userId}): 尝试 ${currentModel} (${i + 1}/${fallbackChain.length})`)
    }

    try {
      const result = await tryCallModel({
        model: currentModel,
        prompt,
        temperature,
        maxOutputTokens,
        timeoutMs,
        userId,
        apiKey,
        endpoint,
        operationType,
      })
      
      // 成功了，如果使用了降级模型，添加提示信息
      if (!isFirstAttempt) {
        const requestedDisplayName = getLiteLLMModelDisplayName(requestedFinalModel)
        const usedDisplayName = getLiteLLMModelDisplayName(currentModel)
        fallbackInfo = `⚠️ 模型 ${requestedDisplayName} 暂时不可用，已自动降级使用 ${usedDisplayName}`
        console.log(`✅ LiteLLM 降级成功 (User ${userId}): ${requestedDisplayName} → ${usedDisplayName}`)
      }
      
      return {
        ...result,
        // 如果有降级信息，将其附加到 text 开头（用于在任务消息中显示）
        text: fallbackInfo ? `${fallbackInfo}\n\n${result.text}` : result.text,
      }
    } catch (error) {
      lastError = error as Error
      const errorMessage = lastError.message || String(lastError)
      
      // 如果是最后一个模型或者不应该降级的错误，直接抛出
      if (isLastAttempt || !shouldFallbackToNextModel(errorMessage)) {
        throw lastError
      }
      
      // 否则记录错误并尝试下一个模型
      console.warn(`⚠️ LiteLLM (User ${userId}): 模型 ${currentModel} 失败，准备降级...`)
    }
  }

  // 理论上不会到这里，但为了类型安全
  throw lastError || new Error('LiteLLM: 所有降级模型均失败')
}

/**
 * 尝试使用指定模型调用 LiteLLM
 * 这是从原 generateContent 提取的核心调用逻辑
 * model 参数现在是 string 类型，因为从数据库动态读取
 */
async function tryCallModel(options: {
  model: string
  prompt: string
  temperature: number
  maxOutputTokens: number
  timeoutMs: number
  userId: number
  apiKey: string
  endpoint: string
  operationType?: string
}): Promise<LiteLLMGenerateResult> {
  const {
    model,
    prompt,
    temperature,
    maxOutputTokens,
    timeoutMs,
    userId,
    apiKey,
    endpoint,
    operationType,
  } = options

  const requestBody = {
    model,
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
      console.log(`🔄 LiteLLM (User ${userId}): 模型 ${model} 要求 stream 模式，自动切换重试`)
      return generateContentStreaming(
        {
          model,
          prompt,
          temperature,
          maxOutputTokens,
          operationType,
        },
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
      `LiteLLM 模型 ${model} 返回了空内容（finish_reason=${data.choices?.[0]?.finish_reason}）。` +
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

  const returnedModel: string = data.model || model

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
      // 若调用方明确传入了 model，直接使用原始值（如 admin 测试自定义模型）；
      // 否则才 fallback 到默认模型，避免把自定义 model_id 错误降级
      const testModel = model || LITELLM_DEFAULT_MODEL
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
