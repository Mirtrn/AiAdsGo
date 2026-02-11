'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showSuccess, showError } from '@/lib/toast-utils'
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { Search, Trash2, ExternalLink, AlertCircle, CheckCircle2, PlayCircle, PauseCircle, XCircle, TrendingUp, Coins, ArrowUpDown, ArrowUp, ArrowDown, Package, Loader2 } from 'lucide-react'
import { TrendChart, TrendChartData, TrendChartMetric } from '@/components/charts/TrendChart'
import AdjustCampaignCpcDialog from '@/components/AdjustCampaignCpcDialog'
import {
  getCampaignStatusLabel,
  getCreationStatusLabel,
} from '@/lib/i18n-constants'
import { formatCurrency } from '@/lib/currency'
import { formatCurrency as formatCurrencyDashboard, formatMultiCurrency } from '@/lib/utils'

interface Campaign {
  id: number
  offerId: number
  googleAdsAccountId: number
  googleCampaignId?: string | null
  campaignId: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  status: string
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  servingStartDate?: string | null
  adsAccountAvailable?: boolean
  adsAccountCurrency?: string | null
  createdAt: string
  // 🔧 新增: 软删除状态字段
  isDeleted?: boolean | number
  deletedAt?: string | null
  offerIsDeleted?: boolean | number
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    commission?: number
    costUsd: number
    ctr: number
    cpcUsd: number
    conversionRate: number
    commissionPerClick?: number
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
  totalCommission?: number
  totalCostUsd: number
  currency?: string
  currencies?: string[]
  hasMixedCurrency?: boolean
  costs?: Array<{ currency: string; amount: number }>
  // 环比增长数据
  changes?: {
    impressions: number | null
    clicks: number | null
    conversions: number | null
    cost: number | null
  }
}

type OfflineActionResult =
  | { status: 'success' }
  | { status: 'error'; message: string }
  | { status: 'account_issue'; message: string; accountStatus?: string }

type BatchOfflineFailure = {
  campaignName: string
  message: string
}

type BatchOfflineAccountIssue = {
  campaign: Campaign
  message: string
  accountStatus?: string
}

type BatchOfflinePendingState = {
  totalCount: number
  successCount: number
  failures: BatchOfflineFailure[]
  accountIssues: BatchOfflineAccountIssue[]
}

export default function CampaignsPage() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [filteredCampaigns, setFilteredCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<PerformanceSummary | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<string>('7')
  const [showDeletedCampaigns, setShowDeletedCampaigns] = useState(false)

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Sorting states
  type SortField = 'campaignName' | 'budgetAmount' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'conversions' | 'cost' | 'status' | 'servingStartDate'
  type SortDirection = 'asc' | 'desc' | null
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const filterKeyRef = useRef<string>('')

  // Trend data states
  const [trendsData, setTrendsData] = useState<TrendChartData[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [trendsError, setTrendsError] = useState<string | null>(null)
  const [trendsCurrencies, setTrendsCurrencies] = useState<string[]>([])
  const [trendsCurrency, setTrendsCurrency] = useState<string>('')

  // Batch offline states
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<number>>(new Set())
  const [batchOfflineSubmitting, setBatchOfflineSubmitting] = useState(false)
  const [isBatchOfflineDialogOpen, setIsBatchOfflineDialogOpen] = useState(false)
  const [isBatchOfflineAccountIssueDialogOpen, setIsBatchOfflineAccountIssueDialogOpen] = useState(false)
  const [batchOfflinePendingState, setBatchOfflinePendingState] = useState<BatchOfflinePendingState | null>(null)
  const [batchOfflineBlacklistOffer, setBatchOfflineBlacklistOffer] = useState(false)
  const [batchOfflinePauseClickFarm, setBatchOfflinePauseClickFarm] = useState(false)
  const [batchOfflinePauseUrlSwap, setBatchOfflinePauseUrlSwap] = useState(false)
  const [batchOfflineRemoveGoogleAds, setBatchOfflineRemoveGoogleAds] = useState(false)

  // Adjust CPC dialog states
  const [adjustCpcOpen, setAdjustCpcOpen] = useState(false)
  const [adjustCpcTarget, setAdjustCpcTarget] = useState<{ googleCampaignId: string; campaignName: string } | null>(null)

  // Toggle status states
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<Set<number>>(new Set())
  const [isToggleStatusDialogOpen, setIsToggleStatusDialogOpen] = useState(false)
  const [toggleStatusTarget, setToggleStatusTarget] = useState<Campaign | null>(null)
  const [toggleStatusNextStatus, setToggleStatusNextStatus] = useState<'PAUSED' | 'ENABLED' | null>(null)

  // Delete draft dialog states
  const [isDeleteDraftDialogOpen, setIsDeleteDraftDialogOpen] = useState(false)
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<Campaign | null>(null)
  const [deleteDraftSubmitting, setDeleteDraftSubmitting] = useState(false)

  // Offline (下线) dialog states
  const [isOfflineDialogOpen, setIsOfflineDialogOpen] = useState(false)
  const [offlineTarget, setOfflineTarget] = useState<Campaign | null>(null)
  const [offlineSubmitting, setOfflineSubmitting] = useState(false)
  const [offlineBlacklistOffer, setOfflineBlacklistOffer] = useState(false)
  const [offlinePauseClickFarm, setOfflinePauseClickFarm] = useState(false)
  const [offlinePauseUrlSwap, setOfflinePauseUrlSwap] = useState(false)
  const [offlineRemoveGoogleAds, setOfflineRemoveGoogleAds] = useState(false)
  const [isOfflineAccountIssueDialogOpen, setIsOfflineAccountIssueDialogOpen] = useState(false)
  const [offlineAccountIssueMessage, setOfflineAccountIssueMessage] = useState<string | null>(null)
  const [offlineAccountIssueStatus, setOfflineAccountIssueStatus] = useState<string | null>(null)

  const isCampaignDeleted = (campaign: Campaign) => {
    const deletedFlag = campaign.isDeleted === true || campaign.isDeleted === 1
    const removedStatus = String(campaign.status || '').toUpperCase() === 'REMOVED'
    return deletedFlag || removedStatus
  }
  const isOfferDeleted = (campaign: Campaign) => campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
  const getCampaignGoogleId = (campaign: Campaign) => campaign.campaignId || campaign.googleCampaignId

  const currencySet = new Set(
    campaigns
      .map((c) => c.adsAccountCurrency)
      .filter((c): c is string => Boolean(c))
  )
  const defaultCurrency = currencySet.size >= 1 ? Array.from(currencySet)[0] : 'USD'
  const formatMoney = (value: number, currencyCode: string = defaultCurrency) =>
    formatCurrency(value, currencyCode)
  const trendsCurrencyValue = trendsCurrency || trendsCurrencies[0] || defaultCurrency
  const formatTrendsMoney = (value: number) => formatCurrency(value, trendsCurrencyValue)
  const visibleCampaignCount = campaigns.filter((campaign) => showDeletedCampaigns || !isCampaignDeleted(campaign)).length
  const hasBatchOfflineSelection = selectedCampaignIds.size > 0
  const activeCampaignCount = campaigns.filter((campaign) => !isCampaignDeleted(campaign)).length

  const resetBatchOfflineOptions = () => {
    setBatchOfflineBlacklistOffer(false)
    setBatchOfflinePauseClickFarm(false)
    setBatchOfflinePauseUrlSwap(false)
    setBatchOfflineRemoveGoogleAds(false)
  }

  const resetBatchOfflineState = () => {
    setBatchOfflinePendingState(null)
    resetBatchOfflineOptions()
  }

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = () => {
    // 清除无效的cookie
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    // 跳转到登录页，保留当前路径用于登录后跳转回来
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }

  useEffect(() => {
    fetchCampaigns()
    fetchTrends()
  }, [])

  useEffect(() => {
    fetchCampaigns()
    fetchTrends()
  }, [timeRange])

  useEffect(() => {
    if (!trendsCurrency) return
    fetchCampaigns(trendsCurrency)
  }, [trendsCurrency])

  useEffect(() => {
    let result = campaigns

    if (!showDeletedCampaigns) {
      result = result.filter((campaign) => !isCampaignDeleted(campaign))
    }

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

    // Sorting
    if (sortField && sortDirection) {
      result = [...result].sort((a, b) => {
        if (sortField === 'servingStartDate') {
          const aDate = a.servingStartDate
          const bDate = b.servingStartDate

          // 无投放日期的记录，始终排在最后（不随排序方向变化）
          if (!aDate && !bDate) return 0
          if (!aDate) return 1
          if (!bDate) return -1

          if (aDate < bDate) return sortDirection === 'asc' ? -1 : 1
          if (aDate > bDate) return sortDirection === 'asc' ? 1 : -1
          return 0
        }

        let aVal: number | string = 0
        let bVal: number | string = 0

        switch (sortField) {
          case 'campaignName':
            aVal = a.campaignName.toLowerCase()
            bVal = b.campaignName.toLowerCase()
            break
          case 'budgetAmount':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.budgetAmount) || 0
            bVal = Number(b.budgetAmount) || 0
            break
          case 'impressions':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.impressions) || 0
            bVal = Number(b.performance?.impressions) || 0
            break
          case 'clicks':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.clicks) || 0
            bVal = Number(b.performance?.clicks) || 0
            break
          case 'ctr':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.ctr) || 0
            bVal = Number(b.performance?.ctr) || 0
            break
          case 'cpc':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.cpcUsd) || 0
            bVal = Number(b.performance?.cpcUsd) || 0
            break
          case 'conversions':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.commission ?? a.performance?.conversions) || 0
            bVal = Number(b.performance?.commission ?? b.performance?.conversions) || 0
            break
          case 'cost':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.costUsd) || 0
            bVal = Number(b.performance?.costUsd) || 0
            break
          case 'status':
            aVal = a.status
            bVal = b.status
            break
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
        return 0
      })
    }

    setFilteredCampaigns(result)

    const filterKey = JSON.stringify({ searchQuery, statusFilter, sortField, sortDirection, showDeletedCampaigns })
    const filtersChanged = filterKeyRef.current !== filterKey
    filterKeyRef.current = filterKey

    const totalPages = Math.max(1, Math.ceil(result.length / pageSize))
    setCurrentPage((prev) => {
      const nextPage = filtersChanged ? 1 : prev
      return nextPage > totalPages ? totalPages : nextPage
    })
  }, [campaigns, searchQuery, statusFilter, sortField, sortDirection, pageSize, showDeletedCampaigns])

  const fetchCampaigns = async (currencyOverride?: string) => {
    try {
      setLoading(true)
      const currencyParam = currencyOverride || trendsCurrency
      const currencyQuery = currencyParam ? `&currency=${encodeURIComponent(currencyParam)}` : ''
      const response = await fetch(`/api/campaigns/performance?daysBack=${timeRange}${currencyQuery}`, {
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error('获取广告系列数据失败')
      }

      const data = await response.json()
      setCampaigns(data.campaigns)
      // 🔧 修复(2025-12-29): 不要直接设置 filteredCampaigns
      // 让 useEffect 自动应用排序、过滤等处理逻辑
      // setFilteredCampaigns(data.campaigns)
      setSummary(data.summary)
      if (Array.isArray(data.summary?.currencies)) {
        setTrendsCurrencies(data.summary.currencies)
      }
      if (!trendsCurrency && data.summary?.currency && data.summary.currency !== 'MIXED') {
        setTrendsCurrency(String(data.summary.currency))
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchTrends = async (currencyOverride?: string) => {
    try {
      setTrendsLoading(true)
      const currencyParam = currencyOverride || trendsCurrency
      const currencyQuery = currencyParam ? `&currency=${encodeURIComponent(currencyParam)}` : ''
      const response = await fetch(`/api/campaigns/trends?daysBack=${timeRange}${currencyQuery}`, {
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error('获取趋势数据失败')
      }

      const data = await response.json()
      setTrendsData(data.trends)
      const nextCurrencies = Array.isArray(data.summary?.currencies) ? data.summary.currencies : []
      setTrendsCurrencies(nextCurrencies)
      if (!trendsCurrency && data.summary?.currency) {
        setTrendsCurrency(String(data.summary.currency))
      }
      setTrendsError(null)
    } catch (err: any) {
      setTrendsError(err.message || '加载趋势数据失败')
    } finally {
      setTrendsLoading(false)
    }
  }

  const openDeleteDraftDialog = (campaign: Campaign) => {
    setDeleteDraftTarget(campaign)
    setIsDeleteDraftDialogOpen(true)
  }

  const confirmDeleteDraft = async () => {
    if (!deleteDraftTarget || deleteDraftSubmitting) return

    const campaignId = deleteDraftTarget.id
    const campaignName = deleteDraftTarget.campaignName

    setDeleteDraftSubmitting(true)

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || '删除草稿失败')
      }

      setSelectedCampaignIds((prev) => {
        const next = new Set(prev)
        next.delete(campaignId)
        return next
      })

      await fetchCampaigns()
      showSuccess('删除草稿成功', `已删除草稿广告系列“${campaignName}”`)
    } catch (err: any) {
      showError('删除草稿失败', err?.message || '网络错误')
    } finally {
      setDeleteDraftSubmitting(false)
      setIsDeleteDraftDialogOpen(false)
      setDeleteDraftTarget(null)
    }
  }

  const runOfflineForCampaign = async (
    campaign: Campaign,
    options?: {
      forceLocalOffline?: boolean
      blacklistOffer?: boolean
      pauseClickFarmTasks?: boolean
      pauseUrlSwapTasks?: boolean
      removeGoogleAdsCampaign?: boolean
    }
  ): Promise<OfflineActionResult> => {
    const response = await fetch(`/api/campaigns/${campaign.id}/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        blacklistOffer: options?.blacklistOffer ?? false,
        pauseClickFarmTasks: options?.pauseClickFarmTasks ?? false,
        pauseUrlSwapTasks: options?.pauseUrlSwapTasks ?? false,
        removeGoogleAdsCampaign: options?.removeGoogleAdsCampaign ?? false,
        forceLocalOffline: options?.forceLocalOffline ?? false,
      }),
    })

    if (response.status === 401) {
      handleUnauthorized()
      throw new Error('UNAUTHORIZED')
    }

    const data = await response.json().catch(() => null)

    if (response.status === 422 && data?.action === 'ACCOUNT_STATUS_NOT_USABLE') {
      const accountStatus = data?.details?.accountStatus
      return {
        status: 'account_issue',
        message: data?.message || '账号状态异常，无法在 Google Ads 中暂停/删除广告系列。',
        accountStatus: accountStatus ? String(accountStatus) : undefined,
      }
    }

    if (!response.ok) {
      return {
        status: 'error',
        message: data?.error || data?.message || '下线失败',
      }
    }

    return { status: 'success' }
  }

  const mapBatchOfflineFailureCategory = (message: string): string => {
    if (message.includes('尚未发布到Google Ads')) return '未发布到 Google Ads'
    if (message.includes('关联Offer已删除')) return '关联 Offer 已删除'
    if (message.includes('账号状态异常') || message.includes('Ads账号') || message.includes('Ads 账号')) return 'Ads 账号异常'
    if (message.includes('已下线') || message.includes('已删除')) return '已下线/已删除'
    if (message.includes('未授权') || message.includes('UNAUTHORIZED')) return '登录状态失效'
    if (message.includes('网络')) return '网络错误'
    return '其他错误'
  }

  const buildBatchOfflineFailureSummary = (failures: BatchOfflineFailure[]): string => {
    const grouped = new Map<string, { count: number; samples: string[] }>()

    failures.forEach((failure) => {
      const category = mapBatchOfflineFailureCategory(failure.message)
      const current = grouped.get(category) || { count: 0, samples: [] }
      current.count += 1
      if (current.samples.length < 2) {
        current.samples.push(failure.campaignName)
      }
      grouped.set(category, current)
    })

    return Array.from(grouped.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([category, info]) => `- ${category}: ${info.count} 个（示例：${info.samples.join('、')}）`)
      .join('\n')
  }

  const getSelectedCampaigns = () => campaigns.filter((campaign) => selectedCampaignIds.has(campaign.id))

  const buildBatchAccountStatusSummary = (accountIssues: BatchOfflineAccountIssue[]): string | null => {
    if (accountIssues.length === 0) return null

    const grouped = new Map<string, number>()
    accountIssues.forEach((item) => {
      const status = item.accountStatus || 'UNKNOWN'
      grouped.set(status, (grouped.get(status) || 0) + 1)
    })

    return Array.from(grouped.entries())
      .map(([status, count]) => `${status}（${count}个）`)
      .join('，')
  }

  const buildBatchAccountIssueSampleNames = (
    accountIssues: BatchOfflineAccountIssue[],
    limit: number = 3
  ): string => accountIssues.slice(0, limit).map((item) => item.campaign.campaignName).join('、')

  const executeBatchOffline = async (
    selectedCampaigns: Campaign[],
    options: {
      forceLocalOffline?: boolean
      blacklistOffer: boolean
      pauseClickFarmTasks: boolean
      pauseUrlSwapTasks: boolean
      removeGoogleAdsCampaign: boolean
    }
  ) => {
    const offlinePromises = selectedCampaigns.map(async (campaign) => ({
      campaign,
      result: await runOfflineForCampaign(campaign, options),
    }))

    const results = await Promise.allSettled(offlinePromises)
    const failures: BatchOfflineFailure[] = []
    const accountIssues: BatchOfflineAccountIssue[] = []
    let successCount = 0
    let unauthorizedDetected = false

    results.forEach((item, index) => {
      const fallbackCampaign = selectedCampaigns[index]

      if (item.status === 'rejected') {
        if (item.reason?.message === 'UNAUTHORIZED') {
          unauthorizedDetected = true
          return
        }

        failures.push({
          campaignName: fallbackCampaign?.campaignName || '未知广告系列',
          message: item.reason?.message || '网络错误',
        })
        return
      }

      const { campaign, result } = item.value
      if (result.status === 'success') {
        successCount += 1
        return
      }

      if (result.status === 'account_issue') {
        accountIssues.push({
          campaign,
          message: result.message,
          accountStatus: result.accountStatus,
        })
        return
      }

      failures.push({
        campaignName: campaign.campaignName,
        message: result.message,
      })
    })

    return {
      successCount,
      failures,
      accountIssues,
      unauthorizedDetected,
    }
  }

  const openToggleStatusConfirm = (campaign: Campaign) => {
    const isDeleted = campaign.isDeleted === true || campaign.isDeleted === 1
    const offerDeleted = campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
    const googleCampaignId = campaign.campaignId || campaign.googleCampaignId

    if (isDeleted || offerDeleted) {
      showError('无法操作', '该广告系列已删除')
      return
    }

    if (!googleCampaignId) {
      showError('无法操作', '该广告系列尚未发布到Google Ads')
      return
    }

    if (campaign.adsAccountAvailable === false) {
      showError('无法操作', '关联的Ads账号不可用（可能已解绑或停用）')
      return
    }

    const currentStatus = String(campaign.status || '').toUpperCase()
    const nextStatus =
      currentStatus === 'ENABLED'
        ? 'PAUSED'
        : currentStatus === 'PAUSED'
          ? 'ENABLED'
          : null

    if (!nextStatus) {
      showError('无法操作', `当前状态(${campaign.status})不支持暂停/启用`)
      return
    }

    setToggleStatusTarget(campaign)
    setToggleStatusNextStatus(nextStatus)
    setIsToggleStatusDialogOpen(true)
  }

  const confirmToggleStatus = async () => {
    if (!toggleStatusTarget || !toggleStatusNextStatus) return
    const campaign = toggleStatusTarget
    const nextStatus = toggleStatusNextStatus

    setIsToggleStatusDialogOpen(false)
    setToggleStatusTarget(null)
    setToggleStatusNextStatus(null)

    await handleToggleStatus(campaign, nextStatus)
  }

  const openOfflineDialog = (campaign: Campaign) => {
    const isDeleted = campaign.isDeleted === true || campaign.isDeleted === 1
    const offerDeleted = campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
    const googleCampaignId = campaign.campaignId || campaign.googleCampaignId

    if (isDeleted || offerDeleted || String(campaign.status || '').toUpperCase() === 'REMOVED') {
      showError('无法操作', '该广告系列已下线/删除')
      return
    }

    if (!googleCampaignId) {
      showError('无法操作', '该广告系列尚未发布到Google Ads')
      return
    }

    if (campaign.adsAccountAvailable === false) {
      showError('无法操作', '关联的Ads账号不可用（可能已解绑或停用）')
      return
    }

    setOfflineTarget(campaign)
    setOfflineBlacklistOffer(false)
    setOfflinePauseClickFarm(false)
    setOfflinePauseUrlSwap(false)
    setOfflineRemoveGoogleAds(false)
    setIsOfflineDialogOpen(true)
  }

  const confirmOffline = async () => {
    if (!offlineTarget || offlineSubmitting) return
    const campaign = offlineTarget

    setOfflineSubmitting(true)
    setIsOfflineDialogOpen(false)
    let keepState = false

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          blacklistOffer: offlineBlacklistOffer,
          pauseClickFarmTasks: offlinePauseClickFarm,
          pauseUrlSwapTasks: offlinePauseUrlSwap,
          removeGoogleAdsCampaign: offlineRemoveGoogleAds,
        }),
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json().catch(() => null)
      if (response.status === 422 && data?.action === 'ACCOUNT_STATUS_NOT_USABLE') {
        setOfflineAccountIssueMessage(data?.message || '账号状态异常，无法在 Google Ads 中暂停广告系列。')
        const status = data?.details?.accountStatus
        setOfflineAccountIssueStatus(status ? String(status) : null)
        setIsOfflineAccountIssueDialogOpen(true)
        keepState = true
        return
      }
      if (!response.ok) {
        const message = data?.error || data?.message || '下线失败'
        showError('下线失败', message)
        return
      }

      const actionLabel = data?.googleAds?.action === 'REMOVE' ? '删除' : '暂停'
      const googleAdsNote = data?.googleAds?.queued
        ? `Google Ads ${actionLabel}处理已排队（计划处理 ${data.googleAds?.planned ?? 0} 个广告系列）`
        : data?.googleAds?.skippedReason
          ? `Google Ads 未同步：${data.googleAds.skippedReason}`
          : undefined

      showSuccess('已下线', googleAdsNote)
      await fetchCampaigns()
    } catch (err: any) {
      showError('下线失败', err?.message || '网络错误')
    } finally {
      setOfflineSubmitting(false)
      if (!keepState) {
        setOfflineTarget(null)
        setOfflineBlacklistOffer(false)
        setOfflinePauseClickFarm(false)
        setOfflinePauseUrlSwap(false)
        setOfflineRemoveGoogleAds(false)
        setOfflineAccountIssueMessage(null)
        setOfflineAccountIssueStatus(null)
      }
    }
  }

  const handleOpenBatchOfflineDialog = () => {
    if (!hasBatchOfflineSelection || batchOfflineSubmitting) return

    resetBatchOfflineState()
    setIsBatchOfflineDialogOpen(true)
  }

  const handleBatchOffline = async () => {
    if (selectedCampaignIds.size === 0 || batchOfflineSubmitting) return

    const selectedCampaigns = getSelectedCampaigns()
    if (selectedCampaigns.length === 0) {
      showError('批量下线失败', '未找到可操作的广告系列')
      return
    }

    setBatchOfflineSubmitting(true)
    setIsBatchOfflineDialogOpen(false)

    try {
      const execution = await executeBatchOffline(selectedCampaigns, {
        blacklistOffer: batchOfflineBlacklistOffer,
        pauseClickFarmTasks: batchOfflinePauseClickFarm,
        pauseUrlSwapTasks: batchOfflinePauseUrlSwap,
        removeGoogleAdsCampaign: batchOfflineRemoveGoogleAds,
      })

      if (execution.unauthorizedDetected) {
        return
      }

      await fetchCampaigns()

      if (execution.accountIssues.length > 0) {
        setBatchOfflinePendingState({
          totalCount: selectedCampaigns.length,
          successCount: execution.successCount,
          failures: execution.failures,
          accountIssues: execution.accountIssues,
        })
        setIsBatchOfflineAccountIssueDialogOpen(true)
        return
      }

      if (execution.failures.length > 0) {
        if (execution.successCount > 0) {
          showSuccess('批量下线部分成功', `已下线 ${execution.successCount} 个广告系列`)
        }
        const groupedSummary = buildBatchOfflineFailureSummary(execution.failures)
        showError(
          '批量下线失败',
          `${execution.failures.length}/${selectedCampaigns.length} 个广告系列下线失败：\n${groupedSummary}`
        )
        return
      }

      setSelectedCampaignIds(new Set())
      resetBatchOfflineState()
      showSuccess('批量下线成功', `已下线 ${selectedCampaigns.length} 个广告系列`)
    } catch (err: any) {
      showError('批量下线失败', err?.message || '网络错误')
    } finally {
      setBatchOfflineSubmitting(false)
    }
  }

  const confirmBatchOfflineLocalOnly = async () => {
    if (!batchOfflinePendingState || batchOfflineSubmitting) return

    const pendingState = batchOfflinePendingState
    const accountIssueCampaigns = pendingState.accountIssues.map((item) => item.campaign)

    if (accountIssueCampaigns.length === 0) {
      setIsBatchOfflineAccountIssueDialogOpen(false)
      resetBatchOfflineState()
      return
    }

    setBatchOfflineSubmitting(true)
    setIsBatchOfflineAccountIssueDialogOpen(false)

    try {
      const retry = await executeBatchOffline(accountIssueCampaigns, {
        forceLocalOffline: true,
        blacklistOffer: batchOfflineBlacklistOffer,
        pauseClickFarmTasks: batchOfflinePauseClickFarm,
        pauseUrlSwapTasks: batchOfflinePauseUrlSwap,
        removeGoogleAdsCampaign: batchOfflineRemoveGoogleAds,
      })

      if (retry.unauthorizedDetected) {
        return
      }

      const combinedFailures: BatchOfflineFailure[] = [...pendingState.failures, ...retry.failures]
      if (retry.accountIssues.length > 0) {
        retry.accountIssues.forEach((item) => {
          combinedFailures.push({
            campaignName: item.campaign.campaignName,
            message: item.message || '账号状态异常，且本地下线未完成',
          })
        })
      }

      const combinedSuccessCount = pendingState.successCount + retry.successCount

      await fetchCampaigns()

      if (combinedFailures.length > 0) {
        if (combinedSuccessCount > 0) {
          showSuccess('批量下线部分成功', `已下线 ${combinedSuccessCount} 个广告系列`)
        }
        const groupedSummary = buildBatchOfflineFailureSummary(combinedFailures)
        showError(
          '批量下线失败',
          `${combinedFailures.length}/${pendingState.totalCount} 个广告系列下线失败：\n${groupedSummary}`
        )
        return
      }

      setSelectedCampaignIds(new Set())
      showSuccess('批量下线成功', `已下线 ${combinedSuccessCount} 个广告系列`)
    } catch (err: any) {
      showError('批量下线失败', err?.message || '网络错误')
    } finally {
      setBatchOfflineSubmitting(false)
      resetBatchOfflineState()
    }
  }

  const confirmOfflineLocalOnly = async () => {
    if (!offlineTarget || offlineSubmitting) return
    const campaign = offlineTarget

    setOfflineSubmitting(true)
    setIsOfflineAccountIssueDialogOpen(false)

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          blacklistOffer: offlineBlacklistOffer,
          pauseClickFarmTasks: offlinePauseClickFarm,
          pauseUrlSwapTasks: offlinePauseUrlSwap,
          removeGoogleAdsCampaign: offlineRemoveGoogleAds,
          forceLocalOffline: true,
        }),
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const message = data?.error || data?.message || '本地下线失败'
        showError('本地下线失败', message)
        return
      }

      const googleAdsNote = data?.googleAds?.skippedReason
        ? `Google Ads 未同步：${data.googleAds.skippedReason}`
        : undefined

      showSuccess('已本地下线', googleAdsNote)
      await fetchCampaigns()
    } catch (err: any) {
      showError('本地下线失败', err?.message || '网络错误')
    } finally {
      setOfflineSubmitting(false)
      setOfflineTarget(null)
      setOfflineBlacklistOffer(false)
      setOfflinePauseClickFarm(false)
      setOfflinePauseUrlSwap(false)
      setOfflineRemoveGoogleAds(false)
      setOfflineAccountIssueMessage(null)
      setOfflineAccountIssueStatus(null)
    }
  }

  const handleToggleStatus = async (
    campaign: Campaign,
    nextStatusOverride?: 'PAUSED' | 'ENABLED'
  ) => {
    const isDeleted = campaign.isDeleted === true || campaign.isDeleted === 1
    const offerDeleted = campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
    const googleCampaignId = campaign.campaignId || campaign.googleCampaignId

    if (isDeleted || offerDeleted) {
      showError('无法操作', '该广告系列已删除')
      return
    }

    if (!googleCampaignId) {
      showError('无法操作', '该广告系列尚未发布到Google Ads')
      return
    }

    if (campaign.adsAccountAvailable === false) {
      showError('无法操作', '关联的Ads账号不可用（可能已解绑或停用）')
      return
    }

    const currentStatus = String(campaign.status || '').toUpperCase()
    if (currentStatus !== 'ENABLED' && currentStatus !== 'PAUSED') {
      showError('无法操作', `当前状态(${campaign.status})不支持暂停/启用`)
      return
    }

    const nextStatus = nextStatusOverride || (currentStatus === 'ENABLED' ? 'PAUSED' : 'ENABLED')

    setStatusUpdatingIds((prev) => {
      const next = new Set(prev)
      next.add(campaign.id)
      return next
    })

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/toggle-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus }),
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const message = data?.error || data?.message || '操作失败'
        if (data?.needsReauth) {
          showError('Google Ads 授权已过期', message)
        } else {
          showError('操作失败', message)
        }
        return
      }

      // 本地更新状态（避免整页重刷）
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaign.id
            ? { ...c, status: data?.status || nextStatus }
            : c
        )
      )

      showSuccess(nextStatus === 'PAUSED' ? '已暂停' : '已启用', campaign.campaignName)
    } catch (err: any) {
      showError('操作失败', err?.message || '网络错误')
    } finally {
      setStatusUpdatingIds((prev) => {
        const next = new Set(prev)
        next.delete(campaign.id)
        return next
      })
    }
  }

  // 获取当前页的广告系列
  const paginatedCampaigns = filteredCampaigns.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(paginatedCampaigns.map(c => c.id))
      setSelectedCampaignIds(allIds)
    } else {
      setSelectedCampaignIds(new Set())
    }
  }

  // 单选切换
  const handleSelectCampaign = (campaignId: number, checked: boolean) => {
    const newSelected = new Set(selectedCampaignIds)
    if (checked) {
      newSelected.add(campaignId)
    } else {
      newSelected.delete(campaignId)
    }
    setSelectedCampaignIds(newSelected)
  }

  const getStatusBadge = (status: string, adsAccountAvailable?: boolean) => {
    if (adsAccountAvailable === false) {
      return (
        <Badge variant="outline" className="flex items-center gap-1 w-fit border-orange-200 text-orange-800 bg-orange-50">
          <AlertCircle className="w-3 h-3" />
          账号已解绑
        </Badge>
      )
    }

    const configs = {
      ENABLED: { label: getCampaignStatusLabel('ENABLED'), variant: 'default' as const, icon: PlayCircle, className: 'bg-green-600 hover:bg-green-700' },
      PAUSED: { label: getCampaignStatusLabel('PAUSED'), variant: 'secondary' as const, icon: PauseCircle, className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' },
      REMOVED: { label: getCampaignStatusLabel('REMOVED'), variant: 'destructive' as const, icon: XCircle, className: '' },
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

  const getCreationStatusBadge = (creationStatus?: string, creationError?: string | null) => {
    const normalizedStatus = String(creationStatus || '').toLowerCase()
    const hasKnownStatus = ['draft', 'pending', 'synced', 'failed'].includes(normalizedStatus)
    const statusKey = (hasKnownStatus ? normalizedStatus : 'draft') as 'draft' | 'pending' | 'synced' | 'failed'
    const label = getCreationStatusLabel(statusKey)

    const configs = {
      draft: 'bg-slate-100 text-slate-700 border-slate-200',
      pending: 'bg-blue-50 text-blue-700 border-blue-200',
      synced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      failed: 'bg-red-50 text-red-700 border-red-200',
    } as const

    const className = configs[statusKey] || 'bg-gray-100 text-gray-700 border-gray-200'
    const title = statusKey === 'failed' && creationError
      ? `同步失败：${creationError}`
      : label

    return (
      <Badge variant="outline" className={`w-fit ${className}`} title={title}>
        {label}
      </Badge>
    )
  }

  // 排序处理函数
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // 如果点击的是当前排序字段，切换排序方向
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else if (sortDirection === 'desc') {
        setSortDirection(null)
        setSortField(null)
      } else {
        setSortDirection('asc')
      }
    } else {
      // 如果点击的是新字段，设置为升序
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // 可排序表头组件
  const SortableHeader = ({ field, children, className = '' }: { field: SortField; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field
    return (
      <TableHead className={`cursor-pointer select-none hover:bg-gray-50 ${className}`} onClick={() => handleSort(field)}>
        <div className="flex items-center gap-1">
          {children}
          {isActive ? (
            sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
          ) : (
            <ArrowUpDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </TableHead>
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
                {visibleCampaignCount}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              {/* 批量下线按钮 - 有选中项时显示 */}
              {hasBatchOfflineSelection && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleOpenBatchOfflineDialog}
                  disabled={batchOfflineSubmitting}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  {batchOfflineSubmitting
                    ? '批量下线中...'
                    : `批量下线 (${selectedCampaignIds.size})`}
                </Button>
              )}
              <Button onClick={() => router.push('/offers')}>
                创建广告系列
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Summary Statistics with comparison */}
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
                    {summary.changes?.impressions !== null && summary.changes?.impressions !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.impressions >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.impressions >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.impressions).toFixed(1)}% 环比
                      </p>
                    )}
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
                    {summary.changes?.clicks !== null && summary.changes?.clicks !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.clicks >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.clicks >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.clicks).toFixed(1)}% 环比
                      </p>
                    )}
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
                    <p className="text-sm font-medium text-gray-600">总佣金</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {formatMoney(Number(summary.totalCommission ?? summary.totalConversions) || 0)}
                    </p>
                    {summary.changes?.conversions !== null && summary.changes?.conversions !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.conversions >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.conversions >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.conversions).toFixed(1)}% 环比
                      </p>
                    )}
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
                      {summary?.currency === 'MIXED' && Array.isArray(summary.costs) && summary.costs.length > 0
                        ? formatMultiCurrency(summary.costs)
                        : formatCurrencyDashboard(
                            Number(summary?.totalCostUsd ?? 0),
                            String(summary?.currency || trendsCurrencyValue || defaultCurrency)
                          )}
                    </p>
                    {summary.changes?.cost !== null && summary.changes?.cost !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.cost <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.cost >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.cost).toFixed(1)}% 环比
                      </p>
                    )}
                  </div>
                  <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                    <Coins className="w-6 h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trends Charts - 分组展示 */}
        <div className="mb-6">
          {/* 统一的时间范围选择器 */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">性能趋势</h3>
            <div className="flex items-center gap-2">
              {trendsCurrencies.length > 1 && (
                <div className="flex items-center gap-2 ml-2 flex-nowrap">
                  <span className="text-sm text-gray-500 whitespace-nowrap shrink-0">币种</span>
                  <Select
                    value={trendsCurrencyValue}
                    onValueChange={(v) => {
                      setTrendsCurrency(v)
                      fetchCampaigns(v)
                      fetchTrends(v)
                    }}
                  >
                    <SelectTrigger className="h-8 w-[110px]">
                      <SelectValue placeholder="币种" />
                    </SelectTrigger>
                    <SelectContent>
                      {trendsCurrencies.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <span className="text-sm text-gray-500">时间范围:</span>
              <div className="flex gap-1">
                {[7, 30, 90].map((days) => (
                  <button
                    key={days}
                    onClick={() => setTimeRange(days.toString())}
                    className={`px-3 py-1 text-sm rounded-md transition-colors ${
                      timeRange === days.toString()
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {days}天
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
            {/* 流量趋势 - 2/5 (柱状图，双Y轴：展示在左轴，点击/佣金在右轴) */}
            <div className="lg:col-span-2">
              <TrendChart
                data={trendsData}
                metrics={[
                  { key: 'impressions', label: '展示', color: 'hsl(217, 91%, 60%)', yAxisId: 'left' },
                  { key: 'clicks', label: '点击', color: 'hsl(142, 76%, 36%)', yAxisId: 'right' },
                  { key: 'commission', label: '佣金', color: 'hsl(280, 87%, 65%)', yAxisId: 'right' },
                ]}
                title="流量趋势"
                description="展示(左轴) / 点击·佣金(右轴)"
                loading={trendsLoading}
                error={trendsError}
                onRetry={fetchTrends}
                height={220}
                hideTimeRangeSelector={true}
                chartType="bar"
                dualYAxis={true}
              />
            </div>

            {/* 成本趋势 - 2/5 (使用双Y轴：花费在左轴，CPC/CPA在右轴) */}
            <div className="lg:col-span-2">
              <TrendChart
                data={trendsData}
                metrics={[
                  { key: 'cost', label: '花费', color: 'hsl(25, 95%, 53%)', formatter: (v) => formatTrendsMoney(v), yAxisId: 'left' },
                  { key: 'avgCpc', label: 'CPC', color: 'hsl(45, 93%, 47%)', formatter: (v) => formatTrendsMoney(v), yAxisId: 'right' },
                  { key: 'costPerCommission', label: '费佣比', color: 'hsl(0, 84%, 60%)', formatter: (v) => `${Number(v || 0).toFixed(2)}x`, yAxisId: 'right' },
                ]}
                title="成本趋势"
                description="花费(左轴) / CPC·费佣比(右轴)"
                loading={trendsLoading}
                error={trendsError}
                onRetry={fetchTrends}
                height={220}
                hideTimeRangeSelector={true}
                dualYAxis={true}
              />
            </div>

            {/* 效率指标卡片 + 状态分布卡片 - 1/5 */}
            <div className="lg:col-span-1 flex flex-col gap-4">
              {/* 效率指标卡片 */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <h4 className="text-sm font-medium text-gray-600 mb-3">效率指标</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">平均CTR</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {trendsData.length > 0
                          ? `${(trendsData.reduce((sum, d) => sum + ((d.ctr as number) || 0), 0) / trendsData.length).toFixed(2)}%`
                          : '0.00%'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">平均CPC</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {trendsData.length > 0
                          ? formatTrendsMoney(trendsData.reduce((sum, d) => sum + ((d.avgCpc as number) || 0), 0) / trendsData.length)
                          : formatTrendsMoney(0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">平均费佣比</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {trendsData.length > 0
                          ? `${(trendsData.reduce((sum, d) => sum + ((d.costPerCommission as number) || 0), 0) / trendsData.length).toFixed(2)}x`
                          : '0.00x'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 状态分布卡片 */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <h4 className="text-sm font-medium text-gray-600 mb-3">广告系列状态</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                        <span className="text-xs text-gray-600">投放中</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {campaigns.filter(c => c.status === 'ENABLED').length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                        <span className="text-xs text-gray-600">已暂停</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {campaigns.filter(c => c.status === 'PAUSED').length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                        <span className="text-xs text-gray-600">已移除</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {campaigns.filter(c => c.status === 'REMOVED').length}
                      </span>
                    </div>
                    <div className="border-t pt-2 mt-2 flex justify-between items-center">
                      <span className="text-xs font-medium text-gray-700">总计</span>
                      <span className="text-sm font-bold text-gray-900">{campaigns.length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                  <SelectItem value="ENABLED">{getCampaignStatusLabel('ENABLED')}</SelectItem>
                  <SelectItem value="PAUSED">{getCampaignStatusLabel('PAUSED')}</SelectItem>
                  <SelectItem value="REMOVED">{getCampaignStatusLabel('REMOVED')}</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md bg-white">
                <Checkbox
                  id="show-deleted-campaigns"
                  checked={showDeletedCampaigns}
                  onCheckedChange={(checked) => setShowDeletedCampaigns(Boolean(checked))}
                  aria-label="显示已删除广告系列"
                />
                <label htmlFor="show-deleted-campaigns" className="text-sm text-gray-700">
                  显示已删除
                </label>
              </div>
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
              {activeCampaignCount === 0
                ? "您还没有创建任何广告系列，请前往Offer列表创建。"
                : "没有找到符合筛选条件的广告系列。"}
            </p>
            {activeCampaignCount === 0 && (
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
                      {/* 全选checkbox */}
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={
                            paginatedCampaigns.length > 0 &&
                            paginatedCampaigns.every((campaign) => selectedCampaignIds.has(campaign.id))
                          }
                          onCheckedChange={handleSelectAll}
                          aria-label="全选"
                        />
                      </TableHead>
                      <SortableHeader field="campaignName" className="w-[180px]">系列名称</SortableHeader>
                      <SortableHeader field="budgetAmount" className="w-[100px]">预算</SortableHeader>
                      <SortableHeader field="impressions" className="w-[100px]">展示</SortableHeader>
                      <SortableHeader field="clicks" className="w-[90px]">点击</SortableHeader>
                      <SortableHeader field="ctr" className="w-[90px]">点击率</SortableHeader>
                      <SortableHeader field="cpc" className="w-[90px]">CPC</SortableHeader>
                      <SortableHeader field="conversions" className="w-[90px]">佣金</SortableHeader>
                      <SortableHeader field="cost" className="w-[100px]">花费</SortableHeader>
                      <SortableHeader field="status" className="w-[110px]">投放状态</SortableHeader>
                      <TableHead className="w-[110px]">同步状态</TableHead>
                      <SortableHeader field="servingStartDate" className="w-[110px]">投放日期</SortableHeader>
                      <TableHead className="w-[140px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
	                  {paginatedCampaigns.map((campaign) => {
	                    // 🔧 检查是否已删除 (兼容PostgreSQL的boolean和SQLite的number)
	                    const isDeleted = isCampaignDeleted(campaign)
	                    const offerDeleted = isOfferDeleted(campaign)
	                    const googleCampaignId = getCampaignGoogleId(campaign)
                        const isStatusUpdating = statusUpdatingIds.has(campaign.id)
	                    const campaignCurrency = campaign.adsAccountCurrency || defaultCurrency

		                    return (
	                    <TableRow
                      key={campaign.id}
                      className={`hover:bg-gray-50/50 ${isDeleted || offerDeleted ? 'opacity-60 bg-gray-50' : ''}`}
                    >
                      {/* 选择checkbox */}
                      <TableCell>
                        <Checkbox
                          checked={selectedCampaignIds.has(campaign.id)}
                          onCheckedChange={(checked) => handleSelectCampaign(campaign.id, checked as boolean)}
                          aria-label={`选择 ${campaign.campaignName}`}
                          title="加入批量下线"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate max-w-[160px]" title={campaign.campaignName}>
                              {campaign.campaignName}
                            </div>
                            {campaign.campaignId && (
                              <div className="text-xs text-gray-500 font-mono mt-1 truncate max-w-[160px]" title={campaign.campaignId}>
                                ID: {campaign.campaignId}
                              </div>
                            )}
                          </div>
                          {/* 🔧 已删除标签 */}
                          {isDeleted && (
                            <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200 shrink-0">
                              已删除
                            </Badge>
                          )}
                          {offerDeleted && !isDeleted && (
                            <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 shrink-0">
                              Offer已删除
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatMoney(Number(campaign.budgetAmount) || 0, campaignCurrency)}
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
                          {(Number(campaign.performance?.ctr) || 0).toFixed(2)}%
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(campaign.performance?.cpcUsd) || 0, campaignCurrency)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(campaign.performance?.commission ?? campaign.performance?.conversions) || 0, campaignCurrency)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(campaign.performance?.costUsd) || 0, campaignCurrency)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(campaign.status, campaign.adsAccountAvailable)}
                      </TableCell>
                      <TableCell>
                        {getCreationStatusBadge(campaign.creationStatus, campaign.creationError)}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-900">
                          {campaign.servingStartDate || '-'}
                        </span>
                      </TableCell>
	                      <TableCell>
	                        <div className="flex items-center gap-1">
	                          {/* View Offer Detail */}
	                          <Button
	                            size="sm"
	                            variant="ghost"
	                            onClick={() => router.push(`/offers/${campaign.offerId}`)}
	                            className="text-green-600 hover:text-green-800"
	                            title="查看关联的Offer详情页"
	                          >
	                            <Package className="w-4 h-4" />
	                          </Button>

		                          {/* Adjust CPC */}
		                          <Button
		                            size="sm"
		                            variant="ghost"
	                            onClick={() => {
	                              if (!googleCampaignId) return
	                              if (campaign.adsAccountAvailable === false) return
	                              setAdjustCpcTarget({ googleCampaignId, campaignName: campaign.campaignName })
	                              setAdjustCpcOpen(true)
	                            }}
	                            disabled={!googleCampaignId || isDeleted || offerDeleted || campaign.adsAccountAvailable === false}
	                            className="text-indigo-600 hover:text-indigo-800"
	                            title={
	                              !googleCampaignId ? '该广告系列尚未发布到Google Ads，无法调整CPC'
	                              : (campaign.adsAccountAvailable === false) ? 'Ads账号已解绑，无法调整CPC'
	                                : '调整CPC出价'
	                            }
	                            aria-label={
	                              !googleCampaignId ? '该广告系列尚未发布到Google Ads，无法调整CPC'
	                            : (campaign.adsAccountAvailable === false) ? 'Ads账号已解绑，无法调整CPC'
	                                : '调整CPC出价'
	                            }
	                          >
		                            <Coins className="w-4 h-4" />
		                          </Button>

                          {/* Pause / Enable */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void openToggleStatusConfirm(campaign)}
                            disabled={
                              isStatusUpdating ||
                              !googleCampaignId ||
                              isDeleted ||
                              offerDeleted ||
                              campaign.adsAccountAvailable === false ||
                              (campaign.status !== 'ENABLED' && campaign.status !== 'PAUSED')
                            }
                            className={
                              campaign.status === 'ENABLED'
                                ? 'text-yellow-600 hover:text-yellow-800'
                                : 'text-green-600 hover:text-green-800'
                            }
                            title={
                              isStatusUpdating
                                ? '操作中...'
                                : !googleCampaignId
                                  ? '该广告系列尚未发布到Google Ads，无法暂停/启用'
                                  : (campaign.adsAccountAvailable === false)
                                    ? 'Ads账号已解绑，无法暂停/启用'
                                    : isDeleted
                                      ? '该广告系列已删除，无法暂停/启用'
                                      : offerDeleted
                                        ? '关联Offer已删除，无法暂停/启用'
                                        : (campaign.status !== 'ENABLED' && campaign.status !== 'PAUSED')
                                          ? `当前状态(${campaign.status})不支持暂停/启用`
                                          : (campaign.status === 'ENABLED')
                                            ? '暂停广告系列'
                                            : '启用广告系列'
                            }
                            aria-label={
                              isStatusUpdating
                                ? '操作中...'
                                : (campaign.status === 'ENABLED')
                                  ? '暂停广告系列'
                                  : '启用广告系列'
                            }
                          >
                            {isStatusUpdating ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              campaign.status === 'ENABLED'
                                ? <PauseCircle className="w-4 h-4" />
                                : <PlayCircle className="w-4 h-4" />
                            )}
                          </Button>

                          {/* Offline / Downline */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openOfflineDialog(campaign)}
                            disabled={
                              offlineSubmitting ||
                              !googleCampaignId ||
                              isDeleted ||
                              offerDeleted ||
                              campaign.adsAccountAvailable === false ||
                              String(campaign.status || '').toUpperCase() === 'REMOVED'
                            }
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title={
                              !googleCampaignId
                                ? '该广告系列尚未发布到Google Ads，无法下线'
                                : (campaign.adsAccountAvailable === false)
                                  ? 'Ads账号已解绑，无法下线'
                                  : isDeleted
                                    ? '该广告系列已删除，无法下线'
                                    : offerDeleted
                                      ? '关联Offer已删除，无法下线'
                                      : String(campaign.status || '').toUpperCase() === 'REMOVED'
                                        ? '该广告系列已下线'
                                        : '下线广告系列（不可恢复）'
                            }
                            aria-label="下线广告系列"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>

	                          {/* Delete Button */}
	                          {campaign.creationStatus === 'draft' && (
	                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openDeleteDraftDialog(campaign)}
                              disabled={deleteDraftSubmitting}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="删除草稿广告系列"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
              </div>
              {/* Pagination Controls - Bottom */}
              {filteredCampaigns.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-200">
                  <ResponsivePagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(filteredCampaigns.length / pageSize)}
                    totalItems={filteredCampaigns.length}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                    pageSizeOptions={[10, 20, 50, 100]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
	      </main>

	      {/* Adjust CPC Dialog */}
	      {adjustCpcTarget && (
	        <AdjustCampaignCpcDialog
	          open={adjustCpcOpen}
	          onOpenChange={(nextOpen: boolean) => {
	            setAdjustCpcOpen(nextOpen)
	            if (!nextOpen) setAdjustCpcTarget(null)
	          }}
	          googleCampaignId={adjustCpcTarget.googleCampaignId}
	          campaignName={adjustCpcTarget.campaignName}
	        />
	      )}

        {/* Toggle Status Confirmation Dialog */}
        <AlertDialog
          open={isToggleStatusDialogOpen}
          onOpenChange={(open) => {
            setIsToggleStatusDialogOpen(open)
            if (!open) {
              setToggleStatusTarget(null)
              setToggleStatusNextStatus(null)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {toggleStatusNextStatus === 'PAUSED' ? '确认暂停广告系列' : '确认启用广告系列'}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    确认要将广告系列{' '}
                    <strong className="text-gray-900">{toggleStatusTarget?.campaignName || '-'}</strong>{' '}
                    {toggleStatusNextStatus
                      ? `切换为「${getCampaignStatusLabel(toggleStatusNextStatus)}」吗？`
                      : '进行状态切换吗？'}
                  </p>

                  {toggleStatusNextStatus === 'PAUSED' ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                      <p className="font-medium mb-1">暂停后将会：</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>停止在 Google Ads 的投放</li>
                        <li>避免继续产生花费</li>
                        <li>可随时重新启用恢复投放</li>
                      </ul>
                    </div>
                  ) : (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                      <p className="font-medium mb-1">启用后将会：</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>恢复在 Google Ads 的投放</li>
                        <li>可能立即开始产生花费</li>
                        <li>请确认预算与出价设置无误</li>
                      </ul>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <Button
                onClick={() => void confirmToggleStatus()}
                className={
                  toggleStatusNextStatus === 'PAUSED'
                    ? 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-600'
                    : 'bg-green-600 hover:bg-green-700 focus:ring-green-600'
                }
              >
                {toggleStatusNextStatus === 'PAUSED' ? '确认暂停' : '确认启用'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      {/* Batch Offline Confirmation Dialog */}
      <AlertDialog
        open={isBatchOfflineDialogOpen}
        onOpenChange={(open) => {
          setIsBatchOfflineDialogOpen(open)
          if (!open && !batchOfflineSubmitting) {
            resetBatchOfflineState()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量下线广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要下线选中的{' '}
                  <strong className="text-gray-900">{selectedCampaignIds.size}</strong>{' '}
                  个广告系列吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">批量下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>逐个下线选中的广告系列</li>
                    <li>在 Google Ads 中暂停这些广告系列（可选删除）</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflineRemoveGoogleAds}
                    onCheckedChange={(checked) => setBatchOfflineRemoveGoogleAds(Boolean(checked))}
                    id="batch-offline-remove-google-ads"
                  />
                  <label htmlFor="batch-offline-remove-google-ads" className="text-sm text-gray-700">
                    同时在 Google Ads 中删除这些广告系列（不可恢复）
                  </label>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响对应 Offer
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflineBlacklistOffer}
                    onCheckedChange={(checked) => setBatchOfflineBlacklistOffer(Boolean(checked))}
                    id="batch-offline-blacklist-offer"
                  />
                  <label htmlFor="batch-offline-blacklist-offer" className="text-sm text-gray-700">
                    同时拉黑对应 Offer（品牌+国家组合）
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflinePauseClickFarm}
                    onCheckedChange={(checked) => setBatchOfflinePauseClickFarm(Boolean(checked))}
                    id="batch-offline-pause-click-farm"
                  />
                  <label htmlFor="batch-offline-pause-click-farm" className="text-sm text-gray-700">
                    同时暂停补点击任务
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflinePauseUrlSwap}
                    onCheckedChange={(checked) => setBatchOfflinePauseUrlSwap(Boolean(checked))}
                    id="batch-offline-pause-url-swap"
                  />
                  <label htmlFor="batch-offline-pause-url-swap" className="text-sm text-gray-700">
                    同时暂停换链接任务
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchOfflineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void handleBatchOffline()}
              disabled={batchOfflineSubmitting || selectedCampaignIds.size === 0}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchOfflineSubmitting ? '下线中...' : `确认批量下线 (${selectedCampaignIds.size})`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Offline Account Issue Dialog */}
      <AlertDialog
        open={isBatchOfflineAccountIssueDialogOpen}
        onOpenChange={(open) => {
          setIsBatchOfflineAccountIssueDialogOpen(open)
          if (!open && !batchOfflineSubmitting) {
            resetBatchOfflineState()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>部分账号状态异常</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  有{' '}
                  <strong className="text-gray-900">{batchOfflinePendingState?.accountIssues.length || 0}</strong>{' '}
                  个广告系列因 Ads 账号状态异常，无法在 Google Ads 中{batchOfflineRemoveGoogleAds ? '删除' : '暂停'}。
                </p>
                <p>
                  {batchOfflinePendingState?.accountIssues[0]?.message || '是否继续仅本地下线这些广告系列？'}
                </p>
                {batchOfflinePendingState && batchOfflinePendingState.accountIssues.length > 0 && (
                  <div className="text-sm text-gray-700">
                    示例广告系列：
                    <strong>{buildBatchAccountIssueSampleNames(batchOfflinePendingState.accountIssues)}</strong>
                  </div>
                )}
                {batchOfflinePendingState && buildBatchAccountStatusSummary(batchOfflinePendingState.accountIssues) && (
                  <div className="text-sm text-gray-700">
                    账号状态分布：
                    <strong>{buildBatchAccountStatusSummary(batchOfflinePendingState.accountIssues)}</strong>
                  </div>
                )}
                {batchOfflinePendingState && batchOfflinePendingState.failures.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    已有 {batchOfflinePendingState.failures.length} 个广告系列因其他原因下线失败，
                    将在本次完成后统一汇总提示。
                  </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                  <p className="font-medium mb-1">继续本地下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅在本地标记这些广告系列为已下线</li>
                    <li>无法保证 Google Ads 侧立即停止投放</li>
                    <li>请尽快登录 Google Ads 处理账号状态与广告系列</li>
                  </ul>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响对应 Offer
                </div>
                <div className="text-sm text-gray-700">
                  当前选择：
                  Google Ads 侧{batchOfflineRemoveGoogleAds ? '删除' : '暂停'}，
                  {batchOfflineBlacklistOffer ? '拉黑Offer' : '不拉黑Offer'}，
                  {batchOfflinePauseClickFarm ? '暂停补点击任务' : '不暂停补点击任务'}，
                  {batchOfflinePauseUrlSwap ? '暂停换链接任务' : '不暂停换链接任务'}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchOfflineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmBatchOfflineLocalOnly()}
              disabled={batchOfflineSubmitting || !batchOfflinePendingState}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchOfflineSubmitting ? '处理中...' : '仅本地下线异常项'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Draft Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDraftDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDraftDialogOpen(open)
          if (!open && !deleteDraftSubmitting) {
            setDeleteDraftTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除草稿广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要删除草稿广告系列{' '}
                  <strong className="text-gray-900">{deleteDraftTarget?.campaignName || '-'}</strong> 吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">删除后将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>永久删除该本地草稿广告系列</li>
                    <li>不会触发 Google Ads 侧投放变化</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDraftSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmDeleteDraft()}
              disabled={deleteDraftSubmitting || !deleteDraftTarget}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteDraftSubmitting ? '删除中...' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offline Confirmation Dialog */}
      <AlertDialog
        open={isOfflineDialogOpen}
        onOpenChange={(open) => {
          setIsOfflineDialogOpen(open)
          if (!open) {
            setOfflineTarget(null)
            setOfflineBlacklistOffer(false)
            setOfflinePauseClickFarm(false)
            setOfflinePauseUrlSwap(false)
            setOfflineRemoveGoogleAds(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认下线广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要下线广告系列{' '}
                  <strong className="text-gray-900">{offlineTarget?.campaignName || '-'}</strong> 吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>在 Google Ads 中暂停该广告系列（可选删除）</li>
                    <li>仅下线当前广告系列，不影响同 Offer 下其他广告系列</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlineRemoveGoogleAds}
                    onCheckedChange={(checked) => setOfflineRemoveGoogleAds(Boolean(checked))}
                    id="offline-remove-google-ads"
                  />
                  <label htmlFor="offline-remove-google-ads" className="text-sm text-gray-700">
                    同时在 Google Ads 中删除该广告系列（不可恢复）
                  </label>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响整个 Offer
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlineBlacklistOffer}
                    onCheckedChange={(checked) => setOfflineBlacklistOffer(Boolean(checked))}
                    id="offline-blacklist-offer"
                  />
                  <label htmlFor="offline-blacklist-offer" className="text-sm text-gray-700">
                    同时拉黑该 Offer（品牌+国家组合）
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlinePauseClickFarm}
                    onCheckedChange={(checked) => setOfflinePauseClickFarm(Boolean(checked))}
                    id="offline-pause-click-farm"
                  />
                  <label htmlFor="offline-pause-click-farm" className="text-sm text-gray-700">
                    同时暂停补点击任务
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlinePauseUrlSwap}
                    onCheckedChange={(checked) => setOfflinePauseUrlSwap(Boolean(checked))}
                    id="offline-pause-url-swap"
                  />
                  <label htmlFor="offline-pause-url-swap" className="text-sm text-gray-700">
                    同时暂停换链接任务
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={offlineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmOffline()}
              disabled={offlineSubmitting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {offlineSubmitting ? '下线中...' : '确认下线'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offline Account Issue Dialog */}
      <AlertDialog
        open={isOfflineAccountIssueDialogOpen}
        onOpenChange={(open) => {
          setIsOfflineAccountIssueDialogOpen(open)
          if (!open) {
            setOfflineAccountIssueMessage(null)
            setOfflineAccountIssueStatus(null)
            setOfflineTarget(null)
            setOfflineBlacklistOffer(false)
            setOfflinePauseClickFarm(false)
            setOfflinePauseUrlSwap(false)
            setOfflineRemoveGoogleAds(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>账号状态异常</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {offlineAccountIssueMessage || '当前 Ads 账号状态异常，无法在 Google Ads 中暂停/删除广告系列。'}
                </p>
                {offlineAccountIssueStatus && (
                  <div className="text-sm text-gray-700">
                    当前账号状态：<strong>{offlineAccountIssueStatus}</strong>
                  </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                  <p className="font-medium mb-1">继续本地下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅在本地标记该广告系列为已下线（不影响同 Offer 下其他广告系列）</li>
                    <li>无法保证 Google Ads 侧立即停止投放</li>
                    <li>请尽快登录 Google Ads 处理账号状态与广告系列</li>
                  </ul>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响整个 Offer
                </div>
                <div className="text-sm text-gray-700">
                  当前选择：
                  Google Ads 侧{offlineRemoveGoogleAds ? '删除' : '暂停'}，
                  {offlineBlacklistOffer ? '拉黑Offer' : '不拉黑Offer'}，
                  {offlinePauseClickFarm ? '暂停补点击任务' : '不暂停补点击任务'}，
                  {offlinePauseUrlSwap ? '暂停换链接任务' : '不暂停换链接任务'}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={offlineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmOfflineLocalOnly()}
              disabled={offlineSubmitting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {offlineSubmitting ? '处理中...' : '仅本地下线'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
