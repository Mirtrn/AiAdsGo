'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { showError } from '@/lib/toast-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LazyROITrendChart, LazyCampaignROIChart, LazyOfferROIChart } from '@/components/LazyChartLoader'
import { Download, TrendingUp, TrendingDown, DollarSign, Target, Percent, RefreshCw } from 'lucide-react'
import { useROIAnalytics } from '@/lib/hooks/useAnalytics'

interface ROIData {
  overall: {
    totalCost: number
    totalRevenue: number
    totalProfit: number
    roi: number
    conversions: number
    avgCommission: number
  }
  trend: Array<{
    date: string
    cost: number
    revenue: number
    profit: number
    roi: number
    conversions: number
  }>
  byCampaign: Array<{
    campaign_id: number
    campaign_name: string
    offer_brand: string
    cost: number
    revenue: number
    profit: number
    roi: number
    conversions: number
    ctr: number
    conversionRate: number
  }>
  byOffer: Array<{
    offer_id: number
    brand: string
    product_name: string
    commission_amount: number
    campaign_count: number
    cost: number
    revenue: number
    profit: number
    roi: number
    conversions: number
  }>
  efficiency: {
    costPerConversion: number
    revenuePerConversion: number
    profitMargin: number
    breakEvenPoint: number
  }
}

export default function ROIAnalyticsPage() {
  const router = useRouter()

  // Date filters
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  // Use SWR for data fetching with automatic caching
  const { data, error, isLoading: loading, refresh } = useROIAnalytics(startDate, endDate)

  // Show error toast if fetch fails
  if (error) {
    showError('加载失败', error.message || 'Failed to load ROI analytics')
  }

  const exportData = () => {
    if (!data) return

    // Create CSV content
    const csvRows: string[] = []

    // Overall section
    csvRows.push('ROI整体分析')
    csvRows.push('指标,数值')
    csvRows.push(`总成本,¥${data.overall.totalCost}`)
    csvRows.push(`总收入,¥${data.overall.totalRevenue}`)
    csvRows.push(`总利润,¥${data.overall.totalProfit}`)
    csvRows.push(`ROI,${data.overall.roi}%`)
    csvRows.push(`转化次数,${data.overall.conversions}`)
    csvRows.push('')

    // Trend section
    csvRows.push('ROI趋势分析')
    csvRows.push('日期,成本,收入,利润,ROI,转化次数')
    data.trend.forEach((row: ROIData['trend'][0]) => {
      csvRows.push(`${row.date},${row.cost},${row.revenue},${row.profit},${row.roi},${row.conversions}`)
    })
    csvRows.push('')

    // Campaign section
    csvRows.push('Campaign ROI排名')
    csvRows.push('Campaign名称,品牌,成本,收入,利润,ROI,转化次数')
    data.byCampaign.forEach((row: ROIData['byCampaign'][0]) => {
      csvRows.push(`${row.campaign_name},${row.offer_brand},${row.cost},${row.revenue},${row.profit},${row.roi},${row.conversions}`)
    })
    csvRows.push('')

    // Offer section
    csvRows.push('Offer ROI分析')
    csvRows.push('品牌,产品名称,成本,收入,利润,ROI,转化次数')
    data.byOffer.forEach((row: ROIData['byOffer'][0]) => {
      csvRows.push(`${row.brand},${row.product_name},${row.cost},${row.revenue},${row.profit},${row.roi},${row.conversions}`)
    })

    // Create and download file
    const csvContent = csvRows.join('\n')
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `roi-analysis-${startDate}-${endDate}.csv`
    link.click()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">无法加载ROI分析数据</p>
          <Button className="mt-4" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/dashboard')}
                className="text-indigo-600 hover:text-indigo-500 mr-4"
              >
                ← 返回Dashboard
              </button>
              <h1 className="text-xl font-bold text-gray-900">ROI分析</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-40"
                />
                <span className="text-gray-500">至</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button variant="outline" onClick={() => refresh()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              <Button onClick={exportData}>
                <Download className="h-4 w-4 mr-2" />
                导出报告
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0 space-y-6">
          {/* Overall Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">总ROI</CardTitle>
                {data.overall.roi >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${data.overall.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {data.overall.roi >= 0 ? '+' : ''}{data.overall.roi.toFixed(2)}%
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  投资回报率
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">总利润</CardTitle>
                <DollarSign className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${data.overall.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ¥{data.overall.totalProfit.toLocaleString()}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  收入 ¥{data.overall.totalRevenue.toLocaleString()} - 成本 ¥{data.overall.totalCost.toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">转化效率</CardTitle>
                <Target className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {data.overall.conversions}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  总转化次数 · ¥{data.efficiency.costPerConversion.toFixed(2)}/次
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">利润率</CardTitle>
                <Percent className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${data.efficiency.profitMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {data.efficiency.profitMargin.toFixed(2)}%
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  利润占收入比例
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">单次转化收入</CardTitle>
                <DollarSign className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  ¥{data.efficiency.revenuePerConversion.toFixed(2)}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  平均佣金 ¥{data.overall.avgCommission.toFixed(2)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">盈亏平衡点</CardTitle>
                <Target className="h-4 w-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {data.efficiency.breakEvenPoint}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  需要转化次数
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ROI Trend */}
          <Card>
            <CardHeader>
              <CardTitle>ROI趋势分析</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyROITrendChart data={data.trend} height={350} />
            </CardContent>
          </Card>

          {/* Campaign ROI Ranking */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign ROI排名 (Top 10)</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyCampaignROIChart data={data.byCampaign} height={450} />
            </CardContent>
          </Card>

          {/* Offer ROI Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>Offer ROI分析</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyOfferROIChart data={data.byOffer} height={400} />
            </CardContent>
          </Card>

          {/* Detailed Campaign Table */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign详细数据</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Campaign
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        品牌
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        成本
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        收入
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        利润
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        ROI
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        转化
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        CTR
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        转化率
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {data.byCampaign.map((campaign: ROIData['byCampaign'][0]) => (
                      <tr key={campaign.campaign_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{campaign.campaign_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{campaign.offer_brand}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          ¥{campaign.cost.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-green-600">
                          ¥{campaign.revenue.toFixed(2)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right font-semibold ${campaign.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ¥{campaign.profit.toFixed(2)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right font-bold ${campaign.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {campaign.roi >= 0 ? '+' : ''}{campaign.roi.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {campaign.conversions}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {campaign.ctr.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {campaign.conversionRate.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
