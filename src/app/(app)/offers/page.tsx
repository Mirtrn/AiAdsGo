'use client'

/**
 * Offer列表页 - P1-2优化版 + P2-2导出功能 + 分页 + 批量删除
 * 使用shadcn/ui Table组件 + 筛选器 + CSV导出
 *
 * 优化：使用usePagination Hook统一分页逻辑
 */

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { exportOffers, type OfferExportData } from '@/lib/export-utils'
import { fetchWithRetry } from '@/lib/api-error-handler'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import dynamic from 'next/dynamic'
import AdjustCpcModal from '@/components/AdjustCpcModal'
import { LaunchScoreModalDynamic } from '@/components/dynamic'
import CreateOfferModalV2 from '@/components/CreateOfferModalV2'
import DeleteOfferConfirmDialog from '@/components/DeleteOfferConfirmDialog'
import ClickFarmTaskModal from '@/components/ClickFarmTaskModal'
import UrlSwapTaskModal from '@/components/UrlSwapTaskModal'
import { SortableTableHead } from '@/components/SortableTableHead'
import { NoOffersState, NoResultsState } from '@/components/ui/empty-state'
import { usePagination } from '@/hooks'
import { Search, Plus, Rocket, DollarSign, BarChart3, ExternalLink, Download, Trash2, Unlink, MoreHorizontal, FileDown, Upload, XCircle, AlertTriangle, MousePointerClick, Link2, RotateCw, Wand2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { ResponsiveActionCell } from '@/components/ui/table-action-buttons'
import { getScrapeStatusLabel, type ScrapeStatus } from '@/lib/i18n-constants'
import { showError, showInfo, showSuccess } from '@/lib/toast-utils'
import type { OfferListItem, UnlinkTarget } from './types'

// 使用类型别名保持兼容性
type Offer = OfferListItem

export default function OffersPage() {
  const router = useRouter()
  const [offers, setOffers] = useState<Offer[]>([])
  const [filteredOffers, setFilteredOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const offersApiUrl = '/api/offers?noCache=true'
  const offersRef = useRef<Offer[]>([])

  useEffect(() => {
    offersRef.current = offers
  }, [offers])

  // P2-4: 移动端检测 - 已移除，统一使用表格视图
  // const isMobile = useIsMobile()

  // P1-2: 筛选器状态
  const [searchQuery, setSearchQuery] = useState('')
  const [countryFilter, setCountryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // P2-5: 排序状态
  const [sortBy, setSortBy] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const filterKeyRef = useRef<string>('')

  // 多选和批量删除状态
  const [selectedOfferIds, setSelectedOfferIds] = useState<Set<number>>(new Set())
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchDeleteError, setBatchDeleteError] = useState<string | null>(null)
  const [isBatchCreativeDialogOpen, setIsBatchCreativeDialogOpen] = useState(false)
  const [batchCreatingCreatives, setBatchCreatingCreatives] = useState(false)
  const MAX_BATCH_CREATIVE_OFFERS = 50

  // 分页状态 - 使用统一的usePagination Hook
  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    offset,
    getTotalPages,
    pageSizeOptions,
  } = usePagination({ initialPageSize: 10 })

  // 计算分页后的数据
  const paginatedOffers = useMemo(() => {
    return filteredOffers.slice(offset, offset + pageSize)
  }, [filteredOffers, offset, pageSize])

  // Modals
  const [isAdjustCpcModalOpen, setIsAdjustCpcModalOpen] = useState(false)
  const [selectedOfferForCpc, setSelectedOfferForCpc] = useState<Offer | null>(null)
  const [isLaunchScoreModalOpen, setIsLaunchScoreModalOpen] = useState(false)
  const [selectedOfferForScore, setSelectedOfferForScore] = useState<Offer | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [offerToDelete, setOfferToDelete] = useState<Offer | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // 补点击任务Modal
  const [isClickFarmModalOpen, setIsClickFarmModalOpen] = useState(false)
  const [selectedOfferForClickFarm, setSelectedOfferForClickFarm] = useState<Offer | null>(null)
  const [editTaskIdForClickFarm, setEditTaskIdForClickFarm] = useState<string | number | undefined>(undefined)
  const [clickFarmLoading, setClickFarmLoading] = useState(false)

  // 换链接任务Modal
  const [isUrlSwapModalOpen, setIsUrlSwapModalOpen] = useState(false)
  const [selectedOfferForUrlSwap, setSelectedOfferForUrlSwap] = useState<Offer | null>(null)
  const [editTaskIdForUrlSwap, setEditTaskIdForUrlSwap] = useState<string | undefined>(undefined)
  const [urlSwapLoading, setUrlSwapLoading] = useState(false)

  // 删除确认对话框状态（支持关联账号详情）
  const [isDeleteConfirmDialogOpen, setIsDeleteConfirmDialogOpen] = useState(false)
  const [deleteLinkedAccounts, setDeleteLinkedAccounts] = useState<any[]>([])
  const [deleteAccountCount, setDeleteAccountCount] = useState(0)
  const [deleteCampaignCount, setDeleteCampaignCount] = useState(0)

  // P1-11: 解除关联状态
  const [isUnlinkDialogOpen, setIsUnlinkDialogOpen] = useState(false)
  const [offerToUnlink, setOfferToUnlink] = useState<UnlinkTarget | null>(null)
  const [unlinking, setUnlinking] = useState(false)

  // 拉黑投放状态
  const [blacklisting, setBlacklisting] = useState(false)
  const [isBlacklistDialogOpen, setIsBlacklistDialogOpen] = useState(false)
  const [offerToBlacklist, setOfferToBlacklist] = useState<Offer | null>(null)

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = () => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }

  useEffect(() => {
    fetchOffers()

    // Poll for scraping status updates every 30 seconds (优化：减少轮询频率)
    const pollInterval = setInterval(async () => {
      try {
        // 先用普通fetch检查401（因为fetchWithRetry会包装错误响应）
        const checkResponse = await fetch(offersApiUrl, {
          credentials: 'include',
          cache: 'no-store',
        })

        // 处理401未授权 - 停止轮询并跳转登录页
        if (checkResponse.status === 401) {
          handleUnauthorized()
          return
        }

        // 如果不是401，使用fetchWithRetry获取数据
        const result = await fetchWithRetry(offersApiUrl, {
          credentials: 'include',
          cache: 'no-store',
        }, {
          maxRetries: 1,
          retryDelay: 2000,
          retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE']
        })

        if (!result.success) {
          return
        }

        const data = result.data
        const shouldUpdateOffers = (() => {
          if (data.offers.some((offer: Offer) => offer.scrapeStatus === 'in_progress')) {
            return true
          }
          const currentOffers = offersRef.current
          if (currentOffers.length !== data.offers.length) {
            return true
          }
          const currentById = new Map(currentOffers.map((offer) => [offer.id, offer]))
          for (const nextOffer of data.offers as Offer[]) {
            const currentOffer = currentById.get(nextOffer.id)
            if (!currentOffer) return true
            const currentLinked = currentOffer.linkedAccounts || []
            const nextLinked = nextOffer.linkedAccounts || []
            if (currentLinked.length !== nextLinked.length) return true
            const currentCustomerIds = currentLinked.map((a) => a.customerId).join(',')
            const nextCustomerIds = nextLinked.map((a) => a.customerId).join(',')
            if (currentCustomerIds !== nextCustomerIds) return true
          }
          return false
        })()

        // 有进行中的任务或关键字段变化时才更新（避免不必要的重渲染）
        if (shouldUpdateOffers) {
          console.log('[Polling] Updating offers list...')
          setOffers(data.offers)
          setFilteredOffers(data.offers)
        }
      } catch (error) {
        // 轮询错误静默处理，不影响用户体验
        console.error('[Polling] Error fetching offers:', error)
      }
    }, 30000) // Poll every 30 seconds (降低频率)

    return () => clearInterval(pollInterval)
  }, []) // 空依赖数组，只在组件挂载时执行一次

  // P1-2 + P2-5: 应用筛选器和排序
  useEffect(() => {
    let filtered = offers

    // 搜索筛选
    if (searchQuery) {
      filtered = filtered.filter(
        (offer) =>
          offer.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.offerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          offer.url.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // 国家筛选
    if (countryFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.targetCountry === countryFilter)
    }

    // 状态筛选
    if (statusFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.scrapeStatus === statusFilter)
    }

    // P2-5: 排序
    if (sortBy) {
      filtered = [...filtered].sort((a, b) => {
        // 特殊处理：关联账号数量排序
        if (sortBy === 'linkedAccounts') {
          const aCount = a.linkedAccounts?.length || 0
          const bCount = b.linkedAccounts?.length || 0
          return sortOrder === 'asc' ? aCount - bCount : bCount - aCount
        }

        const aVal = a[sortBy as keyof Offer]
        const bVal = b[sortBy as keyof Offer]

        if (aVal === null || aVal === undefined) return 1
        if (bVal === null || bVal === undefined) return -1

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortOrder === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal)
        }

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
        }

        return 0
      })
    }

    setFilteredOffers(filtered)

    const filterKey = JSON.stringify({ searchQuery, countryFilter, statusFilter, sortBy, sortOrder })
    const filtersChanged = filterKeyRef.current !== filterKey
    filterKeyRef.current = filterKey

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const nextPage = filtersChanged ? 1 : currentPage
    setPage(nextPage > totalPages ? totalPages : nextPage)
  }, [offers, searchQuery, countryFilter, statusFilter, sortBy, sortOrder, pageSize, currentPage, setPage])

  // P2-5: 排序处理函数
  const handleSort = (field: string) => {
    if (sortBy === field) {
      // 同一列：切换排序方向或取消排序
      if (sortOrder === 'desc') {
        setSortOrder('asc')
      } else {
        setSortBy('')
        setSortOrder('desc')
      }
    } else {
      // 新列：默认降序
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const fetchOffers = async () => {
    try {
      const response = await fetch(offersApiUrl, {
        credentials: 'include',
        cache: 'no-store', // 禁用 Next.js 自动缓存，确保获取最新数据
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        throw new Error('获取Offer列表失败')
      }

      const data = await response.json()
      setOffers(data.offers)
      setFilteredOffers(data.offers)
    } catch (err: any) {
      setError(err.message || '获取Offer列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteOffer = async (autoUnlink: boolean = false) => {
    if (!offerToDelete) return

    try {
      setDeleting(true)
      setDeleteError(null)

      // 构建URL，添加autoUnlink参数
      const url = new URL(`/api/offers/${offerToDelete.id}`, window.location.origin)
      if (autoUnlink) {
        url.searchParams.set('autoUnlink', 'true')
      }

      const response = await fetch(url.toString(), {
        method: 'DELETE',
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json()

      // 409状态码：有关联账号需要确认
      if (response.status === 409 && data.hasLinkedAccounts) {
        // 关闭简单删除对话框，打开关联账号详情对话框
        setIsDeleteDialogOpen(false)
        setDeleteLinkedAccounts(data.linkedAccounts || [])
        setDeleteAccountCount(data.accountCount || 0)
        setDeleteCampaignCount(data.campaignCount || 0)
        setIsDeleteConfirmDialogOpen(true)
        return
      }

      if (!response.ok) {
        // 在对话框内显示错误，不关闭对话框
        setDeleteError(data.error || '删除Offer失败')
        return
      }

      // 刷新列表
      await fetchOffers()

      // 关闭所有对话框
      setIsDeleteDialogOpen(false)
      setIsDeleteConfirmDialogOpen(false)
      setOfferToDelete(null)
      setDeleteError(null)
      setDeleteLinkedAccounts([])
      setDeleteAccountCount(0)
      setDeleteCampaignCount(0)
    } catch (err: any) {
      setDeleteError(err.message || '删除Offer失败')
    } finally {
      setDeleting(false)
    }
  }

  // 批量删除处理函数
  const handleBatchDelete = async () => {
    if (selectedOfferIds.size === 0) return

    try {
      setBatchDeleting(true)
      setBatchDeleteError(null)

      // 并行删除所有选中的offers
      const deletePromises = Array.from(selectedOfferIds).map(async (id) => {
        const response = await fetch(`/api/offers/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        })

        // 处理401未授权 - 跳转到登录页
        if (response.status === 401) {
          handleUnauthorized()
          throw new Error('UNAUTHORIZED')
        }

        const data = await response.json()
        return { id, response, data }
      })

      const results = await Promise.allSettled(deletePromises)

      // 检查是否有401错误
      const hasUnauthorized = results.some(
        (r) => r.status === 'fulfilled' && r.value.response.status === 401
      )
      if (hasUnauthorized) {
        return // handleUnauthorized 已经在循环中调用
      }

      // 收集所有错误（包括HTTP错误响应和网络错误）
      const errors: string[] = []

      results.forEach((result) => {
        if (result.status === 'rejected') {
          // 跳过401错误（已经在循环中处理）
          if (result.reason?.message === 'UNAUTHORIZED') return
          // 网络错误等
          errors.push(result.reason?.message || '网络错误')
        } else if (result.status === 'fulfilled') {
          const { response, data, id } = result.value
          if (!response.ok) {
            // HTTP错误响应（如409 Conflict）
            const offerInfo = offers.find(o => o.id === id)?.brand || `ID:${id}`
            errors.push(`${offerInfo}: ${data.error || '删除失败'}`)
          }
        }
      })

      if (errors.length > 0) {
        // 在对话框内显示错误，不关闭对话框
        setBatchDeleteError(`${errors.length}/${selectedOfferIds.size} 个Offer删除失败：\n${errors.join('\n')}`)
        // 刷新列表以显示成功删除的结果
        await fetchOffers()
        return
      }

      // 全部删除成功
      await fetchOffers()

      // 清空选中状态
      setSelectedOfferIds(new Set())

      // 关闭对话框
      setIsBatchDeleteDialogOpen(false)
      setBatchDeleteError(null)
    } catch (err: any) {
      setBatchDeleteError(err.message || '批量删除失败')
    } finally {
      setBatchDeleting(false)
    }
  }

  // 批量创建广告创意处理函数（每个Offer生成下一步类型，最多1个/Offer）
  const handleBatchCreateCreatives = async () => {
    const offerIds = Array.from(selectedOfferIds)
    if (offerIds.length === 0) return

    if (offerIds.length > MAX_BATCH_CREATIVE_OFFERS) {
      showError('选择数量超限', `单次最多支持${MAX_BATCH_CREATIVE_OFFERS}个Offer`)
      return
    }

    try {
      setBatchCreatingCreatives(true)

      const response = await fetch('/api/offers/batch/generate-creatives-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ offerIds }),
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = {}
      }

      if (!response.ok) {
        const message = data?.message || data?.error || '批量创建广告创意失败'
        const details = data?.details && typeof data.details === 'string' ? data.details : undefined
        showError('批量创建失败', details ? `${message}\n${details}` : message)
        return
      }

      const enqueuedCount = Number(data?.enqueuedCount || 0)
      const skippedCount = Number(data?.skippedCount || 0)
      const failedCount = Number(data?.failedCount || 0)
      const summaryParts = [`已入队 ${enqueuedCount} 个`]
      if (skippedCount > 0) summaryParts.push(`跳过 ${skippedCount} 个`)
      if (failedCount > 0) summaryParts.push(`失败 ${failedCount} 个`)

      showSuccess('已提交批量生成任务', summaryParts.join('，'))
      setIsBatchCreativeDialogOpen(false)
    } catch (err: any) {
      showError('批量创建失败', err?.message || '网络错误')
    } finally {
      setBatchCreatingCreatives(false)
    }
  }

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(paginatedOffers.map(o => o.id))
      setSelectedOfferIds(allIds)
    } else {
      setSelectedOfferIds(new Set())
    }
  }

  // 单选切换
  const handleSelectOffer = (offerId: number, checked: boolean) => {
    const newSelected = new Set(selectedOfferIds)
    if (checked) {
      newSelected.add(offerId)
    } else {
      newSelected.delete(offerId)
    }
    setSelectedOfferIds(newSelected)
  }

  // 计算总页数
  const totalPages = Math.ceil(filteredOffers.length / pageSize)

  // P1-11: 解除关联处理函数
  const handleUnlinkAccount = async () => {
    if (!offerToUnlink) return

    try {
      setUnlinking(true)
      const response = await fetch(`/api/offers/${offerToUnlink.offer.id}/unlink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          accountId: offerToUnlink.accountId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '解除关联失败')
      }

      // 刷新列表
      await fetchOffers()

      // 关闭对话框
      setIsUnlinkDialogOpen(false)
      setOfferToUnlink(null)
    } catch (err: any) {
      setError(err.message || '解除关联失败')
    } finally {
      setUnlinking(false)
    }
  }

  // 拉黑/取消拉黑处理函数
  const handleToggleBlacklist = async () => {
    if (!offerToBlacklist) return

    try {
      setBlacklisting(true)
      const method = offerToBlacklist.isBlacklisted ? 'DELETE' : 'POST'
      const response = await fetch(`/api/offers/${offerToBlacklist.id}/blacklist`, {
        method,
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `${offerToBlacklist.isBlacklisted ? '取消拉黑' : '拉黑投放'}失败`)
      }

      // 刷新列表
      await fetchOffers()

      // 关闭对话框
      setIsBlacklistDialogOpen(false)
      setOfferToBlacklist(null)
    } catch (err: any) {
      setError(err.message || `${offerToBlacklist.isBlacklisted ? '取消拉黑' : '拉黑投放'}失败`)
    } finally {
      setBlacklisting(false)
    }
  }

  const getScrapeStatusBadge = (status: string) => {
    const configs = {
      pending: { label: getScrapeStatusLabel('pending'), variant: 'secondary' as const, className: 'text-gray-500' },
      in_progress: { label: getScrapeStatusLabel('in_progress'), variant: 'default' as const, className: 'bg-blue-600' },
      completed: { label: getScrapeStatusLabel('completed'), variant: 'outline' as const, className: 'bg-green-50 text-green-700 border-green-200' },
      failed: { label: getScrapeStatusLabel('failed'), variant: 'destructive' as const, className: '' },
    }
    const config = configs[status as keyof typeof configs] || { label: status, variant: 'outline' as const, className: '' }
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>
  }

  // 获取唯一国家列表
  const uniqueCountries = Array.from(new Set(offers.map((o) => o.targetCountry)))

  // P2-2: 导出Offer数据
  const handleExport = () => {
    const exportData: OfferExportData[] = offers.map((offer) => ({
      id: offer.id,
      offerName: offer.offerName || `${offer.brand}_${offer.targetCountry}_01`,
      brand: offer.brand,
      targetCountry: offer.targetCountry,
      targetLanguage: offer.targetLanguage || 'English',
      url: offer.url,
      affiliateLink: offer.affiliateLink,
      scrapeStatus: offer.scrapeStatus,
      isActive: offer.isActive,
      createdAt: offer.createdAt,
    }))
    exportOffers(exportData)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 sm:h-16 gap-3 sm:gap-0">
              <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-8 w-32" />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
          </div>
        </div>
        <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-32 w-full mb-6" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header - P2-4移动端优化 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 sm:h-16 gap-3 sm:gap-0">
            {/* 左侧标题区 */}
            <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/dashboard')}
                className="flex-shrink-0"
              >
                ← 返回Dashboard
              </Button>
              <h1 className="page-title">Offer管理</h1>
              <Badge variant="outline" className="text-caption sm:text-body-sm">
                {offers.length}
              </Badge>
            </div>

            {/* 右侧操作按钮 */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {/* 批量操作按钮 - 有选中项时显示 */}
              {selectedOfferIds.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsBatchCreativeDialogOpen(true)}
                    disabled={batchCreatingCreatives || selectedOfferIds.size > MAX_BATCH_CREATIVE_OFFERS}
                    className="flex-shrink-0"
                    title={
                      selectedOfferIds.size > MAX_BATCH_CREATIVE_OFFERS
                        ? `单次最多支持${MAX_BATCH_CREATIVE_OFFERS}个Offer`
                        : '为每个Offer生成下一步创意类型（A→B→D），每次最多1个/Offer'
                    }
                  >
                    <Wand2 className="w-4 h-4 mr-2" />
                    批量创建广告创意 ({selectedOfferIds.size})
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsBatchDeleteDialogOpen(true)}
                    className="flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    删除 ({selectedOfferIds.size})
                  </Button>
                </>
              )}

              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex-1 sm:flex-none"
              >
                <Plus className="w-4 h-4 mr-2" />
                创建
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden sm:flex">
                    <MoreHorizontal className="w-4 h-4 mr-2" />
                    更多操作
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExport} disabled={offers.length === 0}>
                    <Download className="w-4 h-4 mr-2" />
                    导出Offer
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.open('/api/offers/batch-template')}>
                    <FileDown className="w-4 h-4 mr-2" />
                    下载模板
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/offers/batch')}>
                    <Upload className="w-4 h-4 mr-2" />
                    导入Offer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 移动端显示的简化按钮 */}
              <div className="flex sm:hidden w-full gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/offers/batch')}
                  className="flex-1"
                >
                  导入
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={offers.length === 0}
                  className="flex-1"
                >
                  导出
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* P1-2 + P2-4: 筛选器（移动端优化） */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* 搜索框 */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="搜索品牌名称、Offer标识、URL..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* 筛选器组 */}
              <div className="flex gap-3 overflow-x-auto pb-1 lg:pb-0">
                {/* 国家筛选 */}
                <Select value={countryFilter} onValueChange={setCountryFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="所有国家" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">所有国家</SelectItem>
                    {uniqueCountries.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* 状态筛选 */}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="所有状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">所有状态</SelectItem>
                    <SelectItem value="pending">{getScrapeStatusLabel('pending')}</SelectItem>
                    <SelectItem value="in_progress">{getScrapeStatusLabel('in_progress')}</SelectItem>
                    <SelectItem value="completed">{getScrapeStatusLabel('completed')}</SelectItem>
                    <SelectItem value="failed">{getScrapeStatusLabel('failed')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 筛选结果提示 */}
            {(searchQuery || countryFilter !== 'all' || statusFilter !== 'all') && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-body-sm text-muted-foreground">
                  显示 {filteredOffers.length} / {offers.length} 个Offer
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setCountryFilter('all')
                    setStatusFilter('all')
                  }}
                >
                  清除筛选
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* P2-7: 统一空状态 */}
        {filteredOffers.length === 0 ? (
          offers.length === 0 ? (
            <NoOffersState onAction={() => setIsCreateModalOpen(true)} />
          ) : (
            <NoResultsState />
          )
        ) : (
          /* 统一使用表格视图 */
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* 全选checkbox */}
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={paginatedOffers.length > 0 && paginatedOffers.every(o => selectedOfferIds.has(o.id))}
                          onCheckedChange={handleSelectAll}
                          aria-label="全选"
                        />
                      </TableHead>
                      {/* Offer ID */}
                      <TableHead className="w-[80px] whitespace-nowrap">
                        Offer ID
                      </TableHead>
                      <SortableTableHead
                        field="offerName"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[200px]"
                      >
                        产品标识
                      </SortableTableHead>
                      <SortableTableHead
                        field="brand"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                      >
                        品牌信息
                      </SortableTableHead>
                      <SortableTableHead
                        field="targetCountry"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[110px] whitespace-nowrap"
                      >
                        推广国家
                      </SortableTableHead>
                      <SortableTableHead
                        field="targetLanguage"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[100px] whitespace-nowrap"
                      >
                        语言
                      </SortableTableHead>
                      <SortableTableHead
                        field="scrapeStatus"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[120px] whitespace-nowrap"
                      >
                        状态
                      </SortableTableHead>
                      <SortableTableHead
                        field="linkedAccounts"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="whitespace-nowrap"
                      >
                        关联Ads账号
                      </SortableTableHead>
                      <TableHead className="whitespace-nowrap">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedOffers.map((offer, index) => (
                      <TableRow
                        key={offer.id}
                        className={`hover:bg-gray-50/50 ${offer.isBlacklisted ? 'bg-gray-100' : ''}`}
                      >
                        {/* 选择checkbox */}
                        <TableCell>
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <Checkbox
                              checked={selectedOfferIds.has(offer.id)}
                              onCheckedChange={(checked) => handleSelectOffer(offer.id, checked as boolean)}
                              aria-label={`选择 ${offer.brand}`}
                            />
                          </div>
                        </TableCell>
                        {/* Offer ID */}
                        <TableCell className="font-mono text-body-sm text-gray-600">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {offer.id}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <div className="flex items-center gap-2">
                              <a
                                href={`/offers/${offer.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-2"
                              >
                                {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              {offer.isBlacklisted && (
                                <span title="该品牌+国家组合已拉黑投放">
                                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <div>
                              <div className="font-medium text-gray-900">{offer.brand}</div>
                              <div className="text-body-sm text-muted-foreground truncate max-w-[200px]" title={offer.url}>
                                {offer.url}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            <Badge variant="outline">{offer.targetCountry}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-body-sm text-muted-foreground">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {offer.targetLanguage || 'English'}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {getScrapeStatusBadge(offer.scrapeStatus)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={offer.isBlacklisted ? 'opacity-50' : ''}>
                            {/* P1-11: 显示关联的Google Ads账号（只显示非MCC账号） */}
                            {offer.linkedAccounts && offer.linkedAccounts.length > 0 ? (
                              <div className="space-y-1">
                                {/* 🔧 修复(2025-12-11): snake_case → camelCase */}
                                {offer.linkedAccounts.map((account, idx) => (
                                  <div key={idx} className="flex items-center gap-1.5 text-xs">
                                    <span className="text-gray-700 font-mono">
                                      {account.customerId}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setOfferToUnlink({
                                          offer,
                                          accountId: account.accountId,
                                          accountName: account.customerId
                                        })
                                        setIsUnlinkDialogOpen(true)
                                      }}
                                      className="text-gray-400 hover:text-red-600 transition-colors"
                                      title="解除关联"
                                    >
                                      <Unlink className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-caption text-gray-300">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <ResponsiveActionCell
                            primaryAction={{
                              icon: <Rocket className="w-3.5 h-3.5" />,
                              label: '发布广告',
                              href: `/offers/${offer.id}/launch`,  // 🔥 2026-01-05: 使用href打开新标签页
                              target: '_blank',
                              disabled: offer.scrapeStatus !== 'completed',
                              title: offer.scrapeStatus !== 'completed' ? '请等待数据抓取完成' : undefined,
                            }}
                            secondaryActions={[
                              {
                                icon: <DollarSign className="w-4 h-4 text-gray-500" />,
                                label: '调整CPC',
                                onClick: () => {
                                  setSelectedOfferForCpc(offer)
                                  setIsAdjustCpcModalOpen(true)
                                },
                                disabled: !offer.linkedAccounts || offer.linkedAccounts.length === 0,
                                title: !offer.linkedAccounts || offer.linkedAccounts.length === 0
                                  ? '请先发布广告并关联Ads账号'
                                  : undefined,
                              },
                              {
                                icon: <BarChart3 className="w-4 h-4 text-gray-500" />,
                                label: '投放分析',
                                onClick: () => {
                                  setSelectedOfferForScore(offer)
                                  setIsLaunchScoreModalOpen(true)
                                },
                              },
                              {
                                icon: <MousePointerClick className="w-4 h-4 text-gray-500" />,
                                label: '补点击任务',
                                onClick: async () => {
                                  setClickFarmLoading(true)
                                  try {
                                    // 先查询是否有已存在的补点击任务
                                    const response = await fetch(`/api/offers/${offer.id}/click-farm-task`, {
                                      credentials: 'include',
                                    })

                                    if (response.ok) {
                                      const data = await response.json()
                                      if (data.data) {
                                        setSelectedOfferForClickFarm(offer)
                                        if (isEditableClickFarmStatus(data.data.status)) {
                                          // 有可编辑任务，进入编辑模式
                                          setEditTaskIdForClickFarm(data.data.id)
                                        } else {
                                          // 任务不可编辑（如已完成），进入创建模式
                                          setEditTaskIdForClickFarm(undefined)
                                          showInfo(
                                            `当前任务状态为 ${formatClickFarmStatus(data.data.status)}，已进入创建新任务。` +
                                            '如需继续当前任务，请前往补点击管理页面'
                                          )
                                        }
                                      } else {
                                        // 没有任务，进入创建模式
                                        setSelectedOfferForClickFarm(offer)
                                        setEditTaskIdForClickFarm(undefined)
                                      }
                                      setIsClickFarmModalOpen(true)
                                    } else {
                                      console.error('查询补点击任务失败')
                                      // 出错时默认进入创建模式
                                      setSelectedOfferForClickFarm(offer)
                                      setEditTaskIdForClickFarm(undefined)
                                      setIsClickFarmModalOpen(true)
                                    }
                                  } catch (error) {
                                    console.error('查询补点击任务出错:', error)
                                    setSelectedOfferForClickFarm(offer)
                                    setEditTaskIdForClickFarm(undefined)
                                    setIsClickFarmModalOpen(true)
                                  } finally {
                                    setClickFarmLoading(false)
                                  }
                                },
                                disabled: clickFarmLoading,
                              },
                              {
                                icon: <Link2 className="w-4 h-4 text-gray-500" />,
                                label: '换链接任务',
                                onClick: async () => {
                                  setUrlSwapLoading(true)
                                  try {
                                    // 先查询是否有已存在的换链接任务
                                    const response = await fetch(`/api/offers/${offer.id}/url-swap-task`, {
                                      credentials: 'include',
                                    })

                                    if (response.ok) {
                                      const data = await response.json()
                                      if (data.data) {
                                        // 有任务，进入编辑模式
                                        setSelectedOfferForUrlSwap(offer)
                                        setEditTaskIdForUrlSwap(data.data.id)
                                      } else {
                                        // 没有任务，进入创建模式
                                        setSelectedOfferForUrlSwap(offer)
                                        setEditTaskIdForUrlSwap(undefined)
                                      }
                                      setIsUrlSwapModalOpen(true)
                                    } else {
                                      console.error('查询换链接任务失败')
                                      // 出错时默认进入创建模式
                                      setSelectedOfferForUrlSwap(offer)
                                      setEditTaskIdForUrlSwap(undefined)
                                      setIsUrlSwapModalOpen(true)
                                    }
                                  } catch (error) {
                                    console.error('查询换链接任务出错:', error)
                                    setSelectedOfferForUrlSwap(offer)
                                    setEditTaskIdForUrlSwap(undefined)
                                    setIsUrlSwapModalOpen(true)
                                  } finally {
                                    setUrlSwapLoading(false)
                                  }
                                },
                                disabled: urlSwapLoading || !offer.linkedAccounts?.length,
                              },
                              {
                                icon: <XCircle className="w-4 h-4" />,
                                label: offer.isBlacklisted ? '取消拉黑' : '拉黑投放',
                                onClick: () => {
                                  setOfferToBlacklist(offer)
                                  setIsBlacklistDialogOpen(true)
                                },
                                disabled: blacklisting,
                                variant: offer.isBlacklisted ? 'secondary' : 'ghost',
                                className: offer.isBlacklisted ? 'text-green-600' : 'text-orange-600',
                              },
                              {
                                icon: <Trash2 className="w-4 h-4" />,
                                label: '删除Offer',
                                onClick: () => {
                                  setOfferToDelete(offer)
                                  setIsDeleteDialogOpen(true)
                                },
                                variant: 'ghost',
                                className: 'text-red-600',
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 分页组件 */}
              {totalPages > 0 && (
                <div className="px-6 py-4 border-t">
                  <ResponsivePagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={filteredOffers.length}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    pageSizeOptions={pageSizeOptions}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Modals */}
      {selectedOfferForCpc && (
        <AdjustCpcModal
          isOpen={isAdjustCpcModalOpen}
          onClose={() => {
            setIsAdjustCpcModalOpen(false)
            setSelectedOfferForCpc(null)
          }}
          offer={selectedOfferForCpc as any}
        />
      )}

      {selectedOfferForScore && (
        <LaunchScoreModalDynamic
          isOpen={isLaunchScoreModalOpen}
          onClose={() => {
            setIsLaunchScoreModalOpen(false)
            setSelectedOfferForScore(null)
          }}
          offer={selectedOfferForScore as any}
        />
      )}

      {/* 补点击任务Modal */}
      <ClickFarmTaskModal
        open={isClickFarmModalOpen}
        onOpenChange={(open) => {
          setIsClickFarmModalOpen(open)
          if (!open) {
            setSelectedOfferForClickFarm(null)
            setEditTaskIdForClickFarm(undefined)
          }
        }}
        onSuccess={() => {
          // 任务创建/更新成功后可以选择刷新列表或显示提示
        }}
        preSelectedOfferId={selectedOfferForClickFarm?.id}
        editTaskId={editTaskIdForClickFarm}
      />

      <UrlSwapTaskModal
        open={isUrlSwapModalOpen}
        onOpenChange={(open) => {
          setIsUrlSwapModalOpen(open)
          if (!open) {
            setSelectedOfferForUrlSwap(null)
            setEditTaskIdForUrlSwap(undefined)
          }
        }}
        onSuccess={() => {
          // 任务创建/更新成功后可以选择刷新列表或显示提示
        }}
        offerId={selectedOfferForUrlSwap?.id}
        editTaskId={editTaskIdForUrlSwap}
      />

      <CreateOfferModalV2
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={fetchOffers}
      />

      {/* P1-11: Unlink Account Confirmation Dialog */}
      <AlertDialog open={isUnlinkDialogOpen} onOpenChange={setIsUnlinkDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认解除关联</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                您确定要解除 <strong className="text-gray-900">{offerToUnlink?.offer.brand}</strong> 与账号 <strong className="text-gray-900">{offerToUnlink?.accountName}</strong> 的关联吗？
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-body-sm text-blue-800">
                <p className="font-medium mb-1">ℹ️ 解除关联将会：</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>删除此账号下所有与该Offer相关的广告系列</li>
                  <li>广告投放将立即停止</li>
                  <li>历史数据会保留用于查看</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinking}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnlinkAccount}
              disabled={unlinking}
              className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-600"
            >
              {unlinking ? '解除中...' : '确认解除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* P1-10: Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
        setIsDeleteDialogOpen(open)
        if (!open) setDeleteError(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除Offer</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要删除 <strong className="text-gray-900">{offerToDelete?.brand}</strong> 的Offer吗？
                </p>
                {/* 删除错误提示 */}
                {deleteError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-body-sm text-red-800">
                    <p className="font-medium mb-1">删除失败</p>
                    <p>{deleteError}</p>
                  </div>
                )}
                {!deleteError && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-body-sm text-yellow-800">
                    <p className="font-medium mb-1">⚠️ 重要提示：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>已删除的Offer历史数据会保留在系统中</li>
                      <li>系统会自动暂停该Offer关联的已启用广告系列（Google Ads），避免继续花费</li>
                      <li>关联的Google Ads账号会自动解除关联</li>
                      <li>此操作不可撤销</li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} onClick={() => setDeleteError(null)}>取消</AlertDialogCancel>
            <Button
              onClick={() => handleDeleteOffer()}
              disabled={deleting}
              variant="destructive"
            >
              {deleting ? '删除中...' : deleteError ? '重试删除' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Offer Confirm Dialog (with linked accounts details) */}
      <DeleteOfferConfirmDialog
        open={isDeleteConfirmDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteConfirmDialogOpen(open)
          if (!open) {
            setDeleteLinkedAccounts([])
            setDeleteAccountCount(0)
            setDeleteCampaignCount(0)
            setDeleteError(null)
          }
        }}
        offerName={offerToDelete?.offerName || offerToDelete?.brand || ''}
        linkedAccounts={deleteLinkedAccounts}
        accountCount={deleteAccountCount}
        campaignCount={deleteCampaignCount}
        onConfirmDelete={handleDeleteOffer}
        deleting={deleting}
      />

      {/* Batch Delete Confirmation Dialog */}
      <AlertDialog open={isBatchDeleteDialogOpen} onOpenChange={(open) => {
        setIsBatchDeleteDialogOpen(open)
        if (!open) setBatchDeleteError(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>您确定要删除选中的 <strong className="text-gray-900">{selectedOfferIds.size}</strong> 个Offer吗？</p>
                {/* 批量删除错误提示 */}
                {batchDeleteError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-body-sm text-red-800">
                    <p className="font-medium mb-1">部分删除失败</p>
                    <p className="whitespace-pre-line">{batchDeleteError}</p>
                  </div>
                )}
                {!batchDeleteError && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-body-sm text-yellow-800">
                    <p className="font-medium mb-1">⚠️ 重要提示：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>已删除的Offer历史数据会保留在系统中</li>
                      <li>系统会自动暂停各Offer关联的已启用广告系列（Google Ads），避免继续花费</li>
                      <li>关联的Google Ads账号会自动解除关联</li>
                      <li>此操作不可撤销</li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchDeleting} onClick={() => setBatchDeleteError(null)}>取消</AlertDialogCancel>
            <Button
              onClick={handleBatchDelete}
              disabled={batchDeleting}
              variant="destructive"
            >
              {batchDeleting ? '删除中...' : batchDeleteError ? '重试删除' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Creative Generation Confirmation Dialog */}
      <AlertDialog open={isBatchCreativeDialogOpen} onOpenChange={setIsBatchCreativeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量创建广告创意</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  将为选中的 <strong className="text-gray-900">{selectedOfferIds.size}</strong> 个Offer提交创意生成任务：
                  每个Offer仅创建 <strong className="text-gray-900">1</strong> 个创意，生成下一步类型（A→B→D）。
                </p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-body-sm text-gray-700">
                  <p className="font-medium mb-1">跳过规则：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Offer未完成抓取（pending/in_progress/failed）</li>
                    <li>该Offer已存在生成中的任务（pending/running）</li>
                    <li>该Offer已生成满3种类型创意（A/B/D）</li>
                  </ul>
                </div>
                {selectedOfferIds.size > MAX_BATCH_CREATIVE_OFFERS && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-body-sm text-red-800">
                    单次最多支持 <strong>{MAX_BATCH_CREATIVE_OFFERS}</strong> 个Offer，请减少选择后再提交。
                  </div>
                )}
                <div className="text-body-sm text-gray-500">
                  提交后无需等待执行结果，可稍后进入对应Offer的发布流程查看生成进度。
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchCreatingCreatives}>取消</AlertDialogCancel>
            <Button
              onClick={handleBatchCreateCreatives}
              disabled={
                batchCreatingCreatives ||
                selectedOfferIds.size === 0 ||
                selectedOfferIds.size > MAX_BATCH_CREATIVE_OFFERS
              }
            >
              {batchCreatingCreatives ? '提交中...' : '确认提交'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Blacklist Confirmation Dialog */}
      <AlertDialog open={isBlacklistDialogOpen} onOpenChange={setIsBlacklistDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {offerToBlacklist?.isBlacklisted ? '确认取消拉黑' : '确认拉黑投放'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要{offerToBlacklist?.isBlacklisted ? '取消拉黑' : '拉黑'} <strong className="text-gray-900">{offerToBlacklist?.brand}</strong> ({offerToBlacklist?.targetCountry}) 吗？
                </p>
                {!offerToBlacklist?.isBlacklisted && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-body-sm text-orange-800">
                    <p className="font-medium mb-1">⚠️ 拉黑后：</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>该品牌+国家组合将被标记为拉黑状态</li>
                      <li>创建相同品牌+国家的新Offer时会显示风险提示</li>
                      <li>可随时取消拉黑状态</li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={blacklisting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleToggleBlacklist}
              disabled={blacklisting}
              className={offerToBlacklist?.isBlacklisted ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'}
            >
              {blacklisting ? '处理中...' : offerToBlacklist?.isBlacklisted ? '确认取消拉黑' : '确认拉黑'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
const isEditableClickFarmStatus = (status?: string) => (
  status === 'pending' || status === 'running'
)

const formatClickFarmStatus = (status?: string) => {
  switch (status) {
    case 'pending':
      return '待开始'
    case 'running':
      return '运行中'
    case 'paused':
      return '已暂停'
    case 'stopped':
      return '已停止'
    case 'completed':
      return '已完成'
    default:
      return status || '未知'
  }
}
