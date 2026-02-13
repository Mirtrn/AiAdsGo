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
import { selectOptimalModel } from './model-selector'
import { GEMINI_PROVIDERS, type GeminiProvider } from './gemini-config'
import { getDatabase } from './db'
import {
  GEMINI_ACTIVE_MODEL,
  normalizeGeminiModel,
  normalizeModelForProvider,
} from './gemini-models'
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
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
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
  timeoutMs?: number
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

function mapModelForVertexAI(model: string): { model: string; reason?: string } {
  const normalized = normalizeModelForProvider(model, 'vertex')
  if (normalized !== model) {
    return {
      model: normalized,
      reason: `Vertex AI 不支持模型 ${model}，自动切换为 ${normalized}`,
    }
  }

  return { model: normalized }
}

/**
 * 检查用户是否配置了Vertex AI（只检查用户级配置）
 * @param userId - 用户ID（必需）
 */
async function isVertexAIConfigured(userId: number): Promise<boolean> {
  try {
    // 🔧 关键修复(2025-12-30): 使用 getSetting() 而非直接查询数据库
    // 保持与其他配置读取逻辑的一致性，避免未来出现类似 getGeminiApiKey 的bug
    const { getSetting } = await import('./settings')
    const providerSetting = await getSetting('ai', 'gemini_provider', userId)

    // Vertex AI 是否启用：优先使用 use_vertex_ai（设置页的AI模式开关），并兼容旧的 gemini_provider=vertex
    const useVertexAISetting = await getUserOnlySetting('ai', 'use_vertex_ai', userId)
    const useVertexAIValue = useVertexAISetting?.value
    const isVertexAIModeEnabled = (
      useVertexAIValue === 'true' ||
      useVertexAIValue === '1' ||
      providerSetting?.value === 'vertex'
    )

    // 检查 GCP 配置
    const gcpProjectId = await getUserOnlySetting('ai', 'gcp_project_id', userId)
    const gcpServiceAccountJson = await getUserOnlySetting('ai', 'gcp_service_account_json', userId)

    // 调试日志
    console.log(`🔍 Vertex AI配置检查 (用户ID: ${userId}):`)
    console.log(`   use_vertex_ai: ${useVertexAISetting?.value ?? '未配置'}`)
    console.log(`   gemini_provider: ${providerSetting?.value || 'official'}`)
    console.log(`   gcp_project_id: ${gcpProjectId?.value ? '已配置' : '未配置'}`)
    console.log(`   gcp_service_account_json: ${gcpServiceAccountJson?.value ? '已配置' : '未配置'}`)

    // Vertex AI 模式启用 且 配置了项目ID和Service Account
    const isConfigured = (
      isVertexAIModeEnabled &&
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
 * 支持三种provider：vertex（Vertex AI）、official（Google官方API）、relay（第三方中转）
 * @param userId - 用户ID（必需）
 */
async function isGeminiAPIConfigured(userId: number): Promise<boolean> {
  try {
    const { getSetting } = await import('./settings')
    const providerSetting = await getSetting('ai', 'gemini_provider', userId)
    const provider = providerSetting?.value || 'official'

    // 🔧 修复(2026-01-01): 支持 relay provider，检查对应的 relay API key
    if (provider === 'relay') {
      const relayApiKey = await getUserOnlySetting('ai', 'gemini_relay_api_key', userId)
      const isConfigured = !!relayApiKey?.value
      console.log(`🔍 Gemini API配置检查 (用户ID: ${userId}): relay provider`)
      console.log(`   gemini_relay_api_key: ${isConfigured ? '已配置' : '未配置'}`)
      return isConfigured
    } else {
      // official 或其他 provider（如 vertex 降级到 direct-api）
      const apiKey = await getUserOnlySetting('ai', 'gemini_api_key', userId)
      const isConfigured = !!apiKey?.value
      console.log(`🔍 Gemini API配置检查 (用户ID: ${userId}): ${provider} provider`)
      console.log(`   gemini_api_key: ${isConfigured ? '已配置' : '未配置'}`)
      return isConfigured
    }
  } catch (error) {
    console.error(`🔍 Gemini API配置检查失败:`, error)
    return false
  }
}

/**
 * 配置Vertex AI环境变量（从用户配置动态设置）
 * @param userId - 用户ID（必需）
 */
async function configureVertexAI(userId: number): Promise<void> {
  // 重置Vertex AI客户端以确保使用最新配置
  resetVertexAIClient()

  const gcpProjectId = (await getUserOnlySetting('ai', 'gcp_project_id', userId))?.value
  const gcpLocation = (await getUserOnlySetting('ai', 'gcp_location', userId))?.value || 'us-central1'
  const gcpServiceAccountJson = (await getUserOnlySetting('ai', 'gcp_service_account_json', userId))?.value

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
 * ✅ Token使用率监控：防止输出截断
 * 检查实际输出tokens是否接近maxOutputTokens限制
 * - 利用率 > 80%: 警告（可能需要增加限制）
 * - 利用率 = 100%: 错误（发生截断，必须增加限制）
 */
function checkTokenUtilization(
  outputTokens: number,
  maxOutputTokens: number,
  operationType?: string
): void {
  if (!outputTokens || !maxOutputTokens) return

  const utilization = outputTokens / maxOutputTokens
  const percentage = (utilization * 100).toFixed(1)

  if (utilization >= 1.0) {
    // 100%利用率 = 输出被截断，严重错误
    console.error(
      `🚨 Token截断错误: ${operationType || 'unknown'} ` +
      `输出${outputTokens}/${maxOutputTokens} tokens (${percentage}%) - 内容被截断！\n` +
      `⚠️ 必须增加maxOutputTokens配置以避免输出不完整`
    )
  } else if (utilization >= 0.8) {
    // 80%以上利用率 = 接近截断风险
    console.warn(
      `⚠️ Token高使用率警告: ${operationType || 'unknown'} ` +
      `输出${outputTokens}/${maxOutputTokens} tokens (${percentage}%) - 接近限制\n` +
      `💡 建议: 考虑适当增加maxOutputTokens配置`
    )
  } else {
    // 正常范围，记录日志
    console.log(
      `✅ Token使用正常: ${operationType || 'unknown'} ` +
      `输出${outputTokens}/${maxOutputTokens} tokens (${percentage}%)`
    )
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
    timeoutMs,
    operationType,
    enableAutoModelSelection = true, // 默认true，启用智能模型选择
    responseSchema,  // 🆕 Token优化：结构化JSON输出
    responseMimeType,  // 🆕 配合schema使用
  } = params

  // 智能模型选择（默认启用，可通过enableAutoModelSelection=false禁用）
  let finalModel = normalizeGeminiModel(requestedModel)
  if (enableAutoModelSelection && operationType) {
    const selection = await selectOptimalModel(operationType, userId, {
      hasResponseSchema: !!responseSchema
    })
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
  const hasVertexAI = await isVertexAIConfigured(userId)
  const hasGeminiAPI = await isGeminiAPIConfigured(userId)

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
      await configureVertexAI(userId)

      // 使用Vertex AI
      const { generateContent: vertexGenerate } = await import('./gemini-vertex')

      const vertexModelSelection = mapModelForVertexAI(finalModel)
      if (vertexModelSelection.reason && vertexModelSelection.model !== finalModel) {
        console.warn(`⚠️ ${vertexModelSelection.reason}`)
      }

      const result = await vertexGenerate({
        model: vertexModelSelection.model,
        prompt,
        temperature,
        maxOutputTokens,
        responseSchema,  // 🆕 传递JSON schema约束
        responseMimeType,  // 🆕 传递MIME类型
      })

      console.log('✓ Vertex AI 调用成功')

      // ✅ Token使用率监控
      if (result.usage?.outputTokens) {
        checkTokenUtilization(result.usage.outputTokens, maxOutputTokens, operationType)
      }

      return {
        text: result.text,
        usage: result.usage,
        model: result.model || vertexModelSelection.model,
        apiType: 'vertex-ai'
      }
    } catch (error: any) {
      console.warn(`⚠️ Vertex AI 调用失败: ${error.message}`)

      // 如果用户也配置了Gemini API，则降级
      if (hasGeminiAPI) {
        console.log('🔄 降级到用户的 Gemini 直接 API 模式...')
        return await callDirectAPI({ model: finalModel, prompt, temperature, maxOutputTokens, timeoutMs, operationType, responseSchema, responseMimeType }, userId)
      } else {
        // 用户只配置了Vertex AI，没有降级选项
        throw new Error(`Vertex AI 调用失败，且用户未配置 Gemini API 作为备选: ${error.message}`)
      }
    }
  }

  // 使用 Gemini API（用户没有配置Vertex AI）
  console.log(`🌐 使用用户(ID=${userId})的 Gemini 直接 API 配置`)
  return await callDirectAPI({ model: finalModel, prompt, temperature, maxOutputTokens, timeoutMs, operationType, responseSchema, responseMimeType }, userId)
}

/**
 * 调用Gemini直接API（直连，不使用代理，只使用用户级配置）
 * 支持三种provider：vertex（Vertex AI）、official（Google官方API）、relay（第三方中转）
 * @param userId - 用户ID（必需）
 */
async function callDirectAPI(
  params: GeminiGenerateParams,
  userId: number
): Promise<GeminiGenerateResult> {
  const { model, prompt, temperature, maxOutputTokens, timeoutMs, operationType, responseSchema, responseMimeType } = params

  const { getSetting } = await import('./settings')
  const providerSetting = await getSetting('ai', 'gemini_provider', userId)
  const provider = (providerSetting?.value || 'official') as GeminiProvider

  let apiKey: string | undefined

  // 🔧 修复(2026-01-01): 支持 relay provider
  if (provider === 'relay') {
    const relayApiKey = await getUserOnlySetting('ai', 'gemini_relay_api_key', userId)
    if (!relayApiKey?.value) {
      throw new Error(
        `用户(ID=${userId})未配置 Thunderrelay 中转 API 密钥。请在设置页面配置您自己的 relay API 密钥。`
      )
    }
    apiKey = relayApiKey.value as string
    console.log(`🌐 使用用户(ID=${userId})的 Thunderrelay 中转 API`)
  } else {
    // official 或其他 provider
    const apiKeySetting = await getUserOnlySetting('ai', 'gemini_api_key', userId)
    if (!apiKeySetting?.value) {
      throw new Error(
        `用户(ID=${userId})未配置 Gemini API 密钥。请在设置页面配置您自己的 Gemini API 密钥。`
      )
    }
    apiKey = apiKeySetting.value as string
    console.log(`🌐 使用用户(ID=${userId})的 Gemini 直接 API`)
  }

  // 使用代理模式调用（传递用户的API密钥和provider类型）
  const { generateContent: axiosGenerate } = await import('./gemini-axios')

  const effectiveModel = normalizeModelForProvider(model, provider)
  if (model && effectiveModel !== model) {
    console.warn(`⚠️ 服务商 ${provider} 不支持模型 ${model}，自动切换为 ${effectiveModel}`)
  }
  const baseParams = {
    model: effectiveModel,
    prompt,
    temperature,
    maxOutputTokens,
    timeoutMs,
    responseSchema,  // 🆕 传递JSON schema约束
    responseMimeType,  // 🆕 传递MIME类型
  }

  let result
  try {
    result = await axiosGenerate(baseParams, userId)
  } catch (error: any) {
    const message = String(error?.message || '')
    const isMaxTokens = error?.code === 'MAX_TOKENS' || message.includes('MAX_TOKENS') || message.includes('token限制')
    const shouldFallbackModel = isMaxTokens &&
      effectiveModel === GEMINI_ACTIVE_MODEL &&
      operationType === 'ad_creative_generation_main'

    if (shouldFallbackModel) {
      console.warn(`⚠️ ad_creative_generation_main MAX_TOKENS in ${GEMINI_ACTIVE_MODEL}, retry same model with upstream bump`)
      result = await axiosGenerate({
        ...baseParams,
        model: GEMINI_ACTIVE_MODEL,
      }, userId)
    } else {
      throw error
    }
  }

  // ✅ Token使用率监控
  if (result.usage?.outputTokens) {
    checkTokenUtilization(result.usage.outputTokens, maxOutputTokens || 8192, operationType)
  }

  return {
    text: result.text,
    usage: result.usage,
    model: result.model || effectiveModel,
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
export async function getGeminiMode(userId: number): Promise<'vertex-ai' | 'direct-api' | 'none'> {
  if (await isVertexAIConfigured(userId)) {
    return 'vertex-ai'
  }
  if (await isGeminiAPIConfigured(userId)) {
    return 'direct-api'
  }
  return 'none'
}
