'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

export default function NewOfferPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 表单状态
  const [url, setUrl] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [targetCountry, setTargetCountry] = useState('US')
  const [affiliateLink, setAffiliateLink] = useState('')
  const [brandDescription, setBrandDescription] = useState('')
  const [uniqueSellingPoints, setUniqueSellingPoints] = useState('')
  const [productHighlights, setProductHighlights] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  // 需求28：产品价格和佣金比例（可选）
  const [productPrice, setProductPrice] = useState('')
  const [commissionPayout, setCommissionPayout] = useState('')

  // ========== 需求1和需求5: 实时预览自动生成的字段 ==========
  // 国家到语言的映射
  const getTargetLanguage = (countryCode: string): string => {
    const mapping: Record<string, string> = {
      'US': 'English', 'GB': 'English', 'CA': 'English', 'AU': 'English',
      'DE': 'German', 'FR': 'French', 'ES': 'Spanish', 'IT': 'Italian',
      'JP': 'Japanese', 'CN': 'Chinese', 'KR': 'Korean',
      'MX': 'Spanish', 'BR': 'Portuguese', 'NL': 'Dutch',
      'SE': 'Swedish', 'NO': 'Norwegian', 'DK': 'Danish', 'FI': 'Finnish',
      'PL': 'Polish', 'IN': 'Hindi', 'TH': 'Thai', 'VN': 'Vietnamese',
    }
    return mapping[countryCode] || 'English'
  }

  // 自动生成Offer预览名称（品牌_国家_01）
  const offerNamePreview = useMemo(() => {
    if (!brand.trim() || !targetCountry) return '请先填写品牌名称和国家'
    return `${brand.trim()}_${targetCountry}_01`
  }, [brand, targetCountry])

  // 自动推导推广语言
  const targetLanguagePreview = useMemo(() => {
    return getTargetLanguage(targetCountry)
  }, [targetCountry])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          url,
          brand,
          category: category || undefined,
          target_country: targetCountry,
          affiliate_link: affiliateLink || undefined,
          brand_description: brandDescription || undefined,
          unique_selling_points: uniqueSellingPoints || undefined,
          product_highlights: productHighlights || undefined,
          target_audience: targetAudience || undefined,
          // 需求28：产品价格和佣金比例（可选）
          product_price: productPrice || undefined,
          commission_payout: commissionPayout || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '创建Offer失败')
      }

      // 跳转到Offer详情页
      router.push(`/offers/${data.offer.id}`)
    } catch (err: any) {
      setError(err.message || '创建Offer失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const countries = [
    // 英语国家
    { code: 'US', name: '美国 (US)' },
    { code: 'GB', name: '英国 (GB)' },
    { code: 'CA', name: '加拿大 (CA)' },
    { code: 'AU', name: '澳大利亚 (AU)' },
    // 欧洲国家
    { code: 'DE', name: '德国 (DE)' },
    { code: 'FR', name: '法国 (FR)' },
    { code: 'ES', name: '西班牙 (ES)' },
    { code: 'IT', name: '意大利 (IT)' },
    { code: 'NL', name: '荷兰 (NL)' },
    { code: 'SE', name: '瑞典 (SE)' },
    { code: 'NO', name: '挪威 (NO)' },
    { code: 'DK', name: '丹麦 (DK)' },
    { code: 'FI', name: '芬兰 (FI)' },
    { code: 'PL', name: '波兰 (PL)' },
    // 亚太国家
    { code: 'JP', name: '日本 (JP)' },
    { code: 'CN', name: '中国 (CN)' },
    { code: 'KR', name: '韩国 (KR)' },
    { code: 'IN', name: '印度 (IN)' },
    { code: 'TH', name: '泰国 (TH)' },
    { code: 'VN', name: '越南 (VN)' },
    // 拉丁美洲
    { code: 'MX', name: '墨西哥 (MX)' },
    { code: 'BR', name: '巴西 (BR)' },
  ]

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href="/offers" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回列表
              </a>
              <h1 className="text-xl font-bold text-gray-900">创建Offer</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="bg-white shadow rounded-lg p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 基础信息 */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">基础信息</h3>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="url" className="block text-sm font-medium text-gray-700">
                      商品/店铺URL *
                    </label>
                    <input
                      type="url"
                      id="url"
                      required
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="https://www.amazon.com/stores/page/..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      这是您的最终着陆页URL，将用于Google Ads广告
                    </p>
                  </div>

                  <div>
                    <label htmlFor="brand" className="block text-sm font-medium text-gray-700">
                      品牌名称 *
                    </label>
                    <input
                      type="text"
                      id="brand"
                      required
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="Reolink"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="category" className="block text-sm font-medium text-gray-700">
                        产品分类
                      </label>
                      <input
                        type="text"
                        id="category"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        placeholder="安防监控"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      />
                    </div>

                    <div>
                      <label htmlFor="targetCountry" className="block text-sm font-medium text-gray-700">
                        目标国家 *
                      </label>
                      <select
                        id="targetCountry"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        value={targetCountry}
                        onChange={(e) => setTargetCountry(e.target.value)}
                      >
                        {countries.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.name} ({country.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="affiliateLink" className="block text-sm font-medium text-gray-700">
                      联盟推广链接
                    </label>
                    <input
                      type="url"
                      id="affiliateLink"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="https://pboost.me/UKTs4I6"
                      value={affiliateLink}
                      onChange={(e) => setAffiliateLink(e.target.value)}
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      如果有联盟链接，可以在这里填写（可选）
                    </p>
                  </div>
                </div>
              </div>

              {/* ========== 需求28：定价信息（可选）========== */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  定价信息
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    （可选，用于计算建议最大CPC）
                  </span>
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="productPrice" className="block text-sm font-medium text-gray-700">
                      产品价格 (Product Price)
                    </label>
                    <input
                      type="text"
                      id="productPrice"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="$699.00 或 ¥5999.00"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      产品的售价，包含货币符号
                    </p>
                  </div>

                  <div>
                    <label htmlFor="commissionPayout" className="block text-sm font-medium text-gray-700">
                      佣金比例 (Commission Payout)
                    </label>
                    <input
                      type="text"
                      id="commissionPayout"
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="6.75%"
                      value={commissionPayout}
                      onChange={(e) => setCommissionPayout(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      联盟佣金比例，包含%符号
                    </p>
                  </div>
                </div>

                {productPrice && commissionPayout && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-sm text-blue-800">
                      <strong>💡 建议最大CPC</strong>: 在"一键上广告"流程中，系统将根据
                      <code className="mx-1 px-1.5 py-0.5 bg-blue-100 rounded">产品价格 × 佣金比例 ÷ 50</code>
                      公式计算建议的最大CPC出价
                    </p>
                    <p className="mt-1 text-xs text-blue-600">
                      示例：$699.00 × 6.75% ÷ 50 = $0.94（假设50个点击出一单）
                    </p>
                  </div>
                )}
              </div>

              {/* ========== 自动生成信息（需求1和需求5）========== */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  自动生成信息
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    （系统自动生成，无需手动输入）
                  </span>
                </h3>

                <div className="space-y-4 bg-gray-50 p-4 rounded-md">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Offer标识 (Offer Name)
                    </label>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-gray-900 font-mono">
                        {offerNamePreview}
                      </div>
                      <span className="text-xs text-gray-500">自动生成</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      格式：[品牌名称]_[推广国家]_[序号]，用于唯一标识此Offer
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      推广语言 (Target Language)
                    </label>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-gray-900">
                        {targetLanguagePreview}
                      </div>
                      <span className="text-xs text-gray-500">根据国家自动映射</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      广告文案将使用此语言生成，确保符合目标市场
                    </p>
                  </div>

                  {/* 验证提示 */}
                  {brand && brand.length > 25 && (
                    <div className="flex items-start space-x-2 text-sm text-red-600">
                      <svg className="w-5 h-5 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <span>品牌名称过长（当前{brand.length}字符，最多25字符），请缩短</span>
                    </div>
                  )}

                  {brand && targetCountry && brand.length <= 25 && (
                    <div className="flex items-start space-x-2 text-sm text-green-600">
                      <svg className="w-5 h-5 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span>将自动生成Offer标识：{offerNamePreview}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 产品描述（可选，可通过自动抓取填充） */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  产品描述
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    （可选，留空将自动抓取）
                  </span>
                </h3>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="brandDescription" className="block text-sm font-medium text-gray-700">
                      品牌描述
                    </label>
                    <textarea
                      id="brandDescription"
                      rows={3}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="品牌的整体介绍和定位..."
                      value={brandDescription}
                      onChange={(e) => setBrandDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor="uniqueSellingPoints" className="block text-sm font-medium text-gray-700">
                      独特卖点
                    </label>
                    <textarea
                      id="uniqueSellingPoints"
                      rows={3}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="产品的核心优势和差异化特点..."
                      value={uniqueSellingPoints}
                      onChange={(e) => setUniqueSellingPoints(e.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor="productHighlights" className="block text-sm font-medium text-gray-700">
                      产品亮点
                    </label>
                    <textarea
                      id="productHighlights"
                      rows={3}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="关键功能和特性..."
                      value={productHighlights}
                      onChange={(e) => setProductHighlights(e.target.value)}
                    />
                  </div>

                  <div>
                    <label htmlFor="targetAudience" className="block text-sm font-medium text-gray-700">
                      目标受众
                    </label>
                    <textarea
                      id="targetAudience"
                      rows={2}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="目标客户群体特征..."
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* 提交按钮 */}
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => router.push('/offers')}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? '创建中...' : '创建Offer'}
                </button>
              </div>
            </form>
          </div>

          <div className="mt-4 bg-blue-50 border border-blue-400 text-blue-700 px-4 py-3 rounded">
            <p className="font-semibold">💡 提示：</p>
            <ul className="mt-2 text-sm space-y-1">
              <li>• 如果留空产品描述字段，系统将自动从URL抓取产品信息</li>
              <li>• 自动抓取使用AI分析，可能需要几分钟时间</li>
              <li>• 创建后可以在详情页面查看抓取进度和编辑信息</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
