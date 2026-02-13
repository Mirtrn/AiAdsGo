'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { SortableTableHead } from '@/components/SortableTableHead'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { NoDataState, NoResultsState } from '@/components/ui/empty-state'
import { showError, showSuccess } from '@/lib/toast-utils'
import {
  ArrowLeft,
  ArrowUpRight,
  ShieldOff,
  CheckCircle2,
  Clock3,
  XCircle,
  Link2,
  ExternalLink,
  Link,
  Loader2,
  Package,
  Plus,
  PowerOff,
  RefreshCw,
  Search,
  AlertCircle,
  Info,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type ProductPlatform = 'yeahpromos' | 'partnerboost'
type LandingPageType = 'amazon_product' | 'amazon_store' | 'independent_product' | 'independent_store' | 'unknown'
type SortOrder = 'asc' | 'desc'
type SortField =
  | 'serial'
  | 'platform'
  | 'mid'
  | 'asin'
  | 'allowedCountries'
  | 'priceAmount'
  | 'commissionRate'
  | 'commissionAmount'
  | 'reviewCount'
  | 'promoLink'
  | 'relatedOfferCount'
  | 'updatedAt'

type ProductListItem = {
  id: number
  serial: number
  platform: ProductPlatform
  mid: string
  asin: string | null
  landingPageType: LandingPageType
  brand: string | null
  productName: string | null
  productUrl: string | null
  allowedCountries: string[]
  priceAmount: number | null
  priceCurrency: string | null
  commissionRate: number | null
  commissionRateMode: 'percent' | 'amount'
  commissionAmount: number | null
  commissionCurrency: string | null
  reviewCount: number | null
  promoLink: string | null
  shortPromoLink: string | null
  relatedOfferCount: number
  isBlacklisted: boolean
  lastSyncedAt: string | null
  updatedAt: string
}

type ProductListResponse = {
  success: boolean
  items: ProductListItem[]
  total: number
  productsWithLinkCount: number
  page: number
  pageSize: number
}

type SyncRunItem = {
  id: number
  platform: ProductPlatform
  mode: 'platform' | 'single'
  status: 'queued' | 'running' | 'completed' | 'failed' | string
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  error_message: string | null
  completed_at: string | null
  created_at: string
}

type BatchRow = {
  productId: number
  linkType: '单品'
  promoLink: string
  targetCountry: string
  availableCountries: string[]
  productPrice: string
  commissionRate: string
}

type NumericRangeFilters = {
  reviewCountMin: number | null
  reviewCountMax: number | null
  priceAmountMin: number | null
  priceAmountMax: number | null
  commissionRateMin: number | null
  commissionRateMax: number | null
  commissionAmountMin: number | null
  commissionAmountMax: number | null
}

type NumericRangeFilterDrafts = Record<keyof NumericRangeFilters, string>

const PLATFORM_LABEL: Record<ProductPlatform, string> = {
  yeahpromos: 'YeahPromos',
  partnerboost: 'PartnerBoost',
}

const PLATFORM_SHORT_LABEL: Record<ProductPlatform, string> = {
  yeahpromos: 'YP',
  partnerboost: 'PB',
}

const LANDING_PAGE_TYPE_LABEL: Record<LandingPageType, string> = {
  amazon_product: '亚马逊商品',
  amazon_store: '亚马逊店铺',
  independent_product: '独立站商品',
  independent_store: '独立站店铺',
  unknown: '未知',
}

const EMPTY_NUMERIC_RANGE_FILTERS: NumericRangeFilters = {
  reviewCountMin: null,
  reviewCountMax: null,
  priceAmountMin: null,
  priceAmountMax: null,
  commissionRateMin: null,
  commissionRateMax: null,
  commissionAmountMin: null,
  commissionAmountMax: null,
}

const EMPTY_NUMERIC_RANGE_FILTER_DRAFTS: NumericRangeFilterDrafts = {
  reviewCountMin: '',
  reviewCountMax: '',
  priceAmountMin: '',
  priceAmountMax: '',
  commissionRateMin: '',
  commissionRateMax: '',
  commissionAmountMin: '',
  commissionAmountMax: '',
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return '-'
  if (!currency) return `${amount}`
  return `${currency.toUpperCase()} ${amount}`
}

function formatPercent(rate: number | null): string {
  if (rate === null || rate === undefined) return '-'
  return `${rate}%`
}

function formatReviewCount(count: number | null): string {
  if (count === null || count === undefined) return '-'
  return String(count)
}

function resolveDisplayCurrency(product: ProductListItem): string | null {
  const normalizedCommissionCurrency = String(product.commissionCurrency || '').trim()
  if (normalizedCommissionCurrency) return normalizedCommissionCurrency

  const normalizedPriceCurrency = String(product.priceCurrency || '').trim()
  if (normalizedPriceCurrency) return normalizedPriceCurrency

  return null
}


function normalizeCountries(countries: string[]): string[] {
  const deduped = new Set<string>()
  for (const code of countries || []) {
    const normalized = String(code || '').trim().toUpperCase()
    if (!normalized) continue
    deduped.add(normalized)
  }
  return Array.from(deduped)
}

function defaultCountryFromProduct(product: ProductListItem): string {
  const countries = normalizeCountries(product.allowedCountries)
  if (countries.includes('US')) return 'US'
  return countries[0] || 'US'
}

function safeOpenExternal(url?: string | null): void {
  if (!url) return
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
  } catch {
    // ignore invalid url
  }
}

function resolveMidTargetUrl(product: ProductListItem): string | null {
  const productUrl = String(product.productUrl || '').trim()
  if (productUrl) return productUrl

  const shortPromoLink = String(product.shortPromoLink || '').trim()
  if (shortPromoLink) return shortPromoLink

  const promoLink = String(product.promoLink || '').trim()
  if (promoLink) return promoLink

  return null
}

function getSyncRunBadgeVariant(status: SyncRunItem['status']): 'default' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default'
  if (status === 'failed') return 'destructive'
  return 'outline'
}

function getSyncRunStatusIcon(status: SyncRunItem['status']) {
  if (status === 'completed') return CheckCircle2
  if (status === 'failed') return AlertCircle
  return Clock3
}

function toBoolValue(value: boolean | 'indeterminate'): boolean {
  return value === true
}

function parseNumericRangeInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function buildNumericRangeFiltersFromDraft(drafts: NumericRangeFilterDrafts): NumericRangeFilters {
  return {
    reviewCountMin: parseNumericRangeInput(drafts.reviewCountMin),
    reviewCountMax: parseNumericRangeInput(drafts.reviewCountMax),
    priceAmountMin: parseNumericRangeInput(drafts.priceAmountMin),
    priceAmountMax: parseNumericRangeInput(drafts.priceAmountMax),
    commissionRateMin: parseNumericRangeInput(drafts.commissionRateMin),
    commissionRateMax: parseNumericRangeInput(drafts.commissionRateMax),
    commissionAmountMin: parseNumericRangeInput(drafts.commissionAmountMin),
    commissionAmountMax: parseNumericRangeInput(drafts.commissionAmountMax),
  }
}

function isNumericRangeFiltersEqual(a: NumericRangeFilters, b: NumericRangeFilters): boolean {
  return (
    a.reviewCountMin === b.reviewCountMin
    && a.reviewCountMax === b.reviewCountMax
    && a.priceAmountMin === b.priceAmountMin
    && a.priceAmountMax === b.priceAmountMax
    && a.commissionRateMin === b.commissionRateMin
    && a.commissionRateMax === b.commissionRateMax
    && a.commissionAmountMin === b.commissionAmountMin
    && a.commissionAmountMax === b.commissionAmountMax
  )
}

export default function ProductsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ProductListItem[]>([])
  const [total, setTotal] = useState(0)
  const [productsWithLinkCount, setProductsWithLinkCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchText, setSearchText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'all' | ProductPlatform>('all')
  const [numericRangeDrafts, setNumericRangeDrafts] = useState<NumericRangeFilterDrafts>({
    ...EMPTY_NUMERIC_RANGE_FILTER_DRAFTS,
  })
  const [numericRangeFilters, setNumericRangeFilters] = useState<NumericRangeFilters>({
    ...EMPTY_NUMERIC_RANGE_FILTERS,
  })
  const [sortBy, setSortBy] = useState<SortField>('serial')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set())

  const [syncingPlatform, setSyncingPlatform] = useState<ProductPlatform | null>(null)
  const [latestRuns, setLatestRuns] = useState<SyncRunItem[]>([])
  const [syncingProductId, setSyncingProductId] = useState<number | null>(null)
  const [creatingOfferId, setCreatingOfferId] = useState<number | null>(null)
  const [offliningProductId, setOffliningProductId] = useState<number | null>(null)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchOfflining, setBatchOfflining] = useState(false)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [singleOfflineDialogOpen, setSingleOfflineDialogOpen] = useState(false)
  const [batchOfflineDialogOpen, setBatchOfflineDialogOpen] = useState(false)
  const [createOfferDialogOpen, setCreateOfferDialogOpen] = useState(false)
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)

  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [offlineProduct, setOfflineProduct] = useState<ProductListItem | null>(null)
  const [pendingCreateOfferProduct, setPendingCreateOfferProduct] = useState<ProductListItem | null>(null)
  const [runPollingTick, setRunPollingTick] = useState(0)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const selectedProducts = useMemo(() => {
    const selected = new Set(selectedProductIds)
    return items.filter((item) => selected.has(item.id))
  }, [items, selectedProductIds])

  const creatableSelectedProducts = useMemo(
    () => selectedProducts.filter((item) => !item.isBlacklisted),
    [selectedProducts]
  )

  const canBatchCreate = creatableSelectedProducts.length > 0
  const canBatchOffline = selectedProducts.length > 0
  const hasFilters = searchQuery.length > 0
    || platformFilter !== 'all'
    || Object.values(numericRangeFilters).some((value) => value !== null)

  const numericRangeFilterCards: Array<{
    label: string
    minKey: keyof NumericRangeFilterDrafts
    maxKey: keyof NumericRangeFilterDrafts
    minPlaceholder: string
    maxPlaceholder: string
  }> = [
    {
      label: '商品评论数',
      minKey: 'reviewCountMin',
      maxKey: 'reviewCountMax',
      minPlaceholder: '最小值',
      maxPlaceholder: '最大值',
    },
    {
      label: '商品价格',
      minKey: 'priceAmountMin',
      maxKey: 'priceAmountMax',
      minPlaceholder: '最低价',
      maxPlaceholder: '最高价',
    },
    {
      label: '佣金比例(%)',
      minKey: 'commissionRateMin',
      maxKey: 'commissionRateMax',
      minPlaceholder: '最小比例',
      maxPlaceholder: '最大比例',
    },
    {
      label: '佣金金额',
      minKey: 'commissionAmountMin',
      maxKey: 'commissionAmountMax',
      minPlaceholder: '最小金额',
      maxPlaceholder: '最大金额',
    },
  ]

  const stats = useMemo(() => {
    const activeSyncRuns = latestRuns.filter((run) => run.status === 'queued' || run.status === 'running').length
    const blacklistedCount = items.filter((item) => item.isBlacklisted).length

    return {
      activeSyncRuns,
      blacklistedCount,
    }
  }, [items, latestRuns])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchText.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextFilters = buildNumericRangeFiltersFromDraft(numericRangeDrafts)
      if (isNumericRangeFiltersEqual(nextFilters, numericRangeFilters)) {
        return
      }
      setNumericRangeFilters(nextFilters)
      setPage(1)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [numericRangeDrafts, numericRangeFilters])

  const fetchProducts = async (forceNoCache: boolean = false) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)
      if (searchQuery) params.set('search', searchQuery)
      if (platformFilter !== 'all') params.set('platform', platformFilter)

      const numericRangeParams: Array<[string, number | null]> = [
        ['reviewCountMin', numericRangeFilters.reviewCountMin],
        ['reviewCountMax', numericRangeFilters.reviewCountMax],
        ['priceAmountMin', numericRangeFilters.priceAmountMin],
        ['priceAmountMax', numericRangeFilters.priceAmountMax],
        ['commissionRateMin', numericRangeFilters.commissionRateMin],
        ['commissionRateMax', numericRangeFilters.commissionRateMax],
        ['commissionAmountMin', numericRangeFilters.commissionAmountMin],
        ['commissionAmountMax', numericRangeFilters.commissionAmountMax],
      ]
      for (const [key, value] of numericRangeParams) {
        if (value === null) continue
        params.set(key, String(value))
      }

      if (forceNoCache) params.set('noCache', 'true')

      const response = await fetch(`/api/products?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      })

      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json() as ProductListResponse
      if (!response.ok || !data.success) {
        throw new Error((data as any)?.error || '加载商品列表失败')
      }

      setItems(data.items || [])
      setTotal(data.total || 0)
      setProductsWithLinkCount(Number(data.productsWithLinkCount || 0))

      setSelectedProductIds((prev) => {
        if (prev.size === 0) return prev
        const available = new Set((data.items || []).map((item) => item.id))
        const next = new Set<number>()
        prev.forEach((id) => {
          if (available.has(id)) next.add(id)
        })
        return next
      })
    } catch (error: any) {
      showError('加载失败', error?.message || '加载商品列表失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchSyncRuns = async () => {
    try {
      const response = await fetch('/api/products/sync-runs?limit=8', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) return
      const data = await response.json() as { success?: boolean; runs?: SyncRunItem[] }
      if (!data.success) return
      setLatestRuns(data.runs || [])
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchProducts()
    fetchSyncRuns()
  }, [page, pageSize, searchQuery, platformFilter, numericRangeFilters, sortBy, sortOrder])

  useEffect(() => {
    fetchSyncRuns()
  }, [runPollingTick])

  useEffect(() => {
    const hasActiveRuns = latestRuns.some((run) => run.status === 'queued' || run.status === 'running')
    if (!hasActiveRuns) return

    const timer = window.setInterval(() => {
      setRunPollingTick((prev) => prev + 1)
      fetchProducts(true)
    }, 8000)

    return () => window.clearInterval(timer)
  }, [latestRuns])

  const handleSort = (field: string) => {
    const target = field as SortField
    if (sortBy === target) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
      return
    }
    setSortBy(target)
    setSortOrder('desc')
  }

  const updateNumericRangeDraft = (key: keyof NumericRangeFilterDrafts, value: string) => {
    setNumericRangeDrafts((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedProductIds(new Set())
      return
    }
    setSelectedProductIds(new Set(items.map((item) => item.id)))
  }

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const handlePlatformSync = async (platform: ProductPlatform) => {
    if (syncingPlatform) return
    setSyncingPlatform(platform)
    try {
      const response = await fetch(`/api/products/sync/${platform}`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data?.code === 'CONFIG_REQUIRED') {
          showError('请先配置平台', data?.error || '请先前往OpenClaw配置联盟参数')
          router.push(data?.redirect || '/openclaw')
          return
        }
        throw new Error(data?.error || '提交同步任务失败')
      }

      showSuccess('任务已提交', `${PLATFORM_LABEL[platform]} 商品同步已加入队列`)
      setTimeout(() => {
        fetchProducts(true)
        fetchSyncRuns()
      }, 1200)
    } catch (error: any) {
      showError('提交失败', error?.message || '提交同步任务失败')
    } finally {
      setSyncingPlatform(null)
    }
  }

  const handleProductSync = async (product: ProductListItem) => {
    if (syncingProductId) return
    setSyncingProductId(product.id)
    try {
      const response = await fetch(`/api/products/${product.id}/sync`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data?.code === 'CONFIG_REQUIRED') {
          showError('请先配置平台', data?.error || '请先前往OpenClaw配置联盟参数')
          router.push(data?.redirect || '/openclaw')
          return
        }
        throw new Error(data?.error || '提交单商品同步失败')
      }

      showSuccess('任务已提交', '单商品同步已加入队列')
      setTimeout(() => {
        fetchProducts(true)
        fetchSyncRuns()
      }, 1000)
    } catch (error: any) {
      showError('提交失败', error?.message || '提交单商品同步失败')
    } finally {
      setSyncingProductId(null)
    }
  }

  const handleCreateOffer = async (product: ProductListItem, targetCountry?: string): Promise<boolean> => {
    setCreatingOfferId(product.id)
    try {
      const response = await fetch(`/api/products/${product.id}/create-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetCountry }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '创建Offer失败')
      }

      if (data?.taskId) {
        showSuccess('创建成功', `Offer #${data.offerId} 已创建并加入完整处理队列`)
      } else {
        showSuccess('创建成功', `Offer #${data.offerId} 已创建`)
      }
      fetchProducts(true)
      return true
    } catch (error: any) {
      showError('创建失败', error?.message || '创建Offer失败')
      return false
    } finally {
      setCreatingOfferId(null)
    }
  }

  const openCreateOfferDialog = (product: ProductListItem) => {
    if (creatingOfferId !== null || !product.promoLink || product.isBlacklisted) return
    setPendingCreateOfferProduct(product)
    setCreateOfferDialogOpen(true)
  }

  const submitCreateOffer = async () => {
    if (!pendingCreateOfferProduct || creatingOfferId !== null) return

    const created = await handleCreateOffer(pendingCreateOfferProduct)
    if (created) {
      setCreateOfferDialogOpen(false)
      setPendingCreateOfferProduct(null)
    }
  }

  const openSingleOfflineDialog = (product: ProductListItem) => {
    if (offliningProductId !== null || product.isBlacklisted) return
    setOfflineProduct(product)
    setSingleOfflineDialogOpen(true)
  }

  const submitSingleOffline = async () => {
    if (!offlineProduct || offliningProductId !== null) return

    setOffliningProductId(offlineProduct.id)
    try {
      const response = await fetch(`/api/products/${offlineProduct.id}/offline`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || '下线商品失败')
      }

      showSuccess('商品已下线', `已删除 ${data?.deletedOfferCount || 0} 个关联Offer`)
      setSingleOfflineDialogOpen(false)
      setOfflineProduct(null)
      setSelectedProductIds((prev) => {
        const next = new Set(prev)
        next.delete(offlineProduct.id)
        return next
      })
      fetchProducts(true)
    } catch (error: any) {
      showError('下线失败', error?.message || '下线商品失败')
    } finally {
      setOffliningProductId(null)
    }
  }

  const openBatchOfflineConfirm = () => {
    if (!canBatchOffline || batchOfflining) return
    setBatchOfflineDialogOpen(true)
  }

  const submitBatchOffline = async () => {
    if (!canBatchOffline || batchOfflining) return

    setBatchOfflining(true)
    try {
      const response = await fetch('/api/products/batch-offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          productIds: selectedProducts.map((item) => item.id),
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '批量下线商品失败')
      }

      const total = Number(data?.total || 0)
      const successCount = Number(data?.successCount || 0)
      const failureCount = Number(data?.failureCount || 0)

      showSuccess('批量下线完成', `成功 ${successCount} / ${total}`)
      if (failureCount > 0) {
        showError('部分商品下线失败', `${failureCount} 个商品下线失败，请稍后重试`)
      }

      const failedIds = new Set<number>(
        Array.isArray(data?.results)
          ? data.results.filter((item: any) => !item?.success).map((item: any) => Number(item?.productId)).filter((id: number) => Number.isFinite(id) && id > 0)
          : []
      )

      setSelectedProductIds(failedIds)
      setBatchOfflineDialogOpen(false)
      fetchProducts(true)
    } catch (error: any) {
      showError('批量下线失败', error?.message || '批量下线商品失败')
    } finally {
      setBatchOfflining(false)
    }
  }

  const openBatchDialog = () => {
    if (!canBatchCreate) return
    const rows: BatchRow[] = creatableSelectedProducts.map((product) => {
      const displayCurrency = resolveDisplayCurrency(product)

      return {
        productId: product.id,
        linkType: '单品',
        promoLink: product.promoLink || '',
        targetCountry: defaultCountryFromProduct(product),
        availableCountries: normalizeCountries(product.allowedCountries),
        productPrice: formatCurrency(product.priceAmount, product.priceCurrency || displayCurrency),
        commissionRate: product.commissionRateMode === 'amount'
          ? formatCurrency(product.commissionRate, displayCurrency)
          : formatPercent(product.commissionRate),
      }
    })
    setBatchRows(rows)
    setBatchDialogOpen(true)
  }

  const openClearAllDialog = () => {
    if (clearingAll) return
    setClearAllConfirmOpen(true)
  }

  const submitClearAll = async () => {
    if (clearingAll) return

    setClearingAll(true)
    try {
      const response = await fetch('/api/products/clear', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || '清空商品失败')
      }

      const deletedCount = Number(data?.deletedCount || 0)
      showSuccess('清空完成', `已清空 ${deletedCount} 条商品数据`)

      setClearAllConfirmOpen(false)
      setSelectedProductIds(new Set())
      setPage(1)
      await fetchProducts(true)
      await fetchSyncRuns()
    } catch (error: any) {
      showError('清空失败', error?.message || '清空商品失败')
    } finally {
      setClearingAll(false)
    }
  }

  const updateBatchRowCountry = (productId: number, country: string) => {
    setBatchRows((prev) => prev.map((row) => {
      if (row.productId !== productId) return row
      return { ...row, targetCountry: country }
    }))
  }

  const submitBatchCreate = async () => {
    if (batchRows.length === 0 || batchCreating) return

    setBatchCreating(true)
    try {
      const payload = {
        items: batchRows.map((row) => ({
          productId: row.productId,
          targetCountry: row.targetCountry,
        })),
      }

      const response = await fetch('/api/products/batch-create-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '批量创建Offer失败')
      }

      const queuedCount = Array.isArray(data?.results)
        ? data.results.filter((item: any) => item?.success && item?.taskId).length
        : 0

      showSuccess(
        '批量创建完成',
        queuedCount > 0
          ? `成功 ${data.successCount} / ${data.total}，已入队完整流程 ${queuedCount} 条`
          : `成功 ${data.successCount} / ${data.total}`
      )
      setBatchDialogOpen(false)
      setSelectedProductIds(new Set())
      fetchProducts(true)
    } catch (error: any) {
      showError('批量创建失败', error?.message || '批量创建Offer失败')
    } finally {
      setBatchCreating(false)
    }
  }

  const renderProductTable = () => (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="table-fixed min-w-[1500px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[42px] whitespace-nowrap">
              <Checkbox
                checked={items.length > 0 && items.every((item) => selectedProductIds.has(item.id))}
                onCheckedChange={(value) => handleSelectAll(toBoolValue(value))}
                aria-label="全选"
              />
            </TableHead>
            <SortableTableHead field="serial" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[78px] whitespace-nowrap">
              记录ID
            </SortableTableHead>
            <SortableTableHead field="platform" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[96px] whitespace-nowrap">
              联盟平台
            </SortableTableHead>
            <SortableTableHead field="mid" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[150px] whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                平台商品ID
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex items-center text-muted-foreground"
                        onClick={(event) => event.stopPropagation()}
                        aria-label="平台商品ID说明"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs leading-5">
                      <div>PB: product_id（联盟平台商品ID）</div>
                      <div>YP: mid / advert_id（联盟商家ID）</div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            </SortableTableHead>
            <SortableTableHead field="asin" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[122px] whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                ASIN
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex items-center text-muted-foreground"
                        onClick={(event) => event.stopPropagation()}
                        aria-label="ASIN说明"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs leading-5">
                      <div>Amazon 商品唯一标识</div>
                      <div>PB: 通常有值；YP: 通常为空</div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            </SortableTableHead>
            <TableHead className="w-[118px] whitespace-nowrap">落地页类型</TableHead>
            <SortableTableHead field="reviewCount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[114px] whitespace-nowrap">
              商品评论数
            </SortableTableHead>
            <SortableTableHead field="allowedCountries" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[128px] whitespace-nowrap">
              允许投放国家
            </SortableTableHead>
            <SortableTableHead field="priceAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[108px] whitespace-nowrap">
              商品价格
            </SortableTableHead>
            <SortableTableHead field="commissionRate" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[104px] whitespace-nowrap">
              佣金比例
            </SortableTableHead>
            <SortableTableHead field="commissionAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[108px] whitespace-nowrap">
              佣金金额
            </SortableTableHead>
            <SortableTableHead field="promoLink" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[102px] whitespace-nowrap">
              推广链接
            </SortableTableHead>
            <SortableTableHead field="relatedOfferCount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[152px] whitespace-nowrap">
              关联的Offer数量
            </SortableTableHead>
            <TableHead className="w-[118px] whitespace-nowrap">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const selected = selectedProductIds.has(item.id)
            const promoLink = item.shortPromoLink || item.promoLink
            const midTargetUrl = resolveMidTargetUrl(item)
            const asinText = item.asin || '-'
            const landingPageTypeText = LANDING_PAGE_TYPE_LABEL[item.landingPageType] || LANDING_PAGE_TYPE_LABEL.unknown
            const allowedCountriesText = item.allowedCountries.length > 0 ? item.allowedCountries.join(', ') : '-'
            const displayCurrency = resolveDisplayCurrency(item)
            const priceText = formatCurrency(item.priceAmount, item.priceCurrency || displayCurrency)
            const commissionAmountText = formatCurrency(item.commissionAmount, displayCurrency)
            const commissionRateText = item.commissionRateMode === 'amount'
              ? formatCurrency(item.commissionRate, displayCurrency)
              : formatPercent(item.commissionRate)
            const reviewCountText = formatReviewCount(item.reviewCount)
            const relatedOfferCountText = String(item.relatedOfferCount)

            return (
              <TableRow key={item.id} className={`hover:bg-gray-50/50 ${item.isBlacklisted ? 'bg-gray-100' : ''}`}>
                <TableCell>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(value) => toggleSelect(item.id, toBoolValue(value))}
                    aria-label={`选择商品 ${item.id}`}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <div className={item.isBlacklisted ? 'opacity-50' : ''}>#{item.serial}</div>
                </TableCell>
                <TableCell>
                  <div className={item.isBlacklisted ? 'opacity-50' : ''}>
                    <Badge variant="outline">{PLATFORM_SHORT_LABEL[item.platform]}</Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`flex items-center gap-1 ${item.isBlacklisted ? 'opacity-50' : ''}`}>
                    {midTargetUrl ? (
                      <button
                        type="button"
                        className="inline-flex max-w-[138px] items-center gap-1 font-medium text-blue-600 hover:underline"
                        onClick={() => safeOpenExternal(midTargetUrl)}
                        title={`打开联盟平台商品页：${item.mid}`}
                      >
                        <span className="truncate">{item.mid}</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="block max-w-[138px] truncate font-medium" title={item.mid}>{item.mid}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[108px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={asinText}>{asinText}</div>
                </TableCell>
                <TableCell>
                  <div className={item.isBlacklisted ? 'opacity-50' : ''}>
                    <Badge variant="outline">{landingPageTypeText}</Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[84px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={reviewCountText}>
                    {reviewCountText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[116px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={allowedCountriesText}>
                    {allowedCountriesText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[100px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={priceText}>{priceText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[96px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={commissionRateText}>{commissionRateText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[100px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={commissionAmountText}>{commissionAmountText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[98px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={promoLink || '-'}>
                    {promoLink ? (
                      <button
                        className="inline-flex max-w-[92px] items-center gap-1 truncate text-blue-600 hover:underline"
                        onClick={() => safeOpenExternal(promoLink)}
                        title={promoLink}
                      >
                        <Link className="h-3.5 w-3.5" />
                        查看链接
                      </button>
                    ) : (
                      '-'
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[72px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={relatedOfferCountText}>{relatedOfferCountText}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openCreateOfferDialog(item)}
                      disabled={creatingOfferId !== null || !item.promoLink || item.isBlacklisted}
                      title={item.isBlacklisted ? '商品已下线，无法创建Offer' : '创建Offer'}
                    >
                      {creatingOfferId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleProductSync(item)}
                      disabled={syncingProductId !== null}
                      title="同步数据"
                    >
                      {syncingProductId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openSingleOfflineDialog(item)}
                      disabled={offliningProductId !== null || item.isBlacklisted}
                      title={item.isBlacklisted ? '商品已下线' : '下线商品'}
                      className={item.isBlacklisted ? 'text-muted-foreground' : 'text-red-600 hover:text-red-600'}
                    >
                      {offliningProductId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 py-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/dashboard')}
                className="flex-shrink-0"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                返回Dashboard
              </Button>
              <h1 className="text-xl font-semibold tracking-tight">商品管理</h1>
              <Badge variant="outline">{total}</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="destructive"
                onClick={openClearAllDialog}
                disabled={clearingAll || total <= 0}
                title={total > 0 ? '清空当前用户下全部商品数据' : '暂无可清空商品'}
              >
                {clearingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                一键清空
              </Button>
              <Button
                variant="outline"
                onClick={() => handlePlatformSync('yeahpromos')}
                disabled={syncingPlatform !== null}
              >
                {syncingPlatform === 'yeahpromos' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                同步 YP
              </Button>
              <Button
                variant="outline"
                onClick={() => handlePlatformSync('partnerboost')}
                disabled={syncingPlatform !== null}
              >
                {syncingPlatform === 'partnerboost' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                同步 PB
              </Button>
              <Button variant="secondary" onClick={() => router.push('/openclaw')}>
                平台配置
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="px-4 pb-4 pt-4">
              <div className="text-xs text-muted-foreground">所有商品</div>
              <div className="mt-1 flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600" />
                <span className="text-xl font-semibold">{total}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 pb-4 pt-4">
              <div className="text-xs text-muted-foreground">有推广链接</div>
              <div className="mt-1 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-emerald-600" />
                <span className="text-xl font-semibold">{productsWithLinkCount}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 pb-4 pt-4">
              <div className="text-xs text-muted-foreground">已下线商品</div>
              <div className="mt-1 flex items-center gap-2">
                <ShieldOff className="h-4 w-4 text-rose-600" />
                <span className="text-xl font-semibold">{stats.blacklistedCount}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 pb-4 pt-4">
              <div className="text-xs text-muted-foreground">同步进行中</div>
              <div className="mt-1 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-amber-600" />
                <span className="text-xl font-semibold">{stats.activeSyncRuns}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {latestRuns.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">最近同步任务</CardTitle>
              <CardDescription>展示最近 4 条同步执行记录</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {latestRuns.slice(0, 4).map((run) => {
                  const StatusIcon = getSyncRunStatusIcon(run.status)
                  return (
                    <div key={run.id} className="rounded-md border px-3 py-2 text-xs">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-medium">{PLATFORM_SHORT_LABEL[run.platform]} #{run.id}</span>
                        <Badge variant={getSyncRunBadgeVariant(run.status)}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {run.status}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">
                        新增 {run.created_count} · 更新 {run.updated_count} · 失败 {run.failed_count}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">商品列表</CardTitle>
            <CardDescription>
              共 {total} 个商品，支持排序、单商品同步、创建 Offer、下线商品和批量操作
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>同一 ASIN 可能对应多个 MID（不同链接/佣金/策略），列表按推广条目展示。</span>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 items-center gap-2">
                <div className="relative w-full max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="搜索 平台商品ID / ASIN / 商品名 / 品牌"
                    className="pl-9"
                  />
                </div>
                <Select value={platformFilter} onValueChange={(value) => {
                  setPlatformFilter(value as typeof platformFilter)
                  setPage(1)
                }}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="联盟平台" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部平台</SelectItem>
                    <SelectItem value="yeahpromos">YeahPromos</SelectItem>
                    <SelectItem value="partnerboost">PartnerBoost</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasFilters && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSearchText('')
                      setSearchQuery('')
                      setPlatformFilter('all')
                      setNumericRangeDrafts({ ...EMPTY_NUMERIC_RANGE_FILTER_DRAFTS })
                      setNumericRangeFilters({ ...EMPTY_NUMERIC_RANGE_FILTERS })
                      setPage(1)
                    }}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    清除筛选
                  </Button>
                )}
                {canBatchCreate && (
                  <Button onClick={openBatchDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    批量创建Offer ({creatableSelectedProducts.length})
                  </Button>
                )}
                {canBatchOffline && (
                  <Button variant="destructive" onClick={openBatchOfflineConfirm}>
                    <PowerOff className="mr-2 h-4 w-4" />
                    批量下线商品 ({selectedProducts.length})
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {numericRangeFilterCards.map((card) => (
                <div key={card.label} className="rounded-md border p-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={numericRangeDrafts[card.minKey]}
                      onChange={(event) => updateNumericRangeDraft(card.minKey, event.target.value)}
                      placeholder={card.minPlaceholder}
                      inputMode="decimal"
                    />
                    <Input
                      value={numericRangeDrafts[card.maxKey]}
                      onChange={(event) => updateNumericRangeDraft(card.maxKey, event.target.value)}
                      placeholder={card.maxPlaceholder}
                      inputMode="decimal"
                    />
                  </div>
                </div>
              ))}
            </div>

            {loading ? (
              <div className="h-56 rounded-md border flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中...
              </div>
            ) : items.length === 0 ? (
              hasFilters ? (
                <NoResultsState description="当前筛选条件下暂无商品，试试清除筛选后再查看。" />
              ) : (
                <NoDataState
                  title="暂无商品数据"
                  description="请先执行联盟平台同步，系统会自动拉取可推广商品。"
                  actionLabel="立即同步PB商品"
                  onAction={() => handlePlatformSync('partnerboost')}
                />
              )
            ) : (
              renderProductTable()
            )}

            <ResponsivePagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size)
                setPage(1)
              }}
              pageSizeOptions={[10, 20, 50, 100]}
            />
          </CardContent>
        </Card>
      </main>

      <Dialog
        open={createOfferDialogOpen}
        onOpenChange={(open) => {
          setCreateOfferDialogOpen(open)
          if (!open && creatingOfferId === null) {
            setPendingCreateOfferProduct(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认创建 Offer</DialogTitle>
            <DialogDescription>
              确认为商品 <strong className="text-foreground">{pendingCreateOfferProduct?.mid || '-'}</strong> 创建 Offer？
              系统将使用当前商品推广链接生成 Offer，创建后可在 Offer 页面继续编辑。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOfferDialogOpen(false)
                setPendingCreateOfferProduct(null)
              }}
              disabled={creatingOfferId !== null}
            >
              取消
            </Button>
            <Button
              onClick={submitCreateOffer}
              disabled={!pendingCreateOfferProduct || creatingOfferId !== null}
            >
              {creatingOfferId !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={singleOfflineDialogOpen}
        onOpenChange={(open) => {
          setSingleOfflineDialogOpen(open)
          if (!open && offliningProductId === null) {
            setOfflineProduct(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认下线商品</DialogTitle>
            <DialogDescription>
              确认下线商品 <strong className="text-foreground">{offlineProduct?.mid || '-'}</strong>？
              此操作不可撤销，系统会删除该商品所有关联Offer，并自动附带删除对应广告系列。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSingleOfflineDialogOpen(false)
                setOfflineProduct(null)
              }}
              disabled={offliningProductId !== null}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={submitSingleOffline}
              disabled={!offlineProduct || offliningProductId !== null}
            >
              {offliningProductId !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
              确认下线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOfflineDialogOpen} onOpenChange={setBatchOfflineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认批量下线商品</DialogTitle>
            <DialogDescription>
              已选择 <strong className="text-foreground">{selectedProducts.length}</strong> 个商品。
              确认后将删除这些商品的所有关联Offer，并自动附带删除对应广告系列。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBatchOfflineDialogOpen(false)}
              disabled={batchOfflining}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={submitBatchOffline}
              disabled={!canBatchOffline || batchOfflining}
            >
              {batchOfflining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
              确认批量下线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>批量创建Offer</DialogTitle>
            <DialogDescription>
              已选择 {batchRows.length} 个商品。链接类型固定为“单品”，推广国家默认 US（可改）。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>链接类型</TableHead>
                  <TableHead>推广链接</TableHead>
                  <TableHead>推广国家</TableHead>
                  <TableHead>商品价格</TableHead>
                  <TableHead>佣金比例</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchRows.map((row) => {
                  const hasCountries = row.availableCountries.length > 0
                  const fallbackCountries = hasCountries ? row.availableCountries : ['US']
                  const value = fallbackCountries.includes(row.targetCountry)
                    ? row.targetCountry
                    : fallbackCountries[0]

                  return (
                    <TableRow key={row.productId}>
                      <TableCell>{row.linkType}</TableCell>
                      <TableCell className="max-w-[320px] truncate" title={row.promoLink || '-'}>
                        {row.promoLink || '-'}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={value}
                          onValueChange={(country) => updateBatchRowCountry(row.productId, country)}
                        >
                          <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="国家" />
                          </SelectTrigger>
                          <SelectContent>
                            {fallbackCountries.map((country) => (
                              <SelectItem key={country} value={country}>
                                {country}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{row.productPrice}</TableCell>
                      <TableCell>{row.commissionRate}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)} disabled={batchCreating}>
              取消
            </Button>
            <Button onClick={submitBatchCreate} disabled={batchCreating || batchRows.length === 0}>
              {batchCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              确认批量创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearAllConfirmOpen} onOpenChange={setClearAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空全部商品？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作会清空你在“商品管理”中已同步的全部商家/商品数据（共 <strong className="text-foreground">{total}</strong> 条）。
              不会删除已经创建的 Offer。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingAll}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={submitClearAll}
              disabled={clearingAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearingAll ? '清空中...' : '确认清空全部'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
