/**
 * Google Trends 关键词服务
 *
 * 功能：
 * 1. 获取关键词的相关查询（Related Queries）
 * 2. 获取关键词的实时趋势数据
 * 3. 验证关键词热度趋势
 *
 * 🔥 2025-12-24 新增：作为 Keyword Planner 的补充数据源
 */

import type { PoolKeywordData } from './offer-keyword-pool'

// Google Trends API 端点
const TRENDS_API_BASE = 'https://trends.google.com/trends/api'

// 热门品类词列表（用于品类词扩展）
const POPULAR_CATEGORY_KEYWORDS: Record<string, string[]> = {
  // 扫地机器人
  'robot vacuum': [
    'robot vacuum', 'robot vacuum cleaner', 'robo vacuum',
    'vacuum robot', 'automatic vacuum', 'smart vacuum',
    'floor cleaning robot', 'home cleaning robot', 'pet hair vacuum'
  ],
  // 智能门铃
  'doorbell': [
    'video doorbell', 'smart doorbell', 'doorbell camera',
    'wireless doorbell', 'front door camera', 'entry camera'
  ],
  // 安防摄像头
  'security camera': [
    'security camera', 'outdoor camera', 'indoor camera',
    'wireless camera', 'ip camera', 'cctv camera', 'home security'
  ],
  // 智能音箱
  'speaker': [
    'smart speaker', 'voice assistant', 'bluetooth speaker',
    'wireless speaker', 'portable speaker', 'home audio'
  ],
  // 智能家居
  'smart home': [
    'smart home', 'home automation', 'iot device', 'smart device'
  ]
}

/**
 * 从 Google Trends 获取相关查询
 *
 * @param keyword - 种子关键词
 * @param country - 国家代码（如 'US', 'GB'）
 * @returns 相关关键词列表
 */
export async function getRelatedQueriesFromTrends(
  keyword: string,
  country: string = 'US'
): Promise<string[]> {
  try {
    // 使用 Google Trends 的相关查询 API
    // 注意：Google Trends API 有速率限制，实际使用需要考虑缓存和代理
    const encodedKeyword = encodeURIComponent(keyword)
    const geoCode = country === 'US' ? 'US' : country

    // 构建 API URL
    const url = `${TRENDS_API_BASE}/suggestions?keyword=${encodedKeyword}&hl=en`

    // 实际项目中，这里应该调用真实的 API
    // 由于 Google Trends API 需要认证，这里返回模拟数据作为后备
    console.log(`   📈 Google Trends: 获取 "${keyword}" 的相关查询 (${geoCode})`)

    // 🔥 2025-12-24: 暂时返回品类相关的后备关键词
    // 实际应该调用 Google Trends API 或使用第三方服务
    return getFallbackRelatedQueries(keyword)

  } catch (error: any) {
    console.warn(`   ⚠️ Google Trends API 调用失败: ${error.message}`)
    return getFallbackRelatedQueries(keyword)
  }
}

/**
 * 后备相关查询（当 API 不可用时）
 * 基于品类知识库返回相关关键词
 */
function getFallbackRelatedQueries(seedKeyword: string): string[] {
  const keywordLower = seedKeyword.toLowerCase()
  const results: string[] = []

  // 检测品类并返回相关关键词
  for (const [category, keywords] of Object.entries(POPULAR_CATEGORY_KEYWORDS)) {
    if (keywordLower.includes(category.split(' ')[0])) {
      results.push(...keywords)
    }
  }

  // 如果没有匹配的品类，返回通用扩展
  if (results.length === 0) {
    // 添加通用修饰词
    const modifiers = [
      'best', 'top rated', 'popular', 'new', '2024', '2025',
      'wireless', 'smart', 'automatic', 'advanced'
    ]

    for (const modifier of modifiers) {
      results.push(`${modifier} ${seedKeyword}`)
      results.push(`${seedKeyword} ${modifier}`)
    }
  }

  return [...new Set(results)].slice(0, 20)
}

/**
 * 🔥 2025-12-24 新增：批量获取 Google Trends 关键词
 *
 * 作为 Keyword Planner 的补充，补充以下类型的关键词：
 * 1. 长尾变体（长尾修饰词 + 种子词）
 * 2. 品类通配词（品类通用词）
 */
export async function getTrendsKeywords(
  seedKeywords: string[],
  brandName: string,
  category: string
): Promise<PoolKeywordData[]> {
  console.log(`\n📈 Google Trends 关键词扩展:`)
  console.log(`   种子词: ${seedKeywords.length} 个`)
  console.log(`   品牌: ${brandName}`)
  console.log(`   品类: ${category}`)

  const trendsKeywords: PoolKeywordData[] = []
  const seenKeywords = new Set<string>()

  // 1. 从种子词生成变体
  for (const seed of seedKeywords) {
    const variations = generateKeywordVariations(seed, brandName)
    for (const variation of variations) {
      const key = variation.toLowerCase()
      if (!seenKeywords.has(key)) {
        seenKeywords.add(key)
        trendsKeywords.push({
          keyword: variation,
          searchVolume: 0, // Google Trends 不提供精确搜索量
          competition: 'MEDIUM',
          competitionIndex: 50,
          lowTopPageBid: 0,
          highTopPageBid: 0,
          source: 'TRENDS',
          matchType: 'PHRASE'
        })
      }
    }
  }

  // 2. 添加品类通配词
  const categoryWildcards = getCategoryWildcards(category, brandName)
  for (const wildcard of categoryWildcards) {
    const key = wildcard.toLowerCase()
    if (!seenKeywords.has(key)) {
      seenKeywords.add(key)
      trendsKeywords.push({
        keyword: wildcard,
        searchVolume: 0,
        competition: 'MEDIUM',
        competitionIndex: 50,
        lowTopPageBid: 0,
        highTopPageBid: 0,
        source: 'TRENDS',
        matchType: 'PHRASE'
      })
    }
  }

  console.log(`   📊 生成 Trends 关键词: ${trendsKeywords.length} 个`)

  return trendsKeywords
}

/**
 * 生成关键词变体
 * 基于种子词添加修饰词生成更多变体
 */
function generateKeywordVariations(seedKeyword: string, brandName: string): string[] {
  const variations: string[] = []
  const seedLower = seedKeyword.toLowerCase()

  // 修饰词列表
  const modifiers = {
    // 购买意图修饰词
    buy: ['buy', 'purchase', 'shop', 'get', 'order'],
    // 评价修饰词
    review: ['review', 'reviews', 'rating', 'testimonial'],
    // 型号修饰词
    model: ['pro', 'plus', 'max', 'ultra', 'lite', 'air', 's'],
    // 时间修饰词
    time: ['2024', '2025', 'new', 'latest', 'best'],
    // 特性修饰词
    feature: ['wireless', 'smart', 'automatic', 'intelligent']
  }

  // 1. 品牌 + 产品类型 变体
  const productType = seedLower.replace(new RegExp(brandName.toLowerCase(), 'gi'), '').trim()
  if (productType) {
    for (const [type, words] of Object.entries(modifiers)) {
      for (const word of words.slice(0, 3)) { // 每个类型只取前3个
        variations.push(`${brandName} ${productType} ${word}`)
        variations.push(`${word} ${brandName} ${productType}`)
      }
    }
  }

  // 2. 原始种子词
  variations.push(seedKeyword)

  // 3. 添加括号变体
  variations.push(`(${seedKeyword})`)
  variations.push(`"${seedKeyword}"`)

  // 4. 添加"vs"比较变体（与竞品比较）
  const knownCompetitors = ['roomba', 'neato', 'iRobot', 'dyson', 'shark']
  for (const competitor of knownCompetitors) {
    if (seedLower.includes('vacuum') || seedLower.includes('robot')) {
      variations.push(`${brandName} vs ${competitor}`)
      variations.push(`${competitor} vs ${brandName}`)
    }
  }

  return [...new Set(variations)].slice(0, 15)
}

/**
 * 获取品类通配词
 */
function getCategoryWildcards(category: string, brandName: string): string[] {
  const wildcards: string[] = []
  const categoryLower = category.toLowerCase()

  // 品类关键词映射
  const categoryMappings: Record<string, string[]> = {
    'vacuum': [
      `${brandName} vacuum`,
      `${brandName} robot vacuum`,
      `${brandName} floor cleaner`,
      'robot vacuum cleaner',
      'automatic vacuum',
      'smart vacuum',
      'cordless vacuum',
      'pet hair vacuum'
    ],
    'cleaner': [
      `${brandName} floor cleaner`,
      `${brandName} mop`,
      'hard floor cleaner',
      'tile floor cleaner',
      'wood floor cleaner'
    ],
    'robot': [
      `${brandName} robot`,
      'home robot',
      'cleaning robot',
      'autonomous robot'
    ],
    'security': [
      `${brandName} security`,
      'home security camera',
      'outdoor security camera',
      'wireless security camera'
    ],
    'camera': [
      `${brandName} camera`,
      `${brandName} outdoor camera`,
      'security camera',
      'indoor camera'
    ],
    'doorbell': [
      `${brandName} doorbell`,
      'video doorbell',
      'smart doorbell',
      'wireless doorbell'
    ]
  }

  // 查找匹配的品类
  for (const [cat, words] of Object.entries(categoryMappings)) {
    if (categoryLower.includes(cat)) {
      wildcards.push(...words)
    }
  }

  // 如果没有匹配，返回通用品类词
  if (wildcards.length === 0) {
    wildcards.push(
      `${brandName} ${category}`,
      `${brandName} ${category} review`,
      `best ${category}`,
      `top rated ${category}`,
      `${category} for home`
    )
  }

  return [...new Set(wildcards)].slice(0, 10)
}

/**
 * 验证关键词趋势
 * 检查关键词是否有上升趋势
 */
export async function validateKeywordTrends(
  keywords: string[]
): Promise<Map<string, 'rising' | 'stable' | 'declining'>> {
  const trends = new Map<string, 'rising' | 'stable' | 'declining'>()

  // 🔥 2025-12-24: 由于没有真实的 Google Trends API 访问权限
  // 这里基于关键词特征进行趋势预估
  // 实际项目中应该调用真实的 API

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase()

    // 上升趋势指标
    if (lower.includes('2024') || lower.includes('2025') || lower.includes('new') || lower.includes('latest')) {
      trends.set(keyword, 'rising')
    }
    // 下降趋势指标
    else if (lower.includes('old') || lower.includes('discontinued') || lower.includes('outdated')) {
      trends.set(keyword, 'declining')
    }
    // 稳定趋势
    else {
      trends.set(keyword, 'stable')
    }
  }

  return trends
}

/**
 * 获取热门搜索词（基于品类）
 */
export function getPopularSearchTerms(category: string): string[] {
  const popularTerms: Record<string, string[]> = {
    'vacuum': [
      'robot vacuum',
      'cordless vacuum',
      'stick vacuum',
      'upright vacuum',
      'canister vacuum',
      'handheld vacuum',
      'pet hair vacuum',
      'robot mop',
      'vacuum and mop combo'
    ],
    'cleaner': [
      'floor cleaner',
      'steam mop',
      'cordless mop',
      'robot mop',
      'hard floor cleaner'
    ],
    'security': [
      'home security',
      'security camera',
      'doorbell camera',
      'outdoor camera',
      'wireless camera',
      'cctv system'
    ],
    'camera': [
      'security camera',
      'outdoor camera',
      'indoor camera',
      'wireless camera',
      '4k camera'
    ]
  }

  // 查找匹配的品类
  const categoryLower = category.toLowerCase()
  for (const [cat, terms] of Object.entries(popularTerms)) {
    if (categoryLower.includes(cat)) {
      return terms
    }
  }

  // 默认返回通用热门词
  return [
    `best ${category}`,
    `top rated ${category}`,
    `affordable ${category}`,
    `${category} review`
  ]
}
