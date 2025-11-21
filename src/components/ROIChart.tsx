'use client'

import { useMemo, memo } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface ROIChartProps {
  data: any[]
  type?: 'line' | 'bar'
  showProfit?: boolean
  height?: number
}

export const ROITrendChart = memo(function ROITrendChart({ data, height = 300 }: { data: any[]; height?: number }) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      date: new Date(item.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
    }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis yAxisId="left" label={{ value: '金额 (¥)', angle: -90, position: 'insideLeft' }} />
        <YAxis
          yAxisId="right"
          orientation="right"
          label={{ value: 'ROI (%)', angle: 90, position: 'insideRight' }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              return (
                <div className="bg-white border border-gray-300 rounded p-3 shadow-lg">
                  <p className="font-semibold mb-2">{payload[0].payload.date}</p>
                  {payload.map((entry, index) => (
                    <p key={index} className="text-sm" style={{ color: entry.color }}>
                      {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
                      {entry.name === 'ROI' ? '%' : ' ¥'}
                    </p>
                  ))}
                </div>
              )
            }
            return null
          }}
        />
        <Legend />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="revenue"
          name="收入"
          stroke="#10b981"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="cost"
          name="花费"
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="profit"
          name="利润"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="roi"
          name="ROI"
          stroke="#f59e0b"
          strokeWidth={3}
          dot={{ r: 5, fill: '#f59e0b' }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
})

export const CampaignROIChart = memo(function CampaignROIChart({ data, height = 400 }: { data: any[]; height?: number }) {
  const sortedData = useMemo(() => {
    return [...data]
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        name: item.campaign_name.length > 20
          ? item.campaign_name.substring(0, 20) + '...'
          : item.campaign_name,
      }))
  }, [data])

  const getColor = (roi: number) => {
    if (roi >= 100) return '#10b981' // green
    if (roi >= 50) return '#84cc16' // lime
    if (roi >= 0) return '#f59e0b' // amber
    return '#ef4444' // red
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={sortedData} margin={{ top: 5, right: 30, left: 20, bottom: 80 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
        <YAxis label={{ value: 'ROI (%)', angle: -90, position: 'insideLeft' }} />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload
              return (
                <div className="bg-white border border-gray-300 rounded p-3 shadow-lg">
                  <p className="font-semibold mb-2">{data.campaign_name}</p>
                  <p className="text-sm text-gray-600">{data.offer_brand}</p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p>
                      ROI: <span className="font-semibold">{data.roi.toFixed(2)}%</span>
                    </p>
                    <p>
                      收入: <span className="font-semibold">¥{data.revenue.toFixed(2)}</span>
                    </p>
                    <p>
                      花费: <span className="font-semibold">¥{data.cost.toFixed(2)}</span>
                    </p>
                    <p>
                      利润: <span className="font-semibold">¥{data.profit.toFixed(2)}</span>
                    </p>
                    <p>
                      转化: <span className="font-semibold">{data.conversions}</span>
                    </p>
                  </div>
                </div>
              )
            }
            return null
          }}
        />
        <Legend />
        <Bar dataKey="roi" name="ROI (%)">
          {sortedData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getColor(entry.roi)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
})

export const OfferROIChart = memo(function OfferROIChart({ data, height = 350 }: { data: any[]; height?: number }) {
  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((item) => ({
        ...item,
        name: `${item.brand} - ${item.product_name}`.length > 25
          ? `${item.brand} - ${item.product_name}`.substring(0, 25) + '...'
          : `${item.brand} - ${item.product_name}`,
      }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="horizontal" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" label={{ value: '金额 (¥)', position: 'insideBottom', offset: -5 }} />
        <YAxis type="category" dataKey="name" width={90} />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload
              return (
                <div className="bg-white border border-gray-300 rounded p-3 shadow-lg">
                  <p className="font-semibold mb-1">{data.brand}</p>
                  <p className="text-sm text-gray-600 mb-2">{data.product_name}</p>
                  <div className="space-y-1 text-sm">
                    <p>
                      收入: <span className="font-semibold">¥{data.revenue.toFixed(2)}</span>
                    </p>
                    <p>
                      花费: <span className="font-semibold">¥{data.cost.toFixed(2)}</span>
                    </p>
                    <p>
                      利润: <span className="font-semibold">¥{data.profit.toFixed(2)}</span>
                    </p>
                    <p>
                      ROI: <span className="font-semibold">{data.roi.toFixed(2)}%</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      {data.campaign_count} 个Campaign · {data.conversions} 次转化
                    </p>
                  </div>
                </div>
              )
            }
            return null
          }}
        />
        <Legend />
        <Bar dataKey="revenue" name="收入" fill="#10b981" />
        <Bar dataKey="cost" name="花费" fill="#ef4444" />
      </BarChart>
    </ResponsiveContainer>
  )
})
