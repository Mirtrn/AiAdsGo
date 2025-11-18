'use client'

import { useState } from 'react'
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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
    { code: 'US', name: '美国' },
    { code: 'GB', name: '英国' },
    { code: 'CA', name: '加拿大' },
    { code: 'AU', name: '澳大利亚' },
    { code: 'DE', name: '德国' },
    { code: 'FR', name: '法国' },
    { code: 'JP', name: '日本' },
    { code: 'CN', name: '中国' },
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

              {/* 产品描述（可选，可通过自动抓取填充） */}
              <div>
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
