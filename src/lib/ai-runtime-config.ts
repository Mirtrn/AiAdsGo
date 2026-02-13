import { getGeminiEndpoint, type GeminiProvider } from './gemini-config'
import { GEMINI_ACTIVE_MODEL, type AIModel, normalizeModelForProvider } from './gemini-models'
import { getUserOnlySetting } from './settings'

export interface ResolvedAIConfig {
  type: 'vertex-ai' | 'gemini-api' | null
  provider: GeminiProvider
  model: AIModel
  endpoint: string
  vertexAI?: {
    projectId: string
    location: string
    model: AIModel
  }
  geminiAPI?: {
    apiKey: string
    model: AIModel
    provider: 'official' | 'relay'
    endpoint: string
  }
}

function normalizeProvider(value?: string | null): GeminiProvider {
  if (value === 'official' || value === 'relay' || value === 'vertex') {
    return value
  }

  return 'official'
}

function isTrue(value?: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

/**
 * 统一解析用户当前生效的 AI 配置。
 *
 * 规则：
 * 1. 仅使用用户级配置（不回退全局）
 * 2. Vertex 模式优先（use_vertex_ai=true 或 provider=vertex，且配置完整）
 * 3. 直连模式下严格按 provider 取 key，不跨 provider 混用 key
 * 4. 只返回“最后保存并可生效”的单一模型
 */
export async function resolveActiveAIConfig(userId: number): Promise<ResolvedAIConfig> {
  const fallbackModel = GEMINI_ACTIVE_MODEL
  const fallbackProvider: GeminiProvider = 'official'
  const fallbackEndpoint = getGeminiEndpoint(fallbackProvider, fallbackModel)

  if (!userId || userId <= 0) {
    return {
      type: null,
      provider: fallbackProvider,
      model: fallbackModel,
      endpoint: fallbackEndpoint,
    }
  }

  const [
    providerSetting,
    modelSetting,
    useVertexAISetting,
    gcpProjectIdSetting,
    gcpLocationSetting,
    gcpServiceAccountJsonSetting,
    officialApiKeySetting,
    relayApiKeySetting,
  ] = await Promise.all([
    getUserOnlySetting('ai', 'gemini_provider', userId),
    getUserOnlySetting('ai', 'gemini_model', userId),
    getUserOnlySetting('ai', 'use_vertex_ai', userId),
    getUserOnlySetting('ai', 'gcp_project_id', userId),
    getUserOnlySetting('ai', 'gcp_location', userId),
    getUserOnlySetting('ai', 'gcp_service_account_json', userId),
    getUserOnlySetting('ai', 'gemini_api_key', userId),
    getUserOnlySetting('ai', 'gemini_relay_api_key', userId),
  ])

  const rawProvider = normalizeProvider(providerSetting?.value)
  const useVertexAIMode = isTrue(useVertexAISetting?.value) || rawProvider === 'vertex'
  const directProvider: 'official' | 'relay' = rawProvider === 'relay' ? 'relay' : 'official'

  const vertexModel = normalizeModelForProvider(modelSetting?.value || fallbackModel, 'vertex')
  const directModel = normalizeModelForProvider(modelSetting?.value || fallbackModel, directProvider)

  const gcpProjectId = gcpProjectIdSetting?.value || ''
  const gcpLocation = gcpLocationSetting?.value || 'us-central1'
  const gcpServiceAccountJson = gcpServiceAccountJsonSetting?.value || ''

  if (useVertexAIMode && gcpProjectId && gcpServiceAccountJson) {
    return {
      type: 'vertex-ai',
      provider: 'vertex',
      model: vertexModel,
      endpoint: 'vertex',
      vertexAI: {
        projectId: gcpProjectId,
        location: gcpLocation,
        model: vertexModel,
      },
    }
  }

  const directApiKey = directProvider === 'relay'
    ? relayApiKeySetting?.value || ''
    : officialApiKeySetting?.value || ''
  const directEndpoint = getGeminiEndpoint(directProvider, directModel)

  if (directApiKey) {
    return {
      type: 'gemini-api',
      provider: directProvider,
      model: directModel,
      endpoint: directEndpoint,
      geminiAPI: {
        apiKey: directApiKey,
        model: directModel,
        provider: directProvider,
        endpoint: directEndpoint,
      },
    }
  }

  return {
    type: null,
    provider: directProvider,
    model: directModel,
    endpoint: directEndpoint,
  }
}
