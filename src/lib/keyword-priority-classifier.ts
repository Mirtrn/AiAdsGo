/**
 * 关键词优先级分类器
 *
 * 将关键词分类为4种优先级：Brand、Core、Intent、LongTail
 * 验证20-30个关键词是否满足优先级分布要求
 */

import type { Offer } from './offers'

export type KeywordPriority = 'Brand' | 'Core' | 'Intent' | 'LongTail'

export interface KeywordPriorityClassification {
  keyword: string
  priority: KeywordPriority
  confidence: number
  reasoning: string
  searchVolume?: number
}

export interface PriorityDistributionReport {
  distribution: Record<KeywordPriority, number>
  expected: Record<KeywordPriority, [number, number]>  // [min, max]
  isSatisfied: boolean
  missing: KeywordPriority[]
  excess: KeywordPriority[]
  recommendations: string[]
  details: KeywordPriorityClassification[]
}

/**
 * 优先级分布要求
 */
const PRIORITY_REQUIREMENTS: Record<KeywordPriority, [number, number]> = {
  Brand: [8, 10],
  Core: [6, 8],
  Intent: [3, 5],
  LongTail: [3, 7]
}

/**
 * 关键词优先级分类规则
 */
const PRIORITY_PATTERNS: Record<KeywordPriority, { keywords: string[]; patterns: RegExp[] }> = {
  Brand: {
    keywords: ['brand', 'official', 'store', 'shop', 'amazon', 'ebay'],
    patterns: [
      /^[a-z]+\s+brand$/i,
      /^[a-z]+\s+official$/i,
      /^[a-z]+\s+store$/i,
      /^[a-z]+\s+shop$/i
    ]
  },
  Core: {
    keywords: ['product', 'category', 'type', 'model', 'version'],
    patterns: [
      /^[a-z]+\s+[a-z]+$/i,  // 两个单词
      /^[a-z]+\s+[a-z]+\s+[a-z]+$/i  // 三个单词
    ]
  },
  Intent: {
    keywords: ['best', 'cheap', 'affordable', 'buy', 'price', 'sale', 'discount', 'deal', 'compare', 'vs'],
    patterns: [
      /best\s+\w+/i,
      /cheap\s+\w+/i,
      /affordable\s+\w+/i,
      /\w+\s+for\s+\w+/i,
      /\w+\s+vs\s+\w+/i
    ]
  },
  LongTail: {
    keywords: ['specific', 'detailed', 'long', 'phrase', 'question'],
    patterns: [
      /\w+\s+\w+\s+\w+\s+\w+/i,  // 4个或更多单词
      /\w+\s+with\s+\w+/i,
      /\w+\s+for\s+\w+\s+\w+/i,
      /how\s+to\s+\w+/i,
      /best\s+\w+\s+for\s+\w+/i
    ]
  }
}

/**
 * 分类单个关键词
 */
export function classifyKeywordPriority(
  keyword: string,
  offer?: Offer
): KeywordPriorityClassification {
  const lowerKeyword = keyword.toLowerCase().trim()
  const wordCount = lowerKeyword.split(/\s+/).length

  let bestPriority: KeywordPriority = 'LongTail'
  let maxScore = 0
  let reasoning = ''

  // 首先检查是否是品牌词
  if (offer?.brand) {
    const brandLower = offer.brand.toLowerCase()
    if (lowerKeyword.includes(brandLower)) {
      return {
        keyword,
        priority: 'Brand',
        confidence: 0.95,
        reasoning: `Contains brand name: ${offer.brand}`
      }
    }
  }

  // 然后按优先级分类
  for (const [priority, { keywords, patterns }] of Object.entries(PRIORITY_PATTERNS)) {
    let priorityScore = 0
    let priorityReasoning = ''

    // 检查关键词匹配
    const matchedKeywords = keywords.filter(kw =>
      lowerKeyword.includes(kw.toLowerCase())
    )
    if (matchedKeywords.length > 0) {
      priorityScore += matchedKeywords.length * 0.2
      priorityReasoning += `Keywords: ${matchedKeywords.join(', ')}. `
    }

    // 检查模式匹配
    const matchedPatterns = patterns.filter(pattern => pattern.test(keyword))
    if (matchedPatterns.length > 0) {
      priorityScore += matchedPatterns.length * 0.3
      priorityReasoning += `Patterns: ${matchedPatterns.length} matched. `
    }

    // 基于单词数的启发式规则
    if (priority === 'Core' && wordCount === 2) {
      priorityScore += 0.3
      priorityReasoning += 'Two-word keyword (Core pattern). '
    } else if (priority === 'Intent' && wordCount === 3) {
      priorityScore += 0.2
      priorityReasoning += 'Three-word keyword (Intent pattern). '
    } else if (priority === 'LongTail' && wordCount >= 5) {
      // LongTail 需要5+个词才加分，避免与4词Intent冲突
      priorityScore += 0.3
      priorityReasoning += 'Long-tail keyword (5+ words). '
    }

    if (priorityScore > maxScore) {
      maxScore = priorityScore
      bestPriority = priority as KeywordPriority
      reasoning = priorityReasoning
    }
  }

  const confidence = Math.min(1, maxScore)

  return {
    keyword,
    priority: bestPriority,
    confidence,
    reasoning: reasoning || 'Default classification'
  }
}

/**
 * 验证关键词优先级分布
 * 要求：Brand(8-10) + Core(6-8) + Intent(3-5) + LongTail(3-7) = 20-30个
 */
export function validatePriorityDistribution(
  keywords: Array<{ keyword: string; searchVolume?: number }>,
  offer?: Offer
): PriorityDistributionReport {
  const classifications = keywords.map(kw =>
    classifyKeywordPriority(kw.keyword, offer)
  )

  // 统计每个优先级的数量
  const distribution: Record<KeywordPriority, number> = {
    Brand: 0,
    Core: 0,
    Intent: 0,
    LongTail: 0
  }

  for (const classification of classifications) {
    distribution[classification.priority]++
  }

  // 检查是否满足要求
  const missing: KeywordPriority[] = []
  const excess: KeywordPriority[] = []

  for (const [priority, [min, max]] of Object.entries(PRIORITY_REQUIREMENTS)) {
    const count = distribution[priority as KeywordPriority]
    if (count < min) {
      missing.push(priority as KeywordPriority)
    }
    if (count > max) {
      excess.push(priority as KeywordPriority)
    }
  }

  const isSatisfied = missing.length === 0 && excess.length === 0

  // 生成建议
  const recommendations: string[] = []

  if (missing.length > 0) {
    for (const priority of missing) {
      const [min, max] = PRIORITY_REQUIREMENTS[priority]
      const current = distribution[priority]
      recommendations.push(
        `Need ${min - current} more ${priority} keyword(s). Current: ${current}, Required: ${min}-${max}`
      )
    }
  }

  if (excess.length > 0) {
    for (const priority of excess) {
      const [min, max] = PRIORITY_REQUIREMENTS[priority]
      const current = distribution[priority]
      recommendations.push(
        `Too many ${priority} keywords. Current: ${current}, Max: ${max}. Consider removing ${current - max}`
      )
    }
  }

  // 总数检查
  const totalCount = Object.values(distribution).reduce((a, b) => a + b, 0)
  if (totalCount < 20) {
    recommendations.push(`Total keywords: ${totalCount}. Need at least 20 keywords`)
  }
  if (totalCount > 30) {
    recommendations.push(`Total keywords: ${totalCount}. Should not exceed 30 keywords`)
  }

  return {
    distribution,
    expected: PRIORITY_REQUIREMENTS,
    isSatisfied,
    missing,
    excess,
    recommendations,
    details: classifications
  }
}

/**
 * 获取缺失优先级的建议关键词
 */
export function suggestKeywordsForMissingPriority(
  missingPriorities: KeywordPriority[],
  brandName: string,
  productCategory: string,
  productFeatures: string[] = []
): Record<KeywordPriority, string[]> {
  const suggestions: Record<KeywordPriority, string[]> = {
    Brand: [],
    Core: [],
    Intent: [],
    LongTail: []
  }

  for (const priority of missingPriorities) {
    switch (priority) {
      case 'Brand':
        suggestions.Brand = [
          brandName.toLowerCase(),
          `${brandName.toLowerCase()} official`,
          `${brandName.toLowerCase()} store`,
          `${brandName.toLowerCase()} shop`,
          `buy ${brandName.toLowerCase()}`,
          `${brandName.toLowerCase()} online`,
          `${brandName.toLowerCase()} amazon`,
          `${brandName.toLowerCase()} authentic`
        ]
        break

      case 'Core':
        suggestions.Core = [
          productCategory.toLowerCase(),
          `${productCategory.toLowerCase()} online`,
          `buy ${productCategory.toLowerCase()}`,
          `${productCategory.toLowerCase()} store`,
          `best ${productCategory.toLowerCase()}`,
          `${productCategory.toLowerCase()} shop`,
          `${productCategory.toLowerCase()} price`,
          `${productCategory.toLowerCase()} sale`
        ]
        break

      case 'Intent':
        suggestions.Intent = [
          `best ${productCategory}`,
          `cheap ${productCategory}`,
          `affordable ${productCategory}`,
          `${productCategory} for sale`,
          `${productCategory} discount`,
          `${productCategory} deal`,
          `${productCategory} vs`,
          `${productCategory} comparison`
        ]
        break

      case 'LongTail':
        if (productFeatures.length > 0) {
          suggestions.LongTail = [
            `${productCategory} with ${productFeatures[0]}`,
            `best ${productCategory} for ${productFeatures[0]}`,
            `${productCategory} for ${productFeatures[0]} users`,
            `affordable ${productCategory} with ${productFeatures[0]}`,
            `${productCategory} ${productFeatures[0]} online`,
            `buy ${productCategory} with ${productFeatures[0]}`,
            `${productCategory} ${productFeatures[0]} sale`
          ]
        } else {
          suggestions.LongTail = [
            `${productCategory} for home use`,
            `${productCategory} for professionals`,
            `${productCategory} for beginners`,
            `${productCategory} for small spaces`,
            `${productCategory} with warranty`,
            `${productCategory} with free shipping`,
            `${productCategory} easy to use`
          ]
        }
        break
    }
  }

  return suggestions
}

/**
 * 生成优先级分布报告的摘要
 */
export function generatePriorityDistributionSummary(report: PriorityDistributionReport): string {
  const lines: string[] = []

  lines.push('=== Keyword Priority Distribution Report ===')
  lines.push('')

  lines.push('Distribution:')
  for (const [priority, [min, max]] of Object.entries(report.expected)) {
    const count = report.distribution[priority as KeywordPriority]
    const status = count >= min && count <= max ? '✅' : '❌'
    lines.push(`  ${status} ${priority}: ${count}/${min}-${max}`)
  }

  lines.push('')
  const totalCount = Object.values(report.distribution).reduce((a, b) => a + b, 0)
  const totalStatus = totalCount >= 20 && totalCount <= 30 ? '✅' : '❌'
  lines.push(`${totalStatus} Total: ${totalCount}/20-30`)

  lines.push('')
  lines.push(`Status: ${report.isSatisfied ? '✅ SATISFIED' : '❌ NOT SATISFIED'}`)

  if (report.missing.length > 0) {
    lines.push('')
    lines.push('Missing Priorities:')
    for (const priority of report.missing) {
      lines.push(`  - ${priority}`)
    }
  }

  if (report.excess.length > 0) {
    lines.push('')
    lines.push('Excess Priorities:')
    for (const priority of report.excess) {
      lines.push(`  - ${priority}`)
    }
  }

  if (report.recommendations.length > 0) {
    lines.push('')
    lines.push('Recommendations:')
    for (const rec of report.recommendations) {
      lines.push(`  - ${rec}`)
    }
  }

  return lines.join('\n')
}
