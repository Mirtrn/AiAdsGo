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
import LaunchAdModal from '@/components/LaunchAdModal'
import AdjustCpcModal from '@/components/AdjustCpcModal'
import LaunchScoreModal from '@/components/LaunchScoreModal'
import { VirtualizedOfferTable } from '@/components/VirtualizedOfferTable'
import { MobileOfferCard } from '@/components/MobileOfferCard'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Search, Plus, Rocket, DollarSign, BarChart3, ExternalLink, Download } from 'lucide-react'

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

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [isAdjustCpcModalOpen, setIsAdjustCpcModalOpen] = useState(false)
  const [selectedOfferForCpc, setSelectedOfferForCpc] = useState<Offer | null>(null)
  const [isLaunchScoreModalOpen, setIsLaunchScoreModalOpen] = useState(false)
  const [selectedOfferForScore, setSelectedOfferForScore] = useState<Offer | null>(null)

  useEffect(() => {
    fetchOffers()
  }, [])

  // P1-2: 应用筛选器
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

    setFilteredOffers(filtered)
  }, [offers, searchQuery, countryFilter, statusFilter])

  const fetchOffers = async () => {
    try {
      const response = await fetch('/api/offers', {
        credentials: 'include',
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

  const getScrapeStatusBadge = (status: string) => {
    const configs = {
      pending: { label: '等待抓取', variant: 'outline' as const },
      in_progress: { label: '抓取中', variant: 'default' as const },
      completed: { label: '已完成', variant: 'default' as const },
      failed: { label: '失败', variant: 'destructive' as const },
    }
    const config = configs[status as keyof typeof configs] || { label: status, variant: 'outline' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
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
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900">Offer管理</h1>
              <Badge variant="outline" className="text-xs sm:text-sm">
                {offers.length}
              </Badge>
            </div>

            {/* 右侧操作按钮 */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {!isMobile && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={offers.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  导出CSV
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('/api/offers/batch-template')}
                className="flex-1 sm:flex-none"
                title="下载批量导入CSV模板"
              >
                <Download className="w-4 h-4 mr-2" />
                {isMobile ? '模板' : '下载模板'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/offers/batch')}
                className="flex-1 sm:flex-none"
              >
                {isMobile ? '批量' : '批量导入'}
              </Button>
              <Button
                onClick={() => router.push('/offers/new')}
                className="flex-1 sm:flex-none"
              >
                <Plus className="w-4 h-4 mr-2" />
                创建
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* P1-2 + P2-4: 筛选器（移动端优化） */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="space-y-4">
              {/* 搜索框 - 移动端全宽 */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder={isMobile ? "搜索..." : "搜索品牌名称、Offer标识、URL..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* 筛选器 - 移动端竖向排列，桌面端横向 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 国家筛选 */}
                <Select value={countryFilter} onValueChange={setCountryFilter}>
                  <SelectTrigger>
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
                  <SelectTrigger>
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
                <p className="text-sm text-gray-600">
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

        {/* Empty State */}
        {filteredOffers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                {offers.length === 0 ? '暂无Offer' : '未找到匹配的Offer'}
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                {offers.length === 0
                  ? '点击上方按钮创建您的第一个Offer'
                  : '尝试调整筛选条件'}
              </p>
              {offers.length === 0 && (
                <div className="mt-6">
                  <Button onClick={() => router.push('/offers/new')}>
                    <Plus className="w-4 h-4 mr-2" />
                    创建Offer
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
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
                      <TableHead className="w-[200px]">Offer标识</TableHead>
                      <TableHead>品牌信息</TableHead>
                      <TableHead>推广国家</TableHead>
                      <TableHead>语言</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOffers.map((offer) => (
                      <TableRow key={offer.id} className="hover:bg-gray-50/50">
                        <TableCell className="font-mono">
                          <a
                            href={`/offers/${offer.id}`}
                            className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-2"
                          >
                            {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium text-gray-900">{offer.brand}</div>
                            <div className="text-sm text-gray-500 truncate max-w-xs">
                              {offer.url}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{offer.targetCountry}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {offer.targetLanguage || 'English'}
                        </TableCell>
                        <TableCell>{getScrapeStatusBadge(offer.scrape_status)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => {
                                setSelectedOffer(offer)
                                setIsModalOpen(true)
                              }}
                              title="快速创建并发布Google Ads广告"
                            >
                              <Rocket className="w-4 h-4 mr-1" />
                              一键上广告
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedOfferForCpc(offer)
                                setIsAdjustCpcModalOpen(true)
                              }}
                              title="手动调整广告系列的CPC出价"
                            >
                              <DollarSign className="w-4 h-4 mr-1" />
                              调整CPC
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedOfferForScore(offer)
                                setIsLaunchScoreModalOpen(true)
                              }}
                              title="查看投放分析和评分"
                            >
                              <BarChart3 className="w-4 h-4 mr-1" />
                              投放分析
                            </Button>
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
        offer={selectedOffer || {
          id: 0,
          offerName: '',
          brand: '',
          targetCountry: '',
          targetLanguage: '',
          url: '',
          affiliateLink: null,
          productPrice: null,
          commissionPayout: null,
        }}
      />

      {selectedOfferForCpc && (
        <AdjustCpcModal
          open={isAdjustCpcModalOpen}
          onClose={() => {
            setIsAdjustCpcModalOpen(false)
            setSelectedOfferForCpc(null)
          }}
          offer={selectedOfferForCpc}
        />
      )}

      {selectedOfferForScore && (
        <LaunchScoreModal
          open={isLaunchScoreModalOpen}
          onClose={() => {
            setIsLaunchScoreModalOpen(false)
            setSelectedOfferForScore(null)
          }}
          offerId={selectedOfferForScore.id}
        />
      )}
    </div>
  )
}
