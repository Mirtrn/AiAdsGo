import { getDatabase } from './db'

/**
 * Launch Score 数据库记录（v4.0 - 4维度）
 */
export interface LaunchScore {
  id: number
  userId: number
  offerId: number
  totalScore: number
  // 4维度分数
  launchViabilityScore: number // 投放可行性 (35分)
  adQualityScore: number // 广告质量 (30分)
  keywordStrategyScore: number // 关键词策略 (20分)
  basicConfigScore: number // 基础配置 (15分)
  // 详细分析数据 (JSON)
  launchViabilityData: string | null
  adQualityData: string | null
  keywordStrategyData: string | null
  basicConfigData: string | null
  recommendations: string | null
  calculatedAt: string
}

/**
 * Launch Score 评分体系 v4.0
 *
 * 4维度评分系统（总分100）：
 * 1. 投放可行性 (35分) - 品牌词搜索量15 + 利润空间10 + 竞争度10
 * 2. 广告质量 (30分) - Ad Strength 15 + 标题多样性8 + 描述质量7
 * 3. 关键词策略 (20分) - 关键词相关性8 + 匹配类型6 + 否定关键词6
 * 4. 基础配置 (15分) - 国家/语言5 + Final URL 5 + 预算合理性5
 */
export interface ScoreAnalysis {
  // 维度1：投放可行性 (35分)
  launchViability: {
    score: number // 0-35
    brandSearchVolume: number // 品牌词月搜索量
    brandSearchScore: number // 0-15
    profitMargin: number // 利润空间 (price * commission / 50 vs CPC)
    profitScore: number // 0-10
    competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' // 竞争度
    competitionScore: number // 0-10
    issues?: string[]
    suggestions?: string[]
  }

  // 维度2：广告质量 (30分)
  adQuality: {
    score: number // 0-30
    adStrength: 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'
    adStrengthScore: number // 0-15 (POOR=3, AVERAGE=8, GOOD=12, EXCELLENT=15)
    headlineDiversity: number // 标题差异化程度 0-100%
    headlineDiversityScore: number // 0-8
    descriptionQuality: number // 描述质量 0-100%
    descriptionQualityScore: number // 0-7
    issues?: string[]
    suggestions?: string[]
  }

  // 维度3：关键词策略 (20分)
  keywordStrategy: {
    score: number // 0-20
    relevanceScore: number // 关键词相关性 0-8
    matchTypeScore: number // 匹配类型策略 0-6
    negativeKeywordsScore: number // 否定关键词覆盖 0-6
    totalKeywords: number
    negativeKeywordsCount: number
    matchTypeDistribution: Record<string, number>
    issues?: string[]
    suggestions?: string[]
  }

  // 维度4：基础配置 (15分)
  basicConfig: {
    score: number // 0-15
    countryLanguageScore: number // 国家/语言匹配 0-5
    finalUrlScore: number // Final URL有效性 0-5
    budgetScore: number // 预算合理性 0-5
    targetCountry: string
    targetLanguage: string
    finalUrl: string
    dailyBudget: number
    maxCpc: number
    issues?: string[]
    suggestions?: string[]
  }

  overallRecommendations: string[]
}

/**
 * 创建Launch Score记录（v4.0 - 4维度）
 */
export async function createLaunchScore(
  userId: number,
  offerId: number,
  analysis: ScoreAnalysis
): Promise<LaunchScore> {
  const db = await getDatabase()

  const totalScore =
    analysis.launchViability.score +
    analysis.adQuality.score +
    analysis.keywordStrategy.score +
    analysis.basicConfig.score

  const info = await db.exec(`
    INSERT INTO launch_scores (
      user_id, offer_id,
      total_score,
      launch_viability_score, ad_quality_score, keyword_strategy_score, basic_config_score,
      launch_viability_data, ad_quality_data, keyword_strategy_data, basic_config_data,
      recommendations
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userId,
    offerId,
    totalScore,
    analysis.launchViability.score,
    analysis.adQuality.score,
    analysis.keywordStrategy.score,
    analysis.basicConfig.score,
    JSON.stringify(analysis.launchViability),
    JSON.stringify(analysis.adQuality),
    JSON.stringify(analysis.keywordStrategy),
    JSON.stringify(analysis.basicConfig),
    JSON.stringify(analysis.overallRecommendations)
  ])

  return (await findLaunchScoreById(info.lastInsertRowid as number, userId))!
}

/**
 * 查找Launch Score（带权限验证）
 */
export async function findLaunchScoreById(id: number, userId: number): Promise<LaunchScore | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM launch_scores
    WHERE id = ? AND user_id = ?
  `, [id, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToLaunchScore(row)
}

/**
 * 查找Offer的所有Launch Scores
 */
export async function findLaunchScoresByOfferId(offerId: number, userId: number): Promise<LaunchScore[]> {
  const db = await getDatabase()

  const rows = await db.query(`
    SELECT * FROM launch_scores
    WHERE offer_id = ? AND user_id = ?
    ORDER BY calculated_at DESC
  `, [offerId, userId]) as any[]

  return rows.map(mapRowToLaunchScore)
}

/**
 * 查找Offer的最新Launch Score
 */
export async function findLatestLaunchScore(offerId: number, userId: number): Promise<LaunchScore | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM launch_scores
    WHERE offer_id = ? AND user_id = ?
    ORDER BY calculated_at DESC
    LIMIT 1
  `, [offerId, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToLaunchScore(row)
}

/**
 * 删除Launch Score
 */
export async function deleteLaunchScore(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  const info = await db.exec(`
    DELETE FROM launch_scores
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  return info.changes > 0
}

/**
 * 数据库行映射为LaunchScore对象（v4.0 - 4维度）
 */
function mapRowToLaunchScore(row: any): LaunchScore {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    totalScore: row.total_score,
    // 4维度
    launchViabilityScore: row.launch_viability_score || 0,
    adQualityScore: row.ad_quality_score || 0,
    keywordStrategyScore: row.keyword_strategy_score || 0,
    basicConfigScore: row.basic_config_score || 0,
    launchViabilityData: row.launch_viability_data,
    adQualityData: row.ad_quality_data,
    keywordStrategyData: row.keyword_strategy_data,
    basicConfigData: row.basic_config_data,
    recommendations: row.recommendations,
    calculatedAt: row.calculated_at,
  }
}

/**
 * 解析Launch Score的详细分析数据（v4.0 - 4维度）
 */
export function parseLaunchScoreAnalysis(score: LaunchScore): ScoreAnalysis {
  return {
    launchViability: score.launchViabilityData ? JSON.parse(score.launchViabilityData) : getDefaultLaunchViability(),
    adQuality: score.adQualityData ? JSON.parse(score.adQualityData) : getDefaultAdQuality(),
    keywordStrategy: score.keywordStrategyData ? JSON.parse(score.keywordStrategyData) : getDefaultKeywordStrategy(),
    basicConfig: score.basicConfigData ? JSON.parse(score.basicConfigData) : getDefaultBasicConfig(),
    overallRecommendations: score.recommendations ? JSON.parse(score.recommendations) : [],
  }
}

// 默认值生成函数
function getDefaultLaunchViability(): ScoreAnalysis['launchViability'] {
  return {
    score: 0,
    brandSearchVolume: 0,
    brandSearchScore: 0,
    profitMargin: 0,
    profitScore: 0,
    competitionLevel: 'MEDIUM',
    competitionScore: 0,
  }
}

function getDefaultAdQuality(): ScoreAnalysis['adQuality'] {
  return {
    score: 0,
    adStrength: 'POOR',
    adStrengthScore: 0,
    headlineDiversity: 0,
    headlineDiversityScore: 0,
    descriptionQuality: 0,
    descriptionQualityScore: 0,
  }
}

function getDefaultKeywordStrategy(): ScoreAnalysis['keywordStrategy'] {
  return {
    score: 0,
    relevanceScore: 0,
    matchTypeScore: 0,
    negativeKeywordsScore: 0,
    totalKeywords: 0,
    negativeKeywordsCount: 0,
    matchTypeDistribution: {},
  }
}

function getDefaultBasicConfig(): ScoreAnalysis['basicConfig'] {
  return {
    score: 0,
    countryLanguageScore: 0,
    finalUrlScore: 0,
    budgetScore: 0,
    targetCountry: '',
    targetLanguage: '',
    finalUrl: '',
    dailyBudget: 0,
    maxCpc: 0,
  }
}
