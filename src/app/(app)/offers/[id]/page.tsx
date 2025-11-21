'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { showSuccess, showError, showInfo, showConfirm } from '@/lib/toast-utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { TrendingUp, DollarSign, Target, Activity } from 'lucide-react'
import { TrendChart, TrendChartData, TrendChartMetric } from '@/components/charts/TrendChart'

interface Offer {
  id: number
  url: string
  brand: string
  category: string | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  uniqueSellingPoints: string | null
  productHighlights: string | null
  targetAudience: string | null
  scrape_status: string
  scrapeError: string | null
  scrapedAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface PerformanceSummary {
  campaignCount: number
  impressions: number
  clicks: number
  conversions: number
  costUsd: number
  ctr: number
  avgCpcUsd: number
  conversionRate: number
  dateRange: {
    start: string
    end: string
  }
}

interface CampaignPerformance {
  campaignId: number
  campaignName: string
  googleCampaignId: string | null
  impressions: number
  clicks: number
  conversions: number
  costUsd: number
  ctr: number
  cpcUsd: number
  conversionRate: number
}

interface ROIData {
  totalCostUsd: number
  totalRevenueUsd: number
  roiPercentage: number
  profitUsd: number
  conversions: number
  avgOrderValue: number
}

export default function OfferDetailPage() {
  const router = useRouter()
  const params = useParams()
  const offerId = params?.id as string

  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [scraping, setScraping] = useState(false)

  // Performance data states
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummary | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([])
  const [roi, setRoi] = useState<ROIData | null>(null)
  const [timeRange, setTimeRange] = useState<string>('30')
  const [avgOrderValue, setAvgOrderValue] = useState<string>('')

  // Trend data states
  const [trendsData, setTrendsData] = useState<TrendChartData[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [trendsError, setTrendsError] = useState<string | null>(null)

  useEffect(() => {
    fetchOffer()
    fetchPerformance()
    fetchTrends()
  }, [offerId])

  useEffect(() => {
    fetchPerformance()
    fetchTrends()
  }, [timeRange, avgOrderValue])

  const fetchOffer = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}`, {
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        throw new Error('获取Offer失败')
      }

      const data = await response.json()
      setOffer(data.offer)
    } catch (err: any) {
      setError(err.message || '获取Offer失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchPerformance = async () => {
    try {
      setPerformanceLoading(true)
      const avgOrderValueNum = parseFloat(avgOrderValue) || 0
      const response = await fetch(
        `/api/offers/${offerId}/performance?daysBack=${timeRange}&avgOrderValue=${avgOrderValueNum}`,
        {
          credentials: 'include',
        }
      )

      if (!response.ok) {
        throw new Error('获取性能数据失败')
      }

      const data = await response.json()
      setPerformanceSummary(data.summary)
      setCampaigns(data.campaigns)
      setRoi(data.roi)
    } catch (err: any) {
      console.error('Fetch performance error:', err)
      // 不阻塞页面加载，只是性能数据获取失败
    } finally {
      setPerformanceLoading(false)
    }
  }

  const fetchTrends = async () => {
    try {
      setTrendsLoading(true)
      const response = await fetch(
        `/api/offers/${offerId}/trends?daysBack=${timeRange}`,
        {
          credentials: 'include',
        }
      )

      if (!response.ok) {
        throw new Error('获取趋势数据失败')
      }

      const data = await response.json()
      setTrendsData(data.trends)
      setTrendsError(null)
    } catch (err: any) {
      setTrendsError(err.message || '加载趋势数据失败')
    } finally {
      setTrendsLoading(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await showConfirm(
      '确认删除',
      '确定要删除这个Offer吗？此操作不可撤销。'
    )

    if (!confirmed) {
      return
    }

    setDeleting(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}`, {
        method: 'DELETE',
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        throw new Error('删除Offer失败')
      }

      router.push('/offers')
    } catch (err: any) {
      showError('删除失败', err.message || '请稍后重试')
      setDeleting(false)
    }
  }

  const handleScrape = async () => {
    setScraping(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}/scrape`, {
        method: 'POST',
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '启动抓取失败')
      }

      showInfo('抓取已启动', '产品信息抓取已启动，请稍后刷新页面查看结果')

      // 3秒后自动刷新
      setTimeout(() => {
        fetchOffer()
      }, 3000)
    } catch (err: any) {
      showError('启动抓取失败', err.message || '请稍后重试')
    } finally {
      setScraping(false)
    }
  }

  const getScrapeStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      pending: '等待抓取',
      in_progress: '抓取中',
      completed: '已完成',
      failed: '失败',
    }
    return labels[status] || status
  }

  const getScrapeStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (error || !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error || '加载失败'}</p>
          <button
            onClick={() => router.push('/offers')}
            className="mt-4 text-indigo-600 hover:text-indigo-500"
          >
            返回列表
          </button>
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
              <a href="/offers" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回列表
              </a>
              <h1 className="text-xl font-bold text-gray-900">{offer.brand}</h1>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => router.push(`/offers/${offerId}/edit`)}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                编辑
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                {deleting ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 抓取状态提示 */}
          <div className={`mb-6 px-4 py-3 rounded border ${
            offer.scrape_status === 'completed' ? 'bg-green-50 border-green-400 text-green-700' :
            offer.scrape_status === 'failed' ? 'bg-red-50 border-red-400 text-red-700' :
            offer.scrape_status === 'in_progress' ? 'bg-blue-50 border-blue-400 text-blue-700' :
            'bg-yellow-50 border-yellow-400 text-yellow-700'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getScrapeStatusColor(offer.scrape_status)}`}>
                  {getScrapeStatusLabel(offer.scrape_status)}
                </span>
                <span className="ml-3">
                  {offer.scrape_status === 'pending' && '产品信息等待抓取'}
                  {offer.scrape_status === 'in_progress' && '正在抓取产品信息...'}
                  {offer.scrape_status === 'completed' && `产品信息抓取完成 (${offer.scrapedAt ? new Date(offer.scrapedAt).toLocaleString('zh-CN') : ''})`}
                  {offer.scrape_status === 'failed' && `抓取失败: ${offer.scrapeError || '未知错误'}`}
                </span>
              </div>
              {(offer.scrape_status === 'pending' || offer.scrape_status === 'failed') && (
                <button
                  onClick={handleScrape}
                  disabled={scraping}
                  className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {scraping ? '启动中...' : offer.scrape_status === 'failed' ? '重新抓取' : '开始抓取'}
                </button>
              )}
            </div>
          </div>

          {/* 性能数据控制 */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">投放表现</h2>
                <div className="flex items-center gap-3">
                  <Select value={timeRange} onValueChange={setTimeRange}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="时间范围" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">近7天</SelectItem>
                      <SelectItem value="30">近30天</SelectItem>
                      <SelectItem value="90">近90天</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">平均订单价值:</span>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={avgOrderValue}
                      onChange={(e) => setAvgOrderValue(e.target.value)}
                      className="w-[100px]"
                    />
                    <span className="text-sm text-gray-600">USD</span>
                  </div>
                </div>
              </div>

              {performanceLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                  <p className="mt-2 text-sm text-gray-600">加载性能数据...</p>
                </div>
              ) : performanceSummary ? (
                <>
                  {/* 性能汇总卡片 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">展示次数</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              {performanceSummary.impressions.toLocaleString()}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          CTR: {performanceSummary.ctr.toFixed(2)}%
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">点击次数</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              {performanceSummary.clicks.toLocaleString()}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                            <Target className="w-6 h-6 text-green-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          平均CPC: ${performanceSummary.avgCpcUsd.toFixed(2)}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">转化次数</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              {performanceSummary.conversions.toLocaleString()}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                            <Activity className="w-6 h-6 text-purple-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          转化率: {performanceSummary.conversionRate.toFixed(2)}%
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">总花费</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              ${performanceSummary.costUsd.toFixed(2)}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                            <DollarSign className="w-6 h-6 text-orange-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {performanceSummary.campaignCount} 个广告系列
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* ROI卡片 */}
                  {roi && (
                    <Card className="mb-6">
                      <CardContent className="pt-6">
                        <h3 className="text-md font-semibold text-gray-900 mb-4">投资回报率 (ROI)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                          <div>
                            <p className="text-sm text-gray-600">总花费</p>
                            <p className="text-lg font-bold text-gray-900">${roi.totalCostUsd.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">总收入</p>
                            <p className="text-lg font-bold text-gray-900">${roi.totalRevenueUsd.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">利润</p>
                            <p className={`text-lg font-bold ${roi.profitUsd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              ${roi.profitUsd.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">ROI</p>
                            <p className={`text-lg font-bold ${roi.roiPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {roi.roiPercentage.toFixed(0)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">转化次数</p>
                            <p className="text-lg font-bold text-gray-900">{roi.conversions}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Trends Chart */}
                  <div className="mb-6">
                    <TrendChart
                      data={trendsData}
                      metrics={[
                        {
                          key: 'impressions',
                          label: '展示次数',
                          color: 'hsl(var(--chart-1))',
                        },
                        {
                          key: 'clicks',
                          label: '点击次数',
                          color: 'hsl(var(--chart-2))',
                        },
                        {
                          key: 'conversions',
                          label: '转化次数',
                          color: 'hsl(var(--chart-4))',
                        },
                        {
                          key: 'costUsd',
                          label: '花费 (USD)',
                          color: 'hsl(var(--chart-5))',
                          formatter: (value) => `$${value.toFixed(2)}`,
                        },
                      ]}
                      title="投放趋势"
                      description={`过去${timeRange}天的数据变化`}
                      loading={trendsLoading}
                      error={trendsError}
                      onRetry={fetchTrends}
                      selectedTimeRange={parseInt(timeRange)}
                      onTimeRangeChange={(days) => setTimeRange(days.toString())}
                      height={280}
                    />
                  </div>

                  {/* Campaign对比表格 */}
                  {campaigns.length > 0 && (
                    <Card className="mb-6">
                      <CardContent className="pt-6">
                        <h3 className="text-md font-semibold text-gray-900 mb-4">广告系列表现对比</h3>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>广告系列名称</TableHead>
                                <TableHead className="text-right">展示</TableHead>
                                <TableHead className="text-right">点击</TableHead>
                                <TableHead className="text-right">CTR</TableHead>
                                <TableHead className="text-right">CPC</TableHead>
                                <TableHead className="text-right">转化</TableHead>
                                <TableHead className="text-right">转化率</TableHead>
                                <TableHead className="text-right">花费</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {campaigns.map((campaign) => (
                                <TableRow key={campaign.campaignId}>
                                  <TableCell className="font-medium">
                                    <div>
                                      {campaign.campaignName}
                                      {campaign.googleCampaignId && (
                                        <div className="text-xs text-gray-500 font-mono mt-1">
                                          ID: {campaign.googleCampaignId}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">{campaign.impressions.toLocaleString()}</TableCell>
                                  <TableCell className="text-right">{campaign.clicks.toLocaleString()}</TableCell>
                                  <TableCell className="text-right">{campaign.ctr.toFixed(2)}%</TableCell>
                                  <TableCell className="text-right">${campaign.cpcUsd.toFixed(2)}</TableCell>
                                  <TableCell className="text-right">{campaign.conversions.toFixed(1)}</TableCell>
                                  <TableCell className="text-right">{campaign.conversionRate.toFixed(2)}%</TableCell>
                                  <TableCell className="text-right">${campaign.costUsd.toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>暂无性能数据</p>
                  <p className="text-sm mt-2">创建广告系列并投放后，性能数据将在此显示</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 基础信息卡片 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">基础信息</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">品牌名称</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.brand}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">产品分类</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.category || '未分类'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">目标国家</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.targetCountry}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">状态</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${
                    offer.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {offer.isActive ? '启用' : '禁用'}
                  </span>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-gray-500">商品/店铺URL</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  <a href={offer.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-500">
                    {offer.url}
                  </a>
                </dd>
              </div>
              {offer.affiliateLink && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">联盟推广链接</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <a href={offer.affiliateLink} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-500">
                      {offer.affiliateLink}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* 产品描述卡片 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">产品描述</h2>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">品牌描述</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.brandDescription || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">独特卖点</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.uniqueSellingPoints || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">产品亮点</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.productHighlights || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">目标受众</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.targetAudience || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
            </dl>
          </div>

          {/* 系统信息卡片 */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">系统信息</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">创建时间</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(offer.createdAt).toLocaleString('zh-CN')}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">最后更新</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(offer.updatedAt).toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
          </div>

          {/* 快速操作 */}
          <div className="mt-6 flex space-x-3">
            <button
              onClick={() => router.push(`/creatives?offerId=${offerId}`)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              生成AI创意
            </button>
            <button
              onClick={() => router.push(`/campaigns/new?offerId=${offerId}`)}
              className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-md hover:bg-indigo-50"
            >
              创建广告系列
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
