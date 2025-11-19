'use client'

/**
 * VirtualizedOfferTable - P2-3 Optimized Virtual Scrolling + P2-5 Accessibility
 * Uses @tanstack/react-virtual for high-performance long list rendering
 * Adds ARIA attributes and keyboard navigation support
 */

import { useRef, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createKeyboardHandler, announceToScreenReader } from '@/lib/accessibility'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Rocket, DollarSign, BarChart3, ExternalLink, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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

  // P2-5: Keyboard navigation state
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1)

  // Virtual scrolling config
  const rowVirtualizer = useVirtualizer({
    count: offers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Increased row height for better spacing
    overscan: 10, // Pre-render 10 rows for smoother scrolling
  })

  // P2-5: Keyboard navigation handler
  const handleTableKeyboard = createKeyboardHandler({
    onArrowDown: () => {
      if (focusedRowIndex < offers.length - 1) {
        const nextIndex = focusedRowIndex + 1
        setFocusedRowIndex(nextIndex)
        announceToScreenReader(`Row ${nextIndex + 1}, of ${offers.length}`)
      }
    },
    onArrowUp: () => {
      if (focusedRowIndex > 0) {
        const prevIndex = focusedRowIndex - 1
        setFocusedRowIndex(prevIndex)
        announceToScreenReader(`Row ${prevIndex + 1}, of ${offers.length}`)
      }
    },
    onEnter: () => {
      if (focusedRowIndex >= 0 && offers[focusedRowIndex]) {
        onLaunchAd(offers[focusedRowIndex])
      }
    },
  })

  // Scroll to focused row when it changes
  useEffect(() => {
    if (focusedRowIndex >= 0) {
      rowVirtualizer.scrollToIndex(focusedRowIndex, { align: 'center' })
    }
  }, [focusedRowIndex, rowVirtualizer])

  const getScrapeStatusBadge = (status: string) => {
    const configs = {
      pending: { label: 'Pending', variant: 'outline' as const, className: 'text-gray-500 border-gray-200' },
      in_progress: { label: 'Scraping', variant: 'secondary' as const, className: 'bg-blue-50 text-blue-700 border-blue-100 animate-pulse' },
      completed: { label: 'Ready', variant: 'default' as const, className: 'bg-green-50 text-green-700 border-green-100 hover:bg-green-100' },
      failed: { label: 'Failed', variant: 'destructive' as const, className: 'bg-red-50 text-red-700 border-red-100 hover:bg-red-100' },
    }
    const config = configs[status as keyof typeof configs] || {
      label: status,
      variant: 'outline' as const,
      className: 'text-gray-500'
    }
    return <Badge variant={config.variant} className={`font-medium border ${config.className}`}>{config.label}</Badge>
  }

  // If list is empty
  if (offers.length === 0) {
    return (
      <div className="border border-dashed border-gray-200 rounded-xl p-16 text-center bg-gray-50/50">
        <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <Rocket className="w-6 h-6 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900">No offers found</h3>
        <p className="text-gray-500 mt-1">Try adjusting your search or filters.</p>
      </div>
    )
  }

  return (
    <div
      className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm"
      role="region"
      aria-label="Offer List"
    >
      {/* Fixed Header */}
      <div className="bg-gray-50/80 border-b border-gray-200 backdrop-blur-sm sticky top-0 z-10" role="row">
        <div className="grid grid-cols-[240px_1fr_120px_100px_120px_140px] gap-4 px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <div role="columnheader">Offer Name</div>
          <div role="columnheader">Brand / URL</div>
          <div role="columnheader">Country</div>
          <div role="columnheader">Language</div>
          <div role="columnheader">Status</div>
          <div role="columnheader" className="text-right">Actions</div>
        </div>
      </div>

      {/* Virtualized Container */}
      <div
        ref={parentRef}
        className="overflow-auto bg-white custom-scrollbar"
        style={{ height: '600px' }}
        role="table"
        aria-label={`Offer table, ${offers.length} items`}
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
                className={`grid grid-cols-[240px_1fr_120px_100px_120px_140px] gap-4 px-6 py-4 border-b border-gray-100 hover:bg-gray-50/80 transition-colors absolute top-0 left-0 w-full items-center group ${isRowFocused ? 'ring-2 ring-blue-500 bg-blue-50/30 z-10' : ''
                  }`}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => setFocusedRowIndex(virtualRow.index)}
              >
                {/* Offer Name */}
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate" title={offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}>
                    {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 font-mono">ID: {offer.id}</div>
                </div>

                {/* Brand Info */}
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{offer.brand}</div>
                  <a
                    href={offer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline truncate flex items-center gap-1 mt-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {offer.url}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Country */}
                <div>
                  <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 font-normal">
                    {offer.targetCountry}
                  </Badge>
                </div>

                {/* Language */}
                <div className="text-sm text-gray-600">
                  {offer.targetLanguage || 'English'}
                </div>

                {/* Status */}
                <div>{getScrapeStatusBadge(offer.scrape_status)}</div>

                {/* Actions */}
                <div className="flex justify-end gap-2" role="cell">
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all hover:shadow-md h-8 px-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLaunchAd(offer);
                    }}
                    aria-label={`Launch ad for ${offer.offerName || offer.brand}`}
                  >
                    <Rocket className="w-3.5 h-3.5 mr-1.5" />
                    Launch
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger className="h-8 w-8 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md inline-flex items-center justify-center">
                      <MoreHorizontal className="w-4 h-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onLaunchAd(offer)}>
                        <Rocket className="w-4 h-4 mr-2 text-blue-600" />
                        Launch Ad
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onAdjustCpc(offer)}>
                        <DollarSign className="w-4 h-4 mr-2 text-green-600" />
                        Adjust CPC
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onLaunchScore(offer)}>
                        <BarChart3 className="w-4 h-4 mr-2 text-purple-600" />
                        View Analytics
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => window.open(offer.url, '_blank')}>
                        <ExternalLink className="w-4 h-4 mr-2 text-gray-500" />
                        Visit Site
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="bg-gray-50 border-t border-gray-200 px-6 py-3 text-xs text-gray-500 flex justify-between items-center">
        <span>
          Showing {rowVirtualizer.getVirtualItems()[0]?.index + 1 || 0} - {(rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.index || 0) + 1} of {offers.length} offers
        </span>
        <span className="text-gray-400">
          Use arrow keys to navigate
        </span>
      </div>
    </div>
  )
}
