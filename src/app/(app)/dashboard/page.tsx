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
import { ApiQuotaChart } from '@/components/dashboard/ApiQuotaChart'
import { AiTokenCostChart } from '@/components/dashboard/AiTokenCostChart'

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

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = () => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const [kpiRes, riskRes, offerRes] = await Promise.all([
        fetch(`/api/dashboard/kpis?days=${days}`, { credentials: 'include', cache: 'no-store' }),
        fetch('/api/risk-alerts?limit=3', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/offers?summary=true', { credentials: 'include', cache: 'no-store' })
      ])

      // 处理401未授权
      if (kpiRes.status === 401 || riskRes.status === 401 || offerRes.status === 401) {
        handleUnauthorized()
        return
      }

      if (kpiRes.ok) {
        const kpi = await kpiRes.json()
        setKpiData(kpi.data)
      }

      if (riskRes.ok) {
        const risk = await riskRes.json()
        // 确保alerts是数组类型
        const alertsArray = Array.isArray(risk.alerts) ? risk.alerts : []
        setRisks(alertsArray.slice(0, 3))
      }

      if (offerRes.ok) {
        const offer = await offerRes.json()
        // 确保offers是数组类型
        const offersArray = Array.isArray(offer.offers) ? offer.offers : []
        setOfferSummary({
          total: offersArray.length,
          active: offersArray.filter((o: any) => o.isActive).length,
          pendingScrape: offersArray.filter((o: any) => o.scrapeStatus === 'pending').length
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

  const formatNumber = (num: number | null | undefined) => (num ?? 0).toLocaleString()
  const formatCurrency = (num: number | null | undefined) => {
    const value = Number(num ?? 0)
    // 🔧 修复(2025-12-30): 数据库存储的是美元（从Google Ads API的cost_micros转换）
    // campaign_performance.cost字段单位是USD，不是CNY
    return isNaN(value) ? '$0.00' : `$${value.toFixed(2)}`
  }
  const formatPercent = (num: number | null | undefined) => {
    const value = Number(num ?? 0)
    return isNaN(value) ? '0.00%' : `${value.toFixed(2)}%`
  }

  /**
   * 🔧 修复(2025-12-29): 安全地格式化数值，处理可能为字符串或null的情况
   */
  const safeToFixed = (num: any, decimals: number = 2): string => {
    const value = Number(num ?? 0)
    if (isNaN(value)) return '0'.padEnd(decimals > 0 ? decimals + 2 : 1, '0')
    return value.toFixed(decimals)
  }

  // 加载骨架屏
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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


        {/* 核心KPI - 3个最重要的指标 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
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
                    {kpiData.changes.impressions >= 0 ? '+' : ''}{safeToFixed(kpiData.changes.impressions, 1)}%
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
                    {kpiData.changes.clicks >= 0 ? '+' : ''}{safeToFixed(kpiData.changes.clicks, 1)}%
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
                    点击率(CTR) {formatPercent(kpiData.current.ctr)}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="text-sm text-gray-500">
                    每次点击费用(CPC) {formatCurrency(kpiData.current.cpc)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* API配额、AI Token成本 和 快速开始 - 新布局 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* API配额卡片 */}
          <ApiQuotaChart days={days} />

          {/* AI Token成本卡片 */}
          <AiTokenCostChart days={days} />

          {/* 快速开始 - 占1列，最右侧 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">快速开始</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-blue-300 hover:bg-blue-50"
                  onClick={() => router.push('/offers?action=create')}
                >
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Plus className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">创建Offer</div>
                    <div className="text-xs text-gray-500">添加新产品</div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-green-300 hover:bg-green-50"
                  onClick={() => router.push('/offers')}
                >
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Rocket className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">一键上广告</div>
                    <div className="text-xs text-gray-500">
                      {offerSummary && offerSummary.total > 0
                        ? `${offerSummary.total}个可投放`
                        : '先创建Offer'}
                    </div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-indigo-300 hover:bg-indigo-50"
                  onClick={() => router.push('/campaigns')}
                >
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">广告系列</div>
                    <div className="text-xs text-gray-500">管理投放系列</div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-orange-300 hover:bg-orange-50"
                  onClick={() => router.push('/google-ads')}
                >
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <DollarSign className="w-4 h-4 text-orange-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">Google Ads账号</div>
                    <div className="text-xs text-gray-500">账号管理</div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-gray-300 hover:bg-gray-50"
                  onClick={() => router.push('/settings')}
                >
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <RefreshCw className="w-4 h-4 text-gray-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">系统设置</div>
                    <div className="text-xs text-gray-500">配置参数</div>
                  </div>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Insights */}
        <div className="mt-6">
          <InsightsCard days={days} />
        </div>
      </div>
    </div>
  )
}
