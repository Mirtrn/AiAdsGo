'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  AlertCircle,
  Target,
  DollarSign,
  MousePointerClick,
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
    ctr?: number
    cpc?: number
    is_significant: boolean
  } | null
  variants: Array<{
    variant_name: string
    variant_label: string
    campaign_status: string
    metrics: {
      impressions: number
      clicks: number
      ctr: number
      conversions: number
      cpa: number
      cost: number
    }
  }>
  warnings: Array<{
    type: string
    message: string
    severity: string
  }>
  is_complete: boolean
  winner_variant_id: number | null
}

export function ABTestProgressCard() {
  const router = useRouter()
  const [tests, setTests] = useState<ABTestStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchActiveTests()
    // 每30秒刷新一次
    const interval = setInterval(fetchActiveTests, 30000)
    return () => clearInterval(interval)
  }, [])

  const fetchActiveTests = async () => {
    try {
      // 获取所有运行中的测试
      const response = await fetch('/api/ab-tests?status=running', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取测试失败')
      }

      const data = await response.json()
      const runningTests = data.tests || []

      // 获取每个测试的详细状态
      const statusPromises = runningTests.map(async (test: any) => {
        const statusRes = await fetch(`/api/ab-tests/${test.id}/status`, {
          credentials: 'include',
        })
        if (statusRes.ok) {
          return await statusRes.json()
        }
        return null
      })

      const statuses = (await Promise.all(statusPromises)).filter((s) => s !== null)
      setTests(statuses)
    } catch (err: any) {
      console.error('获取测试状态失败:', err)
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

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-50 border-red-200'
      case 'high':
        return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'medium':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      default:
        return 'text-blue-600 bg-blue-50 border-blue-200'
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </CardContent>
      </Card>
    )
  }

  if (tests.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            A/B测试进度
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <FlaskConical className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 text-sm">当前没有运行中的A/B测试</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => router.push('/ab-tests')}
            >
              查看所有测试
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            A/B测试进度 ({tests.length})
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => router.push('/ab-tests')}>
            查看全部
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {tests.map((testStatus) => {
          const { test, progress, current_leader, warnings } = testStatus
          const DimensionIcon = getDimensionIcon(test.dimension)

          return (
            <div
              key={test.id}
              className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => router.push(`/ab-tests/${test.id}`)}
            >
              {/* Test Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <DimensionIcon className="h-4 w-4 text-gray-600" />
                    <h4 className="font-semibold text-sm">{test.name}</h4>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {getDimensionLabel(test.dimension)}
                  </Badge>
                </div>
                <Clock className="h-4 w-4 text-gray-400" />
              </div>

              {/* Progress Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span>进度</span>
                  <span>{progress.completion_percentage.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, progress.completion_percentage)}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {progress.total_samples.toLocaleString()} / {progress.min_samples_required.toLocaleString()}{' '}
                  {test.dimension === 'creative' ? '点击' : '转化'}
                </p>
              </div>

              {/* Current Leader */}
              {current_leader && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-600">当前领先</span>
                    <Badge
                      variant={current_leader.is_significant ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {current_leader.is_significant ? '统计显著' : '继续观察'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2 rounded border">
                    <div>
                      <p className="font-semibold text-sm">
                        {current_leader.variant_label || current_leader.variant_name}
                      </p>
                      {test.dimension === 'creative' ? (
                        <p className="text-xs text-gray-600">CTR: {(current_leader.ctr || 0).toFixed(2)}%</p>
                      ) : (
                        <p className="text-xs text-gray-600">CPC: ¥{(current_leader.cpc || 0).toFixed(2)}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        {current_leader.improvement_vs_control > 0 ? (
                          <>
                            <TrendingUp className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-semibold text-green-600">
                              +{current_leader.improvement_vs_control.toFixed(1)}%
                            </span>
                          </>
                        ) : current_leader.improvement_vs_control < 0 ? (
                          <>
                            <TrendingDown className="h-4 w-4 text-red-600" />
                            <span className="text-sm font-semibold text-red-600">
                              {current_leader.improvement_vs_control.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className="text-sm text-gray-600">持平</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        置信度: {(current_leader.confidence * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="space-y-2">
                  {warnings.slice(0, 2).map((warning, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 p-2 rounded border text-xs ${getSeverityColor(warning.severity)}`}
                    >
                      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <p className="flex-1">{warning.message}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Estimated Completion */}
              {progress.estimated_completion_date && !testStatus.is_complete && (
                <p className="text-xs text-gray-500 mt-2">
                  预计完成: {new Date(progress.estimated_completion_date).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
