import { getDatabase } from './db'

export interface LaunchScore {
  id: number
  userId: number
  offerId: number
  totalScore: number
  keywordScore: number
  marketFitScore: number
  landingPageScore: number
  budgetScore: number
  contentScore: number
  keywordAnalysisData: string | null
  marketAnalysisData: string | null
  landingPageAnalysisData: string | null
  budgetAnalysisData: string | null
  contentAnalysisData: string | null
  recommendations: string | null
  calculatedAt: string
}

export interface ScoreAnalysis {
  keywordAnalysis: {
    score: number
    searchVolume?: number
    competition?: string
    suggestedBid?: number
    relevance?: number
    issues?: string[]
    suggestions?: string[]
  }
  marketFitAnalysis: {
    score: number
    targetAudienceMatch?: number
    geographicRelevance?: number
    seasonality?: number
    competitorPresence?: string
    issues?: string[]
    suggestions?: string[]
  }
  landingPageAnalysis: {
    score: number
    loadSpeed?: number
    mobileOptimization?: boolean
    contentRelevance?: number
    callToAction?: boolean
    trustSignals?: number
    issues?: string[]
    suggestions?: string[]
  }
  budgetAnalysis: {
    score: number
    estimatedCpc?: number
    estimatedClicks?: number
    estimatedConversions?: number
    roi?: number
    competitiveness?: string
    issues?: string[]
    suggestions?: string[]
  }
  contentAnalysis: {
    score: number
    headlineQuality?: number
    descriptionQuality?: number
    keywordAlignment?: number
    uniqueness?: number
    issues?: string[]
    suggestions?: string[]
  }
  overallRecommendations: string[]
}

/**
 * 创建Launch Score记录
 */
export async function createLaunchScore(
  userId: number,
  offerId: number,
  analysis: ScoreAnalysis
): Promise<LaunchScore> {
  const db = await getDatabase()

  const totalScore =
    analysis.keywordAnalysis.score +
    analysis.marketFitAnalysis.score +
    analysis.landingPageAnalysis.score +
    analysis.budgetAnalysis.score +
    analysis.contentAnalysis.score

  const info = await db.exec(`
    INSERT INTO launch_scores (
      user_id, offer_id,
      total_score,
      keyword_score, market_fit_score, landing_page_score, budget_score, content_score,
      keyword_analysis_data, market_analysis_data, landing_page_analysis_data,
      budget_analysis_data, content_analysis_data, recommendations
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userId,
    offerId,
    totalScore,
    analysis.keywordAnalysis.score,
    analysis.marketFitAnalysis.score,
    analysis.landingPageAnalysis.score,
    analysis.budgetAnalysis.score,
    analysis.contentAnalysis.score,
    JSON.stringify(analysis.keywordAnalysis),
    JSON.stringify(analysis.marketFitAnalysis),
    JSON.stringify(analysis.landingPageAnalysis),
    JSON.stringify(analysis.budgetAnalysis),
    JSON.stringify(analysis.contentAnalysis),
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
 * 数据库行映射为LaunchScore对象
 */
function mapRowToLaunchScore(row: any): LaunchScore {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    totalScore: row.total_score,
    keywordScore: row.keyword_score,
    marketFitScore: row.market_fit_score,
    landingPageScore: row.landing_page_score,
    budgetScore: row.budget_score,
    contentScore: row.content_score,
    keywordAnalysisData: row.keyword_analysis_data,
    marketAnalysisData: row.market_analysis_data,
    landingPageAnalysisData: row.landing_page_analysis_data,
    budgetAnalysisData: row.budget_analysis_data,
    contentAnalysisData: row.content_analysis_data,
    recommendations: row.recommendations,
    calculatedAt: row.calculated_at,
  }
}

/**
 * 解析Launch Score的详细分析数据
 */
export function parseLaunchScoreAnalysis(score: LaunchScore): ScoreAnalysis {
  return {
    keywordAnalysis: score.keywordAnalysisData ? JSON.parse(score.keywordAnalysisData) : {},
    marketFitAnalysis: score.marketAnalysisData ? JSON.parse(score.marketAnalysisData) : {},
    landingPageAnalysis: score.landingPageAnalysisData
      ? JSON.parse(score.landingPageAnalysisData)
      : {},
    budgetAnalysis: score.budgetAnalysisData ? JSON.parse(score.budgetAnalysisData) : {},
    contentAnalysis: score.contentAnalysisData ? JSON.parse(score.contentAnalysisData) : {},
    overallRecommendations: score.recommendations ? JSON.parse(score.recommendations) : [],
  } as ScoreAnalysis
}
