'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LaunchAdModal from '@/components/LaunchAdModal'
import AdjustCpcModal from '@/components/AdjustCpcModal'

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
  // 新增字段（需求1和需求5）
  offerName: string | null
  targetLanguage: string | null
  // 需求28：产品价格和佣金比例
  productPrice?: string | null
  commissionPayout?: string | null
}

export default function OffersPage() {
  const router = useRouter()
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Launch Ad Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)

  // Adjust CPC Modal state
  const [isAdjustCpcModalOpen, setIsAdjustCpcModalOpen] = useState(false)
  const [selectedOfferForCpc, setSelectedOfferForCpc] = useState<Offer | null>(null)

  useEffect(() => {
    fetchOffers()
  }, [])

  const fetchOffers = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动获取token
      const response = await fetch('/api/offers', {
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        // Middleware会自动重定向未认证用户到登录页
        throw new Error('获取Offer列表失败')
      }

      const data = await response.json()
      setOffers(data.offers)
    } catch (err: any) {
      setError(err.message || '获取Offer列表失败')
    } finally {
      setLoading(false)
    }
  }

  const getScrapeStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      pending: '等待抓取',
      in_progress: '抓取中',
      completed: '已完成',
      failed: '失败',
    }
    return labels[status] || status
  }

  const getScrapeStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href="/dashboard" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回Dashboard
              </a>
              <h1 className="text-xl font-bold text-gray-900">Offer管理</h1>
            </div>
            <div className="flex items-center">
              <button
                onClick={() => router.push('/offers/new')}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                + 创建Offer
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {offers.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow">
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
              <h3 className="mt-2 text-sm font-medium text-gray-900">暂无Offer</h3>
              <p className="mt-1 text-sm text-gray-500">点击上方按钮创建您的第一个Offer</p>
              <div className="mt-6">
                <button
                  onClick={() => router.push('/offers/new')}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  + 创建Offer
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Offer标识
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      品牌名称
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      推广国家
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      推广语言
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状态
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {offers.map((offer) => (
                    <tr key={offer.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <a
                          href={`/offers/${offer.id}`}
                          className="text-sm font-mono font-medium text-indigo-600 hover:text-indigo-900"
                        >
                          {offer.offerName || `${offer.brand}_${offer.targetCountry}_01`}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{offer.brand}</div>
                        <div className="text-sm text-gray-500 truncate max-w-xs">{offer.url}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{offer.targetCountry}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{offer.targetLanguage || 'English'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getScrapeStatusColor(
                            offer.scrape_status
                          )}`}
                        >
                          {getScrapeStatusLabel(offer.scrape_status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          {/* 需求2: 一键上广告按钮 */}
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              setSelectedOffer(offer)
                              setIsModalOpen(true)
                            }}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            title="快速创建并发布Google Ads广告"
                          >
                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                            </svg>
                            一键上广告
                          </button>

                          {/* 需求2: 一键调整CPC按钮 */}
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              setSelectedOfferForCpc(offer)
                              setIsAdjustCpcModalOpen(true)
                            }}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            title="手动调整广告系列的CPC出价"
                          >
                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                            </svg>
                            一键调整CPC
                          </button>

                          {/* 查看详情链接 */}
                          <a
                            href={`/offers/${offer.id}`}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                          >
                            查看详情
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Launch Ad Modal - Requirement 3 */}
      {selectedOffer && (
        <LaunchAdModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false)
            setSelectedOffer(null)
          }}
          offer={{
            id: selectedOffer.id,
            offerName: selectedOffer.offerName || `${selectedOffer.brand}_${selectedOffer.targetCountry}_01`,
            brand: selectedOffer.brand,
            targetCountry: selectedOffer.targetCountry,
            targetLanguage: selectedOffer.targetLanguage || 'English',
            url: selectedOffer.url,
            affiliateLink: selectedOffer.affiliateLink || selectedOffer.url,
            // 需求28：产品价格和佣金比例
            productPrice: selectedOffer.productPrice,
            commissionPayout: selectedOffer.commissionPayout,
          }}
        />
      )}

      {/* Adjust CPC Modal - Requirement 2 */}
      {selectedOfferForCpc && (
        <AdjustCpcModal
          isOpen={isAdjustCpcModalOpen}
          onClose={() => {
            setIsAdjustCpcModalOpen(false)
            setSelectedOfferForCpc(null)
          }}
          offer={{
            id: selectedOfferForCpc.id,
            offerName: selectedOfferForCpc.offerName || `${selectedOfferForCpc.brand}_${selectedOfferForCpc.targetCountry}_01`,
            brand: selectedOfferForCpc.brand,
          }}
        />
      )}
    </div>
  )
}
