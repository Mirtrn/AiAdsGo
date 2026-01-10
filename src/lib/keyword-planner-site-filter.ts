/**
 * Keyword Planner "Enter a site to filter unrelated keywords" helper.
 *
 * We pass an origin-level URL (scheme + host) to reduce page-level bias.
 * Some marketplace domains are excluded because site filtering tends to introduce
 * platform-generic keywords rather than brand-relevant ones.
 */

const MARKETPLACE_HOST_PATTERNS: RegExp[] = [
  /(^|\.)amazon\./i,
  /(^|\.)ebay\./i,
  /(^|\.)walmart\./i,
  /(^|\.)aliexpress\./i,
  /(^|\.)temu\./i,
  /(^|\.)etsy\./i,
]

export function getKeywordPlannerSiteFilterUrl(inputUrl: string | undefined | null): string | undefined {
  if (!inputUrl) return undefined

  try {
    const url = new URL(inputUrl)
    const hostname = url.hostname.toLowerCase()

    if (MARKETPLACE_HOST_PATTERNS.some(re => re.test(hostname))) {
      return undefined
    }

    return url.origin
  } catch {
    return undefined
  }
}

