'use client'

/**
 * Step 1: Ad Creative Generation
 * 生成广告创意、评分、对比分析
 */

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Star, RefreshCw, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, ExternalLink, Wand2 } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'
import ScoreRadarChart from '@/components/charts/ScoreRadarChart'
import { BonusScoreCard } from '@/components/BonusScoreCard'
import { ConversionFeedbackForm } from '@/components/ConversionFeedbackForm'

interface Props {
  offer: any
  onCreativeSelected: (creative: any) => void
  selectedCreative: any | null
}

interface KeywordWithVolume {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
}

interface HeadlineAsset {
  text: string
  type?: 'brand' | 'product' | 'promo' | 'cta' | 'urgency'
  length?: number
  keywords?: string[]
  hasNumber?: boolean
  hasUrgency?: boolean
}

interface DescriptionAsset {
  text: string
  type?: 'value' | 'cta'
  length?: number
  hasCTA?: boolean
  keywords?: string[]
}

interface QualityMetrics {
  headline_diversity_score?: number
  keyword_relevance_score?: number
  estimated_ad_strength?: 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'
}

interface Creative {
  id: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  keywordsWithVolume?: KeywordWithVolume[]
  negativeKeywords?: string[]  // 🎯 新增：否定关键词
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    url: string
    description?: string
  }>
  final_url: string
  score: number
  score_breakdown: {
    relevance: number
    quality: number
    engagement: number
    diversity: number
    clarity: number
  }
  score_explanation: string
  generation_round: number
  theme: string
  ai_model: string

  // AD_STRENGTH新增字段
  headlinesWithMetadata?: HeadlineAsset[]
  descriptionsWithMetadata?: DescriptionAsset[]
  qualityMetrics?: QualityMetrics
  adStrength?: {
    rating: 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT' | 'PENDING'
    score: number
    isExcellent: boolean
    dimensions: {
      diversity: { score: number; weight: number; details: any }
      relevance: { score: number; weight: number; details: any }
      completeness: { score: number; weight: number; details: any }
      quality: { score: number; weight: number; details: any }
      compliance: { score: number; weight: number; details: any }
      brandSearchVolume?: { score: number; weight: number; details: any }
      competitivePositioning?: { score: number; weight: number; details: any }
    }
    suggestions: string[]
  }
  optimization?: {
    attempts: number
    targetRating: string
    achieved: boolean
    history: Array<{
      attempt: number
      rating: string
      score: number
      suggestions: string[]
    }>
  }
}

// 格式化搜索量显示
const formatSearchVolume = (volume: number): string => {
  if (volume === 0) return '-'
  if (volume < 1000) return volume.toString()
  if (volume < 10000) return `${(volume / 1000).toFixed(1)}K`
  if (volume < 1000000) return `${Math.round(volume / 1000)}K`
  return `${(volume / 1000000).toFixed(1)}M`
}

// 竞争度颜色映射
const getCompetitionColor = (competition?: string): string => {
  if (!competition) return 'text-gray-500'
  const comp = competition.toUpperCase()
  if (comp === 'LOW') return 'text-green-600'
  if (comp === 'MEDIUM') return 'text-yellow-600'
  if (comp === 'HIGH') return 'text-red-600'
  return 'text-gray-500'
}

// Ad Strength评级颜色和样式
const getAdStrengthColor = (rating: string) => {
  switch (rating) {
    case 'EXCELLENT':
      return 'text-green-600 bg-green-50 border-green-200'
    case 'GOOD':
      return 'text-blue-600 bg-blue-50 border-blue-200'
    case 'AVERAGE':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    case 'POOR':
      return 'text-red-600 bg-red-50 border-red-200'
    default:
      return 'text-gray-600 bg-gray-50 border-gray-200'
  }
}

const getAdStrengthBadge = (rating: string) => {
  switch (rating) {
    case 'EXCELLENT':
      return { label: '优秀', variant: 'default' as const, className: 'bg-green-600 hover:bg-green-700' }
    case 'GOOD':
      return { label: '良好', variant: 'default' as const, className: 'bg-blue-600 hover:bg-blue-700' }
    case 'AVERAGE':
      return { label: '一般', variant: 'secondary' as const, className: 'bg-yellow-500 hover:bg-yellow-600' }
    case 'POOR':
      return { label: '待优化', variant: 'destructive' as const }
    default:
      return { label: '待评估', variant: 'outline' as const }
  }
}

const getAdStrengthLabel = (rating: string) => {
  const labels: Record<string, string> = {
    'EXCELLENT': '优秀',
    'GOOD': '良好',
    'AVERAGE': '一般',
    'POOR': '待优化',
    'PENDING': '待评估'
  }
  return labels[rating] || rating
}

export default function Step1CreativeGeneration({ offer, onCreativeSelected, selectedCreative }: Props) {
  const [generating, setGenerating] = useState(false)
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(
    selectedCreative?.id || null
  )
  const [generationCount, setGenerationCount] = useState(0)

  // 生成进度状态
  const [generationProgress, setGenerationProgress] = useState<{
    step: string
    progress: number
    message: string
    details?: any
  } | null>(null)

  // 生成开始时间（用于计算总耗时）
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null)
  const [elapsedTime, setElapsedTime] = useState<number>(0)

  // 展开/折叠状态管理
  const [expandedSections, setExpandedSections] = useState<Record<number, Record<string, boolean>>>({})

  // Bonus Score & Conversion Feedback
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const [selectedCreativeForFeedback, setSelectedCreativeForFeedback] = useState<number | null>(null)
  const [bonusScoreRefreshKey, setBonusScoreRefreshKey] = useState(0)
  const toggleSection = (creativeId: number, section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [creativeId]: {
        ...prev[creativeId],
        [section]: !prev[creativeId]?.[section]
      }
    }))
  }

  const isSectionExpanded = (creativeId: number, section: string) => {
    return expandedSections[creativeId]?.[section] || false
  }

  useEffect(() => {
    fetchExistingCreatives()
  }, [offer.id])

  // 计时器：每秒更新已用时间
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    if (generating && generationStartTime) {
      timer = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - generationStartTime) / 1000))
      }, 1000)
    } else {
      setElapsedTime(0)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [generating, generationStartTime])

  const fetchExistingCreatives = async () => {
    try {
      const response = await fetch(`/api/offers/${offer.id}/generate-ad-creative`, {
        credentials: 'include'
      })

      if (!response.ok) return

      const data = await response.json()
      if (data.creatives && data.creatives.length > 0) {
        // 转换数据库创意为前端需要的格式（构造adStrength对象）
        const formattedCreatives = data.creatives.map((c: any) => {
          const calculatedRating = c.score >= 85 ? 'EXCELLENT' : c.score >= 70 ? 'GOOD' : c.score >= 50 ? 'AVERAGE' : 'POOR'

          return {
            ...c,
            // 构造adStrength对象（如果不存在）
            adStrength: c.adStrength || {
              rating: calculatedRating,
              score: c.score || 0,
              dimensions: {
                diversity: {
                  score: c.score_breakdown?.diversity || 0,
                  weight: 0.25,
                  details: ''
                },
                relevance: {
                  score: c.score_breakdown?.relevance || 0,
                  weight: 0.25,
                  details: ''
                },
                completeness: {
                  score: c.score_breakdown?.engagement || 0,
                  weight: 0.20,
                  details: ''
                },
                quality: {
                  score: c.score_breakdown?.quality || 0,
                  weight: 0.20,
                  details: ''
                },
                compliance: {
                  score: c.score_breakdown?.clarity || 0,
                  weight: 0.10,
                  details: ''
                }
              },
              suggestions: c.score_explanation ? [c.score_explanation] : []
            }
          }
        })

        // 🎯 排序：按分数从高到低，若分数相同则按创建时间从新到旧
        const sortedCreatives = formattedCreatives
          .sort((a: any, b: any) => {
            // 首先按分数从高到低排序
            if (b.score !== a.score) {
              return b.score - a.score
            }
            // 若分数相同，按创建时间从新到旧排序
            const timeA = new Date(a.created_at).getTime()
            const timeB = new Date(b.created_at).getTime()
            return timeB - timeA
          })
          // 🎯 只取前 3 个最佳创意
          .slice(0, 3)

        setCreatives(sortedCreatives)
        setGenerationCount(formattedCreatives.length)

        // Auto-select if already selected
        const selected = sortedCreatives.find((c: Creative) => c.id === selectedCreative?.id)
        if (selected) {
          setSelectedId(selected.id)
        }
      }
    } catch (error) {
      console.error('Failed to fetch creatives:', error)
    }
  }

  const handleGenerate = async () => {
    try {
      setGenerating(true)
      setGenerationStartTime(Date.now())
      setGenerationProgress({ step: 'init', progress: 0, message: '正在初始化...' })

      // 🔥 Step 1: 入队获取taskId
      const enqueueResponse = await fetch(`/api/offers/${offer.id}/generate-creatives-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ maxRetries: 3, targetRating: 'EXCELLENT' })
      })

      if (!enqueueResponse.ok) {
        const errorData = await enqueueResponse.json()
        throw new Error(errorData.error || '任务入队失败')
      }

      const { taskId } = await enqueueResponse.json()

      // 🔥 Step 2: 订阅SSE流
      const response = await fetch(`/api/creative-tasks/${taskId}/stream`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('无法订阅任务进度')
      }

      // 读取SSE流
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === 'progress') {
                setGenerationProgress({
                  step: data.step,
                  progress: data.progress,
                  message: data.message,
                  details: data.details
                })
              } else if (data.type === 'result') {
                // 生成成功
                const newCreative = {
                  id: data.creative.id,
                  ...data.creative,
                  score: data.adStrength.score,
                  score_breakdown: {
                    diversity: data.adStrength.dimensions.diversity.score,
                    relevance: data.adStrength.dimensions.relevance.score,
                    engagement: data.adStrength.dimensions.completeness.score,
                    quality: data.adStrength.dimensions.quality.score,
                    clarity: data.adStrength.dimensions.compliance.score
                  },
                  score_explanation: data.adStrength.suggestions.join(' '),
                  generation_round: generationCount + 1,
                  theme: data.creative.theme || '品牌导向',
                  ai_model: 'gemini-2.5-pro',
                  final_url: data.offer?.url || '',
                  adStrength: data.adStrength,
                  optimization: data.optimization
                }

                const rating = data.adStrength.rating
                const score = data.adStrength.score
                showSuccess(
                  '生成成功',
                  `Ad Strength: ${rating === 'EXCELLENT' ? '优秀' : rating === 'GOOD' ? '良好' : rating === 'AVERAGE' ? '一般' : '待优化'} (${score}分)`
                )

                const allCreatives = [...creatives, newCreative]
                const topCreatives = allCreatives
                  .sort((a: any, b: any) => {
                    // 首先按分数从高到低排序
                    if (b.score !== a.score) {
                      return b.score - a.score
                    }
                    // 若分数相同，按创建时间从新到旧排序
                    const timeA = new Date(a.created_at).getTime()
                    const timeB = new Date(b.created_at).getTime()
                    return timeB - timeA
                  })
                  .slice(0, 3)

                setCreatives(topCreatives)
                setGenerationCount(generationCount + 1)
              } else if (data.type === 'error') {
                throw new Error(data.error)
              }
            } catch (parseError) {
              console.warn('解析SSE数据失败:', parseError)
            }
          }
        }
      }
    } catch (error: any) {
      showError('生成失败', error.message)
    } finally {
      setGenerating(false)
      setGenerationProgress(null)
      setGenerationStartTime(null)
    }
  }

  const handleSelect = async (creative: Creative) => {
    try {
      const response = await fetch(`/api/ad-creatives/${creative.id}/select`, {
        method: 'POST',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('选择失败')
      }

      setSelectedId(creative.id)
      onCreativeSelected(creative)
      showSuccess('已选择', '创意已选择，可以进入下一步')
    } catch (error: any) {
      showError('选择失败', error.message)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50 border-green-200'
    if (score >= 60) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-red-600 bg-red-50 border-red-200'
  }

  const getScoreBadge = (score: number) => {
    if (score >= 80) return { label: '优秀', variant: 'default' as const, className: 'bg-green-600' }
    if (score >= 60) return { label: '良好', variant: 'secondary' as const, className: 'bg-yellow-500' }
    return { label: '待优化', variant: 'destructive' as const }
  }

  // 解析评分说明
  const parseScoreExplanation = (explanation: string) => {
    if (!explanation) return []

    // 解析格式: "相关性 2.1/30: 相关性有待提升 质量 19.7/25: 文案质量良好..."
    const regex = /([^\s]+)\s+([\d.]+)\/([\d.]+):\s*([^]+?)(?=\s+[^\s]+\s+[\d.]+\/[\d.]+:|$)/g
    const items: Array<{ dimension: string; score: number; max: number; comment: string }> = []

    let match
    while ((match = regex.exec(explanation)) !== null) {
      items.push({
        dimension: match[1],
        score: parseFloat(match[2]),
        max: parseFloat(match[3]),
        comment: match[4].trim()
      })
    }

    return items
  }

  // 渲染可展开的列表
  const renderExpandableList = (
    creativeId: number,
    sectionKey: string,
    items: string[],
    title: string,
    defaultShow = 3
  ) => {
    const isExpanded = isSectionExpanded(creativeId, sectionKey)
    const displayItems = isExpanded ? items : items.slice(0, defaultShow)
    const hasMore = items.length > defaultShow

    return (
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
          <span>{title} ({items.length})</span>
          {hasMore && (
            <button
              onClick={() => toggleSection(creativeId, sectionKey)}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {isExpanded ? (
                <>收起 <ChevronUp className="w-3 h-3" /></>
              ) : (
                <>展开全部 <ChevronDown className="w-3 h-3" /></>
              )}
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {displayItems.map((item, i) => (
            <div key={i} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
              {item}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-purple-600" />
            生成广告创意
          </h2>
          <p className="text-gray-500 mt-1">
            AI自动生成广告创意，包含标题、描述、关键词等完整内容，并提供专业评分和解释
          </p>
        </div>
        <div className="flex items-center gap-3">
          {creatives.length > 0 && (
            <Badge variant="secondary" className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 shadow-sm">
              已生成: {generationCount}次 | 展示最佳3个
            </Badge>
          )}

          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-md shadow-purple-500/20 border-0"
            title={generating ? 'AI正在生成创意，最多可能需要2分钟，请耐心等待...' : ''}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                AI生成中...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {generationCount === 0 ? '开始生成创意' : '再次生成'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Creatives List */}
      {creatives.length === 0 ? (
        <Card className="border-dashed border-2 border-gray-200 bg-gray-50/50 py-8">
          <CardContent className="text-center">
            {generating && generationProgress ? (
              // 生成中显示进度
              <div className="space-y-4">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto">
                  <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    AI正在生成广告创意
                  </h3>
                  <p className="text-purple-600 font-medium text-sm">
                    {generationProgress.message}
                  </p>
                </div>
                {/* 进度条 */}
                <div className="max-w-md mx-auto">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>进度</span>
                    <span>{generationProgress.progress}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${generationProgress.progress}%` }}
                    />
                  </div>
                  {/* 总耗时显示 */}
                  <div className="flex justify-center mt-2">
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      已用时: {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
                {/* 详细信息 */}
                {generationProgress.details && (
                  <div className="text-xs text-gray-500 space-y-1">
                    {generationProgress.details.attempt && (
                      <p>第 {generationProgress.details.attempt} / {generationProgress.details.maxRetries || 3} 次尝试</p>
                    )}
                    {generationProgress.details.rating && (
                      <p className="flex items-center justify-center gap-1">
                        当前评级:
                        <span className={`font-medium ${
                          generationProgress.details.rating === 'EXCELLENT' ? 'text-green-600' :
                          generationProgress.details.rating === 'GOOD' ? 'text-blue-600' :
                          generationProgress.details.rating === 'AVERAGE' ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {generationProgress.details.rating === 'EXCELLENT' ? '优秀' :
                           generationProgress.details.rating === 'GOOD' ? '良好' :
                           generationProgress.details.rating === 'AVERAGE' ? '一般' : '待优化'}
                        </span>
                        ({generationProgress.details.score}分)
                      </p>
                    )}
                    {generationProgress.details.suggestions && generationProgress.details.suggestions.length > 0 && (
                      <div className="mt-2 text-left bg-yellow-50 rounded-lg p-2 max-w-sm mx-auto">
                        <p className="font-medium text-yellow-800 mb-1">优化建议:</p>
                        <ul className="text-yellow-700 list-disc list-inside">
                          {generationProgress.details.suggestions.map((s: string, i: number) => (
                            <li key={i} className="truncate">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  AI正在努力创作最优质的广告文案，请稍候...
                </p>
              </div>
            ) : (
              // 未生成时显示空状态
              <>
                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-4">
                  <Wand2 className="w-8 h-8 text-purple-500" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">
                  还没有广告创意
                </h3>
                <p className="text-gray-500 max-w-md mx-auto mb-4 text-sm">
                  点击右上角的"开始生成创意"按钮，AI将自动生成高质量的Google Ads广告文案
                </p>
                <Button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 border-0"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  立即生成
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {creatives.map((creative, index) => {
            const isSelected = selectedId === creative.id
            const rankLabels = ['🥇 TOP 1', '🥈 TOP 2', '🥉 TOP 3']

            return (
              <Card
                key={creative.id}
                className={`relative transition-all duration-200 group hover:shadow-md ${isSelected
                  ? 'ring-2 ring-purple-500 shadow-lg bg-purple-50/10'
                  : 'hover:border-purple-200'
                  }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <span className="font-bold text-gray-900">{rankLabels[index]}</span>
                        {/* 轮次标记 */}
                        <Badge
                          variant="outline"
                          className={`
                            text-[11px] px-1.5 py-0.5 h-5 font-semibold border
                            ${creative.generation_round === 1 ? 'bg-blue-50 text-blue-700 border-blue-300' : ''}
                            ${creative.generation_round === 2 ? 'bg-green-50 text-green-700 border-green-300' : ''}
                            ${creative.generation_round === 3 ? 'bg-orange-50 text-orange-700 border-orange-300' : ''}
                            ${creative.generation_round > 3 ? 'bg-gray-50 text-gray-600 border-gray-300' : ''}
                          `}
                        >
                          {creative.generation_round}
                        </Badge>
                      </CardTitle>
                      <div className="text-xs text-muted-foreground mt-1">
                        <span>{creative.theme || '综合推广'}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {/* 广告创意ID - 右上角显示 */}
                      <div className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-md font-mono border border-gray-200">
                        ID: {creative.id}
                      </div>

                      {isSelected && (
                        <Badge variant="default" className="bg-purple-600 hover:bg-purple-700">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          已选择
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Ad Strength Rating Display */}
                  {creative.adStrength ? (
                    <div className={`p-4 rounded-xl border ${getAdStrengthColor(creative.adStrength.rating)} bg-opacity-50`}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700">Ad Strength</span>
                        <Badge
                          variant={getAdStrengthBadge(creative.adStrength.rating).variant}
                          className={getAdStrengthBadge(creative.adStrength.rating).className}
                        >
                          {getAdStrengthBadge(creative.adStrength.rating).label}
                        </Badge>
                      </div>
                      <div className="flex items-baseline gap-2 mb-3">
                        <div className="text-3xl font-bold tracking-tight">{creative.adStrength.score.toFixed(0)}</div>
                        <div className="text-sm text-gray-500 font-medium">/ 100</div>
                      </div>

                      {/* Radar Chart - Ad Strength Dimensions */}
                      {creative.adStrength.dimensions && (
                        <div className="mt-2">
                          <ScoreRadarChart
                            scoreBreakdown={{
                              diversity: creative.adStrength.dimensions.diversity.score,
                              relevance: creative.adStrength.dimensions.relevance.score,
                              engagement: creative.adStrength.dimensions.completeness.score,
                              quality: creative.adStrength.dimensions.quality.score,
                              clarity: creative.adStrength.dimensions.compliance.score,
                              brandSearchVolume: creative.adStrength.dimensions.brandSearchVolume?.score,
                              competitivePositioning: creative.adStrength.dimensions.competitivePositioning?.score
                            }}
                            maxScores={{
                              diversity: 18,
                              relevance: 18,
                              engagement: 14,
                              quality: 14,
                              clarity: 8,
                              brandSearchVolume: 18,
                              competitivePositioning: 10
                            }}
                            size="sm"
                          />
                        </div>
                      )}

                      {/* Performance Bonus Score */}
                      <div className="mt-3 border-t pt-3">
                        <BonusScoreCard
                          key={`bonus-${creative.id}-${bonusScoreRefreshKey}`}
                          adCreativeId={creative.id}
                          baseScore={creative.adStrength.score || 0}
                          onConversionClick={() => {
                            setSelectedCreativeForFeedback(creative.id)
                            setShowFeedbackForm(true)
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    /* Fallback: Old Score Display */
                    <div className={`p-4 rounded-xl border ${getScoreColor(creative.score)}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">综合评分</span>
                        <Badge variant={getScoreBadge(creative.score).variant} className={getScoreBadge(creative.score).className}>
                          {getScoreBadge(creative.score).label}
                        </Badge>
                      </div>
                      <div className="text-3xl font-bold">{creative.score.toFixed(1)}</div>
                    </div>
                  )}

                  <Separator />

                  {/* Headlines */}
                  {renderExpandableList(
                    creative.id,
                    'headlines',
                    creative.headlines,
                    '标题'
                  )}

                  {/* Descriptions */}
                  {creative.descriptions && creative.descriptions.length > 0 && (
                    <>
                      <Separator />
                      {renderExpandableList(
                        creative.id,
                        'descriptions',
                        creative.descriptions,
                        '描述'
                      )}
                    </>
                  )}

                  {/* Keywords */}
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-3 flex items-center justify-between">
                      <span>关键词 ({creative.keywordsWithVolume?.length || creative.keywords.length})</span>
                      {(creative.keywordsWithVolume?.length || creative.keywords.length) > 3 && (
                        <button
                          onClick={() => toggleSection(creative.id, 'keywords')}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                        >
                          {isSectionExpanded(creative.id, 'keywords') ? (
                            <>收起 <ChevronUp className="w-3 h-3" /></>
                          ) : (
                            <>展开全部 <ChevronDown className="w-3 h-3" /></>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {creative.keywordsWithVolume ? (
                        (isSectionExpanded(creative.id, 'keywords')
                          ? creative.keywordsWithVolume
                          : creative.keywordsWithVolume.slice(0, 3)
                        ).map((kw, i) => (
                          <Badge key={i} variant="secondary" className="text-xs flex items-center gap-1.5 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200">
                            <span className="font-medium">{kw.keyword}</span>
                            {kw.searchVolume > 0 && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span className="text-blue-600 font-semibold">{formatSearchVolume(kw.searchVolume)}</span>
                              </>
                            )}
                          </Badge>
                        ))
                      ) : (
                        (isSectionExpanded(creative.id, 'keywords')
                          ? creative.keywords
                          : creative.keywords.slice(0, 3)
                        ).map((k, i) => (
                          <Badge key={i} variant="secondary" className="text-xs bg-gray-100 text-gray-700">
                            {k}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Negative Keywords */}
                  {creative.negativeKeywords && creative.negativeKeywords.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-3 flex items-center justify-between">
                          <span>否定关键词 ({creative.negativeKeywords.length})</span>
                          {creative.negativeKeywords.length > 5 && (
                            <button
                              onClick={() => toggleSection(creative.id, 'negativeKeywords')}
                              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                            >
                              {isSectionExpanded(creative.id, 'negativeKeywords') ? (
                                <>收起 <ChevronUp className="w-3 h-3" /></>
                              ) : (
                                <>展开全部 <ChevronDown className="w-3 h-3" /></>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(isSectionExpanded(creative.id, 'negativeKeywords')
                            ? creative.negativeKeywords
                            : creative.negativeKeywords.slice(0, 5)
                          ).map((nk, i) => (
                            <Badge key={i} variant="outline" className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 border-red-200">
                              {nk}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Callouts */}
                  {creative.callouts && creative.callouts.length > 0 && (
                    <>
                      <Separator />
                      {renderExpandableList(
                        creative.id,
                        'callouts',
                        creative.callouts,
                        '附加信息',
                        4
                      )}
                    </>
                  )}

                  {/* Sitelinks */}
                  {creative.sitelinks && creative.sitelinks.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2">
                          附加链接 ({creative.sitelinks.length})
                        </div>
                        <div className="space-y-1">
                          {creative.sitelinks.map((link, i) => (
                            <div key={i}>
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:text-blue-800 underline hover:no-underline inline-flex items-center gap-1"
                              >
                                {link.text}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Select Button */}
                  <Button
                    className={`w-full transition-all duration-200 ${isSelected
                      ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                      : 'bg-gray-900 hover:bg-gray-800 text-white'
                      }`}
                    onClick={() => handleSelect(creative)}
                    disabled={isSelected}
                  >
                    {isSelected ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        已选择此创意
                      </>
                    ) : (
                      '选择此创意'
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Conversion Feedback Dialog */}
      {selectedCreativeForFeedback && (
        <ConversionFeedbackForm
          adCreativeId={selectedCreativeForFeedback}
          open={showFeedbackForm}
          onOpenChange={setShowFeedbackForm}
          onSuccess={() => {
            // Refresh bonus score data
            setBonusScoreRefreshKey(prev => prev + 1)
            setShowFeedbackForm(false)
          }}
        />
      )}
    </div>
  )
}
