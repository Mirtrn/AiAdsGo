'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface GoogleAdsAccount {
  id: number
  customerId: string
  accountName: string | null
  currency: string
  timezone: string
  isManagerAccount: boolean
  isActive: boolean
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

// P1-12: 闲置账号接口
interface IdleAccount {
  id: number
  customerId: string
  accountName: string | null
  isActive: boolean
  isIdle: boolean
  createdAt: string
  updatedAt: string
}

export default function GoogleAdsSettingsPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // P1-12: 闲置账号状态
  const [idleAccounts, setIdleAccounts] = useState<IdleAccount[]>([])
  const [idleLoading, setIdleLoading] = useState(false)

  useEffect(() => {
    fetchAccounts()
    fetchIdleAccounts() // P1-12: 同时获取闲置账号
  }, [])

  const fetchAccounts = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/google-ads-accounts', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取账号列表失败')
      }

      const data = await response.json()
      setAccounts(data.accounts || [])
    } catch (err: any) {
      setError(err.message || '获取账号列表失败')
    } finally {
      setLoading(false)
    }
  }

  // P1-12: 获取闲置账号列表
  const fetchIdleAccounts = async () => {
    try {
      setIdleLoading(true)
      const response = await fetch('/api/google-ads/idle-accounts', {
        credentials: 'include',
      })

      if (!response.ok) {
        // 静默失败，不影响主要功能
        console.error('获取闲置账号失败')
        return
      }

      const data = await response.json()
      setIdleAccounts(data.accounts || [])
    } catch (err: any) {
      console.error('获取闲置账号失败:', err)
    } finally {
      setIdleLoading(false)
    }
  }

  const handleConnectAccount = () => {
    // 重定向到OAuth授权页面
    window.location.href = '/api/auth/google-ads/authorize'
  }

  const handleToggleActive = async (accountId: number, currentStatus: boolean) => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/google-ads-accounts/${accountId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isActive: !currentStatus,
        }),
      })

      if (!response.ok) {
        throw new Error('更新账号状态失败')
      }

      setSuccess('账号状态更新成功')
      setTimeout(() => setSuccess(''), 3000)

      // 刷新账号列表
      await fetchAccounts()
    } catch (err: any) {
      setError(err.message || '更新账号状态失败')
    }
  }

  const handleDeleteAccount = async (accountId: number) => {
    if (!confirm('确定要删除这个Google Ads账号连接吗？\n\n删除后将无法使用该账号创建广告。')) {
      return
    }

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/google-ads-accounts/${accountId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('删除账号失败')
      }

      setSuccess('账号删除成功')
      setTimeout(() => setSuccess(''), 3000)

      // 刷新账号列表
      await fetchAccounts()
    } catch (err: any) {
      setError(err.message || '删除账号失败')
    }
  }

  const isTokenExpired = (expiresAt: string | null): boolean => {
    if (!expiresAt) return true
    return new Date(expiresAt) < new Date()
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
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
              <h1 className="text-xl font-bold text-gray-900">Google Ads账号管理</h1>
            </div>
            <div className="flex items-center">
              <button
                onClick={handleConnectAccount}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                + 连接新账号
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

          {success && (
            <div className="mb-4 bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded">
              {success}
            </div>
          )}

          {/* 连接说明 */}
          <div className="mb-6 bg-blue-50 border border-blue-400 text-blue-700 px-4 py-3 rounded">
            <p className="font-semibold">💡 关于Google Ads账号连接：</p>
            <ul className="mt-2 text-sm space-y-1">
              <li>• 连接Google Ads账号后，您可以直接通过"一键上广告"功能创建Google Ads广告</li>
              <li>• 系统使用OAuth安全授权，您的账号密码不会被存储</li>
              <li>• 您可以连接多个Google Ads账号，并设置其中一个为默认账号</li>
              <li>• 如果授权过期，系统会自动刷新，或提示您重新授权</li>
            </ul>
          </div>

          {/* 账号列表 */}
          {accounts.length === 0 ? (
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
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">未连接任何Google Ads账号</h3>
              <p className="mt-1 text-sm text-gray-500">点击上方按钮连接您的Google Ads账号</p>
              <div className="mt-6">
                <button
                  onClick={handleConnectAccount}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  + 连接Google Ads账号
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <div className="divide-y divide-gray-200">
                {accounts.map((account) => {
                  const tokenExpired = isTokenExpired(account.tokenExpiresAt)

                  return (
                    <div key={account.id} className="p-6 hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <h3 className="text-lg font-medium text-gray-900">
                              {account.accountName || `账号 ${account.customerId}`}
                            </h3>

                            {/* 状态标签 */}
                            <span
                              className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                account.isActive
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {account.isActive ? '激活' : '未激活'}
                            </span>

                            {tokenExpired && (
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                                授权过期
                              </span>
                            )}

                            {account.isManagerAccount && (
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                管理账号
                              </span>
                            )}
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-4 text-sm text-gray-500">
                            <div>
                              <span className="font-medium">Customer ID:</span>{' '}
                              <span className="font-mono">{account.customerId}</span>
                            </div>
                            <div>
                              <span className="font-medium">货币:</span> {account.currency}
                            </div>
                            <div>
                              <span className="font-medium">时区:</span> {account.timezone}
                            </div>
                            <div>
                              <span className="font-medium">连接时间:</span>{' '}
                              {formatDate(account.createdAt)}
                            </div>
                            {account.lastSyncAt && (
                              <div className="col-span-2">
                                <span className="font-medium">最后同步:</span>{' '}
                                {formatDate(account.lastSyncAt)}
                              </div>
                            )}
                          </div>

                          {tokenExpired && (
                            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                              <p className="text-sm text-yellow-800">
                                ⚠️ 授权已过期，请重新连接以继续使用该账号创建广告
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="ml-4 flex flex-col space-y-2">
                          {/* 激活/停用按钮 */}
                          <button
                            onClick={() => handleToggleActive(account.id, account.isActive)}
                            className={`px-4 py-2 text-sm rounded-md ${
                              account.isActive
                                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {account.isActive ? '停用' : '激活'}
                          </button>

                          {/* 重新连接按钮（如果授权过期） */}
                          {tokenExpired && (
                            <button
                              onClick={handleConnectAccount}
                              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                            >
                              重新连接
                            </button>
                          )}

                          {/* 删除按钮 */}
                          <button
                            onClick={() => handleDeleteAccount(account.id)}
                            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* P1-12: 闲置账号列表 */}
          {idleAccounts.length > 0 && (
            <div className="mt-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">闲置账号</h2>
                <span className="text-sm text-gray-500">
                  {idleAccounts.length} 个账号未关联到任何Offer
                </span>
              </div>

              <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg mb-4">
                <p className="text-sm">
                  💡 <strong>闲置账号</strong>: 这些Google Ads账号当前未关联到任何Offer。您可以在创建广告时选择这些账号，或者将现有Offer关联到这些账号。
                </p>
              </div>

              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <div className="divide-y divide-gray-200">
                  {idleAccounts.map((account) => (
                    <div key={account.id} className="p-4 hover:bg-gray-50 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-base font-medium text-gray-900">
                            {account.accountName || account.customerId}
                          </h3>
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-amber-100 text-amber-800">
                            闲置
                          </span>
                          {account.isActive && (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                              激活
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          <span className="font-medium">Customer ID:</span>{' '}
                          <span className="font-mono">{account.customerId}</span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <button
                          onClick={() => router.push('/offers')}
                          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                        >
                          关联到Offer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 使用说明 */}
          <div className="mt-6 bg-gray-50 border border-gray-300 text-gray-700 px-4 py-3 rounded">
            <p className="font-semibold">📖 使用说明：</p>
            <ul className="mt-2 text-sm space-y-1">
              <li>
                • <strong>激活账号</strong>: 只有激活的账号才会在"一键上广告"功能中被使用
              </li>
              <li>
                • <strong>默认账号</strong>: 如果有多个激活账号，系统将使用最新连接的账号
              </li>
              <li>
                • <strong>授权过期</strong>: OAuth授权会自动刷新，如果刷新失败会提示重新连接
              </li>
              <li>
                • <strong>删除账号</strong>: 删除后将无法使用该账号创建广告，但不影响已创建的广告
              </li>
              <li>
                • <strong>闲置账号</strong>: 未关联到任何Offer的账号，点击"关联到Offer"可快速建立关联
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
