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
import { Star, RefreshCw, CheckCircle2, AlertCircle, TrendingUp, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { showError, showSuccess } from '@/lib/toast-utils'
import ScoreRadarChart from '@/components/charts/ScoreRadarChart'

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

interface Creative {
  id: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  keywordsWithVolume?: KeywordWithVolume[]
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

export default function Step1CreativeGeneration({ offer, onCreativeSelected, selectedCreative }: Props) {
  const [generating, setGenerating] = useState(false)
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(
    selectedCreative?.id || null
  )
  const [generationCount, setGenerationCount] = useState(0)
  const [comparing, setComparing] = useState(false)
  const [comparisonResult, setComparisonResult] = useState<any>(null)

  // 展开/折叠状态管理
  const [expandedSections, setExpandedSections] = useState<Record<number, Record<string, boolean>>>({})

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

  const fetchExistingCreatives = async () => {
    try {
      const response = await fetch(`/api/offers/${offer.id}/generate-ad-creative`, {
        credentials: 'include'
      })

      if (!response.ok) return

      const data = await response.json()
      if (data.creatives && data.creatives.length > 0) {
        setCreatives(data.creatives)
        setGenerationCount(data.creatives.length)

        // Auto-select if already selected
        const selected = data.creatives.find((c: Creative) => c.id === selectedCreative?.id)
        if (selected) {
          setSelectedId(selected.id)
        }
      }
    } catch (error) {
      console.error('Failed to fetch creatives:', error)
    }
  }

  const handleGenerate = async () => {
    if (generationCount >= 3) {
      showError('已达上限', '每个Offer最多生成3个广告创意')
      return
    }

    try {
      setGenerating(true)

      const response = await fetch(`/api/offers/${offer.id}/generate-ad-creative`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          generation_round: generationCount + 1
        })
      })

      const data = await response.json()

      if (!response.ok) {
        // Check if AI is not configured
        if (data.redirect) {
          showError(data.error || 'AI配置未设置', data.message || '请前往设置页面配置AI')
          setTimeout(() => {
            window.location.href = data.redirect
          }, 2000)
          return
        }
        throw new Error(data.error || '生成失败')
      }

      showSuccess('生成成功', `创意评分: ${data.creative.score.toFixed(1)}分`)
      setCreatives([...creatives, data.creative])
      setGenerationCount(generationCount + 1)

      // Auto-compare if we have multiple creatives
      if (creatives.length > 0) {
        handleCompare([...creatives, data.creative])
      }
    } catch (error: any) {
      showError('生成失败', error.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleCompare = async (creativesToCompare?: Creative[]) => {
    const targetCreatives = creativesToCompare || creatives
    if (targetCreatives.length < 2) {
      showError('无法对比', '至少需要2个创意才能对比')
      return
    }

    try {
      setComparing(true)

      const response = await fetch('/api/ad-creatives/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          creative_ids: targetCreatives.slice(0, 3).map(c => c.id)
        })
      })

      if (!response.ok) {
        throw new Error('对比失败')
      }

      const data = await response.json()
      setComparisonResult(data.comparison)
    } catch (error: any) {
      showError('对比失败', error.message)
    } finally {
      setComparing(false)
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
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="w-5 h-5 text-purple-600" />
            生成广告创意
          </CardTitle>
          <CardDescription>
            AI自动生成广告创意，包含标题、描述、关键词等完整内容，并提供专业评分和解释
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge variant="outline">
                已生成: {generationCount}/3
              </Badge>
              {creatives.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCompare()}
                  disabled={comparing}
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  {comparing ? '对比中...' : '对比分析'}
                </Button>
              )}
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generating || generationCount >= 3}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {generationCount === 0 ? '开始生成' : '重新生成'}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Result */}
      {comparisonResult && (
        <Alert className="bg-blue-50 border-blue-200">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900">
            <strong>对比建议：</strong>
            {comparisonResult.recommendation}
          </AlertDescription>
        </Alert>
      )}

      {/* Creatives List */}
      {creatives.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Star className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">点击"开始生成"创建第一个广告创意</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {creatives.map((creative, index) => {
            const scoreBadge = getScoreBadge(creative.score)
            const isSelected = selectedId === creative.id

            return (
              <Card
                key={creative.id}
                className={`relative ${isSelected ? 'ring-2 ring-primary shadow-lg' : ''}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        创意 #{index + 1}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {creative.theme || '综合推广'}
                      </CardDescription>
                    </div>

                    {isSelected && (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        已选择
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Score Display with Radar Chart */}
                  <div className={`p-4 rounded-lg border ${getScoreColor(creative.score)}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium">综合评分</span>
                      <Badge variant={scoreBadge.variant} className={scoreBadge.className}>
                        {scoreBadge.label}
                      </Badge>
                    </div>
                    <div className="text-3xl font-bold mb-3">{creative.score.toFixed(1)}</div>

                    {/* Radar Chart */}
                    <ScoreRadarChart
                      scoreBreakdown={creative.score_breakdown}
                      size="sm"
                    />
                  </div>

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
                    <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                      <span>关键词 ({creative.keywordsWithVolume?.length || creative.keywords.length})</span>
                      {(creative.keywordsWithVolume?.length || creative.keywords.length) > 3 && (
                        <button
                          onClick={() => toggleSection(creative.id, 'keywords')}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          {isSectionExpanded(creative.id, 'keywords') ? (
                            <>收起 <ChevronUp className="w-3 h-3" /></>
                          ) : (
                            <>展开全部 <ChevronDown className="w-3 h-3" /></>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {creative.keywordsWithVolume ? (
                        // 显示带搜索量的关键词
                        (isSectionExpanded(creative.id, 'keywords')
                          ? creative.keywordsWithVolume
                          : creative.keywordsWithVolume.slice(0, 3)
                        ).map((kw, i) => (
                          <Badge key={i} variant="outline" className="text-xs flex items-center gap-1.5 px-2 py-1">
                            <span className="font-medium">{kw.keyword}</span>
                            {kw.searchVolume > 0 && (
                              <>
                                <span className="text-gray-400">|</span>
                                <span className="text-blue-600 font-semibold">{formatSearchVolume(kw.searchVolume)}</span>
                                {kw.competition && (
                                  <>
                                    <span className="text-gray-400">|</span>
                                    <span className={getCompetitionColor(kw.competition)}>
                                      {kw.competition.substring(0, 1)}
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </Badge>
                        ))
                      ) : (
                        // 显示普通关键词（向后兼容）
                        (isSectionExpanded(creative.id, 'keywords')
                          ? creative.keywords
                          : creative.keywords.slice(0, 3)
                        ).map((k, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {k}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Callouts */}
                  {creative.callouts && creative.callouts.length > 0 && (
                    <>
                      <Separator />
                      {renderExpandableList(
                        creative.id,
                        'callouts',
                        creative.callouts,
                        'Callout扩展'
                      )}
                    </>
                  )}

                  {/* Sitelinks */}
                  {creative.sitelinks && creative.sitelinks.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                          <span>附加链接 ({creative.sitelinks.length})</span>
                          {creative.sitelinks.length > 3 && (
                            <button
                              onClick={() => toggleSection(creative.id, 'sitelinks')}
                              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                              {isSectionExpanded(creative.id, 'sitelinks') ? (
                                <>收起 <ChevronUp className="w-3 h-3" /></>
                              ) : (
                                <>展开全部 <ChevronDown className="w-3 h-3" /></>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {(isSectionExpanded(creative.id, 'sitelinks')
                            ? creative.sitelinks
                            : creative.sitelinks.slice(0, 3)
                          ).map((link, i) => (
                            <a
                              key={i}
                              href={link.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block bg-gray-50 p-2.5 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-blue-600 hover:text-blue-800">{link.text}</div>
                                  {link.description && (
                                    <div className="text-xs text-gray-600 mt-0.5">{link.description}</div>
                                  )}
                                </div>
                                {link.url && (
                                  <ExternalLink className="w-3 h-3 text-blue-500 flex-shrink-0 mt-1" />
                                )}
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Select Button */}
                  <Button
                    className="w-full"
                    variant={isSelected ? 'secondary' : 'default'}
                    onClick={() => handleSelect(creative)}
                    disabled={isSelected}
                  >
                    {isSelected ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        已选择
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
    </div>
  )
}
