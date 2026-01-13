import { isLikelyInvalidBrandName } from './brand-name-utils'

function normalizeBrandNameLight(brand: string): string {
  const trimmed = String(brand || '').trim()
  if (!trimmed) return trimmed

  // Keep common all-caps abbreviations (subset of offer-utils normalization).
  const ABBREVIATIONS = new Set([
    'IBM', 'HP', 'LG', 'BMW', 'ASUS', 'DELL', 'AMD', 'AT&T',
    'USA', 'UK', 'EU', 'NASA', 'FBI', 'CIA', 'DVD', 'LCD',
    'LED', 'USB', 'GPS', 'API', 'SEO', 'CEO', 'CTO', 'CFO',
  ])

  if (ABBREVIATIONS.has(trimmed.toUpperCase())) return trimmed.toUpperCase()

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) return word
      if (ABBREVIATIONS.has(word.toUpperCase())) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

function extractBrandFromAmazonStoreHref(href: string): string | null {
  const raw = href.trim()
  if (!raw) return null

  const m =
    raw.match(/\/stores\/([^\/?#]+)(?:\/|$)/i) ||
    raw.match(/amazon\.[a-z.]+\/stores\/([^\/?#]+)(?:\/|$)/i)

  if (!m?.[1]) return null
  const decoded = decodeURIComponent(m[1])
    .replace(/[-+]+/g, ' ')
    .trim()

  if (!decoded) return null
  const normalized = normalizeBrandNameLight(decoded)
  return isLikelyInvalidBrandName(normalized) ? null : normalized
}

function stripBylineBoilerplate(text: string): string {
  let brand = text.trim()
  if (!brand) return ''

  // Common patterns across Amazon locales (keep this tolerant to partial markup).
  brand = brand
    // English
    .replace(/^Visit(?:\s+the)?\b\s*/i, '')
    // German
    .replace(/^Besuchen(?:\s+Sie)?(?:\s+(den|die|das))?\b\s*/i, '')
    .replace(/^Besuche(?:\s+(den|die|das))?\b\s*/i, '')
    // French
    .replace(/^Visitez(?:\s+(la|le|les))?\b\s*/i, '')
    .replace(/^Visiter(?:\s+(la|le|les))?\b\s*/i, '')
    // Italian
    .replace(/^Visita(?:\s+(lo|il|la|le|i|gli))?\b\s*/i, '')
    // Spanish
    .replace(/^Visita(?:\s+(la|el))?\b\s*/i, '')
    // Dutch
    .replace(/^Bezoek(?:\s+de)?\b\s*/i, '')
    // Polish
    .replace(/^Odwiedź\b\s*/i, '')
    // Generic "Brand:" label
    .replace(/^(Brand|Marke|Marca|Marque|Merk|Marka)\s*[:：]\s*/i, '')
    .trim()

  if (!brand) return ''

  // Drop leading articles / prepositions that may remain after partial stripping.
  brand = brand.replace(/^(the|a|an|den|die|das|der|la|le|les|lo|il|el|de|di|da|du|von|van)\b\s*/i, '').trim()

  // Strip store suffixes (e.g. "Comfyer-Store", "Comfyer Store").
  brand = brand
    .replace(/-(Store|Shop|Boutique|Tienda|Negozio|Loja|Winkel|Sklep)\b$/i, '')
    .replace(/\s+(Store|Shop|Boutique|Tienda|Negozio|Loja|Winkel|Sklep)\b$/i, '')
    .trim()

  return brand
}

/**
 * Extract a brand name from Amazon byline ("Visit the Brand Store", "Besuchen Sie den Brand-Store", etc.)
 * while guarding against locale boilerplate leaking as a brand (e.g. "Besuchen").
 */
export function extractAmazonBrandFromByline(params: {
  bylineText?: string | null
  bylineHref?: string | null
}): string | null {
  const bylineHref = typeof params.bylineHref === 'string' ? params.bylineHref.trim() : ''
  const fromHref = bylineHref ? extractBrandFromAmazonStoreHref(bylineHref) : null
  if (fromHref) return fromHref

  const bylineText = typeof params.bylineText === 'string' ? params.bylineText : ''
  const cleaned = stripBylineBoilerplate(bylineText)
  if (!cleaned) return null

  const normalized = normalizeBrandNameLight(cleaned)
  return isLikelyInvalidBrandName(normalized) ? null : normalized
}
