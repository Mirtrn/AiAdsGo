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
      const response = await fetch(`/api/dashboard/kpis?days=${days}`)
      if (!response.ok) {
        throw new Error('获取KPI数据失败')
      }
      const result = await response.json()
      setData(result.data)
      setError(null)
    } catch (err) {
      console.error('获取KPI数据失败:', err)
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [days])

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-4"></div>
            <div className="h-8 bg-gray-200 rounded w-32 mb-4"></div>
            <div className="h-6 bg-gray-200 rounded w-20"></div>
          </div>
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600">加载KPI数据失败: {error}</p>
      </div>
    )
  }

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

      {/* KPI卡片 */}
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

      {/* 附加指标 - P1-5优化版 */}
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
    </div>
  )
}
