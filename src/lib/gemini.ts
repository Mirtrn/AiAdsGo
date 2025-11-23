/**
 * 统一的Gemini AI调用入口
 *
 * 智能路由逻辑：
 * 1. 优先使用 Vertex AI（如果用户配置了）
 * 2. 降级到 Gemini 直接 API（使用代理）
 *
 * 重要：只使用用户级配置，不存在全局AI配置
 * - 每个用户必须配置自己的 Vertex AI 或 Gemini API
 * - 如果用户没有配置，则报错
 */

import { getUserOnlySetting } from './settings'
import { resetVertexAIClient } from './gemini-vertex'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Gemini生成内容的参数接口
 */
export interface GeminiGenerateParams {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
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

    // 必须明确启用Vertex AI，且配置了项目ID和Service Account
    return (
      useVertexAI?.value === 'true' &&
      !!gcpProjectId?.value &&
      !!gcpServiceAccountJson?.value
    )
  } catch (error) {
    console.log('⚠️ 检查Vertex AI配置失败')
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
 * @returns 生成的文本内容
 */
export async function generateContent(
  params: GeminiGenerateParams,
  userId: number
): Promise<string> {
  // 校验userId
  if (!userId || typeof userId !== 'number' || userId <= 0) {
    throw new Error('AI调用失败：缺少有效的用户ID。每个AI操作必须关联到具体用户。')
  }

  const {
    model = 'gemini-2.5-pro',
    prompt,
    temperature = 0.7,
    maxOutputTokens = 2048,
  } = params

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
        model,
        prompt,
        temperature,
        maxOutputTokens,
      })

      console.log('✓ Vertex AI 调用成功')
      return result
    } catch (error: any) {
      console.warn(`⚠️ Vertex AI 调用失败: ${error.message}`)

      // 如果用户也配置了Gemini API，则降级
      if (hasGeminiAPI) {
        console.log('🔄 降级到用户的 Gemini 直接 API 模式...')
        return await callDirectAPI({ model, prompt, temperature, maxOutputTokens }, userId)
      } else {
        // 用户只配置了Vertex AI，没有降级选项
        throw new Error(`Vertex AI 调用失败，且用户未配置 Gemini API 作为备选: ${error.message}`)
      }
    }
  }

  // 使用 Gemini API（用户没有配置Vertex AI）
  console.log(`🌐 使用用户(ID=${userId})的 Gemini 直接 API 配置`)
  return await callDirectAPI({ model, prompt, temperature, maxOutputTokens }, userId)
}

/**
 * 调用Gemini直接API（使用代理，只使用用户级配置）
 * @param userId - 用户ID（必需）
 */
async function callDirectAPI(
  params: GeminiGenerateParams,
  userId: number
): Promise<string> {
  const { model, prompt, temperature, maxOutputTokens } = params

  // 检查用户的API密钥配置
  const apiKey = getUserOnlySetting('ai', 'gemini_api_key', userId)
  if (!apiKey?.value) {
    throw new Error(
      `用户(ID=${userId})未配置 Gemini API 密钥。请在设置页面配置您自己的 Gemini API 密钥。`
    )
  }

  // 使用代理模式调用（传递用户的API密钥）
  const { generateContent: axiosGenerate } = await import('./gemini-axios')

  return await axiosGenerate({
    model: model || 'gemini-2.5-pro',
    prompt,
    temperature,
    maxOutputTokens,
  }, userId)
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
