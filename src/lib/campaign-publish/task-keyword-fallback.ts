export type CampaignKeywordConfigItem =
  | string
  | {
      text?: string
      keyword?: string
      [key: string]: unknown
    }

interface ResolveTaskKeywordParams {
  configuredKeywords: unknown
  configuredNegativeKeywords: unknown
  fallbackKeywords: string[]
  fallbackNegativeKeywords: string[]
}

interface ResolveTaskKeywordResult {
  keywords: CampaignKeywordConfigItem[]
  negativeKeywords: string[]
  usedKeywordFallback: boolean
  usedNegativeKeywordFallback: boolean
}

function hasNonEmptyKeywordText(item: unknown): boolean {
  if (typeof item === 'string') return item.trim().length > 0
  if (!item || typeof item !== 'object') return false
  const obj = item as Record<string, unknown>
  const candidate = typeof obj.text === 'string' ? obj.text : obj.keyword
  return typeof candidate === 'string' && candidate.trim().length > 0
}

function normalizeNegativeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

export function resolveTaskCampaignKeywords(
  params: ResolveTaskKeywordParams
): ResolveTaskKeywordResult {
  const hasConfiguredKeywords =
    Array.isArray(params.configuredKeywords)
    && params.configuredKeywords.some((item) => hasNonEmptyKeywordText(item))

  const normalizedConfiguredNegativeKeywords = normalizeNegativeKeywords(params.configuredNegativeKeywords)
  const hasConfiguredNegativeKeywords = normalizedConfiguredNegativeKeywords.length > 0

  return {
    keywords: hasConfiguredKeywords
      ? (params.configuredKeywords as CampaignKeywordConfigItem[])
      : params.fallbackKeywords,
    negativeKeywords: hasConfiguredNegativeKeywords
      ? normalizedConfiguredNegativeKeywords
      : params.fallbackNegativeKeywords,
    usedKeywordFallback: !hasConfiguredKeywords,
    usedNegativeKeywordFallback: !hasConfiguredNegativeKeywords,
  }
}
