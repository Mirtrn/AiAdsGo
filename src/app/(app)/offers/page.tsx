'use client'

/**
 * Offer列表页 - P1-2优化版 + P2-2导出功能
 * 使用shadcn/ui Table组件 + 筛选器 + CSV导出
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { exportOffers, type OfferExportData } from '@/lib/export-utils'
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
import LaunchAdModal from '@/components/LaunchAdModal'
import AdjustCpcModal from '@/components/AdjustCpcModal'
import LaunchScoreModal from '@/components/LaunchScoreModal'
import CreateOfferModalV2 from '@/components/CreateOfferModalV2'
import { VirtualizedOfferTable } from '@/components/VirtualizedOfferTable'
import { MobileOfferCard } from '@/components/MobileOfferCard'
import { SortableTableHead } from '@/components/SortableTableHead' // P2-5: 可排序表头
import { NoOffersState, NoResultsState } from '@/components/ui/empty-state' // P2-7: 统一空状态
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Search, Plus, Rocket, DollarSign, BarChart3, ExternalLink, Download, Trash2, Unlink, MoreHorizontal, FileDown, Upload } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

interface Offer {
  id: number
  url: string
  brand: string
  category: string | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  scrape_status: string
  isActive: boolean
  createdAt: string
  offerName: string | null
  targetLanguage: string | null
  productPrice?: string | null
  commissionPayout?: string | null
  // P1-11: 关联的Google Ads账号信息
  linkedAccounts?: Array<{
    account_id: number
    account_name: string | null
    customer_id: string
    campaign_count: number
  }>
}

export default function OffersPage() {
  const router = useRouter()
  const [offers, setOffers] = useState<Offer[]>([])
  const [filteredOffers, setFilteredOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // P2-4: 移动端检测
  const isMobile = useIsMobile()

  // P1-2: 筛选器状态
  const [searchQuery, setSearchQuery] = useState('')
  const [countryFilter, setCountryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // P2-5: 排序状态
  const [sortBy, setSortBy] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [isAdjustCpcModalOpen, setIsAdjustCpcModalOpen] = useState(false)
  const [selectedOfferForCpc, setSelectedOfferForCpc] = useState<Offer | null>(null)
  const [isLaunchScoreModalOpen, setIsLaunchScoreModalOpen] = useState(false)
  const [selectedOfferForScore, setSelectedOfferForScore] = useState<Offer | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [offerToDelete, setOfferToDelete] = useState<Offer | null>(null)
  const [deleting, setDeleting] = useState(false)

  // P1-11: 解除关联状态
  const [isUnlinkDialogOpen, setIsUnlinkDialogOpen] = useState(false)
  const [offerToUnlink, setOfferToUnlink] = useState<{
    offer: Offer
    accountId: number
    accountName: string
  } | null>(null)
  const [unlinking, setUnlinking] = useState(false)

  useEffect(() => {
    fetchOffers()
  }, [])

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
      filtered = filtered.filter((offer) => offer.scrape_status === statusFilter)
    }

    // P2-5: 排序
    if (sortBy) {
      filtered = [...filtered].sort((a, b) => {
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
  }, [offers, searchQuery, countryFilter, statusFilter, sortBy, sortOrder])

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
      const response = await fetch('/api/offers', {
        credentials: 'include',
        cache: 'no-store', // 禁用 Next.js 自动缓存，确保获取最新数据
      })

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

  const handleDeleteOffer = async () => {
    if (!offerToDelete) return

    try {
      setDeleting(true)
      const response = await fetch(`/api/offers/${offerToDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '删除Offer失败')
      }

      // 刷新列表
      await fetchOffers()

      // 关闭对话框
      setIsDeleteDialogOpen(false)
      setOfferToDelete(null)
    } catch (err: any) {
      setError(err.message || '删除Offer失败')
    } finally {
      setDeleting(false)
    }
  }

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

  const getScrapeStatusBadge = (status: string) => {
    const configs = {
      pending: { label: '等待抓取', variant: 'secondary' as const, className: 'text-gray-500' },
      in_progress: { label: '抓取中', variant: 'default' as const, className: 'bg-blue-600' },
      completed: { label: '已完成', variant: 'outline' as const, className: 'bg-green-50 text-green-700 border-green-200' },
      failed: { label: '失败', variant: 'destructive' as const, className: '' },
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
      scrapeStatus: offer.scrape_status,
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
                ← {isMobile ? '' : '返回Dashboard'}
              </Button>
              <h1 className="page-title">Offer管理</h1>
              <Badge variant="outline" className="text-caption sm:text-body-sm">
                {offers.length}
              </Badge>
            </div>

            {/* 右侧操作按钮 */}
            {/* 右侧操作按钮 */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
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
                    导出CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.open('/api/offers/batch-template')}>
                    <FileDown className="w-4 h-4 mr-2" />
                    下载模板
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/offers/batch')}>
                    <Upload className="w-4 h-4 mr-2" />
                    批量导入
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
                  批量
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
                  placeholder={isMobile ? "搜索..." : "搜索品牌名称、Offer标识、URL..."}
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
                    <SelectItem value="pending">等待抓取</SelectItem>
                    <SelectItem value="in_progress">抓取中</SelectItem>
                    <SelectItem value="completed">已完成</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
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
        ) : isMobile ? (
          /* P2-4: 移动端卡片视图 */
          <div className="space-y-3">
            {filteredOffers.map((offer) => (
              <MobileOfferCard
                key={offer.id}
                offer={offer}
                onLaunchAd={(offer) => {
                  setSelectedOffer(offer)
                  setIsModalOpen(true)
                }}
                onAdjustCpc={(offer) => {
                  setSelectedOfferForCpc(offer)
                  setIsAdjustCpcModalOpen(true)
                }}
                onLaunchScore={(offer) => {
                  setSelectedOfferForScore(offer)
                  setIsLaunchScoreModalOpen(true)
                }}
              />
            ))}
          </div>
        ) : filteredOffers.length > 50 ? (
          /* P2-3: 虚拟滚动优化（自动启用：>50 Offers） */
          <VirtualizedOfferTable
            offers={filteredOffers}
            onLaunchAd={(offer) => {
              setSelectedOffer(offer)
              setIsModalOpen(true)
            }}
            onAdjustCpc={(offer) => {
              setSelectedOfferForCpc(offer)
              setIsAdjustCpcModalOpen(true)
            }}
            onLaunchScore={(offer) => {
              setSelectedOfferForScore(offer)
              setIsLaunchScoreModalOpen(true)
            }}
          />
        ) : (
          /* P1-2: shadcn/ui Table */
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* P2-5: 可排序列头 */}
                      <SortableTableHead
                        field="id"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[100px]"
                      >
                        Offer ID
                      </SortableTableHead>
                      <SortableTableHead
                        field="offerName"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        className="w-[200px]"
                      >
                        Offer标识
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
                      >
                        推广国家
                      </SortableTableHead>
                      <SortableTableHead
                        field="targetLanguage"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                      >
                        语言
                      </SortableTableHead>
                      <SortableTableHead
                        field="scrape_status"
                        currentSortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                      >
                        状态
                      </SortableTableHead>
                      <TableHead>关联账号</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOffers.map((offer) => (
                      <TableRow key={offer.id} className="hover:bg-gray-50/50">
                        <TableCell className="font-mono text-body-sm text-gray-600">
                          #{offer.id}
                        </TableCell>
                        <TableCell className="font-mono">
                          <a
                            href={`/offers/${offer.id}`}
                            className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-2"
                          >
                            {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </TableCell>
                        <TableCell className="py-4">
                          <div>
                            <div className="font-medium text-gray-900">{offer.brand}</div>
                            <div className="text-body-sm text-muted-foreground truncate max-w-[200px]" title={offer.url}>
                              {offer.url}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{offer.targetCountry}</Badge>
                        </TableCell>
                        <TableCell className="text-body-sm text-muted-foreground">
                          {offer.targetLanguage || 'English'}
                        </TableCell>
                        <TableCell>{getScrapeStatusBadge(offer.scrape_status)}</TableCell>
                        <TableCell>
                          {/* P1-11: 显示关联的Google Ads账号 */}
                          {offer.linkedAccounts && offer.linkedAccounts.length > 0 ? (
                            <div className="space-y-1">
                              {offer.linkedAccounts.map((account, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-xs">
                                  <Badge variant="secondary" className="gap-1 font-normal">
                                    {account.account_name || account.customer_id}
                                  </Badge>
                                  <span className="text-gray-500 text-[10px]">
                                    {account.campaign_count}个系列
                                  </span>
                                  <button
                                    onClick={() => {
                                      setOfferToUnlink({
                                        offer,
                                        accountId: account.account_id,
                                        accountName: account.account_name || account.customer_id
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
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => {
                                setSelectedOffer(offer)
                                setIsModalOpen(true)
                              }}
                              className="h-8"
                            >
                              <Rocket className="w-3.5 h-3.5 mr-1.5" />
                              一键上广告
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedOfferForCpc(offer)
                                    setIsAdjustCpcModalOpen(true)
                                  }}
                                >
                                  <DollarSign className="w-4 h-4 mr-2 text-gray-500" />
                                  调整CPC
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedOfferForScore(offer)
                                    setIsLaunchScoreModalOpen(true)
                                  }}
                                >
                                  <BarChart3 className="w-4 h-4 mr-2 text-gray-500" />
                                  投放分析
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setOfferToDelete(offer)
                                    setIsDeleteDialogOpen(true)
                                  }}
                                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  删除Offer
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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

      {/* Modals */}
      <LaunchAdModal
        open={isModalOpen && selectedOffer !== null}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedOffer(null)
        }}
        offer={(selectedOffer || {
          id: 0,
          offerName: '',
          brand: '',
          targetCountry: '',
          targetLanguage: '',
          url: '',
          affiliateLink: null,
          productPrice: null,
          commissionPayout: null,
        }) as any}
      />

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
        <LaunchScoreModal
          isOpen={isLaunchScoreModalOpen}
          onClose={() => {
            setIsLaunchScoreModalOpen(false)
            setSelectedOfferForScore(null)
          }}
          offer={selectedOfferForScore as any}
        />
      )}

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
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除Offer</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                您确定要删除 <strong className="text-gray-900">{offerToDelete?.brand}</strong> 的Offer吗？
              </p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-body-sm text-yellow-800">
                <p className="font-medium mb-1">⚠️ 重要提示：</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>已删除的Offer历史数据会保留在系统中</li>
                  <li>关联的Google Ads账号会自动解除关联</li>
                  <li>此操作不可撤销</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOffer}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
