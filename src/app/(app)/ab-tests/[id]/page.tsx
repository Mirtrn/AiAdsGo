'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showSuccess, showError } from '@/lib/toast-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  RefreshCw,
  MousePointerClick,
  Target,
  Clock,
  DollarSign,
} from 'lucide-react'

interface ABTestStatus {
  test: {
    id: number
    name: string
    mode: string
    dimension: 'creative' | 'strategy'
    status: string
    start_date: string | null
    end_date: string | null
    created_at: string
  }
  progress: {
    total_samples: number
    min_samples_required: number
    completion_percentage: number
    estimated_completion_date: string | null
    hours_running: number
  }
  current_leader: {
    variant_name: string
    variant_label: string
    confidence: number
    improvement_vs_control: number
    ctr: number
    cpc: number
    is_significant: boolean
  } | null
  variants: Array<{
    variant_name: string
    variant_label: string
    campaign_id: number
    campaign_name: string
    campaign_status: string
    traffic_allocation: number
    is_control: boolean
    metrics: {
      impressions: number
      clicks: number
      ctr: number
      conversions: number
      cpc: number
      cost: number
    }
    statistics: {
      confidence_interval_lower: number | null
      confidence_interval_upper: number | null
      p_value: number | null
    }
  }>
  warnings: Array<{
    type: string
    message: string
    severity: string
    action?: string
  }>
  is_complete: boolean
  winner_variant_id: number | null
}

export default function ABTestResultsPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const testId = params.id
  const [result, setResult] = useState<ABTestStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchResults()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchResults, 30000)
    return () => clearInterval(interval)
  }, [testId])

  const fetchResults = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/ab-tests/${testId}/status`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取测试结果失败')
      }

      const data = await response.json()
      setResult(data)
    } catch (err: any) {
      showError('加载失败', err.message)
    } finally {
      setLoading(false)
    }
  }

  const getDimensionLabel = (dimension: string) => {
    return dimension === 'creative' ? '创意测试' : '策略测试'
  }

  const getDimensionIcon = (dimension: string) => {
    return dimension === 'creative' ? MousePointerClick : Target
  }

  const getOptimizationMetric = (dimension: string) => {
    return dimension === 'creative' ? 'CTR（点击率）' : 'CPC（点击成本）'
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-red-500 bg-red-50'
      case 'high':
        return 'border-orange-500 bg-orange-50'
      case 'medium':
        return 'border-yellow-500 bg-yellow-50'
      default:
        return 'border-blue-500 bg-blue-50'
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">测试结果加载失败</p>
          <Button className="mt-4" onClick={() => router.push('/ab-tests')}>
            返回列表
          </Button>
        </div>
      </div>
    )
  }

  const { test, progress, current_leader, variants, warnings, is_complete } = result
  const DimensionIcon = getDimensionIcon(test.dimension)

  // Calculate totals
  const totalImpressions = variants.reduce((sum, v) => sum + v.metrics.impressions, 0)
  const totalClicks = variants.reduce((sum, v) => sum + v.metrics.clicks, 0)
  const totalConversions = variants.reduce((sum, v) => sum + v.metrics.conversions, 0)
  const totalCost = variants.reduce((sum, v) => sum + v.metrics.cost, 0)

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/ab-tests')}
                className="text-indigo-600 hover:text-indigo-500"
              >
                ← 返回列表
              </button>
              <DimensionIcon className="h-5 w-5 text-gray-600" />
              <h1 className="text-xl font-bold text-gray-900">{test.name}</h1>
              <Badge variant="outline">{getDimensionLabel(test.dimension)}</Badge>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={fetchResults}>
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新数据
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0 space-y-6">
          {/* Test Progress */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                测试进度
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                  <span>完成度</span>
                  <span>{progress.completion_percentage.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-indigo-600 h-3 rounded-full transition-all"
                    style={{ width: `${Math.min(100, progress.completion_percentage)}%` }}
                  ></div>
                </div>
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span className="text-gray-600">
                    {progress.total_samples.toLocaleString()} / {progress.min_samples_required.toLocaleString()}{' '}
                    {test.dimension === 'creative' ? '点击' : '转化'}
                  </span>
                  {progress.estimated_completion_date && !is_complete && (
                    <span className="text-gray-500">
                      预计完成: {new Date(progress.estimated_completion_date).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                <div>
                  <p className="text-sm text-gray-600">运行时长</p>
                  <p className="text-lg font-semibold">{progress.hours_running.toFixed(1)} 小时</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">优化目标</p>
                  <p className="text-lg font-semibold">{getOptimizationMetric(test.dimension)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">测试状态</p>
                  <Badge variant={is_complete ? 'default' : 'secondary'} className="mt-1">
                    {is_complete ? '已完成' : '进行中'}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">变体数量</p>
                  <p className="text-lg font-semibold">{variants.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Current Leader */}
          {current_leader && (
            <Card className="border-2 border-indigo-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-indigo-600" />
                  当前领先变体
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold mb-1">
                      {current_leader.variant_label || current_leader.variant_name}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      {test.dimension === 'creative' ? (
                        <>
                          <span>CTR: {current_leader.ctr.toFixed(2)}%</span>
                          <span className="flex items-center gap-1">
                            {current_leader.improvement_vs_control > 0 ? (
                              <>
                                <TrendingUp className="h-4 w-4 text-green-600" />
                                <span className="text-green-600 font-semibold">
                                  +{current_leader.improvement_vs_control.toFixed(1)}%
                                </span>
                              </>
                            ) : current_leader.improvement_vs_control < 0 ? (
                              <>
                                <TrendingDown className="h-4 w-4 text-red-600" />
                                <span className="text-red-600 font-semibold">
                                  {current_leader.improvement_vs_control.toFixed(1)}%
                                </span>
                              </>
                            ) : (
                              <span>持平</span>
                            )}
                            <span className="text-gray-500">vs 对照组</span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span>CPC: ¥{current_leader.cpc.toFixed(2)}</span>
                          <span className="flex items-center gap-1">
                            {current_leader.improvement_vs_control < 0 ? (
                              <>
                                <TrendingDown className="h-4 w-4 text-green-600" />
                                <span className="text-green-600 font-semibold">
                                  {current_leader.improvement_vs_control.toFixed(1)}%
                                </span>
                              </>
                            ) : current_leader.improvement_vs_control > 0 ? (
                              <>
                                <TrendingUp className="h-4 w-4 text-red-600" />
                                <span className="text-red-600 font-semibold">
                                  +{current_leader.improvement_vs_control.toFixed(1)}%
                                </span>
                              </>
                            ) : (
                              <span>持平</span>
                            )}
                            <span className="text-gray-500">vs 对照组</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600 mb-1">统计置信度</p>
                    <p className="text-2xl font-bold text-indigo-600">
                      {(current_leader.confidence * 100).toFixed(1)}%
                    </p>
                    <Badge
                      variant={current_leader.is_significant ? 'default' : 'secondary'}
                      className="mt-2"
                    >
                      {current_leader.is_significant ? '统计显著' : '继续观察'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-3">
              {warnings.map((warning, idx) => (
                <Card key={idx} className={`border-l-4 ${getSeverityColor(warning.severity)}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold mb-1">
                          {warning.severity === 'critical' && '严重警告'}
                          {warning.severity === 'high' && '重要警告'}
                          {warning.severity === 'medium' && '注意'}
                          {warning.severity === 'low' && '提示'}
                        </p>
                        <p className="text-sm">{warning.message}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Overall Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                整体表现
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-sm text-gray-600">总展示次数</p>
                  <p className="text-2xl font-bold">{totalImpressions.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">总点击次数</p>
                  <p className="text-2xl font-bold">{totalClicks.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">总转化次数</p>
                  <p className="text-2xl font-bold">{totalConversions.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">总花费</p>
                  <p className="text-2xl font-bold">¥{totalCost.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Variant Results */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">变体表现对比</h2>
            {variants.map((variant, idx) => {
              const isControl = variant.is_control
              const isLeader =
                current_leader && variant.variant_name === current_leader.variant_name

              return (
                <Card
                  key={idx}
                  className={`${isLeader ? 'border-2 border-indigo-500' : ''} ${
                    isControl ? 'bg-gray-50' : ''
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CardTitle>
                          变体 {variant.variant_label || variant.variant_name}
                        </CardTitle>
                        {isControl && <Badge variant="secondary">对照组</Badge>}
                        {isLeader && (
                          <Badge className="bg-indigo-600 text-white flex items-center gap-1">
                            <Trophy className="h-3 w-3" />
                            领先
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          流量: {(variant.traffic_allocation * 100).toFixed(0)}%
                        </Badge>
                      </div>
                      <Badge
                        variant={
                          variant.campaign_status === 'ENABLED' ? 'default' : 'secondary'
                        }
                      >
                        {variant.campaign_status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Performance Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-600">展示次数</p>
                        <p className="text-lg font-semibold">
                          {variant.metrics.impressions.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">点击次数</p>
                        <p className="text-lg font-semibold">
                          {variant.metrics.clicks.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">转化次数</p>
                        <p className="text-lg font-semibold">
                          {variant.metrics.conversions.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">花费</p>
                        <p className="text-lg font-semibold">
                          ¥{variant.metrics.cost.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Key Metrics */}
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                      <div>
                        <p className="text-xs text-gray-600">点击率 (CTR)</p>
                        <p className="text-xl font-bold text-indigo-600">
                          {variant.metrics.ctr.toFixed(2)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">转化率</p>
                        <p className="text-xl font-bold text-indigo-600">
                          {variant.metrics.clicks > 0
                            ? ((variant.metrics.conversions / variant.metrics.clicks) * 100).toFixed(2)
                            : '0.00'}
                          %
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">单次点击成本</p>
                        <p className="text-xl font-bold text-indigo-600">
                          ¥{variant.metrics.cpc.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Statistical Analysis */}
                    {variant.statistics.p_value !== null && !isControl && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                        <p className="font-semibold text-sm mb-3">统计分析</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-gray-600">P值</p>
                            <p className="font-semibold">
                              {variant.statistics.p_value.toFixed(4)}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-600">置信区间</p>
                            <p className="font-semibold text-xs">
                              [{(variant.statistics.confidence_interval_lower || 0).toFixed(2)},{' '}
                              {(variant.statistics.confidence_interval_upper || 0).toFixed(2)}]
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-600">统计显著性</p>
                            <Badge
                              variant={
                                variant.statistics.p_value < 0.05 ? 'default' : 'secondary'
                              }
                              className="mt-1"
                            >
                              {variant.statistics.p_value < 0.05 ? '显著' : '不显著'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
