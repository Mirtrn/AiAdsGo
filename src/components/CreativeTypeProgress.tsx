'use client'

/**
 * 🆕 v4.16: 创意类型进度指示器组件
 * 显示5个创意类型的生成状态：已生成、生成中、待生成
 */

import { CheckCircle2, Circle, Clock } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

interface CreativeTypeProgressProps {
  generatedBuckets: string[]
  offer: {
    page_type?: string | null
  }
}

// 单品链接的创意类型配置
const PRODUCT_BUCKETS = [
  { key: 'A', label: '产品型号导向', description: '标题包含具体产品型号参数', color: 'bg-blue-500' },
  { key: 'B', label: '购买意图导向', description: '描述包含价格和折扣信息', color: 'bg-green-500' },
  { key: 'C', label: '功能特性导向', description: '突出核心功能和技术参数', color: 'bg-purple-500' },
  { key: 'D', label: '紧迫促销导向', description: '包含限时/限量/立即行动元素', color: 'bg-amber-500' },
  { key: 'S', label: '综合推广', description: '平衡所有意图，Ad Strength最大化', color: 'bg-rose-500' },
]

// 店铺链接的创意类型配置
const STORE_BUCKETS = [
  { key: 'A', label: '品牌信任导向', description: '强调官方正品和品牌权威', color: 'bg-blue-500' },
  { key: 'B', label: '场景解决方案', description: '突出使用场景和痛点解决', color: 'bg-green-500' },
  { key: 'C', label: '精选推荐导向', description: '展示热销产品和店铺特色', color: 'bg-purple-500' },
  { key: 'D', label: '信任信号导向', description: '突出评价、退换货、售后', color: 'bg-amber-500' },
  { key: 'S', label: '店铺全景', description: '全面展示店铺产品线', color: 'bg-rose-500' },
]

export function CreativeTypeProgress({ generatedBuckets, offer }: CreativeTypeProgressProps) {
  const linkType = offer.page_type || 'product'
  const buckets = linkType === 'store' ? STORE_BUCKETS : PRODUCT_BUCKETS

  return (
    <TooltipProvider>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">创意类型进度</h3>
        <div className="flex items-center gap-2">
          {buckets.map((bucket) => {
            const isGenerated = generatedBuckets.includes(bucket.key)
            const isCurrent = generatedBuckets.length === buckets.findIndex(b => b.key === bucket.key)

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
            已完成 <span className="font-medium text-gray-900">{generatedBuckets.length}</span> / 5 个创意类型
          </span>
          <span className="text-gray-500">
            {generatedBuckets.length === 5 ? (
              <span className="text-green-600 font-medium">全部完成</span>
            ) : generatedBuckets.length === 0 ? (
              <span className="text-gray-400">点击生成开始</span>
            ) : (
              <span className="text-purple-600">
                下一个: {buckets[generatedBuckets.length]?.label}
              </span>
            )}
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
