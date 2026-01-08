/**
 * Offer category utilities
 * src/lib/offer-category.ts
 */

export function compactCategoryLabel(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) return ''

  const withoutPrefix = raw.replace(/^\s*(category|产品分类)\s*[:：]\s*/i, '').trim()

  const parts = withoutPrefix
    .split(/(?:\s*[›»>\/|]\s*|\s*→\s*|\r?\n)+/g)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((p) => !isNoiseCategorySegment(p))

  const candidate = (parts.length > 0 ? parts[parts.length - 1] : withoutPrefix)
    .replace(/\s+/g, ' ')
    .trim()

  if (!candidate) return ''

  // Guardrail: category should be short; if AI returns a sentence, keep the first clause.
  const firstClause = candidate.split(/[.。!！?？;；]\s*/)[0].trim()
  const finalValue = firstClause || candidate

  return finalValue.length > 80 ? finalValue.slice(0, 80).trim() : finalValue
}

function isNoiseCategorySegment(segment: string): boolean {
  const s = segment.trim().toLowerCase()
  if (!s) return true

  // Common breadcrumb noise / generic buckets that reduce accuracy.
  const noise = new Set([
    'home',
    'homepage',
    'all',
    'all departments',
    'departments',
    'shop',
    'store',
    'stores',
    'products',
    'product',
    'category',
    'categories',
  ])
  if (noise.has(s)) return true

  // Numbers-only / separator-only.
  if (!/\p{L}/u.test(segment)) return true

  return false
}

export function deriveCategoryFromScrapedData(scrapedDataJson: string | null | undefined): string | null {
  if (!scrapedDataJson) return null

  const parsed = safeJsonParse(scrapedDataJson)
  if (!parsed || typeof parsed !== 'object') return null

  // Store pages: prefer aggregated primary categories if available.
  const primaryCategories = (parsed as any)?.productCategories?.primaryCategories
  if (Array.isArray(primaryCategories) && primaryCategories.length > 0) {
    const top = [...primaryCategories]
      .filter((c) => c && typeof c.name === 'string' && c.name.trim())
      .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))[0]
    if (top?.name) {
      const compact = compactCategoryLabel(top.name)
      if (compact) return compact
    }
  }

  // Product pages: prefer breadcrumb category.
  const breadcrumb = (parsed as any)?.productCategory
  if (typeof breadcrumb === 'string') {
    const compact = compactCategoryLabel(breadcrumb)
    if (compact) return compact
  }

  // Fallbacks (varies by scraper/source).
  const category = (parsed as any)?.category
  if (typeof category === 'string') {
    const compact = compactCategoryLabel(category)
    if (compact) return compact
  }

  return null
}

export function safeJsonParse(input: string): any | null {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}
