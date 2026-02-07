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
} from 'lucide-react'

type ProductPlatform = 'yeahpromos' | 'partnerboost'
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
  | 'promoLink'
  | 'relatedOfferCount'
  | 'updatedAt'

type ProductListItem = {
  id: number
  serial: number
  platform: ProductPlatform
  mid: string
  asin: string | null
  brand: string | null
  productName: string | null
  productUrl: string | null
  allowedCountries: string[]
  priceAmount: number | null
  priceCurrency: string | null
  commissionRate: number | null
  commissionAmount: number | null
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

const PLATFORM_LABEL: Record<ProductPlatform, string> = {
  yeahpromos: 'YeahPromos',
  partnerboost: 'PartnerBoost',
}

const PLATFORM_SHORT_LABEL: Record<ProductPlatform, string> = {
  yeahpromos: 'YP',
  partnerboost: 'PB',
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

export default function ProductsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ProductListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchText, setSearchText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'all' | ProductPlatform>('all')
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
  const hasFilters = searchQuery.length > 0 || platformFilter !== 'all'

  const stats = useMemo(() => {
    const activeSyncRuns = latestRuns.filter((run) => run.status === 'queued' || run.status === 'running').length
    const blacklistedCount = items.filter((item) => item.isBlacklisted).length
    const productsWithLinkCount = items.filter((item) => Boolean(item.shortPromoLink || item.promoLink)).length

    return {
      activeSyncRuns,
      blacklistedCount,
      productsWithLinkCount,
    }
  }, [items, latestRuns])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchText.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchText])

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
  }, [page, pageSize, searchQuery, platformFilter, sortBy, sortOrder])

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

      showSuccess('创建成功', `Offer #${data.offerId} 已创建`)
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
    const rows: BatchRow[] = creatableSelectedProducts.map((product) => ({
      productId: product.id,
      linkType: '单品',
      promoLink: product.promoLink || '',
      targetCountry: defaultCountryFromProduct(product),
      availableCountries: normalizeCountries(product.allowedCountries),
      productPrice: formatCurrency(product.priceAmount, product.priceCurrency),
      commissionRate: formatPercent(product.commissionRate),
    }))
    setBatchRows(rows)
    setBatchDialogOpen(true)
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

      showSuccess('批量创建完成', `成功 ${data.successCount} / ${data.total}`)
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
      <Table className="table-fixed min-w-[1320px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[48px] whitespace-nowrap">
              <Checkbox
                checked={items.length > 0 && items.every((item) => selectedProductIds.has(item.id))}
                onCheckedChange={(value) => handleSelectAll(toBoolValue(value))}
                aria-label="全选"
              />
            </TableHead>
            <SortableTableHead field="serial" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[90px] whitespace-nowrap">
              序号
            </SortableTableHead>
            <SortableTableHead field="platform" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[120px] whitespace-nowrap">
              联盟平台
            </SortableTableHead>
            <SortableTableHead field="mid" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[140px] whitespace-nowrap">
              MID
            </SortableTableHead>
            <SortableTableHead field="asin" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[130px] whitespace-nowrap">
              ASIN
            </SortableTableHead>
            <SortableTableHead field="allowedCountries" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[140px] whitespace-nowrap">
              允许投放国家
            </SortableTableHead>
            <SortableTableHead field="priceAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[120px] whitespace-nowrap">
              商品价格
            </SortableTableHead>
            <SortableTableHead field="commissionRate" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[120px] whitespace-nowrap">
              佣金比例
            </SortableTableHead>
            <SortableTableHead field="commissionAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[120px] whitespace-nowrap">
              佣金金额
            </SortableTableHead>
            <SortableTableHead field="promoLink" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[130px] whitespace-nowrap">
              推广链接
            </SortableTableHead>
            <SortableTableHead field="relatedOfferCount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[170px] whitespace-nowrap">
              关联的Offer数量
            </SortableTableHead>
            <TableHead className="w-[120px] whitespace-nowrap">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const selected = selectedProductIds.has(item.id)
            const promoLink = item.shortPromoLink || item.promoLink
            const midTargetUrl = resolveMidTargetUrl(item)
            const asinText = item.asin || '-'
            const allowedCountriesText = item.allowedCountries.length > 0 ? item.allowedCountries.join(', ') : '-'
            const priceText = formatCurrency(item.priceAmount, item.priceCurrency)
            const commissionRateText = formatPercent(item.commissionRate)
            const commissionAmountText = formatCurrency(item.commissionAmount, item.priceCurrency)
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
                        className="inline-flex max-w-[120px] items-center gap-1 font-medium text-blue-600 hover:underline"
                        onClick={() => safeOpenExternal(midTargetUrl)}
                        title={`打开联盟平台商品页：${item.mid}`}
                      >
                        <span className="truncate">{item.mid}</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="block max-w-[120px] truncate font-medium" title={item.mid}>{item.mid}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[120px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={asinText}>{asinText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[130px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={allowedCountriesText}>
                    {allowedCountriesText}
                  </div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[110px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={priceText}>{priceText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[110px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={commissionRateText}>{commissionRateText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[110px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={commissionAmountText}>{commissionAmountText}</div>
                </TableCell>
                <TableCell>
                  <div className={`max-w-[120px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={promoLink || '-'}>
                    {promoLink ? (
                      <button
                        className="inline-flex max-w-[110px] items-center gap-1 truncate text-blue-600 hover:underline"
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
                  <div className={`max-w-[80px] truncate whitespace-nowrap ${item.isBlacklisted ? 'opacity-50' : ''}`} title={relatedOfferCountText}>{relatedOfferCountText}</div>
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
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">当前页商品</div>
              <div className="mt-1 flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600" />
                <span className="text-xl font-semibold">{items.length}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">有推广链接</div>
              <div className="mt-1 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-emerald-600" />
                <span className="text-xl font-semibold">{stats.productsWithLinkCount}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">已下线商品</div>
              <div className="mt-1 flex items-center gap-2">
                <ShieldOff className="h-4 w-4 text-rose-600" />
                <span className="text-xl font-semibold">{stats.blacklistedCount}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 items-center gap-2">
                <div className="relative w-full max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="搜索 MID / ASIN / 商品名 / 品牌"
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
                  actionLabel="立即同步 YP"
                  onAction={() => handlePlatformSync('yeahpromos')}
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
    </div>
  )
}
