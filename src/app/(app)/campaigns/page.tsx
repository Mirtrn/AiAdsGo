'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showSuccess, showError, showConfirm } from '@/lib/toast-utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, RefreshCw, Trash2, ExternalLink, AlertCircle, CheckCircle2, PlayCircle, PauseCircle, XCircle, TrendingUp, DollarSign } from 'lucide-react'
import { TrendChart, TrendChartData, TrendChartMetric } from '@/components/charts/TrendChart'

interface Campaign {
  id: number
  offerId: number
  googleAdsAccountId: number
  campaignId: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  status: string
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    costUsd: number
    ctr: number
    cpcUsd: number
    conversionRate: number
    dateRange: {
      start: string
      end: string
      days: number
    }
  }
}

interface PerformanceSummary {
  totalCampaigns: number
  activeCampaigns: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  totalCostUsd: number
}

export default function CampaignsPage() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [filteredCampaigns, setFilteredCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState<number | null>(null)
  const [syncingData, setSyncingData] = useState(false)
  const [summary, setSummary] = useState<PerformanceSummary | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [creationStatusFilter, setCreationStatusFilter] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<string>('7')

  // Trend data states
  const [trendsData, setTrendsData] = useState<TrendChartData[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [trendsError, setTrendsError] = useState<string | null>(null)

  useEffect(() => {
    fetchCampaigns()
    fetchTrends()
  }, [])

  useEffect(() => {
    fetchCampaigns()
    fetchTrends()
  }, [timeRange])

  useEffect(() => {
    let result = campaigns

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (c) =>
          c.campaignName.toLowerCase().includes(query) ||
          (c.campaignId && c.campaignId.includes(query))
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter)
    }

    // Creation Status filter
    if (creationStatusFilter !== 'all') {
      result = result.filter((c) => c.creationStatus === creationStatusFilter)
    }

    setFilteredCampaigns(result)
  }, [campaigns, searchQuery, statusFilter, creationStatusFilter])

  const fetchCampaigns = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/campaigns/performance?daysBack=${timeRange}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取广告系列数据失败')
      }

      const data = await response.json()
      setCampaigns(data.campaigns)
      setFilteredCampaigns(data.campaigns)
      setSummary(data.summary)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchTrends = async () => {
    try {
      setTrendsLoading(true)
      const response = await fetch(`/api/campaigns/trends?daysBack=${timeRange}`, {
        credentials: 'include',
      })

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

  const handleSyncData = async () => {
    setSyncingData(true)
    try {
      const response = await fetch('/api/sync/trigger', {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '数据同步失败')
      }

      showSuccess('同步成功', `已同步 ${data.recordCount} 条性能数据`)
      // Wait a moment then refresh campaigns
      setTimeout(() => {
        fetchCampaigns()
      }, 1000)
    } catch (err: any) {
      showError('同步失败', err.message)
    } finally {
      setSyncingData(false)
    }
  }

  const handleSync = async (campaignId: number) => {
    setSyncing(campaignId)

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sync`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '同步失败')
      }

      showSuccess('同步成功', '广告系列已成功同步到Google Ads')
      fetchCampaigns()
    } catch (err: any) {
      showError('同步失败', err.message)
    } finally {
      setSyncing(null)
    }
  }

  const handleDelete = async (campaignId: number, campaignName: string) => {
    const confirmed = await showConfirm(
      '确认删除',
      `确定要删除广告系列"${campaignName}"吗？`
    )

    if (!confirmed) {
      return
    }

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '删除失败')
      }

      fetchCampaigns()
    } catch (err: any) {
      showError('删除失败', err.message)
    }
  }

  const getStatusBadge = (status: string) => {
    const configs = {
      ENABLED: { label: '启用', variant: 'default' as const, icon: PlayCircle, className: 'bg-green-600 hover:bg-green-700' },
      PAUSED: { label: '暂停', variant: 'secondary' as const, icon: PauseCircle, className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' },
      REMOVED: { label: '已移除', variant: 'destructive' as const, icon: XCircle, className: '' },
    }
    const config = configs[status as keyof typeof configs] || { label: status, variant: 'outline' as const, icon: AlertCircle, className: '' }
    const Icon = config.icon

    return (
      <Badge variant={config.variant} className={`flex items-center gap-1 w-fit ${config.className}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    )
  }

  const getCreationStatusBadge = (status: string) => {
    const configs = {
      draft: { label: '草稿', variant: 'secondary' as const, className: 'bg-gray-100 text-gray-600' },
      pending: { label: '同步中', variant: 'secondary' as const, className: 'bg-blue-100 text-blue-700' },
      synced: { label: '已同步', variant: 'default' as const, className: 'bg-green-600 hover:bg-green-700' },
      failed: { label: '同步失败', variant: 'destructive' as const, className: '' },
    }
    const config = configs[status as keyof typeof configs] || { label: status, variant: 'outline' as const, className: '' }

    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">广告系列管理</h1>
              <Badge variant="outline" className="text-sm">
                {campaigns.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleSyncData}
                disabled={syncingData}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${syncingData ? 'animate-spin' : ''}`} />
                {syncingData ? '同步中...' : '同步数据'}
              </Button>
              <Button onClick={() => router.push('/offers')}>
                创建广告系列
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Summary Statistics */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总展示次数</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {(summary.totalImpressions ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总点击次数</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {(summary.totalClicks ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总转化次数</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {(summary.totalConversions ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总花费</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      ${(summary.totalCostUsd ?? 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                    <DollarSign className="w-6 h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trends Chart */}
        <div className="mb-6">
          <TrendChart
            data={trendsData}
            metrics={[
              { key: 'impressions', label: '展示次数', color: 'hsl(var(--chart-1))' },
              { key: 'clicks', label: '点击次数', color: 'hsl(var(--chart-2))' },
              { key: 'conversions', label: '转化次数', color: 'hsl(var(--chart-4))' },
            ]}
            title="性能趋势"
            description={`过去${timeRange}天的数据变化`}
            loading={trendsLoading}
            error={trendsError}
            onRetry={fetchTrends}
            selectedTimeRange={parseInt(timeRange)}
            onTimeRangeChange={(days) => setTimeRange(days.toString())}
            height={280}
          />
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="搜索广告系列名称或ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Time Range Filter */}
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger>
                  <SelectValue placeholder="时间范围" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">近7天</SelectItem>
                  <SelectItem value="30">近30天</SelectItem>
                  <SelectItem value="90">近90天</SelectItem>
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="投放状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有投放状态</SelectItem>
                  <SelectItem value="ENABLED">启用</SelectItem>
                  <SelectItem value="PAUSED">暂停</SelectItem>
                  <SelectItem value="REMOVED">已移除</SelectItem>
                </SelectContent>
              </Select>

              {/* Creation Status Filter */}
              <Select value={creationStatusFilter} onValueChange={setCreationStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="同步状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有同步状态</SelectItem>
                  <SelectItem value="draft">草稿</SelectItem>
                  <SelectItem value="synced">已同步</SelectItem>
                  <SelectItem value="failed">同步失败</SelectItem>
                  <SelectItem value="pending">同步中</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Content */}
        {filteredCampaigns.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <Search className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到广告系列</h3>
            <p className="mt-2 text-sm text-gray-500">
              {campaigns.length === 0
                ? "您还没有创建任何广告系列，请前往Offer列表创建。"
                : "没有找到符合筛选条件的广告系列。"}
            </p>
            {campaigns.length === 0 && (
              <div className="mt-6">
                <Button onClick={() => router.push('/offers')}>
                  前往Offer列表
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">广告系列名称</TableHead>
                      <TableHead>预算</TableHead>
                      <TableHead>展示</TableHead>
                      <TableHead>点击</TableHead>
                      <TableHead>CTR</TableHead>
                      <TableHead>CPC</TableHead>
                      <TableHead>转化</TableHead>
                      <TableHead>花费</TableHead>
                      <TableHead>投放状态</TableHead>
                      <TableHead>同步状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {filteredCampaigns.map((campaign) => (
                    <TableRow key={campaign.id} className="hover:bg-gray-50/50">
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {campaign.campaignName}
                        </div>
                        {campaign.campaignId && (
                          <div className="text-xs text-gray-500 font-mono mt-1">
                            ID: {campaign.campaignId}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          ${campaign.budgetAmount.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">{campaign.budgetType}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {campaign.performance?.impressions?.toLocaleString() || '0'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {campaign.performance?.clicks?.toLocaleString() || '0'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {campaign.performance?.ctr?.toFixed(2) || '0.00'}%
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          ${campaign.performance?.cpcUsd?.toFixed(2) || '0.00'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {campaign.performance?.conversions?.toFixed(1) || '0.0'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          ${campaign.performance?.costUsd?.toFixed(2) || '0.00'}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(campaign.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getCreationStatusBadge(campaign.creationStatus)}
                          {campaign.creationError && (
                            <span className="text-xs text-red-600 max-w-[200px] truncate" title={campaign.creationError}>
                              {campaign.creationError}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end items-center gap-2">
                          {(campaign.creationStatus === 'draft' || campaign.creationStatus === 'failed') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSync(campaign.id)}
                              disabled={syncing === campaign.id}
                              className={campaign.creationStatus === 'failed' ? 'text-orange-600 hover:text-orange-700' : 'text-indigo-600 hover:text-indigo-700'}
                            >
                              <RefreshCw className={`w-4 h-4 mr-1 ${syncing === campaign.id ? 'animate-spin' : ''}`} />
                              {syncing === campaign.id ? '同步中' : (campaign.creationStatus === 'failed' ? '重试' : '同步')}
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(`/offers/${campaign.offerId}`)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-4 h-4 mr-1" />
                            Offer
                          </Button>

                          {campaign.creationStatus === 'draft' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(campaign.id, campaign.campaignName)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
