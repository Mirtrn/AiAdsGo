/**
 * Google Ads关键词标准化工具
 *
 * Google Ads会自动标准化关键词，规则包括：
 * 1. 去除前导和尾随空格
 * 2. 去除多余的内部空格（多个空格变一个）
 * 3. 去除特殊字符（+、-、_、.等）
 * 4. 转换为小写
 * 5. 去除标点符号
 *
 * 例如：
 * - "anker power bank" → "ankerpowerbank"
 * - "anker-power_bank" → "ankerpowerbank"
 * - "anker.power.bank" → "ankerpowerbank"
 */

/**
 * 标准化关键词（模拟Google Ads行为）
 *
 * @param keyword - 原始关键词
 * @returns 标准化后的关键词
 */
export function normalizeGoogleAdsKeyword(keyword: string): string {
  if (!keyword || typeof keyword !== 'string') {
    return ''
  }

  return keyword
    .trim() // 去除前后空格
    .toLowerCase() // 转换为小写
    .replace(/[\s\-_\.]+/g, '') // 去除空格、破折号、下划线、点号
    .replace(/[^\w]/g, '') // 去除其他特殊字符（保留字母、数字、下划线）
}

/**
 * 批量标准化关键词数组
 *
 * @param keywords - 关键词数组
 * @returns Map<标准化关键词, 原始关键词[]>，便于查看去重情况
 */
export function normalizeKeywordArray(keywords: string[]): Map<string, string[]> {
  const normalizedMap = new Map<string, string[]>()

  keywords.forEach(keyword => {
    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalizedMap.has(normalized)) {
      normalizedMap.set(normalized, [])
    }
    normalizedMap.get(normalized)!.push(keyword)
  })

  return normalizedMap
}

/**
 * 去重并保留第一个出现的关键词（高优先级来源优先）
 *
 * @param keywords - 关键词数组
 * @param getPriority - 获取关键词优先级的函数（数值越大优先级越高）
 * @returns 去重后的关键词数组
 */
export function deduplicateKeywordsWithPriority<T>(
  keywords: T[],
  getKeyword: (item: T) => string,
  getPriority?: (item: T) => number
): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  keywords.forEach((item, index) => {
    const keyword = getKeyword(item)
    const normalized = normalizeGoogleAdsKeyword(keyword)

    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(item)
    } else if (getPriority) {
      // 如果有重复，检查优先级
      const existingIndex = result.findIndex(
        existingItem => normalizeGoogleAdsKeyword(getKeyword(existingItem)) === normalized
      )

      if (existingIndex >= 0) {
        const existingPriority = getPriority(result[existingIndex])
        const currentPriority = getPriority(item)

        // 如果当前优先级更高，替换已存在的
        if (currentPriority > existingPriority) {
          result[existingIndex] = item
          console.log(`🔄 替换重复关键词 "${keyword}" (优先级: ${currentPriority} > ${existingPriority})`)
        }
      }
    }
  })

  return result
}

/**
 * 检查两个关键词在Google Ads中是否会被视为重复
 *
 * @param keyword1 - 关键词1
 * @param keyword2 - 关键词2
 * @returns 如果标准化后相同，返回true
 */
export function areKeywordsDuplicates(keyword1: string, keyword2: string): boolean {
  return normalizeGoogleAdsKeyword(keyword1) === normalizeGoogleAdsKeyword(keyword2)
}

/**
 * 获取关键词的重复信息
 *
 * @param keywords - 关键词数组
 * @returns 重复关键词信息数组
 */
export function getDuplicateKeywordsInfo(keywords: string[]): Array<{
  normalized: string
  variants: string[]
  count: number
}> {
  const normalizedMap = normalizeKeywordArray(keywords)

  return Array.from(normalizedMap.entries())
    .filter(([_, variants]) => variants.length > 1)
    .map(([normalized, variants]) => ({
      normalized,
      variants,
      count: variants.length
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 为调试目的，打印重复关键词信息
 *
 * @param keywords - 关键词数组
 * @param label - 标签（用于标识输出）
 */
export function logDuplicateKeywords(keywords: string[], label: string = '关键词'): void {
  const duplicates = getDuplicateKeywordsInfo(keywords)

  if (duplicates.length > 0) {
    console.warn(`⚠️ 发现 ${duplicates.length} 组重复${label}:`)
    duplicates.forEach(({ normalized, variants, count }) => {
      console.warn(`   - "${variants.join('", "')}" → 标准化为: "${normalized}" (${count}个变体)`)
    })
  } else {
    console.log(`✅ ${label}无重复`)
  }
}
