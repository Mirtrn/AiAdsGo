'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Offer {
  id: number
  url: string
  brand: string
  category: string | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  scrapeStatus: string
  isActive: boolean
  createdAt: string
}

export default function OffersPage() {
  const router = useRouter()
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchOffers()
  }, [])

  const fetchOffers = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch('/api/offers', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
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
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <ul className="divide-y divide-gray-200">
                {offers.map((offer) => (
                  <li key={offer.id}>
                    <a
                      href={`/offers/${offer.id}`}
                      className="block hover:bg-gray-50 transition"
                    >
                      <div className="px-4 py-4 sm:px-6">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-lg font-medium text-indigo-600 truncate">
                              {offer.brand}
                            </p>
                            <p className="mt-1 text-sm text-gray-500 truncate">
                              {offer.url}
                            </p>
                          </div>
                          <div className="ml-2 flex-shrink-0 flex">
                            <span
                              className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getScrapeStatusColor(
                                offer.scrapeStatus
                              )}`}
                            >
                              {getScrapeStatusLabel(offer.scrapeStatus)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 sm:flex sm:justify-between">
                          <div className="sm:flex">
                            <p className="flex items-center text-sm text-gray-500">
                              <svg
                                className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              {offer.category || '未分类'}
                            </p>
                            <p className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0 sm:ml-6">
                              <svg
                                className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              {offer.targetCountry}
                            </p>
                          </div>
                          <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                            <p>
                              创建于{' '}
                              {new Date(offer.createdAt).toLocaleDateString('zh-CN')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
