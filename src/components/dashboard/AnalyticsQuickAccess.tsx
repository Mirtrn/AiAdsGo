'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TrendingUp, DollarSign, BarChart3, ArrowRight } from 'lucide-react'

export function AnalyticsQuickAccess() {
  const router = useRouter()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          数据分析
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ROI Analysis */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-lg border border-green-200 hover:shadow-lg transition-shadow cursor-pointer group">
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-green-100 rounded-lg">
                <TrendingUp className="h-6 w-6 text-green-700" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/analytics/roi')}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                查看详情
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            <h3 className="font-semibold text-lg text-gray-900 mb-2">ROI分析</h3>
            <p className="text-sm text-gray-600 mb-4">
              投资回报率分析、利润趋势、转化效率监控
            </p>
            <ul className="space-y-2 text-xs text-gray-600">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-600"></span>
                整体ROI和利润分析
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-600"></span>
                Campaign ROI排名
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-600"></span>
                Offer收益对比
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-600"></span>
                转化效率指标
              </li>
            </ul>
            <div className="mt-4 pt-4 border-t border-green-200">
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={() => router.push('/analytics/roi')}
              >
                查看ROI分析
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>

          {/* Budget Analysis */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-lg border border-blue-200 hover:shadow-lg transition-shadow cursor-pointer group">
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <DollarSign className="h-6 w-6 text-blue-700" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/analytics/budget')}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                查看详情
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            <h3 className="font-semibold text-lg text-gray-900 mb-2">预算分析</h3>
            <p className="text-sm text-gray-600 mb-4">
              预算使用监控、花费趋势、预算警报和优化建议
            </p>
            <ul className="space-y-2 text-xs text-gray-600">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                预算使用状态追踪
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                超预算警报提醒
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                花费趋势预测
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                预算优化建议
              </li>
            </ul>
            <div className="mt-4 pt-4 border-t border-blue-200">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => router.push('/analytics/budget')}
              >
                查看预算分析
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-gray-600" />
            <div>
              <p className="text-sm font-semibold text-gray-900">数据驱动决策</p>
              <p className="text-xs text-gray-600 mt-1">
                通过深入的数据分析，优化广告投放策略，提升投资回报率
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
