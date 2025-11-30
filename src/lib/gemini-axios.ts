/**
 * 使用 axios 调用 Gemini API
 *
 * 重要：
 * 1. API密钥从用户配置获取，不使用全局配置
 * 2. 不使用代理，直接访问Google API
 */

import axios, { AxiosInstance } from 'axios'
import { getUserOnlySetting } from './settings'

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
 * 创建 axios 实例用于 Gemini API（直连，不使用代理）
 */
export function createGeminiAxiosClient(): AxiosInstance {
  return axios.create({
    baseURL: 'https://generativelanguage.googleapis.com',
    timeout: 60000, // 60秒超时
    headers: {
      'Content-Type': 'application/json',
    },
  })
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
 * @returns 生成的文本内容
 */
export async function generateContent(params: {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  responseSchema?: any  // 🆕 Token优化：JSON schema
  responseMimeType?: string  // 🆕 Token优化：MIME类型
}, userId: number): Promise<GeminiAxiosGenerateResult> {
  const {
    model = 'gemini-2.5-pro',
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    responseSchema,  // 🆕 Token优化：JSON schema
    responseMimeType,  // 🆕 Token优化：MIME类型
  } = params

  // 从用户配置获取API密钥（不使用全局配置）
  const apiKeySetting = getUserOnlySetting('ai', 'gemini_api_key', userId)
  const apiKey = apiKeySetting?.value
  if (!apiKey) {
    throw new Error(`用户(ID=${userId})未配置 Gemini API 密钥。请在设置页面配置您自己的 API 密钥。`)
  }

  // 创建 axios 客户端（直连，不使用代理）
  const client = createGeminiAxiosClient()
  console.log(`🌐 直接访问Gemini API（不使用代理）`)

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

    const response = await client.post<GeminiResponse>(
      `/v1beta/models/${model}:generateContent`,
      request,
      {
        params: {
          key: apiKey,
        },
      }
    )

    // 提取响应文本
    if (
      !response.data.candidates ||
      response.data.candidates.length === 0 ||
      !response.data.candidates[0].content.parts ||
      response.data.candidates[0].content.parts.length === 0
    ) {
      throw new Error('Gemini API 返回了空响应')
    }

    const text = response.data.candidates[0].content.parts[0].text
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
    // 检查是否是模型过载错误（503或overloaded消息）
    const isOverloaded =
      error.response?.status === 503 ||
      error.message?.toLowerCase().includes('overload') ||
      error.response?.data?.error?.message?.toLowerCase().includes('overload')

    // 如果是gemini-2.5-pro过载且未指定其他模型，降级到gemini-2.5-flash
    if (isOverloaded && model === 'gemini-2.5-pro') {
      console.warn(`⚠️ ${model} 模型过载，自动降级到 gemini-2.5-flash`)

      try {
        const fallbackResponse = await client.post<GeminiResponse>(
          `/v1beta/models/gemini-2.5-flash:generateContent`,
          request,
          {
            params: {
              key: apiKey,
            },
          }
        )

        if (
          !fallbackResponse.data.candidates ||
          fallbackResponse.data.candidates.length === 0 ||
          !fallbackResponse.data.candidates[0].content.parts ||
          fallbackResponse.data.candidates[0].content.parts.length === 0
        ) {
          throw new Error('Gemini API (fallback) 返回了空响应')
        }

        const text = fallbackResponse.data.candidates[0].content.parts[0].text
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
    throw new Error(`Gemini API调用失败: ${error.message}`)
  }
}
