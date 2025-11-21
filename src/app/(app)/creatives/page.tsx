'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { showSuccess, showError, showWarning, showConfirm } from '@/lib/toast-utils'

interface KeywordWithVolume {
  keyword: string
  searchVolume: number
  competition?: string
}

interface Sitelink {
  text: string
  url: string
  description?: string
}

interface Creative {
  id: number
  offer_id: number
  version: number
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  keywords_with_volume?: KeywordWithVolume[]
  callouts: string[]
  sitelinks: Sitelink[]
  final_url: string
  path_1: string | null
  path_2: string | null
  ai_model: string
  score: number | null
  is_approved: number
  approved_at: string | null
  ad_group_id: number | null
  ad_id: string | null
  creation_status: string
  creation_error: string | null
  last_sync_at: string | null
  created_at: string
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
  scrape_status: string
}

export default function CreativesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const offerId = searchParams?.get('offerId')

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
    headlines: ['', '', ''],
    descriptions: ['', ''],
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
      // HttpOnly Cookie自动携带，无需手动操作

      // 获取Offer信息
      const offerRes = await fetch(`/api/offers/${offerId}`, {
        credentials: 'include',
      })

      if (!offerRes.ok) {
        throw new Error('获取Offer失败')
      }

      const offerData = await offerRes.json()
      setOffer(offerData.offer)

      // 获取创意列表
      const creativesRes = await fetch(`/api/creatives?offerId=${offerId}`, {
        credentials: 'include',
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
            credentials: 'include',
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
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/offers/${offerId}/generate-creatives`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 3 }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '生成创意失败')
      }

      showSuccess('创意生成成功', `已生成 ${data.count} 组创意`)
      fetchOfferAndCreatives()
    } catch (err: any) {
      setError(err.message || '生成创意失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleApprove = async (creativeId: number, isApproved: number) => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const method = isApproved ? 'DELETE' : 'POST'
      const response = await fetch(`/api/creatives/${creativeId}/approve`, {
        method,
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(isApproved ? '取消批准失败' : '批准失败')
      }

      fetchOfferAndCreatives()
    } catch (err: any) {
      showError('操作失败', err.message)
    }
  }

  const handleDelete = async (creativeId: number) => {
    const confirmed = await showConfirm(
      '确认删除',
      '确定要删除这组创意吗？此操作不可撤销。'
    )

    if (!confirmed) {
      return
    }

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/creatives/${creativeId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('删除失败')
      }

      fetchOfferAndCreatives()
    } catch (err: any) {
      showError('删除失败', err.message)
    }
  }

  const startEdit = (creative: Creative) => {
    setEditingId(creative.id)
    setEditForm({
      headlines: [...creative.headlines, '', '', ''].slice(0, 3), // Ensure at least 3 slots
      descriptions: [...creative.descriptions, ''].slice(0, 2), // Ensure at least 2 slots
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({
      headlines: ['', '', ''],
      descriptions: ['', ''],
    })
  }

  const saveEdit = async (creativeId: number) => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // Filter out empty strings
      const updates = {
        headlines: editForm.headlines.filter(h => h.trim().length > 0),
        descriptions: editForm.descriptions.filter(d => d.trim().length > 0),
      }

      const response = await fetch(`/api/creatives/${creativeId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        throw new Error('更新失败')
      }

      cancelEdit()
      fetchOfferAndCreatives()
    } catch (err: any) {
      showError('更新失败', err.message)
    }
  }

  const handleAssignAdGroup = async (creativeId: number) => {
    if (!selectedAdGroupId) {
      showWarning('请选择Ad Group', '需要先选择一个Ad Group才能继续')
      return
    }

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/creatives/${creativeId}/assign-adgroup`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
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
      showSuccess('关联成功', '已成功关联到Ad Group')
    } catch (err: any) {
      showError('关联失败', err.message)
    }
  }

  const handleSyncToGoogleAds = async (creativeId: number) => {
    const confirmed = await showConfirm(
      '确认同步',
      '确定要将此Creative同步到Google Ads吗？'
    )

    if (!confirmed) {
      return
    }

    setSyncingId(creativeId)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/creatives/${creativeId}/sync`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '同步失败')
      }

      showSuccess('同步成功', 'Creative已成功同步到Google Ads')
      fetchOfferAndCreatives()
    } catch (err: any) {
      showError('同步失败', err.message)
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-indigo-100 mb-4">
            <svg className="h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h3 className="text-h3 mb-2">创意管理</h3>
          <p className="text-body text-muted-foreground mb-6">
            需要选择一个Offer才能查看和管理创意
          </p>
          <button
            onClick={() => router.push('/offers')}
            className="w-full px-4 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
          >
            前往选择 Offer
          </button>
          <p className="mt-4 helper-text">
            在Offer详情页中，您可以生成和管理AI创意
          </p>
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
              <h1 className="text-h3 font-bold text-gray-900">
                {offer?.brand} - AI创意管理
              </h1>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleGenerateCreatives}
                disabled={generating || offer?.scrape_status !== 'completed'}
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

          {offer?.scrape_status !== 'completed' && (
            <div className="mb-6 px-4 py-3 bg-yellow-50 border border-yellow-400 text-yellow-700 rounded">
              请先完成产品信息抓取后再生成创意
            </div>
          )}

          {creatives.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-body-lg text-muted-foreground mb-4">暂无创意</p>
              <button
                onClick={handleGenerateCreatives}
                disabled={generating || offer?.scrape_status !== 'completed'}
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
                    creative.is_approved === 1 ? 'border-2 border-green-500' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-h4 font-semibold text-gray-900">
                        版本 {creative.version}
                        {creative.is_approved === 1 && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">
                            已批准
                          </span>
                        )}
                        {creative.creation_status === 'synced' && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-800">
                            已同步
                          </span>
                        )}
                        {creative.creation_status === 'pending' && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">
                            同步中
                          </span>
                        )}
                        {creative.creation_status === 'failed' && (
                          <span className="ml-2 px-2 py-1 text-xs font-semibold rounded bg-red-100 text-red-800">
                            同步失败
                          </span>
                        )}
                      </h2>
                      <p className="text-body-sm text-muted-foreground">
                        创建时间: {new Date(creative.created_at).toLocaleString('zh-CN')}
                      </p>
                      {creative.ad_group_id && (
                        <p className="text-body-sm text-muted-foreground">
                          关联Ad Group:{' '}
                          {adGroups.find(ag => ag.id === creative.ad_group_id)?.adGroupName ||
                            `ID: ${creative.ad_group_id}`}
                        </p>
                      )}
                      {creative.last_sync_at && (
                        <p className="text-body-sm text-muted-foreground">
                          最后同步: {new Date(creative.last_sync_at).toLocaleString('zh-CN')}
                        </p>
                      )}
                      {creative.creation_error && (
                        <p className="text-sm text-red-600">错误: {creative.creation_error}</p>
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
                            disabled={creative.ad_id !== null}
                            className="px-3 py-1 text-sm text-gray-700 hover:text-gray-900 disabled:opacity-50"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleApprove(creative.id, creative.is_approved)}
                            className={`px-3 py-1 text-sm ${
                              creative.is_approved
                                ? 'text-yellow-600 hover:text-yellow-800'
                                : 'text-green-600 hover:text-green-800'
                            }`}
                          >
                            {creative.is_approved ? '取消批准' : '批准'}
                          </button>
                          {!creative.ad_group_id && adGroups.length > 0 && (
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
                          {creative.ad_group_id &&
                            !creative.ad_id &&
                            creative.creation_status !== 'pending' && (
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
                            disabled={creative.ad_id !== null}
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
                      {editForm.headlines.map((headline, index) => (
                        <div key={index}>
                          <label className="block label-text mb-1">
                            标题{index + 1} {index === 0 && '*'}
                          </label>
                          <input
                            type="text"
                            value={headline}
                            onChange={e => {
                              const newHeadlines = [...editForm.headlines]
                              newHeadlines[index] = e.target.value
                              setEditForm({ ...editForm, headlines: newHeadlines })
                            }}
                            maxLength={30}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          <p className="helper-text mt-1">
                            {headline.length}/30 字符
                          </p>
                        </div>
                      ))}
                      {editForm.descriptions.map((description, index) => (
                        <div key={index}>
                          <label className="block label-text mb-1">
                            描述{index + 1} {index === 0 && '*'}
                          </label>
                          <textarea
                            value={description}
                            onChange={e => {
                              const newDescriptions = [...editForm.descriptions]
                              newDescriptions[index] = e.target.value
                              setEditForm({ ...editForm, descriptions: newDescriptions })
                            }}
                            maxLength={90}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          <p className="helper-text mt-1">
                            {description.length}/90 字符
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Google Search Ad Preview */}
                      <div className="border border-gray-300 rounded-lg p-4 bg-white">
                        <p className="text-xs text-gray-500 mb-2">📱 广告预览 (Google Search)</p>
                        <div className="bg-gray-50 p-3 rounded">
                          <div className="text-xs text-green-700 mb-1">广告 · {offer?.url}</div>
                          <div className="text-lg text-blue-600 font-normal leading-snug mb-1">
                            {creative.headlines.slice(0, 3).join(' | ')}
                          </div>
                          <div className="text-xs text-gray-600 mb-1">
                            {new URL(creative.final_url).hostname}
                            {creative.path_1 && ` › ${creative.path_1}`}
                            {creative.path_2 && ` › ${creative.path_2}`}
                          </div>
                          <div className="text-sm text-gray-800 leading-relaxed">
                            {creative.descriptions.join(' ')}
                          </div>
                        </div>
                      </div>

                      {/* Creative Details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Headlines */}
                        <div className="bg-gray-50 p-3 rounded">
                          <p className="text-sm font-medium text-gray-700 mb-2">📝 Headlines ({creative.headlines.length})</p>
                          <div className="space-y-1">
                            {creative.headlines.map((headline, index) => (
                              <div key={index} className="flex justify-between items-center">
                                <span className="text-sm text-gray-900">{headline}</span>
                                <span className="text-xs text-gray-400">{headline.length}/30</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Descriptions */}
                        <div className="bg-gray-50 p-3 rounded">
                          <p className="text-sm font-medium text-gray-700 mb-2">📄 Descriptions ({creative.descriptions.length})</p>
                          <div className="space-y-1">
                            {creative.descriptions.map((description, index) => (
                              <div key={index} className="flex justify-between items-start">
                                <span className="text-sm text-gray-900 flex-1">{description}</span>
                                <span className="text-xs text-gray-400 ml-2">{description.length}/90</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Keywords with Search Volume */}
                        <div className="bg-blue-50 p-3 rounded">
                          <p className="text-sm font-medium text-gray-700 mb-2">🔑 Keywords ({creative.keywords?.length || 0})</p>
                          <div className="flex flex-wrap gap-2">
                            {(creative.keywords_with_volume || creative.keywords?.map(k => ({ keyword: k, searchVolume: 0 })) || []).map((kw, index) => (
                              <span
                                key={index}
                                className="inline-flex items-center px-2 py-1 text-xs rounded bg-blue-100 text-blue-800"
                              >
                                {typeof kw === 'string' ? kw : kw.keyword}
                                {typeof kw !== 'string' && kw.searchVolume > 0 && (
                                  <span className="ml-1 text-blue-600 font-medium">
                                    ({kw.searchVolume.toLocaleString()})
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Callouts */}
                        {creative.callouts && creative.callouts.length > 0 && (
                          <div className="bg-green-50 p-3 rounded">
                            <p className="text-sm font-medium text-gray-700 mb-2">✨ Callouts ({creative.callouts.length})</p>
                            <div className="flex flex-wrap gap-2">
                              {creative.callouts.map((callout, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center px-2 py-1 text-xs rounded bg-green-100 text-green-800"
                                >
                                  {callout}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Sitelinks */}
                        {creative.sitelinks && creative.sitelinks.length > 0 && (
                          <div className="bg-purple-50 p-3 rounded md:col-span-2">
                            <p className="text-sm font-medium text-gray-700 mb-2">🔗 Sitelinks ({creative.sitelinks.length})</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {creative.sitelinks.map((sitelink, index) => (
                                <div key={index} className="bg-white p-2 rounded border border-purple-200">
                                  <p className="text-sm font-medium text-purple-700">{sitelink.text}</p>
                                  <p className="text-xs text-gray-500 truncate">{sitelink.url}</p>
                                  {sitelink.description && (
                                    <p className="text-xs text-gray-600 mt-1">{sitelink.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Final URL & Score */}
                        <div className="md:col-span-2 flex justify-between items-center bg-gray-50 p-3 rounded">
                          <div>
                            <p className="text-sm font-medium text-gray-500">最终链接</p>
                            <a
                              href={creative.final_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-indigo-600 hover:text-indigo-500"
                            >
                              {creative.final_url}
                            </a>
                          </div>
                          {creative.score && (
                            <div className="text-right">
                              <p className="text-sm font-medium text-gray-500">质量评分</p>
                              <p className="text-lg font-bold text-indigo-600">{creative.score}/100</p>
                            </div>
                          )}
                        </div>
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
