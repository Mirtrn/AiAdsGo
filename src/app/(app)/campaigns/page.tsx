'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showSuccess, showError, showConfirm } from '@/lib/toast-utils'

interface Campaign {
  id: number
  offerId: number
  googleAdsAccountId: number
  campaignId: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  status: string
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
}

export default function CampaignsPage() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState<number | null>(null)

  useEffect(() => {
    fetchCampaigns()
  }, [])

  const fetchCampaigns = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/campaigns', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取广告系列列表失败')
      }

      const data = await response.json()
      setCampaigns(data.campaigns)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async (campaignId: number) => {
    setSyncing(campaignId)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/campaigns/${campaignId}/sync`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '同步失败')
      }

      showSuccess('同步成功', '广告系列已成功同步到Google Ads')
      fetchCampaigns() // 刷新列表
    } catch (err: any) {
      showError('同步失败', err.message)
    } finally {
      setSyncing(null)
    }
  }

  const handleDelete = async (campaignId: number, campaignName: string) => {
    const confirmed = await showConfirm(
      '确认删除',
      `确定要删除广告系列"${campaignName}"吗？`
    )

    if (!confirmed) {
      return
    }

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '删除失败')
      }

      fetchCampaigns() // 刷新列表
    } catch (err: any) {
      showError('删除失败', err.message)
    }
  }

  const getStatusBadge = (status: string) => {
    const badges = {
      ENABLED: 'bg-green-100 text-green-800',
      PAUSED: 'bg-yellow-100 text-yellow-800',
      REMOVED: 'bg-red-100 text-red-800',
    }
    return badges[status as keyof typeof badges] || 'bg-gray-100 text-gray-800'
  }

  const getCreationStatusBadge = (status: string) => {
    const badges = {
      draft: 'bg-gray-100 text-gray-800',
      pending: 'bg-blue-100 text-blue-800',
      synced: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    }
    return badges[status as keyof typeof badges] || 'bg-gray-100 text-gray-800'
  }

  const getCreationStatusText = (status: string) => {
    const texts = {
      draft: '草稿',
      pending: '同步中',
      synced: '已同步',
      failed: '同步失败',
    }
    return texts[status as keyof typeof texts] || status
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
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">广告系列管理</h1>
          <p className="text-gray-500 mt-2">管理和监控您的 Google Ads 广告系列</p>
        </div>

        {error && (
            <div className="mb-6 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {campaigns.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow">
              <p className="text-gray-600 mb-4">您还没有创建任何广告系列</p>
              <button
                onClick={() => router.push('/offers')}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                前往Offer列表创建广告系列
              </button>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      名称
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      预算
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状态
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      同步状态
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      创建时间
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {campaigns.map(campaign => (
                    <tr key={campaign.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {campaign.campaignName}
                        </div>
                        {campaign.campaignId && (
                          <div className="text-xs text-gray-500">ID: {campaign.campaignId}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          ${campaign.budgetAmount.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">{campaign.budgetType}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(
                            campaign.status
                          )}`}
                        >
                          {campaign.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getCreationStatusBadge(
                            campaign.creationStatus
                          )}`}
                        >
                          {getCreationStatusText(campaign.creationStatus)}
                        </span>
                        {campaign.creationError && (
                          <div className="text-xs text-red-600 mt-1">
                            {campaign.creationError}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(campaign.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                        {campaign.creationStatus === 'draft' && (
                          <button
                            onClick={() => handleSync(campaign.id)}
                            disabled={syncing === campaign.id}
                            className="text-indigo-600 hover:text-indigo-900 disabled:opacity-50"
                          >
                            {syncing === campaign.id ? '同步中...' : '同步到Google Ads'}
                          </button>
                        )}
                        {campaign.creationStatus === 'failed' && (
                          <button
                            onClick={() => handleSync(campaign.id)}
                            disabled={syncing === campaign.id}
                            className="text-orange-600 hover:text-orange-900 disabled:opacity-50"
                          >
                            {syncing === campaign.id ? '重试中...' : '重试同步'}
                          </button>
                        )}
                        <a
                          href={`/offers/${campaign.offerId}`}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          查看Offer
                        </a>
                        {campaign.creationStatus === 'draft' && (
                          <button
                            onClick={() => handleDelete(campaign.id, campaign.campaignName)}
                            className="text-red-600 hover:text-red-900"
                          >
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}
      </div>
    </div>
  )
}
