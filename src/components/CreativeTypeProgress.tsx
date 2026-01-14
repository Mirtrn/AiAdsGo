'use client'

/**
 * 🆕 v4.16: 创意类型进度指示器组件
 * ✅ KISS-3类型：显示3个创意类型的生成状态：已生成、待生成
 */

import { CheckCircle2, Circle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

interface CreativeTypeProgressProps {
  generatedBuckets: string[]
  offer: {
    page_type?: string | null
  }
}

// KISS-3类型创意配置（单品/店铺使用同一套逻辑展示）
const PRODUCT_BUCKETS = [
  { key: 'A', label: '品牌/信任', description: '强调官方、正品与可信（证据内）', color: 'bg-blue-500' },
  { key: 'B', label: '场景+功能', description: '用场景痛点引入，用功能给出解法', color: 'bg-green-500' },
  { key: 'D', label: '转化/价值', description: '可验证优惠/价值点 + 强CTA', color: 'bg-amber-500' },
]

const STORE_BUCKETS = [
  { key: 'A', label: '品牌/信任', description: '强调官方、正品与可信（证据内）', color: 'bg-blue-500' },
  { key: 'B', label: '场景+功能', description: '用场景痛点引入，用功能给出解法', color: 'bg-green-500' },
  { key: 'D', label: '转化/价值', description: '可验证优惠/价值点 + 强CTA', color: 'bg-amber-500' },
]

export function CreativeTypeProgress({ generatedBuckets, offer }: CreativeTypeProgressProps) {
  const linkType = offer.page_type || 'product'
  const buckets = linkType === 'store' ? STORE_BUCKETS : PRODUCT_BUCKETS
  const nextBucket = buckets.find(b => !generatedBuckets.includes(b.key))

  return (
    <TooltipProvider>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">创意类型进度</h3>
        <div className="flex items-center gap-2">
          {buckets.map((bucket) => {
            const isGenerated = generatedBuckets.includes(bucket.key)
            const isCurrent = !!nextBucket && nextBucket.key === bucket.key

            return (
              <Tooltip key={bucket.key}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    {/* 连接线 */}
                    {bucket.key !== 'A' && (
                      <div className={`w-8 h-0.5 ${
                        generatedBuckets.includes(buckets[buckets.findIndex(b => b.key === bucket.key) - 1]?.key || '')
                          ? 'bg-gray-300'
                          : 'bg-gray-100'
                      }`} />
                    )}

                    {/* 状态图标 */}
                    <div
                      className={`
                        relative flex items-center justify-center w-10 h-10 rounded-full
                        ${isGenerated
                          ? `${bucket.color} text-white`
                          : 'bg-gray-100 text-gray-400'}
                        ${isCurrent && !isGenerated ? 'ring-2 ring-offset-2 ring-purple-500' : ''}
                      `}
                    >
                      {isGenerated ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <Circle className="w-5 h-5" />
                      )}

                      {/* 类型标签 */}
                      <span className={`
                        absolute -bottom-6 text-xs font-medium whitespace-nowrap
                        ${isGenerated ? 'text-gray-900' : 'text-gray-500'}
                      `}>
                        {bucket.key}
                      </span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{bucket.label}</p>
                  <p className="text-xs text-gray-500">{bucket.description}</p>
                  {isGenerated && (
                    <p className="text-xs text-green-600 mt-1">✓ 已生成</p>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>

        {/* 进度统计 */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
          <span className="text-gray-500">
            已完成 <span className="font-medium text-gray-900">{generatedBuckets.length}</span> / 3 个创意类型
          </span>
          <span className="text-gray-500">
            {generatedBuckets.length === 3 ? (
              <span className="text-green-600 font-medium">全部完成</span>
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
    </TooltipProvider>
  )
}
