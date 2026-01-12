'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Campaign {
  id: string
  name: string
  status: string
  currentCpc: number
  currency: string
  adsCustomerId?: string | null
  adsAccountName?: string | null
}

interface AdjustCpcModalProps {
  isOpen: boolean
  onClose: () => void
  offer: {
    id: number
    offerName: string
    brand: string
  }
}

export default function AdjustCpcModal({ isOpen, onClose, offer }: AdjustCpcModalProps) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [cpcValues, setCpcValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isOpen) {
      fetchCampaigns()
    }
  }, [isOpen, offer.id])

  const fetchCampaigns = async () => {
    try {
      setLoading(true)
      setError('')
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/offers/${offer.id}/campaigns`, {
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || errorData?.message || '获取广告系列失败')
      }

      const data = await response.json()
      setCampaigns(data.campaigns || [])

      // Initialize CPC values with current values
      const initialCpc: Record<string, string> = {}
      data.campaigns.forEach((campaign: Campaign) => {
        initialCpc[campaign.id] = campaign.currentCpc.toFixed(2)
      })
      setCpcValues(initialCpc)
    } catch (err: any) {
      setError(err.message || '获取广告系列失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCpcChange = (campaignId: string, value: string) => {
    setCpcValues(prev => ({
      ...prev,
      [campaignId]: value
    }))
  }

  const handleUpdateCpc = async (campaignId: string) => {
    try {
      setUpdating(true)
      setError('')
      setSuccess('')
      // HttpOnly Cookie自动携带，无需手动操作

      const newCpc = parseFloat(cpcValues[campaignId])
      if (isNaN(newCpc) || newCpc <= 0) {
        setError('请输入有效的CPC值')
        return
      }

      const response = await fetch(`/api/campaigns/${campaignId}/update-cpc`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          newCpc: newCpc,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '更新CPC失败')
      }

      setSuccess(`广告系列 ${campaigns.find(c => c.id === campaignId)?.name} 的CPC已更新`)

      // Refresh campaigns list
      await fetchCampaigns()

      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || '更新CPC失败')
    } finally {
      setUpdating(false)
    }
  }

  const handleUpdateAllCpc = async () => {
    try {
      setUpdating(true)
      setError('')
      setSuccess('')

      let successCount = 0
      let failCount = 0

      for (const campaign of campaigns) {
        try {
          // HttpOnly Cookie自动携带，无需手动操作

          const newCpc = parseFloat(cpcValues[campaign.id])
          if (isNaN(newCpc) || newCpc <= 0) {
            failCount++
            continue
          }

          // Skip if CPC hasn't changed
          if (newCpc === campaign.currentCpc) {
            continue
          }

          const response = await fetch(`/api/campaigns/${campaign.id}/update-cpc`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include', // 确保发送cookie
            body: JSON.stringify({
              newCpc: newCpc,
            }),
          })

          if (response.ok) {
            successCount++
          } else {
            failCount++
          }
        } catch {
          failCount++
        }
      }

      if (successCount > 0) {
        setSuccess(`成功更新 ${successCount} 个广告系列的CPC${failCount > 0 ? `，${failCount} 个失败` : ''}`)
        await fetchCampaigns()
      } else {
        setError('所有更新均失败，请检查CPC值是否有效')
      }

      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || '批量更新CPC失败')
    } finally {
      setUpdating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b">
          <h3 className="text-xl font-semibold text-gray-900">
            调整CPC出价 - {offer.offerName}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

	        {/* Content */}
	        <div className="mt-4">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded">
              {success}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <span className="ml-3 text-gray-600">加载广告系列...</span>
            </div>
	          ) : campaigns.length === 0 ? (
            <div className="text-center py-12">
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">未找到广告系列</h3>
              <p className="mt-1 text-sm text-gray-500">
                该Offer还没有创建任何广告系列，请先使用"一键上广告"创建广告
              </p>
            </div>
	          ) : (
	            <>
              {/* Campaigns Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        广告系列名称
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Ads账户
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        状态
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        当前CPC
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        新CPC
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
	                  <tbody className="bg-white divide-y divide-gray-200">
	                    {campaigns.map((campaign) => (
	                      <tr key={campaign.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{campaign.name}</div>
                          <div className="text-xs text-gray-500">ID: {campaign.id}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{campaign.adsAccountName?.trim() || '未命名账号'}</div>
                          <div className="text-xs text-gray-500">
                            {campaign.adsCustomerId ? `CID: ${campaign.adsCustomerId}` : 'CID: (未知)'}
                          </div>
                        </td>
	                        <td className="px-6 py-4 whitespace-nowrap">
	                          <span
	                            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
	                              campaign.status === 'ENABLED'
	                                ? 'bg-green-100 text-green-800'
	                                : campaign.status === 'PAUSED'
	                                  ? 'bg-yellow-100 text-yellow-800'
	                                  : campaign.status === 'REMOVED'
	                                    ? 'bg-red-100 text-red-800'
	                                    : 'bg-gray-100 text-gray-800'
	                            }`}
	                          >
	                            {campaign.status === 'ENABLED'
	                              ? '启用'
	                              : campaign.status === 'PAUSED'
	                                ? '暂停'
	                                : campaign.status === 'REMOVED'
	                                  ? '已删除'
	                                  : `未知(${campaign.status || 'UNKNOWN'})`}
	                          </span>
	                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {campaign.currency} {campaign.currentCpc.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-sm text-gray-500 mr-2">{campaign.currency}</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={cpcValues[campaign.id] || ''}
                              onChange={(e) => handleCpcChange(campaign.id, e.target.value)}
                              className="w-24 px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="0.00"
                            />
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleUpdateCpc(campaign.id)}
                            disabled={updating || campaign.status !== 'ENABLED'}
                            className={`inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md ${
                              campaign.status === 'ENABLED'
                                ? 'text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'
                                : 'text-gray-400 bg-gray-200 cursor-not-allowed'
                            }`}
                          >
                            {updating ? '更新中...' : '更新'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Batch Update Button */}
              <div className="mt-6 flex items-center justify-between pt-4 border-t">
                <div className="text-sm text-gray-500">
                  💡 提示：修改CPC值后，点击"更新"按钮应用到对应广告系列，或点击"批量更新所有CPC"一次性更新所有修改
                </div>
                <button
                  onClick={handleUpdateAllCpc}
                  disabled={updating}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {updating ? '更新中...' : '批量更新所有CPC'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
