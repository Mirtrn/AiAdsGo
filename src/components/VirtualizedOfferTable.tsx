'use client'

/**
 * VirtualizedOfferTable - P2-3虚拟滚动优化 + P2-5可访问性增强
 * 使用 @tanstack/react-virtual 实现高性能长列表渲染
 * 添加 ARIA 属性和键盘导航支持
 */

import { useRef, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createKeyboardHandler, announceToScreenReader } from '@/lib/accessibility'
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
import { Rocket, DollarSign, BarChart3, ExternalLink } from 'lucide-react'

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

interface VirtualizedOfferTableProps {
  offers: Offer[]
  onLaunchAd: (offer: Offer) => void
  onAdjustCpc: (offer: Offer) => void
  onLaunchScore: (offer: Offer) => void
}

export function VirtualizedOfferTable({
  offers,
  onLaunchAd,
  onAdjustCpc,
  onLaunchScore,
}: VirtualizedOfferTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // P2-5: 键盘导航状态
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1)

  // 虚拟滚动配置
  const rowVirtualizer = useVirtualizer({
    count: offers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 73, // 预估行高（px）
    overscan: 10, // 预渲染10行以获得更流畅的滚动体验
  })

  // P2-5: 键盘导航处理
  const handleTableKeyboard = createKeyboardHandler({
    onArrowDown: () => {
      if (focusedRowIndex < offers.length - 1) {
        const nextIndex = focusedRowIndex + 1
        setFocusedRowIndex(nextIndex)
        announceToScreenReader(`行 ${nextIndex + 1}，共 ${offers.length} 行`)
      }
    },
    onArrowUp: () => {
      if (focusedRowIndex > 0) {
        const prevIndex = focusedRowIndex - 1
        setFocusedRowIndex(prevIndex)
        announceToScreenReader(`行 ${prevIndex + 1}，共 ${offers.length} 行`)
      }
    },
    onEnter: () => {
      if (focusedRowIndex >= 0 && offers[focusedRowIndex]) {
        onLaunchAd(offers[focusedRowIndex])
      }
    },
  })

  // 当焦点行改变时，滚动到对应位置
  useEffect(() => {
    if (focusedRowIndex >= 0) {
      rowVirtualizer.scrollToIndex(focusedRowIndex, { align: 'center' })
    }
  }, [focusedRowIndex, rowVirtualizer])

  const getScrapeStatusBadge = (status: string) => {
    const configs = {
      pending: { label: '等待抓取', variant: 'outline' as const },
      in_progress: { label: '抓取中', variant: 'default' as const },
      completed: { label: '已完成', variant: 'default' as const },
      failed: { label: '失败', variant: 'destructive' as const },
    }
    const config = configs[status as keyof typeof configs] || {
      label: status,
      variant: 'outline' as const,
    }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  // 如果列表为空，显示提示
  if (offers.length === 0) {
    return (
      <div className="border rounded-lg p-12 text-center bg-gray-50">
        <p className="text-gray-500">未找到匹配的Offer</p>
      </div>
    )
  }

  return (
    <div
      className="border rounded-lg overflow-hidden"
      role="region"
      aria-label="Offer列表"
    >
      {/* 固定表头 */}
      <div className="bg-gray-50 border-b" role="row">
        <div className="grid grid-cols-[200px_1fr_120px_100px_120px_auto] gap-4 px-4 py-3 text-sm font-medium text-gray-700">
          <div role="columnheader">Offer标识</div>
          <div role="columnheader">品牌信息</div>
          <div role="columnheader">推广国家</div>
          <div role="columnheader">语言</div>
          <div role="columnheader">状态</div>
          <div role="columnheader" className="text-right">操作</div>
        </div>
      </div>

      {/* 虚拟滚动容器 - P2-5: 添加ARIA和键盘支持 */}
      <div
        ref={parentRef}
        className="overflow-auto bg-white"
        style={{ height: '600px' }}
        role="table"
        aria-label={`Offer数据表，共${offers.length}项`}
        aria-rowcount={offers.length}
        tabIndex={0}
        onKeyDown={handleTableKeyboard}
        onFocus={() => {
          if (focusedRowIndex === -1 && offers.length > 0) {
            setFocusedRowIndex(0)
          }
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const offer = offers[virtualRow.index]
            const isRowFocused = focusedRowIndex === virtualRow.index

            return (
              <div
                key={offer.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                role="row"
                aria-rowindex={virtualRow.index + 1}
                aria-selected={isRowFocused}
                className={`grid grid-cols-[200px_1fr_120px_100px_120px_auto] gap-4 px-4 py-4 border-b hover:bg-gray-50 transition-colors absolute top-0 left-0 w-full ${
                  isRowFocused ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                }`}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => setFocusedRowIndex(virtualRow.index)}
              >
                {/* Offer标识 */}
                <div className="font-mono">
                  <a
                    href={`/offers/${offer.id}`}
                    className="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-2"
                  >
                    {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* 品牌信息 */}
                <div>
                  <div className="font-medium text-gray-900">{offer.brand}</div>
                  <div className="text-sm text-gray-500 truncate">{offer.url}</div>
                </div>

                {/* 推广国家 */}
                <div>
                  <Badge variant="outline">{offer.targetCountry}</Badge>
                </div>

                {/* 语言 */}
                <div className="text-sm text-gray-600">
                  {offer.targetLanguage || 'English'}
                </div>

                {/* 状态 */}
                <div>{getScrapeStatusBadge(offer.scrape_status)}</div>

                {/* 操作 - P2-5: ARIA labels */}
                <div className="flex justify-end gap-2" role="cell">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onLaunchAd(offer)}
                    aria-label={`为${offer.offerName || offer.brand}一键上广告`}
                    title="快速创建并发布Google Ads广告"
                  >
                    <Rocket className="w-4 h-4 mr-1" aria-hidden="true" />
                    一键上广告
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAdjustCpc(offer)}
                    aria-label={`调整${offer.offerName || offer.brand}的CPC出价`}
                    title="手动调整广告系列的CPC出价"
                  >
                    <DollarSign className="w-4 h-4 mr-1" aria-hidden="true" />
                    调整CPC
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onLaunchScore(offer)}
                    aria-label={`查看${offer.offerName || offer.brand}的投放分析`}
                    title="查看投放分析和评分"
                  >
                    <BarChart3 className="w-4 h-4 mr-1" aria-hidden="true" />
                    投放分析
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部统计信息 */}
      <div className="bg-gray-50 border-t px-4 py-2 text-sm text-gray-600">
        共 {offers.length} 个Offer，正在显示第{' '}
        {rowVirtualizer.getVirtualItems()[0]?.index + 1 || 0} 至{' '}
        {(rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]
          ?.index || 0) + 1}{' '}
        项
      </div>
    </div>
  )
}
