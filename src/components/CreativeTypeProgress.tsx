'use client'

/**
 * 🆕 v4.16: 创意类型进度指示器组件
 * ✅ KISS-3类型：显示3个创意类型的生成状态：已生成、待生成
 */

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

interface CreativeTypeProgressProps {
  generatedBuckets: string[]
  activeBucket?: string | null
  offer: {
    page_type?: string | null
  }
}

// KISS-3类型创意配置（单品/店铺使用同一套逻辑展示）
const PRODUCT_BUCKETS = [
  { key: 'A', label: '品牌/信任', description: '强调官方、正品与可信（证据内）', color: 'bg-blue-500' },
  { key: 'B', label: '场景+功能', description: '用场景痛点引入，用功能给出解法', color: 'bg-green-500' },
  { key: 'D', label: '转化/价值', description: '可验证优惠/价值点 + 强CTA（全量关键词覆盖）', color: 'bg-amber-500' },
]

const STORE_BUCKETS = [
  { key: 'A', label: '品牌/信任', description: '强调官方、正品与可信（证据内）', color: 'bg-blue-500' },
  { key: 'B', label: '场景+功能', description: '用场景痛点引入，用功能给出解法', color: 'bg-green-500' },
  { key: 'D', label: '转化/价值', description: '可验证优惠/价值点 + 强CTA（全量关键词覆盖）', color: 'bg-amber-500' },
]

export function CreativeTypeProgress({ generatedBuckets, activeBucket, offer }: CreativeTypeProgressProps) {
  const linkType = offer.page_type || 'product'
  const buckets = linkType === 'store' ? STORE_BUCKETS : PRODUCT_BUCKETS
  const nextBucket = buckets.find(b => !generatedBuckets.includes(b.key))
  const highlightedBucket = activeBucket || nextBucket?.key || null

  return (
    <TooltipProvider>
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <h3 className="mb-2 text-sm font-medium text-gray-700">创意类型进度</h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {buckets.map((bucket) => {
            const isGenerated = generatedBuckets.includes(bucket.key)
            const isCurrent = highlightedBucket === bucket.key
            const isGenerating = activeBucket === bucket.key

            return (
              <div key={bucket.key} className="min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex h-full cursor-default flex-col items-center justify-center rounded-lg border px-2 py-2 text-center ${
                        isGenerated
                          ? 'border-green-200 bg-green-50/60'
                          : isCurrent
                            ? 'border-purple-200 bg-purple-50/50'
                            : 'border-gray-200 bg-gray-50/60'
                      }`}
                    >
                      <div
                        className={`
                          relative flex h-9 w-9 items-center justify-center rounded-full
                          ${isGenerated
                            ? `${bucket.color} text-white`
                            : 'bg-gray-100 text-gray-400'}
                          ${isCurrent && !isGenerated ? 'ring-2 ring-offset-2 ring-purple-500' : ''}
                          ${isGenerating ? 'shadow-md shadow-purple-200' : ''}
                        `}
                      >
                        {isGenerated ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : isGenerating ? (
                          <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </div>
                      <span className={`
                        mt-1 text-xs font-semibold leading-none
                        ${isGenerated ? 'text-gray-900' : 'text-gray-500'}
                      `}>
                        {bucket.key}
                      </span>
                      <span className="mt-1 line-clamp-1 text-[11px] text-gray-500">{bucket.label}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">{bucket.label}</p>
                    <p className="text-xs text-gray-500">{bucket.description}</p>
                    {isGenerated && (
                      <p className="mt-1 text-xs text-green-600">✓ 已生成</p>
                    )}
                    {isGenerating && (
                      <p className="mt-1 text-xs text-purple-600">生成中</p>
                    )}
                    {!isGenerated && !isGenerating && isCurrent && (
                      <p className="mt-1 text-xs text-gray-500">下一步</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>

        {/* 进度统计 */}
        <div className="mt-3 border-t border-gray-100 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
            <span className="text-gray-500">
              已完成 <span className="font-medium text-gray-900">{generatedBuckets.length}</span> / 3 个创意类型
            </span>
            <span className="pr-1 text-right text-gray-500">
              {generatedBuckets.length === 3 ? (
                <span className="font-medium text-green-600">全部完成</span>
              ) : activeBucket ? (
                <span className="font-medium text-purple-600">
                  当前: {buckets.find(bucket => bucket.key === activeBucket)?.label || activeBucket}
                </span>
              ) : generatedBuckets.length === 0 ? (
                <span className="text-gray-400">点击生成开始</span>
              ) : (
                <span className="text-purple-600">
                  下一个: {nextBucket?.label || '-'}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
