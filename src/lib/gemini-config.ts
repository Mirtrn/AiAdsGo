/**
 * Gemini API 服务商配置
 *
 * 职责：统一管理 Gemini API 的服务商端点和配置信息
 *
 * 支持的服务商：
 * - official: Google Gemini 官方 API
 * - relay: 第三方中转服务（Thunderrelay）
 * - vertex: Google Vertex AI（企业级）
 */

/**
 * Gemini API 服务商配置
 */
export const GEMINI_PROVIDERS = {
  official: {
    name: 'Gemini 官方',
    endpoint: 'https://generativelanguage.googleapis.com',
    apiKeyUrl: 'https://aistudio.google.com/app/api-keys',
    description: '直接连接 Google Gemini API',
    icon: '🌐',
  },
  relay: {
    name: '第三方中转',
    endpoint: 'https://cc.thunderrelay.com/gemini',
    apiKeyUrl: 'https://cc.thunderrelay.com/user-register?ref=4K5GVEY2',
    description: '通过国内中转服务访问（更快更稳定）',
    icon: '⚡',
  },
  vertex: {
    name: 'Vertex AI',
    endpoint: 'vertex', // 特殊标识，不是实际 URL
    apiKeyUrl: null,
    description: '使用 Google Cloud Vertex AI（需配置服务账号）',
    icon: '☁️',
  },
} as const

/**
 * Gemini 服务商类型
 */
export type GeminiProvider = keyof typeof GEMINI_PROVIDERS

/**
 * 根据服务商获取端点 URL
 *
 * @param provider - 服务商类型
 * @returns 端点 URL
 *
 * @example
 * getGeminiEndpoint('official') // 'https://generativelanguage.googleapis.com'
 * getGeminiEndpoint('relay') // 'https://cc.thunderrelay.com/gemini'
 */
export function getGeminiEndpoint(provider: GeminiProvider): string {
  return GEMINI_PROVIDERS[provider]?.endpoint || GEMINI_PROVIDERS.official.endpoint
}

/**
 * 根据服务商获取 API Key 获取地址
 *
 * @param provider - 服务商类型
 * @returns API Key 获取地址（Vertex AI 返回 null）
 *
 * @example
 * getGeminiApiKeyUrl('official') // 'https://aistudio.google.com/app/api-keys'
 * getGeminiApiKeyUrl('relay') // 'https://cc.thunderrelay.com/user-register?ref=4K5GVEY2'
 * getGeminiApiKeyUrl('vertex') // null
 */
export function getGeminiApiKeyUrl(provider: GeminiProvider): string | null {
  return GEMINI_PROVIDERS[provider]?.apiKeyUrl || null
}

/**
 * 验证服务商类型是否有效
 *
 * @param provider - 要验证的服务商类型
 * @returns 是否有效
 */
export function isValidProvider(provider: string): provider is GeminiProvider {
  return provider in GEMINI_PROVIDERS
}
