'use client'

/**
 * TrendChart - 可复用的趋势图组件
 * 支持折线图展示性能趋势数据
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, BarChart, Bar } from 'recharts'
import { TrendingUp, Calendar } from 'lucide-react'

export interface TrendChartData {
  date: string
  [key: string]: string | number
}

export interface TrendChartMetric {
  key: string
  label: string
  color: string
  formatter?: (value: number) => string
}

export interface TrendChartProps {
  data: TrendChartData[]
  metrics: TrendChartMetric[]
  title?: string
  description?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  chartType?: 'line' | 'bar'
  timeRangeOptions?: number[]
  selectedTimeRange?: number
  onTimeRangeChange?: (days: number) => void
  height?: number
  showLegend?: boolean
  className?: string
}

const defaultTimeRangeOptions = [7, 14, 30]

export function TrendChart({
  data,
  metrics,
  title = '性能趋势',
  description,
  loading = false,
  error = null,
  onRetry,
  chartType = 'line',
  timeRangeOptions = defaultTimeRangeOptions,
  selectedTimeRange,
  onTimeRangeChange,
  height = 300,
  showLegend = true,
  className = '',
}: TrendChartProps) {
  // Loading state
  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
            <div className="h-64 bg-gray-100 rounded"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error) {
    return (
      <Card className={className}>
        <CardContent className="py-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-red-800 font-medium">数据加载失败</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors text-sm font-medium"
              >
                重新加载
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // No data state
  const hasNoData = data.length === 0 || metrics.every(metric =>
    data.every(item => (item[metric.key] as number) === 0)
  )

  // Build chart config
  const chartConfig: ChartConfig = metrics.reduce((acc, metric) => {
    acc[metric.key] = {
      label: metric.label,
      color: metric.color,
    }
    return acc
  }, {} as ChartConfig)

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
            <div>
              <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
              {description && (
                <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>
              )}
            </div>
          </div>

          {/* Time range selector */}
          {onTimeRangeChange && selectedTimeRange !== undefined && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground hidden sm:block" />
              <div className="flex gap-2">
                {timeRangeOptions.map((days) => (
                  <Button
                    key={days}
                    variant={selectedTimeRange === days ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onTimeRangeChange(days)}
                    className="text-xs sm:text-sm px-3"
                  >
                    {days}天
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {hasNoData ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-blue-800 font-medium">暂无趋势数据</p>
                <p className="text-blue-600 text-sm mt-1">
                  当前时间段内暂无数据。开始创建广告并同步数据后，这里将显示趋势图表。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <ChartContainer config={chartConfig} style={{ height: `${height}px` }}>
            {chartType === 'line' ? (
              <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return `${date.getMonth() + 1}/${date.getDate()}`
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    if (value >= 1000000) {
                      return `${(value / 1000000).toFixed(1)}M`
                    }
                    if (value >= 1000) {
                      return `${(value / 1000).toFixed(1)}K`
                    }
                    return value.toString()
                  }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => {
                        const metric = metrics.find(m => m.key === name)
                        if (metric?.formatter) {
                          return metric.formatter(value as number)
                        }
                        return value
                      }}
                    />
                  }
                />
                {showLegend && <Legend />}
                {metrics.map((metric) => (
                  <Line
                    key={metric.key}
                    type="monotone"
                    dataKey={metric.key}
                    stroke={metric.color}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name={metric.label}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return `${date.getMonth() + 1}/${date.getDate()}`
                  }}
                />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {showLegend && <Legend />}
                {metrics.map((metric) => (
                  <Bar
                    key={metric.key}
                    dataKey={metric.key}
                    fill={metric.color}
                    name={metric.label}
                  />
                ))}
              </BarChart>
            )}
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
