/**
 * LaunchScore相关类型定义
 */

export interface LaunchScoreModalProps {
  isOpen: boolean
  onClose: () => void
  offer: {
    id: number
    offerName: string
    brand: string
  }
}

export interface Creative {
  id: number
  version: number
  headline1: string
  headline2: string | null
  headline3: string | null
  description1: string
  description2: string | null
  finalUrl: string
  qualityScore: number | null
  isApproved: boolean
  createdAt: string
}

export interface ScoreDimension {
  score: number
  issues: string[]
  suggestions: string[]
}

export interface LaunchScoreData {
  totalScore: number
  keywordAnalysis: ScoreDimension & {
    relevance: number
    competition: string
  }
  marketFitAnalysis: ScoreDimension & {
    targetAudienceMatch: number
    geographicRelevance: number
    competitorPresence: string
  }
  landingPageAnalysis: ScoreDimension & {
    loadSpeed: number
    mobileOptimization: boolean
    contentRelevance: number
    callToAction: boolean
    trustSignals: number
  }
  budgetAnalysis: ScoreDimension & {
    estimatedCpc: number
    competitiveness: string
    roi: number
  }
  contentAnalysis: ScoreDimension & {
    headlineQuality: number
    descriptionQuality: number
    keywordAlignment: number
    uniqueness: number
  }
  overallRecommendations: string[]
}

export interface ScoreHistoryItem {
  id: number
  creative_id: number
  total_score: number
  keyword_analysis_data: string
  market_analysis_data: string
  landing_page_analysis_data: string
  budget_analysis_data: string
  content_analysis_data: string
  recommendations: string
  created_at: string
}

export interface CompareDataItem {
  creativeId: number
  version: number
  headline: string
  score: LaunchScoreData | null
  createdAt: string
}

export interface PerformanceData {
  success: boolean
  data: {
    totalScore: number
    metricsUsed: string[]
    performanceGrade: string
    correlationInsights: string[]
    creativePerformance?: {
      impressions: number
      clicks: number
      cost: number
      conversions: number
      ctr: number
      avgCpc: number
      conversionRate: number
    }
  }
}

export type LaunchScoreTab = 'current' | 'history' | 'compare' | 'performance'

// 维度映射用于渲染
export const DIMENSION_CONFIG = {
  keyword: {
    key: 'keyword',
    name: '关键词分析',
    maxScore: 30,
    color: 'from-blue-500 to-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  },
  market: {
    key: 'market',
    name: '市场契合度',
    maxScore: 25,
    color: 'from-green-500 to-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  },
  landing: {
    key: 'landing',
    name: '落地页质量',
    maxScore: 20,
    color: 'from-purple-500 to-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  },
  budget: {
    key: 'budget',
    name: '预算效率',
    maxScore: 15,
    color: 'from-orange-500 to-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200'
  },
  content: {
    key: 'content',
    name: '内容质量',
    maxScore: 10,
    color: 'from-pink-500 to-pink-600',
    bgColor: 'bg-pink-50',
    borderColor: 'border-pink-200'
  },
} as const
