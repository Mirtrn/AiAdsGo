/**
 * Google Ads 文案工具
 * - DKI（Dynamic Keyword Insertion）: {KeyWord:DefaultText}
 *   Google Ads 字符计数通常按 DefaultText + token 外文本计算（不计入 "{KeyWord:...}" 结构本身）。
 */

const DKI_PATTERN = /\{keyword:([^}]*)\}/gi

export function getGoogleAdsTextEffectiveLength(text: string): number {
  const input = String(text ?? '')

  let total = 0
  let lastIndex = 0

  for (const match of input.matchAll(DKI_PATTERN)) {
    const matchText = match[0] || ''
    const defaultText = match[1] || ''
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) continue

    total += input.slice(lastIndex, matchIndex).length
    total += defaultText.length
    lastIndex = matchIndex + matchText.length
  }

  total += input.slice(lastIndex).length
  return total
}

export function sanitizeGoogleAdsAdText(text: string, maxLen: number): string {
  const original = String(text ?? '')
  const replaced = original.replace(/±/g, '+/-').replace(/\s+/g, ' ').trim()
  if (getGoogleAdsTextEffectiveLength(replaced) <= maxLen) return replaced

  // 如果替换导致超长，回退为移除该符号，优先保证长度合规
  const removed = original.replace(/±/g, '').replace(/\s+/g, ' ').trim()
  if (getGoogleAdsTextEffectiveLength(removed) <= maxLen) return removed

  throw new Error(
    `广告文案超过${maxLen}字符限制（清理后仍超长）: "${replaced}" ` +
    `(effective=${getGoogleAdsTextEffectiveLength(replaced)}, raw=${replaced.length})`
  )
}

