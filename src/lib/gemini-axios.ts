/**
 * 使用 axios 调用 Gemini API
 *
 * 重要：
 * 1. API密钥从用户配置获取，不使用全局配置
 * 2. 不使用代理，直接访问Google API
 */

import axios, { AxiosInstance } from 'axios'
import { getUserOnlySetting } from './settings'
import { GEMINI_PROVIDERS, type GeminiProvider } from './gemini-config'
import { getDatabase } from './db'

/**
 * Gemini API 请求接口
 */
export interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text: string
    }>
    role?: string
  }>
  generationConfig?: {
    temperature?: number
    topK?: number
    topP?: number
    maxOutputTokens?: number
    responseMimeType?: string  // 🆕 Token优化：MIME类型
    responseSchema?: any  // 🆕 Token优化：JSON schema
  }
}

/**
 * Gemini API 响应接口
 */
export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string
      }>
      role: string
    }
    finishReason: string
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
    thoughtsTokenCount?: number
  }
}

/**
 * Gemini生成结果接口
 */
export interface GeminiAxiosGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
}

function extractCandidateText(candidate: GeminiResponse['candidates'][number]): string {
  const parts = candidate?.content?.parts
  if (!parts || parts.length === 0) return ''
  return parts
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
}

function logEmptyCandidate(response: GeminiResponse, candidate: GeminiResponse['candidates'][number]) {
  const candidateAny = candidate as any
  const responseAny = response as any
  const parts = candidateAny?.content?.parts

  console.error('   - finishReason:', candidateAny?.finishReason)
  if (candidateAny?.safetyRatings) {
    console.error('   - safetyRatings:', JSON.stringify(candidateAny.safetyRatings))
  }
  if (responseAny?.promptFeedback) {
    console.error('   - promptFeedback:', JSON.stringify(responseAny.promptFeedback))
  }
  console.error('   - content存在:', !!candidateAny?.content)
  console.error('   - parts存在:', !!parts)
  console.error('   - parts长度:', Array.isArray(parts) ? parts.length : 0)
  if (Array.isArray(parts)) {
    console.error('   - parts字段:', parts.map(part => Object.keys(part || {})))
  }
  const responsePreview = JSON.stringify(responseAny, null, 2)
  console.error(`   - 响应片段: ${responsePreview.substring(0, 800)}`)
}

/**
 * 根据用户配置获取对应的 Gemini API Key
 *
 * @param userId - 用户ID
 * @param provider - 服务商类型
 * @returns API Key
 */
async function getGeminiApiKey(userId: number, provider: GeminiProvider): Promise<string> {
  // 🔧 关键修复(2025-12-30): 使用 getSetting() 正确处理加密字段
  // 直接查询 value 字段会忽略 encrypted_value，导致已配置的用户报错
  const { getSetting } = await import('./settings')

  // 根据服务商选择对应的字段
  const keyField = provider === 'relay' ? 'gemini_relay_api_key' : 'gemini_api_key'

  const setting = await getSetting('ai', keyField, userId)

  if (!setting?.value) {
    throw new Error(
      `用户(ID=${userId})未配置 ${GEMINI_PROVIDERS[provider].name} 的 API 密钥。` +
      `请在设置页面配置。`
    )
  }

  return setting.value
}

/**
 * 根据用户配置获取 Gemini 端点
 *
 * 🔧 关键修复(2025-12-30): 使用 getSetting() 正确处理配置字段
 *
 * @param userId - 用户ID
 * @returns Gemini API 端点 URL
 */
async function getGeminiEndpoint(userId: number): Promise<string> {
  const provider = await getGeminiProvider(userId)
  return getEndpointByProvider(provider)
}

/**
 * 根据服务商类型获取端点 URL（纯函数）
 */
export function getEndpointByProvider(provider: GeminiProvider): string {
  if (provider === 'vertex') {
    return 'vertex'
  }
  return GEMINI_PROVIDERS[provider].endpoint
}

/**
 * 创建 axios 实例用于 Gemini API
 *
 * 🔧 2025-12-29 更新：支持动态端点
 * - 根据用户配置自动选择官方或中转端点
 * - 直连访问，不使用代理
 *
 * 超时设置：
 * - 180秒（3分钟）
 * - 原因：平衡可靠性与响应时间
 *
 * 🔧 2025-12-31 修复：
 * - relay 服务商使用 Cloudflare 防护，需要浏览器特征 headers 绕过检测
 * - official 服务商不需要这些 headers（官方API不使用Cloudflare）
 */
export async function createGeminiAxiosClient(userId: number, provider?: GeminiProvider): Promise<AxiosInstance> {
  const geminiProvider = provider || await getGeminiProvider(userId)
  const endpoint = getEndpointByProvider(geminiProvider)

  if (endpoint === 'vertex') {
    // Vertex AI 使用专用客户端
    throw new Error('Use Vertex AI client instead')
  }

  // 🔧 2025-12-31 修复：relay 服务商需要浏览器特征 headers 绕过 Cloudflare
  // ThunderRelay 使用 Cloudflare 防护，服务器请求需要模拟浏览器行为
  const isRelayProvider = geminiProvider === 'relay'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  }

  // 🔧 relay 服务商需要额外的浏览器特征 headers 绕过 Cloudflare
  if (isRelayProvider) {
    headers['Origin'] = 'https://aicode.cat'
    headers['Referer'] = 'https://aicode.cat/'
    headers['sec-fetch-dest'] = 'empty'
    headers['sec-fetch-mode'] = 'cors'
    headers['sec-fetch-site'] = 'same-origin'
  }

  return axios.create({
    baseURL: endpoint, // 动态端点
    timeout: 300000, // 300 秒（5分钟）- 适配 Gemini 3 thinking 模式
    headers,
  })
}

/**
 * 获取用户配置的服务商类型
 *
 * 🔧 关键修复(2025-12-30): 使用 getSetting() 正确处理配置字段
 */
async function getGeminiProvider(userId: number): Promise<GeminiProvider> {
  const { getSetting } = await import('./settings')
  const setting = await getSetting('ai', 'gemini_provider', userId)

  return (setting?.value as GeminiProvider) || 'official'
}

/**
 * 调用 Gemini API 生成内容（不做自动降级）
 *
 * 不自动切换模型，错误直接抛出
 * 直接访问Google API，不使用代理
 *
 * 重要：API密钥从用户配置获取，不使用全局配置
 *
 * @param params - 生成参数
 * @param params.model - 模型名称，默认 'gemini-2.5-pro'
 * @param params.prompt - 提示词
 * @param params.temperature - 温度参数，默认 0.7
 * @param params.maxOutputTokens - 最大输出tokens，默认 8192
 * @param userId - 用户ID（必需，用于获取用户的API密钥）
 * @param overrideConfig - 临时配置覆盖（可选，用于验证未保存的配置）
 * @param overrideConfig.provider - 服务商类型（'official' | 'relay'）
 * @param overrideConfig.apiKey - API密钥
 * @returns 生成的文本内容
 */
export async function generateContent(params: {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  responseSchema?: any  // 🆕 Token优化：JSON schema
  responseMimeType?: string  // 🆕 Token优化：MIME类型
}, userId: number, overrideConfig?: { provider: string; apiKey: string }): Promise<GeminiAxiosGenerateResult> {
  const {
    model = 'gemini-2.5-pro',
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    timeoutMs,
    responseSchema,  // 🆕 Token优化：JSON schema
    responseMimeType,  // 🆕 Token优化：MIME类型
  } = params

  // 🔧 关键修复(2025-12-30): 支持临时配置覆盖（用于验证未保存的配置）
  // 根据用户配置获取服务商类型和对应的 API Key
  const provider = overrideConfig ? overrideConfig.provider as GeminiProvider : await getGeminiProvider(userId)
  const apiKey = overrideConfig ? overrideConfig.apiKey : await getGeminiApiKey(userId, provider)
  console.log(`🌐 使用 ${GEMINI_PROVIDERS[provider].name} 服务商${overrideConfig ? '（临时配置）' : ''}`)

  // 🔧 2025-12-31 修复：传递 provider 参数以确保正确设置 headers（relay 需要 Cloudflare 绕过 headers）
  const client = await createGeminiAxiosClient(userId, provider)

  // 构建请求
  // 构建generationConfig（根据是否有responseSchema）
  const generationConfig: any = {
    temperature,
    maxOutputTokens,
  }

  // 🔧 2026-02-01: 恢复 Gemini 3 thinking 模式
  // thinking 模式可能有助于模型更好地规划结构化输出，避免生成过多 tokens
  if (model.includes('gemini-3') || model.includes('gemini-2.5')) {
    console.log(`🧠 Gemini 3/2.5 模型使用默认 thinking 模式 (模型: ${model})`)
  }

  // 🆕 Token优化：结构化JSON输出约束
  if (responseSchema) {
    generationConfig.responseMimeType = responseMimeType || 'application/json'
    generationConfig.responseSchema = responseSchema
    console.log(`📋 Gemini API使用JSON schema约束`)
  }

  const request: GeminiRequest = {
    contents: [
      {
        parts: [{ text: prompt }],
        role: 'user',
      },
    ],
    generationConfig,
  }

  // 尝试使用主模型
  try {
    console.log(`🤖 调用 Gemini API: ${model}`)
    console.log(`   - Prompt长度: ${prompt.length} 字符`)
    console.log(`   - maxOutputTokens: ${maxOutputTokens}`)
    if (timeoutMs) {
      console.log(`   - timeout: ${timeoutMs}ms`)
    }
    console.log(`   - temperature: ${temperature}`)

    // 🔧 修复(2025-12-30): 第三方中转服务需要在headers中传递API Key
    // - 官方API: query参数 ?key=xxx
    // - ThunderRelay中转: header x-api-key: xxx
    const timeoutConfig = timeoutMs ? { timeout: timeoutMs } : {}
    const requestConfig = provider === 'relay'
      ? {
          headers: {
            'x-api-key': apiKey,
          },
          ...timeoutConfig,
        }
      : {
          params: {
            key: apiKey,
          },
          ...timeoutConfig,
        }

    // 🔧 2026-02-01: 提高上限到65536（Gemini 3 Flash Preview 支持的最大值）
    // 原问题：gemini-3-flash-preview 可能生成36k+ tokens，超过原来的49152上限
    const MAX_OUTPUT_TOKENS_CAP = 65536
    const MAX_TOKENS_RETRY_BUMP = 16384  // 更大的增量，减少重试次数
    const MAX_TOKENS_RETRY_BUFFER = 4096

    const runRequest = async (overrideMaxOutputTokens?: number): Promise<GeminiAxiosGenerateResult> => {
      const effectiveMaxOutputTokens = overrideMaxOutputTokens ?? maxOutputTokens
      const requestToSend = overrideMaxOutputTokens
        ? {
            ...request,
            generationConfig: {
              ...generationConfig,
              maxOutputTokens: effectiveMaxOutputTokens,
            },
          }
        : request

      if (overrideMaxOutputTokens) {
        console.warn(`🔄 MAX_TOKENS重试: maxOutputTokens=${effectiveMaxOutputTokens}`)
      }

      const response = await client.post<GeminiResponse>(
        `/v1beta/models/${model}:generateContent`,
        requestToSend,
        requestConfig
      )

      // 检查响应基本结构
      if (!response.data.candidates || response.data.candidates.length === 0) {
        console.error('❌ Gemini API响应异常: 没有candidates')
        console.error('   - 完整响应:', JSON.stringify(response.data, null, 2))
        throw new Error('Gemini API 返回了空响应（没有candidates）')
      }

      const candidate = response.data.candidates[0]

      // 🔧 修复(2025-12-11): 检查finishReason，如果是MAX_TOKENS，说明输出被截断
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        console.warn(`⚠️ Gemini API finishReason: ${candidate.finishReason}`)
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.error('❌ Gemini API输出达到token限制被截断')
          console.error('   - finishReason:', candidate.finishReason)
          console.error('   - usageMetadata:', response.data.usageMetadata)
          const partialText = extractCandidateText(candidate)
          if (partialText) {
            const head = partialText.substring(0, 1024)
            const tail = partialText.substring(Math.max(0, partialText.length - 1024))
            console.error(`   - 输出预览(前1KB): ${head}`)
            console.error(`   - 输出预览(后1KB): ${tail}`)
            console.error(`   - 输出长度: ${partialText.length} 字符`)
          } else {
            console.error('   - 输出预览: 空文本')
          }

          const usage = response.data.usageMetadata
          const thoughtsTokenCount = usage?.thoughtsTokenCount || 0
          const candidatesTokenCount = usage?.candidatesTokenCount || 0
          // Use actual output token usage as a floor for the retry to avoid under-bumping.
          const minRetryFromUsage = candidatesTokenCount > 0
            ? candidatesTokenCount + MAX_TOKENS_RETRY_BUFFER
            : 0
          const minRetryFromThoughts = thoughtsTokenCount > 0
            ? thoughtsTokenCount + MAX_TOKENS_RETRY_BUFFER
            : 0
          const retryMaxOutputTokens = Math.min(
            MAX_OUTPUT_TOKENS_CAP,
            Math.max(
              effectiveMaxOutputTokens + MAX_TOKENS_RETRY_BUMP,
              minRetryFromThoughts,
              minRetryFromUsage
            )
          )

          if (!overrideMaxOutputTokens && retryMaxOutputTokens > effectiveMaxOutputTokens) {
            console.warn(`   - 自动提升maxOutputTokens: ${effectiveMaxOutputTokens} → ${retryMaxOutputTokens}`)
            return await runRequest(retryMaxOutputTokens)
          }

          const maxTokensError: any = new Error('Gemini API 输出达到token限制被截断。请增加maxOutputTokens参数。')
          maxTokensError.code = 'MAX_TOKENS'
          throw maxTokensError
        }
        if ((candidate as any).safetyRatings) {
          console.warn('   - safetyRatings:', JSON.stringify((candidate as any).safetyRatings))
        }
      }

      // 提取响应文本
      const text = extractCandidateText(candidate)
      if (!text) {
        console.error('❌ Gemini API响应异常: content.parts为空', { finishReason: candidate.finishReason })
        logEmptyCandidate(response.data, candidate)
        throw new Error('Gemini API 返回了空响应（content.parts为空）')
      }
      console.log(`✓ Gemini API 调用成功，返回 ${text.length} 字符`)

      // 🔧 调试(2026-01-31): 记录响应内容详情，排查输出过大问题
      const usage = response.data.usageMetadata
      const thoughtsTokenCount = usage?.thoughtsTokenCount || 0
      const candidatesTokenCount = usage?.candidatesTokenCount || 0
      const charsPerToken = candidatesTokenCount > 0 ? (text.length / candidatesTokenCount).toFixed(2) : 'N/A'
      console.log(`📊 响应分析:`)
      console.log(`   - 文本长度: ${text.length} 字符`)
      console.log(`   - 输出tokens: ${candidatesTokenCount} (含thinking: ${thoughtsTokenCount})`)
      console.log(`   - 字符/token比: ${charsPerToken}`)
      // 如果输出异常大（超过10k tokens），记录更多信息
      if (candidatesTokenCount > 10000) {
        console.warn(`⚠️ 输出异常大! 预期约1000 tokens，实际 ${candidatesTokenCount} tokens`)
        console.log(`   - 响应前500字符: ${text.substring(0, 500)}`)
        console.log(`   - 响应后500字符: ${text.substring(text.length - 500)}`)
      }

      // 记录token使用情况
      let usageResult: GeminiAxiosGenerateResult['usage']
      if (response.data.usageMetadata) {
        usageResult = {
          inputTokens: response.data.usageMetadata.promptTokenCount || 0,
          outputTokens: response.data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.data.usageMetadata.totalTokenCount || 0
        }
        console.log(`   Token使用: prompt=${usageResult.inputTokens}, ` +
          `output=${usageResult.outputTokens}, ` +
          `total=${usageResult.totalTokens}`)
      }

      return {
        text,
        usage: usageResult,
        model
      }
    }

    const maxRateLimitRetries = 3
    for (let attempt = 1; attempt <= maxRateLimitRetries; attempt++) {
      try {
        return await runRequest()
      } catch (error: any) {
        if (error?.code === 'MAX_TOKENS') {
          throw error
        }

        const status = error?.response?.status
        const message = String(error?.message || '')
        const isRateLimited = status === 429 ||
          message.includes('concurrency slot') ||
          message.includes('RESOURCE_EXHAUSTED')

        if (isRateLimited && attempt < maxRateLimitRetries) {
          const baseDelayMs = 2000 * Math.pow(2, attempt - 1)
          const jitterMs = Math.floor(Math.random() * 1000)
          const delayMs = Math.min(baseDelayMs + jitterMs, 20000)
          console.warn(`⚠️ Gemini API限流/并发受限，${(delayMs / 1000).toFixed(1)}s 后重试 (${attempt}/${maxRateLimitRetries})`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
          continue
        }

        throw error
      }
    }

    throw new Error('Gemini API调用失败: 超过最大重试次数')
  } catch (error: any) {
    // 🔧 修复(2025-12-11): 对所有错误打印详细信息
    console.error(`❌ Gemini API调用失败:`)
    console.error(`   - HTTP状态: ${error.response?.status}`)
    console.error(`   - 错误消息: ${error.message}`)

    // 🔧 修复(2025-12-30): 正确处理可能是Buffer或压缩数据的错误响应
    if (error.response?.data) {
      try {
        // 如果是Buffer，转换为字符串
        let dataStr = error.response.data
        if (Buffer.isBuffer(dataStr)) {
          dataStr = dataStr.toString('utf-8')
        }
        // 如果是对象，序列化为JSON
        if (typeof dataStr === 'object') {
          dataStr = JSON.stringify(dataStr, null, 2)
        }
        // 限制输出长度，避免日志过长
        const maxLength = 500
        if (dataStr.length > maxLength) {
          console.error(`   - 响应数据（前${maxLength}字符）: ${dataStr.substring(0, maxLength)}...`)
        } else {
          console.error(`   - 响应数据: ${dataStr}`)
        }
      } catch (parseError) {
        console.error(`   - 响应数据解析失败:`, parseError)
      }
    }

    // 🔧 修复(2025-12-30): 针对403错误给出更明确的提示
    if (error.response?.status === 403) {
      const providerName = GEMINI_PROVIDERS[provider]?.name || '当前服务商'
      throw new Error(
        `Gemini API调用失败: 403 Forbidden\n` +
        `\n` +
        `可能的原因：\n` +
        `1. API Key无效或过期（${providerName}）\n` +
        `2. ${providerName === '第三方中转' ? '中转服务的' : ''}API Key权限不足\n` +
        `3. ${providerName === '第三方中转' ? '中转服务的Cloudflare防护拦截了请求\n' : 'IP地址被限制\n'}` +
        `\n` +
        `请检查：\n` +
        `- API Key是否正确配置\n` +
        `- API Key是否仍然有效\n` +
        `- ${providerName === '第三方中转' ? '中转服务账户是否有足够余额\n' : '账户是否处于正常状态\n'}` +
        `\n` +
        `原始错误: ${error.message}`
      )
    }

    // 🔧 新增(2025-12-30): 针对402错误（余额不足）给出明确提示
    if (error.response?.status === 402) {
      const providerName = GEMINI_PROVIDERS[provider]?.name || '当前服务商'
      const errorData = error.response?.data
      const balance = errorData?.billing?.balance ?? 0
      const message = errorData?.message || '账户余额不足'
      const errorCode = errorData?.error

      // 🔧 新增(2025-12-30): 处理BILLING_BINDING_MISSING错误
      if (errorCode === 'BILLING_BINDING_MISSING') {
        throw new Error(
          `Gemini API调用失败: 需要绑定专属账户\n` +
          `\n` +
          `${providerName}配置问题：\n` +
          `- 错误代码: BILLING_BINDING_MISSING\n` +
          `- 服务消息: ${message}\n` +
          `- 计费模式: ${errorData?.billing?.mode || 'payg'} (按量付费)\n` +
          `\n` +
          `解决方案：\n` +
          `1. 登录中转服务平台 (https://aicode.cat)\n` +
          `2. 前往账户设置，绑定Gemini专属账户\n` +
          `3. 或联系服务商管理员配置账户绑定\n` +
          `4. 配置完成后重新验证API Key\n`
        )
      }

      // 余额不足错误
      throw new Error(
        `Gemini API调用失败: 402 Payment Required\n` +
        `\n` +
        `${providerName}账户余额不足：\n` +
        `- 当前余额: ${balance} 积分\n` +
        `- 服务消息: ${message}\n` +
        `\n` +
        `解决方案：\n` +
        `1. ${providerName === '第三方中转' ? '前往中转服务平台充值积分\n' : '检查账户配额并充值\n'}` +
        `2. 更换其他有余额的API Key\n` +
        `3. ${providerName === '第三方中转' ? '切换到Gemini官方API或Vertex AI\n' : '联系服务提供商\n'}`
      )
    }

    // 其他错误直接抛出
    // 🔧 修复(2025-12-11): 增加详细错误信息，便于排查400错误
    const errorDetails = error.response?.data?.error
    if (errorDetails) {
      console.error('❌ Gemini API错误详情:')
      console.error('   - code:', errorDetails.code)
      console.error('   - message:', errorDetails.message)
      console.error('   - status:', errorDetails.status)
      if (errorDetails.details) {
        console.error('   - details:', JSON.stringify(errorDetails.details, null, 2))
      }

      // 🔧 地理位置限制的友好错误提示
      if (errorDetails.message?.includes('location is not supported') ||
          errorDetails.status === 'FAILED_PRECONDITION') {
        throw new Error(
          `Gemini API调用失败: 当前地理位置不支持直接访问Gemini API。\n` +
          `解决方案:\n` +
          `1. 配置 Vertex AI（推荐，在/settings页面配置GCP项目ID和服务账号）\n` +
          `2. 使用VPN或代理切换到支持的地区\n` +
          `原始错误: ${errorDetails.message}`
        )
      }

      throw new Error(`Gemini API调用失败 (${errorDetails.code}): ${errorDetails.message}`)
    }
    throw new Error(`Gemini API调用失败: ${error.message}`)
  }
}
