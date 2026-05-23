/**
 * New-API / LiteLLM Gateway 适配器
 *
 * 职责：封装 New-API（openllmapi.com）的 OpenAI 兼容 API，输出格式与 GeminiGenerateResult 保持一致
 * 后端：calciumion/new-api + OpenRouter，支持 Kimi/DeepSeek/GPT/Claude/Gemini/Llama/Qwen 全系模型
 *
 * New-API 暴露标准 OpenAI Chat Completions 格式（/v1/chat/completions），只需替换 base_url + api_key
 */

import { getUserOnlySetting } from './settings'
import { LITELLM_DEFAULT_BASE_URL, LITELLM_DEFAULT_MODEL, getLiteLLMModelDisplayName } from './gemini-models'
import { getDatabase } from './db'

/**
 * 根据 endpoint 和 model 返回正确的请求参数
 * - GPT-5 系列（api.openai.com）要求 max_completion_tokens，其他兼容网关用 max_tokens
 * - GPT-5.5 等 reasoning 模型不支持自定义 temperature（只允许默认值 1），需省略该字段
 */
function buildTokenParam(endpoint: string, tokens: number): Record<string, number> {
  if (endpoint.includes('api.openai.com')) {
    return { max_completion_tokens: tokens }
  }
  return { max_tokens: tokens }
}

/**
 * 构建完整的 chat/completions 端点 URL
 *
 * 规则：
 *  - Gemini OpenAI-compat：baseUrl 已包含 /openai 路径段，直接追加 /chat/completions
 *    正确：.../v1beta/openai/chat/completions
 *    错误（旧逻辑）：.../v1beta/openai/v1/chat/completions（多了 /v1）
 *  - 其他网关（New-API / OpenAI 官方）：追加 /v1/chat/completions
 */
function buildEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '')
  if (base.includes('generativelanguage.googleapis.com')) {
    // Gemini OpenAI-compatible endpoint 不带版本前缀 /v1
    return `${base}/chat/completions`
  }
  return `${base}/v1/chat/completions`
}

/**
 * 判断模型是否为 OpenAI reasoning 模型（不支持自定义 temperature）
 * 当前已知：gpt-5.5 系列为 reasoning 模型
 */
function isOpenAIReasoningModel(model: string): boolean {
  return model.startsWith('gpt-5.5') || model.startsWith('o1') || model.startsWith('o3')
}

/**
 * 构建 temperature 参数：reasoning 模型省略 temperature（使用 API 默认值 1）
 */
function buildTemperatureParam(endpoint: string, model: string, temperature: number): Record<string, number> {
  if (endpoint.includes('api.openai.com') && isOpenAIReasoningModel(model)) {
    return {} // reasoning 模型不传 temperature，API 默认为 1
  }
  return { temperature }
}

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
 *
 * 触发降级的错误类型：
 *  - 模型不存在（网关路由失败）
 *  - 速率限制（429 / rate_limit）
 *  - 模型过载（overloaded / quota_exceeded）
 *  - 服务不可用（503 / 502 / 504）
 *  - 网关内部错误（500）—— 中转服务上游波动
 *
 * 不应降级的错误（让调用方直接感知）：
 *  - 认证失败（401 / 403 / invalid_api_key）
 *  - 请求体格式错误（400）
 *  - 超时（abort）— 已达到本次超时上限，继续尝试无意义
 */
function shouldFallbackToNextModel(errorMessage: string, statusCode?: number): boolean {
  const lowerError = errorMessage.toLowerCase()

  // 明确不应降级的 HTTP 状态码
  if (statusCode === 401 || statusCode === 403 || statusCode === 400) {
    return false
  }

  // 触发降级的错误类型（关键字匹配）
  const fallbackTriggers = [
    'model_not_found',
    'no available channel',
    'model not found',
    'rate limit',
    'rate_limit',
    'rateLimitExceeded',
    'quota_exceeded',
    'quota exceeded',
    'resource_exhausted',   // Google API 超配额
    'overloaded',           // 模型过载（Anthropic 等）
    'too many requests',    // HTTP 429 文本描述
    '429',
    '500',                  // 中转网关内部错误（上游模型波动）
    '502',
    'bad gateway',          // 502 文本描述
    '503',
    'service unavailable',
    '504',                  // 网关超时（tryCallModel 生成 "LiteLLM 网关超时 (504)..."）
    'gateway timeout',
  ]

  return (
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    fallbackTriggers.some(trigger => lowerError.includes(trigger.toLowerCase()))
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
 * 检查用户是否配置了有效的 AI 服务
 * 支持三种提供商：OpenLLM 中转、Gemini 官方、OpenAI 官方
 */
export async function isLiteLLMConfigured(userId: number): Promise<boolean> {
  try {
    const { resolveActiveAIConfig } = await import('./ai-runtime-config')
    const config = await resolveActiveAIConfig(userId)
    return config.type === 'litellm' && !!config.litellmAPI?.apiKey
  } catch {
    return false
  }
}

/**
 * 调用 LiteLLM Gateway（OpenAI 兼容格式）
 * 支持三种提供商：OpenLLM 中转、Gemini 官方、OpenAI 官方
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

  // 使用 AI 运行时配置解析正确的 API key、baseUrl 和 model
  // 支持三种提供商：litellm（OpenLLM中转）、gemini_official、openai_official
  const { resolveActiveAIConfig } = await import('./ai-runtime-config')
  const aiConfig = await resolveActiveAIConfig(userId)

  if (!aiConfig.type || !aiConfig.litellmAPI) {
    throw new Error(
      `用户(ID=${userId})未配置有效的 AI 服务。请在"设置 → AI引擎"中选择提供商并配置 API Key。`
    )
  }

  const { apiKey, baseUrl, model: configModel, provider } = aiConfig.litellmAPI
  const endpoint = buildEndpoint(baseUrl)

  // 优先使用调用时传入的模型，否则用用户保存的配置模型，最后兜底默认
  const requestedFinalModel: string = requestedModel || configModel || LITELLM_DEFAULT_MODEL

  // 对于 Gemini 官方和 OpenAI 官方，直接调用不降级
  // 降级机制只适用于 OpenLLM 中转（用户可以在后台管理模型列表）
  if (provider !== 'litellm') {
    console.log(`🤖 ${provider === 'gemini_official' ? 'Gemini 官方' : 'OpenAI 官方'} 直连 (User ${userId}): ${operationType || 'unknown'} → ${requestedFinalModel}`)
    return await tryCallModel({
      model: requestedFinalModel,
      prompt, temperature, maxOutputTokens,
      timeoutMs, userId, apiKey, endpoint, operationType,
    })
  }

  // OpenLLM 中转：使用降级链从数据库动态读取
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
    ...buildTokenParam(endpoint, maxOutputTokens),
    ...buildTemperatureParam(endpoint, model, temperature),
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
        ...buildTokenParam(endpoint, maxOutputTokens),
        ...buildTemperatureParam(endpoint, model, temperature),
        stream: true,
        // GPT-5（api.openai.com）流式默认不返回 usage，需显式开启
        ...(endpoint.includes('api.openai.com') ? { stream_options: { include_usage: true } } : {}),
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

  // streamDone 用于在 [DONE] 事件后同时跳出内层 for-of 和外层 while
  let streamDone = false
  try {
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const jsonStr = trimmed.slice(5).trim()
        if (jsonStr === '[DONE]') {
          // 必须同时退出外层 while，否则 reader.read() 会继续阻塞
          streamDone = true
          break
        }
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
export interface CheckLiteLLMResult {
  ok: boolean
  /** 连接失败时的实际错误描述（来自 API 原始响应），可直接展示给用户 */
  errorMessage?: string
}

/**
 * 检查 LiteLLM / OpenAI 官方 / Gemini 官方 连接状态（ping）
 *
 * 返回结构化结果 { ok, errorMessage }：
 *  - ok=true  → 连接正常
 *  - ok=false → 连接失败，errorMessage 包含 API 原始错误，用于前端展示
 *
 * @param userId   当前用户 ID（apiKey 为空时从 DB 读取配置）
 * @param apiKey   可选，直接传入 API Key（优先于 DB 配置）
 * @param baseUrl  可选，服务基础 URL（如 https://api.openai.com）
 * @param model    可选，测试用模型 ID
 */
export async function checkLiteLLMConnection(
  userId: number,
  apiKey?: string,
  baseUrl?: string,
  model?: string
): Promise<CheckLiteLLMResult> {
  try {
    if (apiKey) {
      const resolvedBase = (baseUrl || LITELLM_DEFAULT_BASE_URL).replace(/\/$/, '')
      // 使用 buildEndpoint 修复 Gemini endpoint 路径（避免多出 /v1 段）
      const endpoint = buildEndpoint(resolvedBase)
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
            ...buildTokenParam(endpoint, 5),
            ...buildTemperatureParam(endpoint, testModel, 0.7),
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
                  ...buildTokenParam(endpoint, 5),
                  ...buildTemperatureParam(endpoint, testModel, 0.7),
                  stream: true,
                  ...(endpoint.includes('api.openai.com') ? { stream_options: { include_usage: true } } : {}),
                  messages: [{ role: 'user', content: 'Hi' }],
                }),
                signal: ctrl2.signal,
              })
              if (resp2.ok) {
                // 流式 ping 成功：必须消费响应体，否则底层 HTTP 连接不会释放
                // 只需排空 reader，不需要解析 SSE 内容
                try {
                  const reader2 = resp2.body?.getReader()
                  if (reader2) {
                    // eslint-disable-next-line no-constant-condition
                    while (true) {
                      const { done } = await reader2.read()
                      if (done) break
                    }
                    reader2.releaseLock()
                  }
                } catch {
                  // 忽略消费错误，连接最终会被 GC 回收
                }
                return { ok: true }
              }
              const err2 = await resp2.text().catch(() => '')
              const msg2 = extractApiErrorMessage(err2, resp2.status)
              console.warn(`LiteLLM 流式验证失败 (${resp2.status}) model=${testModel}: ${err2.substring(0, 200)}`)
              return { ok: false, errorMessage: msg2 }
            } finally {
              clearTimeout(t2)
            }
          }
          const msg = extractApiErrorMessage(errText, resp.status)
          console.warn(`LiteLLM 验证失败 (${resp.status}) model=${testModel}: ${errText.substring(0, 200)}`)
          return { ok: false, errorMessage: msg }
        }
        return { ok: true }
      } finally {
        clearTimeout(timer)
      }
    }

    // 用 userId 从 DB 读取配置做连接测试
    await generateContent(
      { prompt: 'Hello', maxOutputTokens: 10, operationType: 'connection_test' },
      userId
    )
    return { ok: true }
  } catch (error: any) {
    const errMsg = error?.message || String(error)
    console.error(`用户(ID=${userId})的 LiteLLM 连接检查失败:`, error)
    return { ok: false, errorMessage: errMsg }
  }
}

/**
 * 从 API 原始错误响应中提取用户友好的错误描述
 * 优先提取 JSON 中的 error.message，兜底使用状态码+原始文本
 */
function extractApiErrorMessage(rawText: string, statusCode: number): string {
  try {
    const parsed = JSON.parse(rawText)
    // OpenAI 格式：{ error: { message: '...' } }
    if (parsed?.error?.message) return `${parsed.error.message}`
    // 部分网关直接放 { message: '...' }
    if (parsed?.message) return `${parsed.message}`
  } catch {
    // 不是 JSON，fallback
  }
  const preview = rawText.trimStart().startsWith('<')
    ? `服务器返回了非预期响应（HTML），请检查网关地址配置`
    : rawText.substring(0, 200)
  return `HTTP ${statusCode}: ${preview}`
}
