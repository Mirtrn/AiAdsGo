/**
 * Google Ads 文案工具
 * - DKI（Dynamic Keyword Insertion）: {KeyWord:DefaultText}
 *   Google Ads 字符计数通常按 DefaultText + token 外文本计算（不计入 "{KeyWord:...}" 结构本身）。
 */

const DKI_PATTERN = /\{keyword:([^}]*)\}/gi

export function getGoogleAdsTextEffectiveLength(text: string): number {
  const input = String(text ?? '')

  const cjkPattern = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/
  const weightedLength = (value: string): number => {
    let total = 0
    for (const ch of Array.from(value)) {
      total += cjkPattern.test(ch) ? 2 : 1
    }
    return total
  }

  let total = 0
  let lastIndex = 0

  for (const match of input.matchAll(DKI_PATTERN)) {
    const matchText = match[0] || ''
    const defaultText = match[1] || ''
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) continue

    total += weightedLength(input.slice(lastIndex, matchIndex))
    total += weightedLength(defaultText)
    lastIndex = matchIndex + matchText.length
  }

  total += weightedLength(input.slice(lastIndex))
  return total
}

function truncateByEffectiveLength(text: string, maxLen: number): string {
  const input = String(text ?? '')
  if (maxLen <= 0) return ''

  const cjkPattern = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/
  const charWeight = (ch: string) => (cjkPattern.test(ch) ? 2 : 1)

  const takePlain = (value: string, budget: number): { text: string; used: number } => {
    let used = 0
    let out = ''
    for (const ch of Array.from(value)) {
      const w = charWeight(ch)
      if (used + w > budget) break
      out += ch
      used += w
    }
    return { text: out, used }
  }

  let out = ''
  let budget = maxLen
  let lastIndex = 0

  for (const match of input.matchAll(DKI_PATTERN)) {
    const token = match[0] || ''
    const defaultText = match[1] || ''
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) continue

    const before = input.slice(lastIndex, matchIndex)
    const beforeTaken = takePlain(before, budget)
    out += beforeTaken.text
    budget -= beforeTaken.used
    if (budget <= 0) return out.trim()

    const defaultTaken = takePlain(defaultText, budget)
    if (defaultTaken.text.length === 0) return out.trim()

    const colonIndex = token.indexOf(':')
    const tokenPrefix = colonIndex >= 0 ? token.slice(0, colonIndex + 1) : '{keyword:'
    out += `${tokenPrefix}${defaultTaken.text}}`
    budget -= defaultTaken.used
    lastIndex = matchIndex + token.length
    if (budget <= 0) return out.trim()
  }

  const tail = input.slice(lastIndex)
  out += takePlain(tail, budget).text
  return out.trim()
}

export function sanitizeGoogleAdsAdText(text: string, maxLen: number): string {
  const original = String(text ?? '')
  const replaced = original.replace(/±/g, '+/-').replace(/\s+/g, ' ').trim()
  if (getGoogleAdsTextEffectiveLength(replaced) <= maxLen) return replaced

  // 如果替换导致超长，回退为移除该符号，优先保证长度合规
  const removed = original.replace(/±/g, '').replace(/\s+/g, ' ').trim()
  if (getGoogleAdsTextEffectiveLength(removed) <= maxLen) return removed

  // 🔧 兜底：自动截断，避免发布失败（包含CJK字符权重 & DKI token 保护）
  return truncateByEffectiveLength(replaced, maxLen)
}
