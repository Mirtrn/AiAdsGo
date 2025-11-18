'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface Offer {
  id: number
  url: string
  brand: string
  category: string | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  uniqueSellingPoints: string | null
  productHighlights: string | null
  targetAudience: string | null
  scrape_status: string
  scrapeError: string | null
  scrapedAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function OfferDetailPage() {
  const router = useRouter()
  const params = useParams()
  const offerId = params.id as string

  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [scraping, setScraping] = useState(false)

  useEffect(() => {
    fetchOffer()
  }, [offerId])

  const fetchOffer = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}`, {
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        throw new Error('获取Offer失败')
      }

      const data = await response.json()
      setOffer(data.offer)
    } catch (err: any) {
      setError(err.message || '获取Offer失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('确定要删除这个Offer吗？此操作不可撤销。')) {
      return
    }

    setDeleting(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}`, {
        method: 'DELETE',
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        throw new Error('删除Offer失败')
      }

      router.push('/offers')
    } catch (err: any) {
      alert(err.message || '删除失败')
      setDeleting(false)
    }
  }

  const handleScrape = async () => {
    setScraping(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}/scrape`, {
        method: 'POST',
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '启动抓取失败')
      }

      alert('产品信息抓取已启动，请稍后刷新页面查看结果')

      // 3秒后自动刷新
      setTimeout(() => {
        fetchOffer()
      }, 3000)
    } catch (err: any) {
      alert(err.message || '启动抓取失败')
    } finally {
      setScraping(false)
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

  if (error || !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error || '加载失败'}</p>
          <button
            onClick={() => router.push('/offers')}
            className="mt-4 text-indigo-600 hover:text-indigo-500"
          >
            返回列表
          </button>
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
              <a href="/offers" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回列表
              </a>
              <h1 className="text-xl font-bold text-gray-900">{offer.brand}</h1>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => router.push(`/offers/${offerId}/edit`)}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                编辑
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                {deleting ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 抓取状态提示 */}
          <div className={`mb-6 px-4 py-3 rounded border ${
            offer.scrape_status === 'completed' ? 'bg-green-50 border-green-400 text-green-700' :
            offer.scrape_status === 'failed' ? 'bg-red-50 border-red-400 text-red-700' :
            offer.scrape_status === 'in_progress' ? 'bg-blue-50 border-blue-400 text-blue-700' :
            'bg-yellow-50 border-yellow-400 text-yellow-700'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getScrapeStatusColor(offer.scrape_status)}`}>
                  {getScrapeStatusLabel(offer.scrape_status)}
                </span>
                <span className="ml-3">
                  {offer.scrape_status === 'pending' && '产品信息等待抓取'}
                  {offer.scrape_status === 'in_progress' && '正在抓取产品信息...'}
                  {offer.scrape_status === 'completed' && `产品信息抓取完成 (${offer.scrapedAt ? new Date(offer.scrapedAt).toLocaleString('zh-CN') : ''})`}
                  {offer.scrape_status === 'failed' && `抓取失败: ${offer.scrapeError || '未知错误'}`}
                </span>
              </div>
              {(offer.scrape_status === 'pending' || offer.scrape_status === 'failed') && (
                <button
                  onClick={handleScrape}
                  disabled={scraping}
                  className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {scraping ? '启动中...' : offer.scrape_status === 'failed' ? '重新抓取' : '开始抓取'}
                </button>
              )}
            </div>
          </div>

          {/* 基础信息卡片 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">基础信息</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">品牌名称</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.brand}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">产品分类</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.category || '未分类'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">目标国家</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.targetCountry}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">状态</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${
                    offer.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {offer.isActive ? '启用' : '禁用'}
                  </span>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-gray-500">商品/店铺URL</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  <a href={offer.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-500">
                    {offer.url}
                  </a>
                </dd>
              </div>
              {offer.affiliateLink && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">联盟推广链接</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <a href={offer.affiliateLink} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-500">
                      {offer.affiliateLink}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* 产品描述卡片 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">产品描述</h2>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">品牌描述</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.brandDescription || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">独特卖点</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.uniqueSellingPoints || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">产品亮点</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.productHighlights || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">目标受众</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.targetAudience || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
            </dl>
          </div>

          {/* 系统信息卡片 */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">系统信息</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">创建时间</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(offer.createdAt).toLocaleString('zh-CN')}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">最后更新</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(offer.updatedAt).toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
          </div>

          {/* 快速操作 */}
          <div className="mt-6 flex space-x-3">
            <button
              onClick={() => router.push(`/creatives?offerId=${offerId}`)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              生成AI创意
            </button>
            <button
              onClick={() => router.push(`/campaigns/new?offerId=${offerId}`)}
              className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-md hover:bg-indigo-50"
            >
              创建广告系列
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
