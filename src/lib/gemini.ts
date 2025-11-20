/**
 * 统一的Gemini AI调用入口
 *
 * 智能路由逻辑：
 * 1. 优先使用 Vertex AI（如果用户配置了）
 * 2. 降级到 Gemini 直接 API（使用代理）
 *
 * 优势：
 * - Vertex AI: 企业级稳定性、无需代理、更好的SLA
 * - 直接API: 灵活配置、支持中国大陆代理访问
 */

import { getSetting } from './settings'
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
 * 检查Vertex AI配置是否完整
 */
function isVertexAIConfigured(userId?: number): boolean {
  try {
    const useVertexAI = getSetting('ai', 'use_vertex_ai', userId)
    const gcpProjectId = getSetting('ai', 'gcp_project_id', userId)
    const gcpServiceAccountJson = getSetting('ai', 'gcp_service_account_json', userId)

    // 必须明确启用Vertex AI，且配置了项目ID和Service Account
    return (
      useVertexAI?.value === 'true' &&
      !!gcpProjectId?.value &&
      !!gcpServiceAccountJson?.value
    )
  } catch (error) {
    console.log('⚠️ 检查Vertex AI配置失败，将使用直接API模式')
    return false
  }
}

/**
 * 配置Vertex AI环境变量（从数据库配置动态设置）
 */
function configureVertexAI(userId?: number): void {
  const gcpProjectId = getSetting('ai', 'gcp_project_id', userId)?.value
  const gcpLocation = getSetting('ai', 'gcp_location', userId)?.value || 'us-central1'
  const gcpServiceAccountJson = getSetting('ai', 'gcp_service_account_json', userId)?.value

  if (!gcpProjectId || !gcpServiceAccountJson) {
    throw new Error('Vertex AI配置不完整：缺少项目ID或Service Account JSON')
  }

  // 设置环境变量
  process.env.GCP_PROJECT_ID = gcpProjectId
  process.env.GCP_LOCATION = gcpLocation

  // 将Service Account JSON写入临时文件
  const tempDir = os.tmpdir()
  const credentialsPath = path.join(tempDir, `gcp-sa-${userId || 'global'}.json`)

  try {
    fs.writeFileSync(credentialsPath, gcpServiceAccountJson, 'utf8')
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath

    console.log(`✓ Vertex AI配置成功`)
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
 * 自动选择最佳调用方式：
 * - 优先使用 Vertex AI（如果已配置）
 * - 降级到 Gemini 直接 API（使用代理）
 *
 * @param params - 生成参数
 * @param userId - 用户ID（可选，用于读取用户级配置）
 * @returns 生成的文本内容
 */
export async function generateContent(
  params: GeminiGenerateParams,
  userId?: number
): Promise<string> {
  const {
    model = 'gemini-2.5-pro',
    prompt,
    temperature = 0.7,
    maxOutputTokens = 2048,
  } = params

  // 检查是否配置了Vertex AI
  if (isVertexAIConfigured(userId)) {
    try {
      console.log('🚀 使用 Vertex AI 模式')

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
      console.log('🔄 降级到 Gemini 直接 API 模式...')

      // 降级到直接API
      return await callDirectAPI({ model, prompt, temperature, maxOutputTokens }, userId)
    }
  } else {
    // 未配置Vertex AI，直接使用API模式
    console.log('🌐 使用 Gemini 直接 API 模式')
    return await callDirectAPI({ model, prompt, temperature, maxOutputTokens }, userId)
  }
}

/**
 * 调用Gemini直接API（使用代理）
 */
async function callDirectAPI(
  params: GeminiGenerateParams,
  userId?: number
): Promise<string> {
  const { model, prompt, temperature, maxOutputTokens } = params

  // 检查API密钥
  const apiKey = getSetting('ai', 'gemini_api_key', userId)
  if (!apiKey) {
    throw new Error(
      'Gemini API密钥未配置。请在设置页面配置 Gemini API 密钥或 Vertex AI 配置。'
    )
  }

  // 使用代理模式调用
  const { generateContent: axiosGenerate } = await import('./gemini-axios')

  return await axiosGenerate({
    model: model || 'gemini-2.5-pro',
    prompt,
    temperature,
    maxOutputTokens,
  })
}

/**
 * 检查Gemini连接状态
 *
 * @param userId - 用户ID（可选）
 * @returns 连接是否正常
 */
export async function checkGeminiConnection(userId?: number): Promise<boolean> {
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
    console.error('Gemini连接检查失败:', error)
    return false
  }
}

/**
 * 获取当前使用的Gemini模式
 *
 * @param userId - 用户ID（可选）
 * @returns 'vertex-ai' | 'direct-api'
 */
export function getGeminiMode(userId?: number): 'vertex-ai' | 'direct-api' {
  return isVertexAIConfigured(userId) ? 'vertex-ai' : 'direct-api'
}
