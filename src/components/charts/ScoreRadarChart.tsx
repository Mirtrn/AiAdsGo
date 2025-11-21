'use client'

/**
 * Score Radar Chart Component
 * 创意评分雷达图组件
 */

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts'

interface ScoreRadarChartProps {
  scoreBreakdown: {
    relevance: number    // 相关性 /30
    quality: number      // 质量 /25
    engagement: number   // 吸引力 /25
    diversity: number    // 多样性 /10
    clarity: number      // 清晰度 /10
  }
  size?: 'sm' | 'md' | 'lg'
}

export default function ScoreRadarChart({ scoreBreakdown, size = 'md' }: ScoreRadarChartProps) {
  // 转换为百分比以便在雷达图上显示
  const data = [
    {
      dimension: '相关性',
      score: (scoreBreakdown.relevance / 30) * 100,
      fullMark: 100,
      actual: scoreBreakdown.relevance,
      max: 30
    },
    {
      dimension: '质量',
      score: (scoreBreakdown.quality / 25) * 100,
      fullMark: 100,
      actual: scoreBreakdown.quality,
      max: 25
    },
    {
      dimension: '吸引力',
      score: (scoreBreakdown.engagement / 25) * 100,
      fullMark: 100,
      actual: scoreBreakdown.engagement,
      max: 25
    },
    {
      dimension: '多样性',
      score: (scoreBreakdown.diversity / 10) * 100,
      fullMark: 100,
      actual: scoreBreakdown.diversity,
      max: 10
    },
    {
      dimension: '清晰度',
      score: (scoreBreakdown.clarity / 10) * 100,
      fullMark: 100,
      actual: scoreBreakdown.clarity,
      max: 10
    }
  ]

  const sizeMap = {
    sm: 180,
    md: 240,
    lg: 320
  }

  const height = sizeMap[size]

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900 mb-1">{data.dimension}</p>
          <p className="text-sm text-gray-600">
            得分: <span className="font-semibold text-blue-600">{data.actual}/{data.max}</span>
          </p>
          <p className="text-xs text-gray-500">
            完成度: {data.score.toFixed(1)}%
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data}>
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fill: '#6b7280', fontSize: 12 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: '#9ca3af', fontSize: 10 }}
        />
        <Radar
          name="评分"
          dataKey="score"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.6}
        />
        <Tooltip content={<CustomTooltip />} />
      </RadarChart>
    </ResponsiveContainer>
  )
}
