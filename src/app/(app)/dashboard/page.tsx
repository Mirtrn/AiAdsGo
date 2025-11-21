'use client'

/**
 * Dashboard - 简洁高效的仪表盘
 * 设计原则：聚焦核心指标，减少视觉噪音，突出行动点
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Eye,
  MousePointerClick,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Plus,
  Rocket,
  AlertTriangle,
  ChevronRight,
  RefreshCw
} from 'lucide-react'
import { InsightsCard } from '@/components/dashboard/InsightsCard'
import { ABTestProgressCard } from '@/components/dashboard/ABTestProgressCard'

interface KPIData {
  current: {
    impressions: number
    clicks: number
    cost: number
    ctr: number
    cpc: number
  }
  changes: {
    impressions: number
    clicks: number
    cost: number
  }
}

interface RiskAlert {
  id: number
  type: string
  message: string
  severity: 'high' | 'medium' | 'low'
}

interface OfferSummary {
  total: number
  active: number
  pendingScrape: number
}

export default function DashboardPage() {
  const router = useRouter()
  const [days, setDays] = useState(7)
  const [kpiData, setKpiData] = useState<KPIData | null>(null)
  const [risks, setRisks] = useState<RiskAlert[]>([])
  const [offerSummary, setOfferSummary] = useState<OfferSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const [kpiRes, riskRes, offerRes] = await Promise.all([
        fetch(`/api/dashboard/kpis?days=${days}`, { credentials: 'include' }),
        fetch('/api/risk-alerts?limit=3', { credentials: 'include' }),
        fetch('/api/offers?summary=true', { credentials: 'include' })
      ])

      if (kpiRes.ok) {
        const kpi = await kpiRes.json()
        setKpiData(kpi.data)
      }

      if (riskRes.ok) {
        const risk = await riskRes.json()
        setRisks(risk.alerts?.slice(0, 3) || [])
      }

      if (offerRes.ok) {
        const offer = await offerRes.json()
        setOfferSummary({
          total: offer.offers?.length || 0,
          active: offer.offers?.filter((o: any) => o.isActive)?.length || 0,
          pendingScrape: offer.offers?.filter((o: any) => o.scrape_status === 'pending')?.length || 0
        })
      }
    } catch (err) {
      console.error('Dashboard数据加载失败:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [days])

  const formatNumber = (num: number) => num.toLocaleString()
  const formatCurrency = (num: number) => `¥${num.toFixed(2)}`
  const formatPercent = (num: number) => `${num.toFixed(2)}%`

  // 加载骨架屏
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
          </div>
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  }

  const hasRisks = risks.length > 0

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header - 简洁 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>
            <p className="text-sm text-gray-500 mt-1">
              {offerSummary && `${offerSummary.total} 个Offer · ${offerSummary.active} 个活跃`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 刷新按钮 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            {/* 时间范围 */}
            <div className="flex bg-white rounded-lg border p-1">
              {[7, 30].map((d) => (
                <Button
                  key={d}
                  variant={days === d ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setDays(d)}
                  className="h-7 px-3 text-xs"
                >
                  {d}天
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* 风险提示 - 优先显示 */}
        {hasRisks && (
          <Card className="mb-6 border-orange-200 bg-orange-50">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-orange-800">需要关注</h3>
                    <Badge variant="outline" className="text-orange-600 border-orange-300">
                      {risks.length} 项
                    </Badge>
                  </div>
                  <p className="text-sm text-orange-700 mt-1 truncate">
                    {risks[0]?.message || '有问题需要处理'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push('/data-management')}
                  className="text-orange-600 hover:text-orange-700 hover:bg-orange-100"
                >
                  查看
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 核心KPI - 3个最重要的指标 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 展示量 */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">展示量</p>
                  <p className="text-2xl font-bold">
                    {kpiData ? formatNumber(kpiData.current.impressions) : '-'}
                  </p>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl">
                  <Eye className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              {kpiData && (
                <div className="flex items-center gap-1 mt-3">
                  {kpiData.changes.impressions >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${kpiData.changes.impressions >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kpiData.changes.impressions >= 0 ? '+' : ''}{kpiData.changes.impressions.toFixed(1)}%
                  </span>
                  <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 点击量 */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">点击量</p>
                  <p className="text-2xl font-bold">
                    {kpiData ? formatNumber(kpiData.current.clicks) : '-'}
                  </p>
                </div>
                <div className="p-3 bg-green-50 rounded-xl">
                  <MousePointerClick className="w-6 h-6 text-green-600" />
                </div>
              </div>
              {kpiData && (
                <div className="flex items-center gap-1 mt-3">
                  {kpiData.changes.clicks >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${kpiData.changes.clicks >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kpiData.changes.clicks >= 0 ? '+' : ''}{kpiData.changes.clicks.toFixed(1)}%
                  </span>
                  <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 花费 */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">总花费</p>
                  <p className="text-2xl font-bold">
                    {kpiData ? formatCurrency(kpiData.current.cost) : '-'}
                  </p>
                </div>
                <div className="p-3 bg-purple-50 rounded-xl">
                  <DollarSign className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              {kpiData && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-sm text-gray-500">
                    CTR {formatPercent(kpiData.current.ctr)}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="text-sm text-gray-500">
                    CPC {formatCurrency(kpiData.current.cpc)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 快速操作 - 只保留2个核心操作 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">快速开始</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 justify-start gap-4 hover:border-blue-300 hover:bg-blue-50"
                onClick={() => router.push('/offers?action=create')}
              >
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Plus className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">创建Offer</div>
                  <div className="text-xs text-gray-500">添加新的推广产品</div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="h-auto py-4 justify-start gap-4 hover:border-green-300 hover:bg-green-50"
                onClick={() => router.push('/offers')}
              >
                <div className="p-2 bg-green-100 rounded-lg">
                  <Rocket className="w-5 h-5 text-green-600" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">一键上广告</div>
                  <div className="text-xs text-gray-500">
                    {offerSummary && offerSummary.total > 0
                      ? `${offerSummary.total} 个Offer可投放`
                      : '先创建Offer'}
                  </div>
                </div>
              </Button>
            </div>

            {/* 其他入口 - 文字链接形式 */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t">
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-gray-500 hover:text-gray-900"
                onClick={() => router.push('/campaigns')}
              >
                广告系列
              </Button>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-gray-500 hover:text-gray-900"
                onClick={() => router.push('/google-ads')}
              >
                Google Ads账号
              </Button>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-gray-500 hover:text-gray-900"
                onClick={() => router.push('/settings')}
              >
                系统设置
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Insights 和 AB测试进度 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <InsightsCard days={days} />
          <ABTestProgressCard />
        </div>
      </div>
    </div>
  )
}
