'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Eye, MousePointerClick, DollarSign, Target } from 'lucide-react'

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
  const changeColor = isPositive ? 'text-green-600' : 'text-red-600'
  const changeBgColor = isPositive ? 'bg-green-50' : 'bg-red-50'

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

  return (
    <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{formatValue(value)}</p>
        </div>
        <div className="ml-4 flex-shrink-0">
          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
            {icon}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center">
        <div className={`flex items-center gap-1 px-2 py-1 rounded ${changeBgColor}`}>
          {isPositive ? (
            <TrendingUp className={`h-4 w-4 ${changeColor}`} />
          ) : (
            <TrendingDown className={`h-4 w-4 ${changeColor}`} />
          )}
          <span className={`text-sm font-medium ${changeColor}`}>
            {Math.abs(change).toFixed(1)}%
          </span>
        </div>
        <span className="ml-2 text-sm text-gray-500">vs 上周期</span>
      </div>
    </div>
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
      {/* 日期范围选择器 */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-gray-600">统计周期:</span>
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

      {/* 附加指标 */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-600">平均CTR</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {data.current.ctr.toFixed(2)}%
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-600">平均CPC</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            ¥{data.current.cpc.toFixed(2)}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-600">转化率</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {data.current.conversionRate.toFixed(2)}%
          </p>
        </div>
      </div>
    </div>
  )
}
