'use client'

/**
 * KPICards - P1-5优化版
 * 使用shadcn/ui Card组件，增强视觉设计
 */

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Eye, MousePointerClick, DollarSign, Target } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { KPILoadingSkeleton } from '@/components/ui/loading-skeleton' // P2-6: 统一loading

interface KPIData {
  current: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
    ctr: number
    cpc: number
    conversionRate: number
  }
  changes: {
    impressions: number
    clicks: number
    cost: number
    conversions: number
  }
}

interface KPICardProps {
  title: string
  value: string | number
  change: number
  icon: React.ReactNode
  format?: 'number' | 'currency' | 'percentage'
}

function KPICard({ title, value, change, icon, format = 'number' }: KPICardProps) {
  const isPositive = change >= 0

  const formatValue = (val: string | number): string => {
    const numVal = typeof val === 'string' ? parseFloat(val) : val

    if (format === 'currency') {
      return `¥${numVal.toFixed(2)}`
    } else if (format === 'percentage') {
      return `${numVal.toFixed(2)}%`
    } else {
      return numVal.toLocaleString()
    }
  }

  // Card color based on metric type
  const getCardStyle = () => {
    if (title === '展示量') return 'border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100/50'
    if (title === '点击量') return 'border-green-200 bg-gradient-to-br from-green-50 to-green-100/50'
    if (title === '总花费') return 'border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100/50'
    if (title === '转化量') return 'border-orange-200 bg-gradient-to-br from-orange-50 to-orange-100/50'
    return 'border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50'
  }

  const getIconBg = () => {
    if (title === '展示量') return 'bg-blue-100'
    if (title === '点击量') return 'bg-green-100'
    if (title === '总花费') return 'bg-purple-100'
    if (title === '转化量') return 'bg-orange-100'
    return 'bg-gray-100'
  }

  const getIconColor = () => {
    if (title === '展示量') return 'text-blue-600'
    if (title === '点击量') return 'text-green-600'
    if (title === '总花费') return 'text-purple-600'
    if (title === '转化量') return 'text-orange-600'
    return 'text-gray-600'
  }

  return (
    <Card className={`${getCardStyle()} hover:shadow-lg transition-all`}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-2">{title}</p>
            <p className="text-3xl font-bold">{formatValue(value)}</p>
          </div>
          <div className={`p-3 rounded-lg ${getIconBg()}`}>
            <div className={getIconColor()}>{icon}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isPositive ? 'default' : 'destructive'} className="gap-1">
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </Badge>
          <span className="text-xs text-muted-foreground">vs 上周期</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function KPICards() {
  const [data, setData] = useState<KPIData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(7)

  const fetchData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard/kpis?days=${days}`, {
        credentials: 'include'
      })
      if (!response.ok) {
        throw new Error('获取KPI数据失败')
      }
      const result = await response.json()
      setData(result.data)
      setError(null)
    } catch (err) {
      console.error('KPI数据加载错误:', err)
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [days])

  // P2-6: 使用统一的Loading Skeleton
  if (loading) {
    return <KPILoadingSkeleton />
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
          </svg>
          <div>
            <p className="text-red-800 font-medium">数据加载失败</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors text-sm font-medium"
        >
          重新加载
        </button>
      </div>
    )
  }

  // 数据为空的友好提示
  const hasNoData = data &&
    data.current.impressions === 0 &&
    data.current.clicks === 0 &&
    data.current.cost === 0 &&
    data.current.conversions === 0

  return (
    <div>
      {/* 日期范围选择器 - P1-5优化版 */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">统计周期:</span>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              variant={days === d ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}天
            </Button>
          ))}
        </div>
      </div>

      {/* 暂无数据提示 */}
      {hasNoData && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
            </svg>
            <div>
              <p className="text-blue-800 font-medium">暂无广告数据</p>
              <p className="text-blue-600 text-sm mt-1">
                当前时间段内暂无广告投放数据。开始创建Campaign并同步Google Ads数据后，这里将显示您的广告表现指标。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPI卡片 */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <KPICard
            title="展示量"
            value={data.current.impressions}
            change={data.changes.impressions}
            icon={<Eye className="h-6 w-6" />}
            format="number"
          />
        <KPICard
          title="点击量"
          value={data.current.clicks}
          change={data.changes.clicks}
          icon={<MousePointerClick className="h-6 w-6" />}
          format="number"
        />
        <KPICard
          title="总花费"
          value={data.current.cost}
          change={data.changes.cost}
          icon={<DollarSign className="h-6 w-6" />}
          format="currency"
        />
        <KPICard
          title="转化量"
          value={data.current.conversions}
          change={data.changes.conversions}
          icon={<Target className="h-6 w-6" />}
          format="number"
        />
        </div>
      )}

      {/* 附加指标 - P1-5优化版 */}
      {data && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-gray-200 hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-2">平均CTR</p>
            <p className="text-2xl font-bold text-primary">
              {data.current.ctr.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200 hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-2">平均CPC</p>
            <p className="text-2xl font-bold text-primary">
              ¥{data.current.cpc.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200 hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-2">转化率</p>
            <p className="text-2xl font-bold text-primary">
              {data.current.conversionRate.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        </div>
      )}
    </div>
  )
}
