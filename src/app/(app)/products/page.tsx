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
import { showError, showSuccess } from '@/lib/toast-utils'
import {
  ArrowUpRight,
  ExternalLink,
  Link,
  Loader2,
  Plus,
  PowerOff,
  RefreshCw,
  Search,
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

  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [offlineProduct, setOfflineProduct] = useState<ProductListItem | null>(null)
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

  const handleCreateOffer = async (product: ProductListItem, targetCountry?: string) => {
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
    } catch (error: any) {
      showError('创建失败', error?.message || '创建Offer失败')
    } finally {
      setCreatingOfferId(null)
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">商品管理</h1>
          <p className="text-sm text-muted-foreground">
            同步联盟平台可推广商品，并快捷创建 Offer
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>商品信息同步</CardTitle>
          <CardDescription>
            按用户在 OpenClaw 中配置的联盟平台账号同步可推广商品（仅同步可获得推广链接商品）
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => handlePlatformSync('yeahpromos')}
            disabled={syncingPlatform !== null}
          >
            {syncingPlatform === 'yeahpromos' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            YP平台商品同步
          </Button>
          <Button
            variant="secondary"
            onClick={() => handlePlatformSync('partnerboost')}
            disabled={syncingPlatform !== null}
          >
            {syncingPlatform === 'partnerboost' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            PB平台商品同步
          </Button>
          <Button variant="outline" onClick={() => router.push('/openclaw')}>
            前往 OpenClaw 配置
            <ArrowUpRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
        {latestRuns.length > 0 && (
          <CardContent className="pt-0">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {latestRuns.slice(0, 4).map((run) => (
                <div key={run.id} className="rounded-md border px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">{PLATFORM_SHORT_LABEL[run.platform]} #{run.id}</span>
                    <Badge variant={run.status === 'failed' ? 'destructive' : run.status === 'completed' ? 'default' : 'outline'}>
                      {run.status}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground">
                    新增 {run.created_count} · 更新 {run.updated_count} · 失败 {run.failed_count}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>商品列表</CardTitle>
          <CardDescription>
            共 {total} 个商品，支持排序、单商品同步、创建Offer、下线商品、批量操作
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

            <div className="flex items-center gap-2">
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

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[48px]">
                    <Checkbox
                      checked={items.length > 0 && items.every((item) => selectedProductIds.has(item.id))}
                      onCheckedChange={(value) => handleSelectAll(toBoolValue(value))}
                      aria-label="全选"
                    />
                  </TableHead>
                  <SortableTableHead field="serial" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[90px]">
                    序号
                  </SortableTableHead>
                  <SortableTableHead field="platform" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="w-[120px]">
                    联盟平台
                  </SortableTableHead>
                  <SortableTableHead field="mid" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    MID
                  </SortableTableHead>
                  <SortableTableHead field="asin" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    ASIN
                  </SortableTableHead>
                  <SortableTableHead field="allowedCountries" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    允许投放国家
                  </SortableTableHead>
                  <SortableTableHead field="priceAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    商品价格
                  </SortableTableHead>
                  <SortableTableHead field="commissionRate" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    佣金比例
                  </SortableTableHead>
                  <SortableTableHead field="commissionAmount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    佣金金额
                  </SortableTableHead>
                  <SortableTableHead field="promoLink" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    推广链接
                  </SortableTableHead>
                  <SortableTableHead field="relatedOfferCount" currentSortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>
                    关联的Offer数量
                  </SortableTableHead>
                  <TableHead className="whitespace-nowrap">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="h-28 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="h-24 text-center text-sm text-muted-foreground">
                      暂无商品数据，请先执行同步
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const selected = selectedProductIds.has(item.id)
                    const promoLink = item.shortPromoLink || item.promoLink

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
                            <span className="font-medium">{item.mid}</span>
                            {item.productUrl && (
                              <button
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => safeOpenExternal(item.productUrl || promoLink || undefined)}
                                title="打开联盟平台商品页"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={item.isBlacklisted ? 'opacity-50' : ''}>{item.asin || '-'}</div>
                        </TableCell>
                        <TableCell>
                          <div className={item.isBlacklisted ? 'opacity-50' : ''}>
                            {item.allowedCountries.length > 0 ? item.allowedCountries.join(', ') : '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={item.isBlacklisted ? 'opacity-50' : ''}>{formatCurrency(item.priceAmount, item.priceCurrency)}</div>
                        </TableCell>
                        <TableCell>
                          <div className={item.isBlacklisted ? 'opacity-50' : ''}>{formatPercent(item.commissionRate)}</div>
                        </TableCell>
                        <TableCell>
                          <div className={item.isBlacklisted ? 'opacity-50' : ''}>{formatCurrency(item.commissionAmount, item.priceCurrency)}</div>
                        </TableCell>
                        <TableCell>
                          <div className={item.isBlacklisted ? 'opacity-50' : ''}>
                            {promoLink ? (
                              <button
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                                onClick={() => safeOpenExternal(promoLink)}
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
                          <div className={item.isBlacklisted ? 'opacity-50' : ''}>{item.relatedOfferCount}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleCreateOffer(item)}
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
                  })
                )}
              </TableBody>
            </Table>
          </div>

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
              系统会删除该商品所有关联Offer，并自动附带删除对应广告系列。
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
