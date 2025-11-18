'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Creative {
  id: number
  offerId: number
  version: number
  headline1: string
  headline2: string | null
  headline3: string | null
  description1: string
  description2: string | null
  finalUrl: string
  path1: string | null
  path2: string | null
  aiModel: string
  qualityScore: number | null
  isApproved: boolean
  approvedAt: string | null
  adGroupId: number | null
  adId: string | null
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  createdAt: string
}

interface AdGroup {
  id: number
  adGroupName: string
  campaignId: number
  status: string
}

interface Offer {
  id: number
  brand: string
  url: string
  targetCountry: string
  scrapeStatus: string
}

export default function CreativesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const offerId = searchParams.get('offerId')

  const [creatives, setCreatives] = useState<Creative[]>([])
  const [offer, setOffer] = useState<Offer | null>(null)
  const [adGroups, setAdGroups] = useState<AdGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [assigningId, setAssigningId] = useState<number | null>(null)
  const [selectedAdGroupId, setSelectedAdGroupId] = useState<number | null>(null)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({
    headline1: '',
    headline2: '',
    headline3: '',
    description1: '',
    description2: '',
  })

  useEffect(() => {
    if (offerId) {
      fetchOfferAndCreatives()
    } else {
      setError('缺少offerId参数')
      setLoading(false)
    }
  }, [offerId])

  const fetchOfferAndCreatives = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      // 获取Offer信息
      const offerRes = await fetch(`/api/offers/${offerId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!offerRes.ok) {
        throw new Error('获取Offer失败')
      }

      const offerData = await offerRes.json()
      setOffer(offerData.offer)

      // 获取创意列表
      const creativesRes = await fetch(`/api/creatives?offerId=${offerId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!creativesRes.ok) {
        throw new Error('获取创意列表失败')
      }

      const creativesData = await creativesRes.json()
      setCreatives(creativesData.creatives)

      // 获取Ad Groups列表 (如果Offer关联了Campaign)
      if (offerData.offer.campaignId) {
        const adGroupsRes = await fetch(
          `/api/ad-groups?campaignId=${offerData.offer.campaignId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        )

        if (adGroupsRes.ok) {
          const adGroupsData = await adGroupsRes.json()
          setAdGroups(adGroupsData.adGroups)
        }
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateCreatives = async () => {
    setGenerating(true)
    setError('')

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch(`/api/offers/${offerId}/generate-creatives`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ count: 3 }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '生成创意失败')
      }

      alert(`成功生成${data.count}组创意！`)
      fetchOfferAndCreatives()
    } catch (err: any) {
      setError(err.message || '生成创意失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleApprove = async (creativeId: number, isApproved: boolean) => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const method = isApproved ? 'DELETE' : 'POST'
      const response = await fetch(`/api/creatives/${creativeId}/approve`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error(isApproved ? '取消批准失败' : '批准失败')
      }

      fetchOfferAndCreatives()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleDelete = async (creativeId: number) => {
    if (!confirm('确定要删除这组创意吗？此操作不可撤销。')) {
      return
    }

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch(`/api/creatives/${creativeId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('删除失败')
      }

      fetchOfferAndCreatives()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const startEdit = (creative: Creative) => {
    setEditingId(creative.id)
    setEditForm({
      headline1: creative.headline1,
      headline2: creative.headline2 || '',
      headline3: creative.headline3 || '',
      description1: creative.description1,
      description2: creative.description2 || '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({
      headline1: '',
      headline2: '',
      headline3: '',
      description1: '',
      description2: '',
    })
  }

  const saveEdit = async (creativeId: number) => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch(`/api/creatives/${creativeId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm),
      })

      if (!response.ok) {
        throw new Error('更新失败')
      }

      cancelEdit()
      fetchOfferAndCreatives()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleAssignAdGroup = async (creativeId: number) => {
    if (!selectedAdGroupId) {
      alert('请选择一个Ad Group')
      return
    }

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch(`/api/creatives/${creativeId}/assign-adgroup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ adGroupId: selectedAdGroupId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '关联失败')
      }

      setAssigningId(null)
      setSelectedAdGroupId(null)
      fetchOfferAndCreatives()
      alert('已成功关联到Ad Group')
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleSyncToGoogleAds = async (creativeId: number) => {
    if (!confirm('确定要将此Creative同步到Google Ads吗？')) {
      return
    }

    setSyncingId(creativeId)

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch(`/api/creatives/${creativeId}/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '同步失败')
      }

      alert('Creative已成功同步到Google Ads！')
      fetchOfferAndCreatives()
    } catch (err: any) {
      alert(`同步失败：${err.message}`)
    } finally {
      setSyncingId(null)
    }
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

  if (error && !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error}</p>
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
              <a
                href={`/offers/${offerId}`}
                className="text-indigo-600 hover:text-indigo-500 mr-4"
              >
                ← 返回Offer
              </a>
              <h1 className="text-xl font-bold text-gray-900">
                {offer?.brand} - AI创意管理
              </h1>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleGenerateCreatives}
                disabled={generating || offer?.scrapeStatus !== 'completed'}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {generating ? '生成中...' : '生成新创意'}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-6 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {offer?.scrapeStatus !== 'completed' && (
            <div className="mb-6 px-4 py-3 bg-yellow-50 border border-yellow-400 text-yellow-700 rounded">
              请先完成产品信息抓取后再生成创意
            </div>
          )}

          {creatives.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg mb-4">暂无创意</p>
              <button
                onClick={handleGenerateCreatives}
                disabled={generating || offer?.scrapeStatus !== 'completed'}
                className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {generating ? '生成中...' : '生成第一组创意'}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {creatives.map(creative => (
                <div
                  key={creative.id}
                  className={`bg-white shadow rounded-lg p-6 ${
                    creative.isApproved ? 'border-2 border-green-500' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        版本 {creative.version}
                        {creative.isApproved && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">
                            已批准
                          </span>
                        )}
                        {creative.creationStatus === 'synced' && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-800">
                            已同步
                          </span>
                        )}
                        {creative.creationStatus === 'pending' && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">
                            同步中
                          </span>
                        )}
                        {creative.creationStatus === 'failed' && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-red-100 text-red-800">
                            同步失败
                          </span>
                        )}
                      </h2>
                      <p className="text-sm text-gray-500">
                        创建时间: {new Date(creative.createdAt).toLocaleString('zh-CN')}
                      </p>
                      {creative.adGroupId && (
                        <p className="text-sm text-gray-500">
                          关联Ad Group:{' '}
                          {adGroups.find(ag => ag.id === creative.adGroupId)?.adGroupName ||
                            `ID: ${creative.adGroupId}`}
                        </p>
                      )}
                      {creative.lastSyncAt && (
                        <p className="text-sm text-gray-500">
                          最后同步: {new Date(creative.lastSyncAt).toLocaleString('zh-CN')}
                        </p>
                      )}
                      {creative.creationError && (
                        <p className="text-sm text-red-600">错误: {creative.creationError}</p>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      {editingId === creative.id ? (
                        <>
                          <button
                            onClick={() => saveEdit(creative.id)}
                            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
                          >
                            取消
                          </button>
                        </>
                      ) : assigningId === creative.id ? (
                        <>
                          <select
                            value={selectedAdGroupId || ''}
                            onChange={e => setSelectedAdGroupId(parseInt(e.target.value, 10))}
                            className="px-2 py-1 text-sm border border-gray-300 rounded"
                          >
                            <option value="">选择Ad Group</option>
                            {adGroups.map(ag => (
                              <option key={ag.id} value={ag.id}>
                                {ag.adGroupName}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAssignAdGroup(creative.id)}
                            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            确认
                          </button>
                          <button
                            onClick={() => {
                              setAssigningId(null)
                              setSelectedAdGroupId(null)
                            }}
                            className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(creative)}
                            disabled={creative.adId !== null}
                            className="px-3 py-1 text-sm text-gray-700 hover:text-gray-900 disabled:opacity-50"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleApprove(creative.id, creative.isApproved)}
                            className={`px-3 py-1 text-sm ${
                              creative.isApproved
                                ? 'text-yellow-600 hover:text-yellow-800'
                                : 'text-green-600 hover:text-green-800'
                            }`}
                          >
                            {creative.isApproved ? '取消批准' : '批准'}
                          </button>
                          {!creative.adGroupId && adGroups.length > 0 && (
                            <button
                              onClick={() => {
                                setAssigningId(creative.id)
                                setSelectedAdGroupId(null)
                              }}
                              className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
                            >
                              关联Ad Group
                            </button>
                          )}
                          {creative.adGroupId &&
                            !creative.adId &&
                            creative.creationStatus !== 'pending' && (
                              <button
                                onClick={() => handleSyncToGoogleAds(creative.id)}
                                disabled={syncingId === creative.id}
                                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                {syncingId === creative.id ? '同步中...' : '同步到Google Ads'}
                              </button>
                            )}
                          <button
                            onClick={() => handleDelete(creative.id)}
                            disabled={creative.adId !== null}
                            className="px-3 py-1 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                          >
                            删除
                          </button>
                          <button
                            onClick={() =>
                              router.push(
                                `/launch-score?offerId=${offerId}&creativeId=${creative.id}`
                              )
                            }
                            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                          >
                            Launch Score
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {editingId === creative.id ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          标题1 *
                        </label>
                        <input
                          type="text"
                          value={editForm.headline1}
                          onChange={e => setEditForm({ ...editForm, headline1: e.target.value })}
                          maxLength={30}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {editForm.headline1.length}/30 字符
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          标题2
                        </label>
                        <input
                          type="text"
                          value={editForm.headline2}
                          onChange={e => setEditForm({ ...editForm, headline2: e.target.value })}
                          maxLength={30}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          标题3
                        </label>
                        <input
                          type="text"
                          value={editForm.headline3}
                          onChange={e => setEditForm({ ...editForm, headline3: e.target.value })}
                          maxLength={30}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          描述1 *
                        </label>
                        <textarea
                          value={editForm.description1}
                          onChange={e =>
                            setEditForm({ ...editForm, description1: e.target.value })
                          }
                          maxLength={90}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {editForm.description1.length}/90 字符
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          描述2
                        </label>
                        <textarea
                          value={editForm.description2}
                          onChange={e =>
                            setEditForm({ ...editForm, description2: e.target.value })
                          }
                          maxLength={90}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Google Search Ad Preview */}
                      <div className="border border-gray-300 rounded-lg p-4 bg-white">
                        <p className="text-xs text-gray-500 mb-2">📱 广告预览 (Google Search)</p>
                        <div className="bg-gray-50 p-3 rounded">
                          <div className="text-xs text-green-700 mb-1">广告 · {offer?.url}</div>
                          <div className="text-lg text-blue-600 font-normal leading-snug mb-1">
                            {creative.headline1}
                            {creative.headline2 && ` | ${creative.headline2}`}
                            {creative.headline3 && ` | ${creative.headline3}`}
                          </div>
                          <div className="text-xs text-gray-600 mb-1">
                            {new URL(creative.finalUrl).hostname}
                            {creative.path1 && ` › ${creative.path1}`}
                            {creative.path2 && ` › ${creative.path2}`}
                          </div>
                          <div className="text-sm text-gray-800 leading-relaxed">
                            {creative.description1}
                            {creative.description2 && ` ${creative.description2}`}
                          </div>
                        </div>
                      </div>

                      {/* Creative Details */}
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-medium text-gray-500">标题</p>
                          <p className="text-sm text-gray-900">{creative.headline1}</p>
                          {creative.headline2 && (
                            <p className="text-sm text-gray-900">{creative.headline2}</p>
                          )}
                          {creative.headline3 && (
                            <p className="text-sm text-gray-900">{creative.headline3}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-500">描述</p>
                          <p className="text-sm text-gray-900">{creative.description1}</p>
                          {creative.description2 && (
                            <p className="text-sm text-gray-900">{creative.description2}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-500">最终链接</p>
                          <a
                            href={creative.finalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-indigo-600 hover:text-indigo-500"
                          >
                            {creative.finalUrl}
                          </a>
                        </div>
                        {creative.qualityScore && (
                          <div>
                            <p className="text-sm font-medium text-gray-500">质量评分</p>
                            <p className="text-sm text-gray-900">{creative.qualityScore}/100</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
