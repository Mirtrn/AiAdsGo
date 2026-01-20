type GoogleAdsFieldPathElement = {
  field_name?: string
  fieldName?: string
  index?: number
}

type GoogleAdsLocation = {
  field_path_elements?: GoogleAdsFieldPathElement[]
  fieldPathElements?: GoogleAdsFieldPathElement[]
}

type GoogleAdsPolicyViolationDetails = {
  external_policy_description?: string
  externalPolicyDescription?: string
  external_policy_name?: string
  externalPolicyName?: string
  is_exemptible?: boolean
  isExemptible?: boolean
  key?: {
    policy_name?: string
    policyName?: string
    violating_text?: string
    violatingText?: string
  }
}

type GoogleAdsError = {
  message?: string
  error_code?: Record<string, unknown>
  errorCode?: Record<string, unknown>
  trigger?: { string_value?: string; stringValue?: string }
  location?: GoogleAdsLocation
  details?: { policy_violation_details?: GoogleAdsPolicyViolationDetails }
}

type GoogleAdsFailure = {
  errors?: GoogleAdsError[]
  request_id?: string
  requestId?: string
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function truncateList(items: string[], maxItems: number): string[] {
  if (items.length <= maxItems) return items
  return [...items.slice(0, maxItems), `+${items.length - maxItems}`]
}

function getFieldPath(location: GoogleAdsLocation | undefined): string | undefined {
  const elements = location?.field_path_elements ?? location?.fieldPathElements
  if (!elements || !Array.isArray(elements) || elements.length === 0) return undefined

  const parts: string[] = []
  for (const element of elements) {
    const fieldName = element?.field_name ?? element?.fieldName
    if (!fieldName) continue
    if (typeof element?.index === 'number') {
      parts.push(`${fieldName}[${element.index}]`)
    } else {
      parts.push(fieldName)
    }
  }
  return parts.length ? parts.join('.') : undefined
}

function isGoogleAdsFailure(value: unknown): value is GoogleAdsFailure {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as any).errors))
}

export function formatGoogleAdsApiError(
  error: unknown,
  opts?: { maxViolatingTexts?: number }
): string {
  const maxViolatingTexts = typeof opts?.maxViolatingTexts === 'number'
    ? opts.maxViolatingTexts
    : 6

  const fallbackMessage = (() => {
    if (error instanceof Error && error.message) return normalizeWhitespace(error.message)
    if (typeof error === 'string') return normalizeWhitespace(error)
    return 'Google Ads API error'
  })()

  if (!isGoogleAdsFailure(error)) return fallbackMessage

  const requestId = (error.request_id ?? error.requestId)
  const errors = (error.errors || []).filter(Boolean)

  const policyViolations = errors
    .map((e) => {
      const details = e.details?.policy_violation_details
      if (!details) return null
      const key = details.key || {}
      const violatingText =
        key.violating_text ??
        key.violatingText ??
        e.trigger?.string_value ??
        e.trigger?.stringValue

      return {
        message: typeof e.message === 'string' ? normalizeWhitespace(e.message) : undefined,
        policyName: details.key?.policy_name ?? details.key?.policyName,
        externalPolicyName: details.external_policy_name ?? details.externalPolicyName,
        externalPolicyDescription: details.external_policy_description ?? details.externalPolicyDescription,
        isExemptible: details.is_exemptible ?? details.isExemptible,
        violatingText: typeof violatingText === 'string' ? normalizeWhitespace(violatingText) : undefined,
        fieldPath: getFieldPath(e.location),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (policyViolations.length > 0) {
    const grouped = new Map<string, typeof policyViolations>()
    for (const v of policyViolations) {
      const groupKey = [
        v.externalPolicyName || '',
        v.policyName || '',
        v.externalPolicyDescription || '',
        String(Boolean(v.isExemptible)),
      ].join('|')
      const existing = grouped.get(groupKey)
      if (existing) existing.push(v)
      else grouped.set(groupKey, [v])
    }

    const groupSummaries = Array.from(grouped.values()).map((group) => {
      const first = group[0]
      const policyLabel = first.externalPolicyName || first.policyName || 'Policy violation'
      const policyNameSuffix = first.externalPolicyName && first.policyName
        ? ` / ${first.policyName}`
        : (first.policyName ? ` (${first.policyName})` : '')

      const violatingTexts = truncateList(
        uniq(group.map(g => g.violatingText).filter((t): t is string => Boolean(t))),
        maxViolatingTexts
      )

      const fieldPaths = uniq(group.map(g => g.fieldPath).filter((p): p is string => Boolean(p)))
      const noun = fieldPaths.length > 0 && fieldPaths.every(p => p.includes('keyword.text'))
        ? '关键词'
        : '触发文本'

      const parts: string[] = []
      parts.push(`${policyLabel}${policyNameSuffix}`)
      if (violatingTexts.length > 0) parts.push(`${noun}: ${violatingTexts.join(', ')}`)
      const description = first.externalPolicyDescription ? normalizeWhitespace(first.externalPolicyDescription) : ''
      if (description) parts.push(description)
      parts.push(`可申请豁免: ${first.isExemptible ? '是' : '否'}`)
      return parts.join('；')
    })

    const reqPart = requestId ? `；RequestId=${requestId}` : ''
    return `Google Ads 政策违规：${groupSummaries.join('；')}${reqPart}`
  }

  const messages = uniq(
    errors
      .map(e => (typeof e.message === 'string' ? normalizeWhitespace(e.message) : ''))
      .filter(Boolean)
  )

  if (messages.length > 0) {
    const reqPart = requestId ? `；RequestId=${requestId}` : ''
    return `${truncateList(messages, 3).join('；')}${reqPart}`
  }

  return requestId ? `${fallbackMessage}；RequestId=${requestId}` : fallbackMessage
}

