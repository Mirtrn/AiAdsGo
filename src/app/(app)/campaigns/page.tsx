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
import { Search, RefreshCw, Trash2, ExternalLink, AlertCircle, CheckCircle2, PlayCircle, PauseCircle, XCircle } from 'lucide-react'

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
}

export default function CampaignsPage() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [filteredCampaigns, setFilteredCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState<number | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [creationStatusFilter, setCreationStatusFilter] = useState<string>('all')

  useEffect(() => {
    fetchCampaigns()
  }, [])

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
      const response = await fetch('/api/campaigns', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取广告系列列表失败')
      }

      const data = await response.json()
      setCampaigns(data.campaigns)
      setFilteredCampaigns(data.campaigns)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
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
            <Button onClick={() => router.push('/offers')}>
              创建广告系列
            </Button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">广告系列名称</TableHead>
                    <TableHead>预算</TableHead>
                    <TableHead>投放状态</TableHead>
                    <TableHead>同步状态</TableHead>
                    <TableHead>创建时间</TableHead>
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
                      <TableCell className="text-sm text-gray-500">
                        {new Date(campaign.createdAt).toLocaleDateString()}
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
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
