'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Info, AlertTriangle, TrendingUp, Lightbulb } from 'lucide-react'

interface Insight {
  id: string
  type: 'warning' | 'success' | 'info' | 'error'
  priority: 'high' | 'medium' | 'low'
  title: string
  message: string
  recommendation: string
  relatedCampaign?: {
    id: number
    name: string
  }
  metrics?: {
    current: number
    benchmark: number
    change: number
  }
  createdAt: string
}

interface InsightsData {
  insights: Insight[]
  total: number
  summary: {
    high: number
    medium: number
    low: number
  }
  generatedAt: string
}

export function InsightsCard() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(7)

  const fetchData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard/insights?days=${days}`)
      if (!response.ok) {
        throw new Error('获取智能洞察失败')
      }
      const result = await response.json()
      setData(result.data)
      setError(null)
    } catch (err) {
      console.error('获取智能洞察失败:', err)
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [days])

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'error':
        return <AlertCircle className="h-5 w-5" />
      case 'warning':
        return <AlertTriangle className="h-5 w-5" />
      case 'success':
        return <CheckCircle className="h-5 w-5" />
      case 'info':
        return <Info className="h-5 w-5" />
      default:
        return <Info className="h-5 w-5" />
    }
  }

  const getInsightColors = (type: string) => {
    switch (type) {
      case 'error':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200',
          icon: 'text-red-600',
          title: 'text-red-900',
        }
      case 'warning':
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          icon: 'text-yellow-600',
          title: 'text-yellow-900',
        }
      case 'success':
        return {
          bg: 'bg-green-50',
          border: 'border-green-200',
          icon: 'text-green-600',
          title: 'text-green-900',
        }
      case 'info':
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          icon: 'text-blue-600',
          title: 'text-blue-900',
        }
      default:
        return {
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          icon: 'text-gray-600',
          title: 'text-gray-900',
        }
    }
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
            高优先级
          </span>
        )
      case 'medium':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
            中优先级
          </span>
        )
      case 'low':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
            低优先级
          </span>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-48"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600">加载智能洞察失败: {error}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">智能洞察</h2>
          </div>

          {/* 统计摘要 */}
          <div className="flex items-center gap-4">
            {data.summary.high > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-red-600">{data.summary.high}</span>
                <span className="text-sm text-gray-500">高优先级</span>
              </div>
            )}
            {data.summary.medium > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-yellow-600">{data.summary.medium}</span>
                <span className="text-sm text-gray-500">中优先级</span>
              </div>
            )}
            {data.summary.low > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-gray-600">{data.summary.low}</span>
                <span className="text-sm text-gray-500">低优先级</span>
              </div>
            )}
          </div>
        </div>

        {/* 日期范围选择器 */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm text-gray-600">分析周期:</span>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 text-sm rounded ${
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Insights列表 */}
      <div className="p-6 space-y-4">
        {data.insights.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-gray-600">太好了！目前没有发现需要关注的问题</p>
            <p className="text-sm text-gray-500 mt-2">您的Campaign运行状况良好</p>
          </div>
        ) : (
          data.insights.map((insight) => {
            const colors = getInsightColors(insight.type)
            return (
              <div
                key={insight.id}
                className={`border ${colors.border} ${colors.bg} rounded-lg p-4 hover:shadow-md transition-shadow`}
              >
                {/* Insight Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div className={colors.icon}>{getInsightIcon(insight.type)}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-semibold ${colors.title}`}>{insight.title}</h3>
                        {getPriorityBadge(insight.priority)}
                      </div>
                      <p className="text-sm text-gray-700">{insight.message}</p>
                    </div>
                  </div>
                </div>

                {/* Related Campaign */}
                {insight.relatedCampaign && (
                  <div className="mb-3 pl-8">
                    <div className="flex items-center gap-2 text-sm">
                      <TrendingUp className="h-4 w-4 text-gray-500" />
                      <span className="text-gray-600">相关Campaign:</span>
                      <a
                        href={`/campaigns/${insight.relatedCampaign.id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {insight.relatedCampaign.name}
                      </a>
                    </div>
                  </div>
                )}

                {/* Metrics */}
                {insight.metrics && (
                  <div className="mb-3 pl-8">
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">当前值: </span>
                        <span className="font-medium text-gray-900">
                          {insight.metrics.current.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">基准值: </span>
                        <span className="font-medium text-gray-900">
                          {insight.metrics.benchmark.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">差异: </span>
                        <span
                          className={`font-medium ${
                            insight.metrics.change >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {insight.metrics.change >= 0 ? '+' : ''}
                          {insight.metrics.change.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recommendation */}
                <div className="pl-8 pt-3 border-t border-gray-200">
                  <p className="text-sm font-medium text-gray-700 mb-1">💡 建议:</p>
                  <p className="text-sm text-gray-600">{insight.recommendation}</p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      {data.insights.length > 0 && (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
          <p className="text-sm text-gray-500">
            最后更新: {new Date(data.generatedAt).toLocaleString('zh-CN')}
          </p>
        </div>
      )}
    </div>
  )
}
