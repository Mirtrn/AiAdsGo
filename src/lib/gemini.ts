/**
 * 统一的Gemini AI调用入口
 *
 * 智能路由逻辑：
 * 1. 优先使用 Vertex AI（如果用户配置了）
 * 2. 降级到 Gemini 直接 API（不使用代理，直连）
 *
 * 重要：只使用用户级配置，不存在全局AI配置
 * - 每个用户必须配置自己的 Vertex AI 或 Gemini API
 * - 如果用户没有配置，则报错
 * - AI API调用不使用代理（代理仅用于网页爬取）
 *
 * 新功能（Token优化）：
 * - 可选的智能模型选择：Pro vs Flash
 * - 通过operationType自动选择最优模型
 * - 默认行为不变，确保零破坏性
 */

import { getUserOnlySetting } from './settings'
import { resetVertexAIClient } from './gemini-vertex'
import { selectOptimalModel, type ModelType } from './model-selector'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * JSON Schema类型定义（符合OpenAPI 3.0规范）
 */
export interface ResponseSchema {
  type?: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT'
  format?: string
  description?: string
  nullable?: boolean
  items?: ResponseSchema
  enum?: string[]
  properties?: {
    [key: string]: ResponseSchema
  }
  required?: string[]
  example?: unknown
}

/**
 * Gemini生成内容的参数接口
 */
export interface GeminiGenerateParams {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  operationType?: string // 用于智能模型选择（可选）
  enableAutoModelSelection?: boolean // 启用自动模型选择（默认false，零破坏性）
  responseSchema?: ResponseSchema  // 🆕 Token优化：结构化JSON输出约束
  responseMimeType?: string  // 🆕 配合responseSchema使用（默认'application/json'）
}

/**
 * Gemini生成内容的返回结果接口
 */
export interface GeminiGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
  apiType: 'vertex-ai' | 'direct-api'
}

/**
 * 检查用户是否配置了Vertex AI（只检查用户级配置）
 * @param userId - 用户ID（必需）
 */
function isVertexAIConfigured(userId: number): boolean {
  try {
    const useVertexAI = getUserOnlySetting('ai', 'use_vertex_ai', userId)
    const gcpProjectId = getUserOnlySetting('ai', 'gcp_project_id', userId)
    const gcpServiceAccountJson = getUserOnlySetting('ai', 'gcp_service_account_json', userId)

    // 调试日志
    console.log(`🔍 Vertex AI配置检查 (用户ID: ${userId}):`)
    console.log(`   use_vertex_ai: ${useVertexAI?.value} (类型: ${typeof useVertexAI?.value})`)
    console.log(`   gcp_project_id: ${gcpProjectId?.value ? '已配置' : '未配置'}`)
    console.log(`   gcp_service_account_json: ${gcpServiceAccountJson?.value ? '已配置' : '未配置'}`)

    // 必须明确启用Vertex AI，且配置了项目ID和Service Account
    const isConfigured = (
      useVertexAI?.value === 'true' &&
      !!gcpProjectId?.value &&
      !!gcpServiceAccountJson?.value
    )
    console.log(`   → Vertex AI已配置: ${isConfigured}`)
    return isConfigured
  } catch (error: any) {
    console.log(`⚠️ 检查Vertex AI配置失败: ${error.message}`)
    return false
  }
}

/**
 * 检查用户是否配置了Gemini API（只检查用户级配置）
 * @param userId - 用户ID（必需）
 */
function isGeminiAPIConfigured(userId: number): boolean {
  try {
    const apiKey = getUserOnlySetting('ai', 'gemini_api_key', userId)
    return !!apiKey?.value
  } catch (error) {
    return false
  }
}

/**
 * 配置Vertex AI环境变量（从用户配置动态设置）
 * @param userId - 用户ID（必需）
 */
function configureVertexAI(userId: number): void {
  // 重置Vertex AI客户端以确保使用最新配置
  resetVertexAIClient()

  const gcpProjectId = getUserOnlySetting('ai', 'gcp_project_id', userId)?.value
  const gcpLocation = getUserOnlySetting('ai', 'gcp_location', userId)?.value || 'us-central1'
  const gcpServiceAccountJson = getUserOnlySetting('ai', 'gcp_service_account_json', userId)?.value

  if (!gcpProjectId || !gcpServiceAccountJson) {
    throw new Error('Vertex AI配置不完整：缺少项目ID或Service Account JSON')
  }

  // 设置环境变量
  process.env.GCP_PROJECT_ID = gcpProjectId
  process.env.GCP_LOCATION = gcpLocation

  // 将Service Account JSON写入临时文件（每用户独立文件）
  const tempDir = os.tmpdir()
  const credentialsPath = path.join(tempDir, `gcp-sa-user-${userId}.json`)

  try {
    fs.writeFileSync(credentialsPath, gcpServiceAccountJson, 'utf8')
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath

    console.log(`✓ Vertex AI配置成功 (用户ID: ${userId})`)
    console.log(`  Project: ${gcpProjectId}`)
    console.log(`  Location: ${gcpLocation}`)
    console.log(`  Credentials: ${credentialsPath}`)
  } catch (error) {
    throw new Error(`写入Service Account凭证失败: ${error}`)
  }
}

/**
 * 统一的Gemini内容生成接口
 *
 * 路由逻辑（只使用用户级配置）：
 * 1. 优先使用用户配置的 Vertex AI
 * 2. 其次使用用户配置的 Gemini API
 * 3. 如果用户都没有配置，报错
 *
 * 重要：不存在全局AI配置，每个用户必须配置自己的AI
 *
 * @param params - 生成参数
 * @param userId - 用户ID（必需，用于读取用户级配置）
 * @returns 生成的文本内容和token使用信息
 */
export async function generateContent(
  params: GeminiGenerateParams,
  userId: number
): Promise<GeminiGenerateResult> {
  // 校验userId
  if (!userId || typeof userId !== 'number' || userId <= 0) {
    throw new Error('AI调用失败：缺少有效的用户ID。每个AI操作必须关联到具体用户。')
  }

  const {
    model: requestedModel,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    operationType,
    enableAutoModelSelection = true, // 默认true，启用智能模型选择
    responseSchema,  // 🆕 Token优化：结构化JSON输出
    responseMimeType,  // 🆕 配合schema使用
  } = params

  // 智能模型选择（默认启用，可通过enableAutoModelSelection=false禁用）
  let finalModel = requestedModel || 'gemini-2.5-pro'
  if (enableAutoModelSelection && operationType) {
    const selection = selectOptimalModel(operationType, userId) // 传递userId获取用户模型偏好
    finalModel = selection.model
    console.log(`🤖 智能模型选择 (User ${userId}): ${operationType} → ${finalModel} (${selection.reason})`)
  } else if (requestedModel) {
    // 如果显式指定model，则使用指定的模型
    console.log(`📝 使用显式指定模型: ${finalModel}`)
  } else {
    // 没有operationType且没有指定model，使用Pro（向后兼容）
    console.log(`⚠️ 未指定operationType，默认使用Pro模型`)
  }

  // 检查用户是否配置了任何AI
  const hasVertexAI = isVertexAIConfigured(userId)
  const hasGeminiAPI = isGeminiAPIConfigured(userId)

  if (!hasVertexAI && !hasGeminiAPI) {
    throw new Error(
      `AI配置缺失：用户(ID=${userId})尚未配置任何AI服务。\n` +
      `请在设置页面配置 Vertex AI 或 Gemini API 密钥。\n` +
      `注意：系统不支持全局AI配置，每个用户必须配置自己的AI凭证。`
    )
  }

  // 优先使用 Vertex AI
  if (hasVertexAI) {
    try {
      console.log(`🚀 使用用户(ID=${userId})的 Vertex AI 配置`)

      // 动态配置Vertex AI环境
      configureVertexAI(userId)

      // 使用Vertex AI
      const { generateContent: vertexGenerate } = await import('./gemini-vertex')

      const result = await vertexGenerate({
        model: finalModel, // 使用智能选择的模型
        prompt,
        temperature,
        maxOutputTokens,
        responseSchema,  // 🆕 传递JSON schema约束
        responseMimeType,  // 🆕 传递MIME类型
      })

      console.log('✓ Vertex AI 调用成功')
      return {
        text: result.text,
        usage: result.usage,
        model: result.model || finalModel,
        apiType: 'vertex-ai'
      }
    } catch (error: any) {
      console.warn(`⚠️ Vertex AI 调用失败: ${error.message}`)

      // 如果用户也配置了Gemini API，则降级
      if (hasGeminiAPI) {
        console.log('🔄 降级到用户的 Gemini 直接 API 模式...')
        return await callDirectAPI({ model: finalModel, prompt, temperature, maxOutputTokens, responseSchema, responseMimeType }, userId)
      } else {
        // 用户只配置了Vertex AI，没有降级选项
        throw new Error(`Vertex AI 调用失败，且用户未配置 Gemini API 作为备选: ${error.message}`)
      }
    }
  }

  // 使用 Gemini API（用户没有配置Vertex AI）
  console.log(`🌐 使用用户(ID=${userId})的 Gemini 直接 API 配置`)
  return await callDirectAPI({ model: finalModel, prompt, temperature, maxOutputTokens, responseSchema, responseMimeType }, userId)
}

/**
 * 调用Gemini直接API（直连，不使用代理，只使用用户级配置）
 * @param userId - 用户ID（必需）
 */
async function callDirectAPI(
  params: GeminiGenerateParams,
  userId: number
): Promise<GeminiGenerateResult> {
  const { model, prompt, temperature, maxOutputTokens, responseSchema, responseMimeType } = params

  // 检查用户的API密钥配置
  const apiKey = getUserOnlySetting('ai', 'gemini_api_key', userId)
  if (!apiKey?.value) {
    throw new Error(
      `用户(ID=${userId})未配置 Gemini API 密钥。请在设置页面配置您自己的 Gemini API 密钥。`
    )
  }

  // 使用代理模式调用（传递用户的API密钥）
  const { generateContent: axiosGenerate } = await import('./gemini-axios')

  const result = await axiosGenerate({
    model: model || 'gemini-2.5-pro',
    prompt,
    temperature,
    maxOutputTokens,
    responseSchema,  // 🆕 传递JSON schema约束
    responseMimeType,  // 🆕 传递MIME类型
  }, userId)

  return {
    text: result.text,
    usage: result.usage,
    model: result.model || model || 'gemini-2.5-pro',
    apiType: 'direct-api'
  }
}

/**
 * 检查用户的Gemini连接状态
 *
 * @param userId - 用户ID（必需）
 * @returns 连接是否正常
 */
export async function checkGeminiConnection(userId: number): Promise<boolean> {
  try {
    await generateContent(
      {
        prompt: 'Hello',
        maxOutputTokens: 10,
      },
      userId
    )
    return true
  } catch (error) {
    console.error(`用户(ID=${userId})的Gemini连接检查失败:`, error)
    return false
  }
}

/**
 * 获取用户当前使用的Gemini模式
 *
 * @param userId - 用户ID（必需）
 * @returns 'vertex-ai' | 'direct-api' | 'none'
 */
export function getGeminiMode(userId: number): 'vertex-ai' | 'direct-api' | 'none' {
  if (isVertexAIConfigured(userId)) {
    return 'vertex-ai'
  }
  if (isGeminiAPIConfigured(userId)) {
    return 'direct-api'
  }
  return 'none'
}
