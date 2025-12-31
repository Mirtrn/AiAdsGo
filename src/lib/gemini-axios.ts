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
    headers['Origin'] = 'https://cc.thunderrelay.com'
    headers['Referer'] = 'https://cc.thunderrelay.com/'
    headers['sec-fetch-dest'] = 'empty'
    headers['sec-fetch-mode'] = 'cors'
    headers['sec-fetch-site'] = 'same-origin'
  }

  return axios.create({
    baseURL: endpoint, // 动态端点
    timeout: 180000, // 180 秒（3分钟）
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
 * 调用 Gemini API 生成内容（带自动降级）
 *
 * 尝试使用 gemini-2.5-pro，如果遇到模型过载（503）则自动降级到 gemini-2.5-flash
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
  responseSchema?: any  // 🆕 Token优化：JSON schema
  responseMimeType?: string  // 🆕 Token优化：MIME类型
}, userId: number, overrideConfig?: { provider: string; apiKey: string }): Promise<GeminiAxiosGenerateResult> {
  const {
    model = 'gemini-2.5-pro',
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
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
    console.log(`   - temperature: ${temperature}`)

    // 🔧 修复(2025-12-30): 第三方中转服务需要在headers中传递API Key
    // - 官方API: query参数 ?key=xxx
    // - ThunderRelay中转: header x-api-key: xxx
    const requestConfig = provider === 'relay'
      ? {
          headers: {
            'x-api-key': apiKey,
          },
        }
      : {
          params: {
            key: apiKey,
          },
        }

    const response = await client.post<GeminiResponse>(
      `/v1beta/models/${model}:generateContent`,
      request,
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
    if (candidate.finishReason === 'MAX_TOKENS') {
      console.error('❌ Gemini API输出达到token限制被截断')
      console.error('   - finishReason:', candidate.finishReason)
      console.error('   - usageMetadata:', response.data.usageMetadata)
      throw new Error('Gemini API 输出达到token限制被截断。请增加maxOutputTokens参数。')
    }

    // 提取响应文本
    if (
      !candidate.content ||
      !candidate.content.parts ||
      candidate.content.parts.length === 0 ||
      !candidate.content.parts[0].text
    ) {
      console.error('❌ Gemini API响应异常: content.parts为空', { finishReason: candidate.finishReason })
      throw new Error('Gemini API 返回了空响应（content.parts为空）')
    }

    const text = candidate.content.parts[0].text
    console.log(`✓ Gemini API 调用成功，返回 ${text.length} 字符`)

    // 记录token使用情况
    let usage: GeminiAxiosGenerateResult['usage']
    if (response.data.usageMetadata) {
      usage = {
        inputTokens: response.data.usageMetadata.promptTokenCount || 0,
        outputTokens: response.data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.data.usageMetadata.totalTokenCount || 0
      }
      console.log(`   Token使用: prompt=${usage.inputTokens}, ` +
        `output=${usage.outputTokens}, ` +
        `total=${usage.totalTokens}`)
    }

    return {
      text,
      usage,
      model
    }
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

    // 检查是否是模型过载错误（503或overloaded消息）
    const isOverloaded =
      error.response?.status === 503 ||
      error.message?.toLowerCase().includes('overload') ||
      error.response?.data?.error?.message?.toLowerCase().includes('overload')

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
          `1. 登录ThunderRelay平台 (https://cc.thunderrelay.com)\n` +
          `2. 前往账户设置，绑定Gemini专属账户\n` +
          `3. 或联系ThunderRelay管理员配置账户绑定\n` +
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

    // 如果是gemini-2.5-pro过载且未指定其他模型，降级到gemini-2.5-flash
    if (isOverloaded && model === 'gemini-2.5-pro') {
      console.warn(`⚠️ ${model} 模型过载，自动降级到 gemini-2.5-flash`)

      try {
        // 🔧 修复(2025-12-30): fallback也需要使用正确的API Key传递方式
        const fallbackRequestConfig = provider === 'relay'
          ? {
              headers: {
                'x-api-key': apiKey,
              },
            }
          : {
              params: {
                key: apiKey,
              },
            }

        const fallbackResponse = await client.post<GeminiResponse>(
          `/v1beta/models/gemini-2.5-flash:generateContent`,
          request,
          fallbackRequestConfig
        )

        // 检查fallback响应基本结构
        if (!fallbackResponse.data.candidates || fallbackResponse.data.candidates.length === 0) {
          console.error('Gemini API (fallback)响应结构异常: 没有候选响应')
          console.error('   - 完整响应:', JSON.stringify(fallbackResponse.data, null, 2))
          throw new Error('Gemini API (fallback) 返回了空响应（没有candidates）')
        }

        const fallbackCandidate = fallbackResponse.data.candidates[0]

        // 检查finishReason
        if (fallbackCandidate.finishReason === 'MAX_TOKENS') {
          console.error('❌ Gemini API (fallback) 输出达到token限制被截断')
          console.error('   - finishReason:', fallbackCandidate.finishReason)
          throw new Error('Gemini API (fallback) 输出达到token限制被截断')
        }

        // 检查content.parts
        if (
          !fallbackCandidate.content ||
          !fallbackCandidate.content.parts ||
          fallbackCandidate.content.parts.length === 0 ||
          !fallbackCandidate.content.parts[0].text
        ) {
          console.error('Gemini API (fallback)响应结构异常: content.parts为空')
          console.error('   - candidate:', fallbackCandidate)
          console.error('   - 完整响应:', JSON.stringify(fallbackResponse.data, null, 2))
          throw new Error('Gemini API (fallback) 返回了空响应（content.parts为空）')
        }

        const text = fallbackCandidate.content.parts[0].text
        console.log(`✓ Gemini API (fallback: gemini-2.5-flash) 调用成功，返回 ${text.length} 字符`)

        // 记录token使用情况
        let usage: GeminiAxiosGenerateResult['usage']
        if (fallbackResponse.data.usageMetadata) {
          usage = {
            inputTokens: fallbackResponse.data.usageMetadata.promptTokenCount || 0,
            outputTokens: fallbackResponse.data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: fallbackResponse.data.usageMetadata.totalTokenCount || 0
          }
        }

        return {
          text,
          usage,
          model: 'gemini-2.5-flash'
        }
      } catch (fallbackError: any) {
        // 降级模型也失败，抛出原始错误和降级错误
        throw new Error(
          `Gemini API调用失败。主模型(${model})错误: ${error.message}。` +
            `降级模型(gemini-2.5-flash)错误: ${fallbackError.message}`
        )
      }
    }

    // 其他错误（非过载或已经是flash模型），直接抛出
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
