import { getCustomer } from './google-ads-api'

/**
 * 关键词建议结果
 */
export interface KeywordIdea {
  text: string
  avgMonthlySearches: number
  competition: 'LOW' | 'MEDIUM' | 'HIGH'
  competitionIndex: number // 0-100
  lowTopOfPageBidMicros: number
  highTopOfPageBidMicros: number
  keyword_annotations?: {
    concepts?: Array<{ name: string; concept_group: { name: string; type: string } }>
  }
}

/**
 * 关键词指标数据
 */
export interface KeywordMetrics {
  keyword: string
  avgMonthlySearches: number
  competition: 'LOW' | 'MEDIUM' | 'HIGH'
  competitionIndex: number
  lowTopOfPageBidMicros: number
  highTopOfPageBidMicros: number
  yearOverYearChange?: number
  threeMonthChange?: number
}

/**
 * 获取关键词建议
 * 基于种子关键词和URL生成关键词创意
 */
export async function getKeywordIdeas(params: {
  customerId: string
  refreshToken: string
  seedKeywords?: string[]
  pageUrl?: string
  targetCountry: string
  targetLanguage: string
  accountId?: number
  userId?: number
}): Promise<KeywordIdea[]> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  try {
    // 构建Keyword Ideas请求
    const request: any = {
      customer_id: params.customerId,
      language: getLanguageCode(params.targetLanguage),
      geo_target_constants: [getGeoTargetConstant(params.targetCountry)],
      include_adult_keywords: false,
    }

    // 添加种子关键词
    if (params.seedKeywords && params.seedKeywords.length > 0) {
      request.keyword_seed = {
        keywords: params.seedKeywords,
      }
    }

    // 添加URL种子
    if (params.pageUrl) {
      request.url_seed = {
        url: params.pageUrl,
      }
    }

    // 调用Keyword Planner API
    const ideas = await customer.keywordPlanIdeas.generateKeywordIdeas(request)

    // 转换结果格式
    const keywordIdeas: KeywordIdea[] = (ideas as any).map((idea: any) => ({
      text: idea.text,
      avgMonthlySearches: idea.keyword_idea_metrics?.avg_monthly_searches || 0,
      competition: mapCompetition(idea.keyword_idea_metrics?.competition),
      competitionIndex: idea.keyword_idea_metrics?.competition_index || 0,
      lowTopOfPageBidMicros: idea.keyword_idea_metrics?.low_top_of_page_bid_micros || 0,
      highTopOfPageBidMicros: idea.keyword_idea_metrics?.high_top_of_page_bid_micros || 0,
      keyword_annotations: idea.keyword_annotations,
    }))

    return keywordIdeas
  } catch (error: any) {
    console.error('获取关键词建议失败:', error)
    throw new Error(`Keyword Planner API调用失败: ${error.message}`)
  }
}

/**
 * 获取关键词历史指标
 * 用于已知关键词列表的数据分析
 */
export async function getKeywordMetrics(params: {
  customerId: string
  refreshToken: string
  keywords: string[]
  targetCountry: string
  targetLanguage: string
  accountId?: number
  userId?: number
}): Promise<KeywordMetrics[]> {
  const customer = await getCustomer(
    params.customerId,
    params.refreshToken,
    params.accountId,
    params.userId
  )

  try {
    // 构建历史指标请求
    const request = {
      customer_id: params.customerId,
      keywords: params.keywords,
      language: getLanguageCode(params.targetLanguage),
      geo_target_constants: [getGeoTargetConstant(params.targetCountry)],
      include_adult_keywords: false,
    }

    // 调用Historical Metrics API
    const metrics = await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics(request as any)

    // 转换结果格式
    const keywordMetrics: KeywordMetrics[] = (metrics as any).map((metric: any) => ({
      keyword: metric.text,
      avgMonthlySearches: metric.keyword_metrics?.avg_monthly_searches || 0,
      competition: mapCompetition(metric.keyword_metrics?.competition),
      competitionIndex: metric.keyword_metrics?.competition_index || 0,
      lowTopOfPageBidMicros: metric.keyword_metrics?.low_top_of_page_bid_micros || 0,
      highTopOfPageBidMicros: metric.keyword_metrics?.high_top_of_page_bid_micros || 0,
      yearOverYearChange: metric.keyword_metrics?.year_over_year_change,
      threeMonthChange: metric.keyword_metrics?.three_month_change,
    }))

    return keywordMetrics
  } catch (error: any) {
    console.error('获取关键词指标失败:', error)
    throw new Error(`Keyword Metrics API调用失败: ${error.message}`)
  }
}

/**
 * 过滤高质量关键词
 * 根据搜索量和竞争度筛选
 */
export function filterHighQualityKeywords(
  keywords: KeywordIdea[],
  options: {
    minMonthlySearches?: number
    maxCompetitionIndex?: number
    maxCpcMicros?: number
    excludeCompetition?: Array<'LOW' | 'MEDIUM' | 'HIGH'>
  } = {}
): KeywordIdea[] {
  const {
    minMonthlySearches = 100,
    maxCompetitionIndex = 80,
    maxCpcMicros,
    excludeCompetition = [],
  } = options

  return keywords.filter(kw => {
    // 过滤低搜索量
    if (kw.avgMonthlySearches < minMonthlySearches) {
      return false
    }

    // 过滤高竞争度
    if (kw.competitionIndex > maxCompetitionIndex) {
      return false
    }

    // 过滤指定竞争等级
    if (excludeCompetition.includes(kw.competition)) {
      return false
    }

    // 过滤高CPC
    if (maxCpcMicros && kw.highTopOfPageBidMicros > maxCpcMicros) {
      return false
    }

    return true
  })
}

/**
 * 按相关性排序关键词
 * 综合考虑搜索量、竞争度和CPC
 */
export function rankKeywordsByRelevance(keywords: KeywordIdea[]): KeywordIdea[] {
  return keywords.sort((a, b) => {
    // 计算相关性得分
    // 公式: 搜索量权重40% + 低竞争权重30% + 低CPC权重30%
    const scoreA = calculateRelevanceScore(a)
    const scoreB = calculateRelevanceScore(b)

    return scoreB - scoreA // 降序排列
  })
}

/**
 * 计算关键词相关性得分
 */
function calculateRelevanceScore(keyword: KeywordIdea): number {
  // 搜索量得分 (0-40分，归一化到10000月搜索为满分)
  const searchScore = Math.min((keyword.avgMonthlySearches / 10000) * 40, 40)

  // 竞争度得分 (0-30分，竞争度越低分数越高)
  const competitionScore = (100 - keyword.competitionIndex) * 0.3

  // CPC得分 (0-30分，CPC越低分数越高，归一化到$5为基准)
  const avgCpcMicros = (keyword.lowTopOfPageBidMicros + keyword.highTopOfPageBidMicros) / 2
  const cpcScore = Math.max(30 - (avgCpcMicros / 5000000) * 30, 0)

  return searchScore + competitionScore + cpcScore
}

/**
 * 分组关键词
 * 按主题或意图分组
 */
export function groupKeywordsByTheme(keywords: KeywordIdea[]): {
  [theme: string]: KeywordIdea[]
} {
  const groups: { [theme: string]: KeywordIdea[] } = {
    brand: [],
    product: [],
    comparison: [],
    informational: [],
    transactional: [],
    other: [],
  }

  keywords.forEach(kw => {
    const text = kw.text.toLowerCase()

    // 品牌词
    if (text.includes('official') || text.includes('store') || text.includes('shop')) {
      groups.brand.push(kw)
    }
    // 产品词
    else if (text.includes('buy') || text.includes('price') || text.includes('deal')) {
      groups.product.push(kw)
    }
    // 对比词
    else if (text.includes('vs') || text.includes('compare') || text.includes('alternative')) {
      groups.comparison.push(kw)
    }
    // 信息词
    else if (text.includes('how') || text.includes('what') || text.includes('review')) {
      groups.informational.push(kw)
    }
    // 交易词
    else if (
      text.includes('discount') ||
      text.includes('coupon') ||
      text.includes('sale') ||
      text.includes('free shipping')
    ) {
      groups.transactional.push(kw)
    }
    // 其他
    else {
      groups.other.push(kw)
    }
  })

  return groups
}

/**
 * 获取语言代码
 */
function getLanguageCode(language: string): string {
  const languageMap: { [key: string]: string } = {
    English: '1000', // English
    Chinese: '1017', // Chinese (Simplified)
    Spanish: '1003', // Spanish
    French: '1002', // French
    German: '1001', // German
    Japanese: '1005', // Japanese
    Korean: '1012', // Korean
  }

  return languageMap[language] || '1000' // 默认英语
}

/**
 * 获取地理位置常量
 */
function getGeoTargetConstant(country: string): string {
  const geoMap: { [key: string]: string } = {
    US: 'geoTargetConstants/2840', // United States
    CN: 'geoTargetConstants/2156', // China
    UK: 'geoTargetConstants/2826', // United Kingdom
    CA: 'geoTargetConstants/2124', // Canada
    AU: 'geoTargetConstants/2036', // Australia
    DE: 'geoTargetConstants/2276', // Germany
    FR: 'geoTargetConstants/2250', // France
    JP: 'geoTargetConstants/2392', // Japan
    KR: 'geoTargetConstants/2410', // South Korea
  }

  return geoMap[country] || 'geoTargetConstants/2840' // 默认美国
}

/**
 * 映射竞争等级
 */
function mapCompetition(competition: string | undefined): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (!competition) return 'LOW'

  const competitionUpper = competition.toUpperCase()
  if (competitionUpper.includes('LOW')) return 'LOW'
  if (competitionUpper.includes('MEDIUM')) return 'MEDIUM'
  if (competitionUpper.includes('HIGH')) return 'HIGH'

  return 'LOW'
}

/**
 * 格式化CPC金额
 */
export function formatCpcMicros(micros: number, currency: 'USD' | 'CNY' = 'USD'): string {
  const amount = micros / 1000000
  const symbol = currency === 'CNY' ? '¥' : '$'
  return `${symbol}${amount.toFixed(2)}`
}

/**
 * 格式化搜索量
 */
export function formatSearchVolume(searches: number): string {
  if (searches >= 1000000) {
    return `${(searches / 1000000).toFixed(1)}M`
  } else if (searches >= 1000) {
    return `${(searches / 1000).toFixed(1)}K`
  } else {
    return searches.toString()
  }
}
