/**
 * 使用 Vertex AI 调用 Gemini API
 * 优势：
 * 1. 无需代理，直接通过 Service Account 认证
 * 2. 企业级稳定性和 SLA
 * 3. 更好的错误处理和重试机制
 */

import { VertexAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai'
import * as path from 'path'

// 单例 VertexAI 客户端和当前配置
let vertexAI: VertexAI | null = null
let currentConfig: {
  projectId: string
  location: string
  credentialsPath: string
} | null = null

/**
 * 重置 VertexAI 客户端（当配置变更时调用）
 */
export function resetVertexAIClient(): void {
  vertexAI = null
  currentConfig = null
  console.log('🔄 Vertex AI 客户端已重置')
}

/**
 * 获取 VertexAI 客户端（带配置变更检测）
 * 每次调用都检查当前环境变量，如果配置变了就重新初始化
 */
function getVertexAI(): VertexAI {
  // 获取当前环境变量配置（每次都读取最新值）
  const projectId = process.env.GCP_PROJECT_ID
  const location = process.env.GCP_LOCATION || 'us-central1'
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(process.cwd(), 'docs/secrets/gcp_autoads_dev.json')

  // 检查是否需要重新初始化（配置变更或首次初始化）
  const needsReinit = !vertexAI || !currentConfig ||
    currentConfig.projectId !== projectId ||
    currentConfig.location !== location ||
    currentConfig.credentialsPath !== credentialsPath

  if (needsReinit) {
    if (!projectId) {
      throw new Error('Vertex AI配置错误：缺少GCP_PROJECT_ID环境变量')
    }

    if (!credentialsPath) {
      throw new Error('Vertex AI配置错误：缺少GOOGLE_APPLICATION_CREDENTIALS环境变量')
    }

    console.log(`🔧 初始化 Vertex AI 客户端...`)
    console.log(`   Project: ${projectId}`)
    console.log(`   Location: ${location}`)
    console.log(`   Credentials: ${credentialsPath}`)

    // 直接传递凭证文件路径，而不是依赖环境变量
    // 这样可以确保在运行时动态设置的凭证被正确使用
    vertexAI = new VertexAI({
      project: projectId,
      location: location,
      googleAuthOptions: {
        keyFilename: credentialsPath,
      },
    })

    // 保存当前配置用于后续比较
    currentConfig = {
      projectId,
      location,
      credentialsPath,
    }

    console.log('✓ Vertex AI 客户端初始化成功')
  }

  // TypeScript确保vertexAI在此处非null
  if (!vertexAI) {
    throw new Error('Vertex AI客户端初始化失败')
  }

  return vertexAI
}

/**
 * 获取生成模型
 */
function getGenerativeModel(modelName: string): GenerativeModel {
  const client = getVertexAI()

  return client.getGenerativeModel({
    model: modelName,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ],
  })
}

/**
 * 带重试的延迟函数
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 调用 Vertex AI Gemini API 生成内容（带自动降级和重试）
 *
 * @param params - 生成参数
 * @param params.model - 模型名称，默认 'gemini-2.5-pro'
 *   支持的模型：
 *   - gemini-2.5-pro (稳定版，推荐)
 *   - gemini-2.5-flash (快速版)
 *   - gemini-2.5-flash-lite (轻量版)
 *   - gemini-3-pro-preview-11-2025 (预览版，最新)
 * @param params.prompt - 提示词
 * @param params.temperature - 温度参数，默认 0.7
 * @param params.maxOutputTokens - 最大输出tokens，默认 2048
 * @returns 生成的文本内容
 */
export async function generateContent(params: {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
}): Promise<string> {
  const {
    model = 'gemini-2.5-pro',
    prompt,
    temperature = 0.7,
    maxOutputTokens = 2048,
  } = params

  const maxRetries = 3
  let lastError: Error | null = null

  // 尝试主模型
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 调用 Vertex AI: ${model} (尝试 ${attempt}/${maxRetries})`)

      const generativeModel = getGenerativeModel(model)

      const result = await generativeModel.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens,
        },
      })

      const response = result.response

      if (!response.candidates || response.candidates.length === 0) {
        throw new Error('Vertex AI 返回了空响应')
      }

      const candidate = response.candidates[0]

      // 检查finishReason以诊断截断问题
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        console.warn(`⚠️ Vertex AI 输出被截断: ${candidate.finishReason}`)
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn(`   原因: 达到maxOutputTokens限制 (当前: ${maxOutputTokens})`)
          console.warn(`   ⚠️  建议: 增加maxOutputTokens或精简prompt`)
        } else if (candidate.finishReason === 'SAFETY') {
          console.warn(`   原因: 安全过滤触发`)
          if (candidate.safetyRatings) {
            console.warn(`   安全评级:`, JSON.stringify(candidate.safetyRatings))
          }
        }
        // 注意：即使被截断，仍然尝试返回部分内容（下游可以尝试解析）
      }

      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        throw new Error('Vertex AI 响应中没有内容')
      }

      const text = candidate.content.parts
        .map(part => part.text || '')
        .join('')

      if (!text) {
        throw new Error('Vertex AI 返回了空文本')
      }

      console.log(`✓ Vertex AI 调用成功，返回 ${text.length} 字符`)

      // 记录token使用情况
      if (response.usageMetadata) {
        console.log(`   Token使用: prompt=${response.usageMetadata.promptTokenCount}, ` +
          `output=${response.usageMetadata.candidatesTokenCount}, ` +
          `total=${response.usageMetadata.totalTokenCount}`)
      }

      return text
    } catch (error: any) {
      lastError = error
      console.warn(`⚠️ Vertex AI 调用失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`)
      console.error('完整错误信息:', JSON.stringify({
        message: error.message,
        code: error.code,
        status: error.status,
        statusCode: error.statusCode,
        details: error.details,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      }, null, 2))

      // 检查是否是可重试的错误
      const isRetryable =
        error.message?.includes('503') ||
        error.message?.includes('overload') ||
        error.message?.includes('RESOURCE_EXHAUSTED') ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('DEADLINE_EXCEEDED') ||
        error.message?.includes('timeout') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT'

      if (isRetryable && attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000 // 指数退避: 2s, 4s, 8s
        console.log(`   等待 ${waitTime / 1000}s 后重试...`)
        await delay(waitTime)
        continue
      }

      // 不可重试或已用完重试次数
      break
    }
  }

  // 主模型失败，尝试降级到 flash 模型
  if (model.includes('pro')) {
    const fallbackModel = 'gemini-2.5-flash'
    console.warn(`⚠️ ${model} 调用失败，降级到 ${fallbackModel}`)

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 调用 Vertex AI (降级): ${fallbackModel} (尝试 ${attempt}/${maxRetries})`)

        const generativeModel = getGenerativeModel(fallbackModel)

        const result = await generativeModel.generateContent({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens,
          },
        })

        const response = result.response

        if (!response.candidates || response.candidates.length === 0) {
          throw new Error('Vertex AI (fallback) 返回了空响应')
        }

        const candidate = response.candidates[0]

        if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
          throw new Error('Vertex AI (fallback) 响应中没有内容')
        }

        const text = candidate.content.parts
          .map(part => part.text || '')
          .join('')

        if (!text) {
          throw new Error('Vertex AI (fallback) 返回了空文本')
        }

        console.log(`✓ Vertex AI (fallback: ${fallbackModel}) 调用成功，返回 ${text.length} 字符`)

        return text
      } catch (fallbackError: any) {
        console.warn(`⚠️ Vertex AI (fallback) 调用失败 (尝试 ${attempt}/${maxRetries}): ${fallbackError.message}`)

        if (attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000
          console.log(`   等待 ${waitTime / 1000}s 后重试...`)
          await delay(waitTime)
          continue
        }

        // 降级模型也失败
        throw new Error(
          `Vertex AI 调用失败。主模型(${model})错误: ${lastError?.message}。` +
          `降级模型(${fallbackModel})错误: ${fallbackError.message}`
        )
      }
    }
  }

  // 所有尝试都失败
  throw new Error(`Vertex AI 调用失败: ${lastError?.message}`)
}

/**
 * 检查 Vertex AI 连接状态
 */
export async function checkVertexAIConnection(): Promise<boolean> {
  try {
    const model = getGenerativeModel('gemini-2.5-flash')
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 10,
      },
    })

    return !!(result.response.candidates && result.response.candidates.length > 0)
  } catch (error) {
    console.error('Vertex AI 连接检查失败:', error)
    return false
  }
}
