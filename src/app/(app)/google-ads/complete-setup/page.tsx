'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function CompleteGoogleAdsSetup() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [customerId, setCustomerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [tokens, setTokens] = useState<any>(null)

  useEffect(() => {
    const tokensParam = searchParams?.get('tokens')
    if (tokensParam) {
      try {
        const parsedTokens = JSON.parse(decodeURIComponent(tokensParam))
        setTokens(parsedTokens)
      } catch (e) {
        setError('无效的token参数')
      }
    } else {
      setError('缺少token信息')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 验证customer_id格式（应该是10位数字）
      if (!/^\d{10}$/.test(customerId.replace(/-/g, ''))) {
        throw new Error('Customer ID格式无效，应为10位数字（如：123-456-7890）')
      }

      const cleanCustomerId = customerId.replace(/-/g, '')

      // 计算token过期时间
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

      // 创建Google Ads账号
      const response = await fetch('/api/google-ads-accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
},
        body: JSON.stringify({
          customerId: cleanCustomerId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: expiresAt,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '创建账号失败')
      }

      router.push('/settings?success=google_ads_connected')
    } catch (err: any) {
      setError(err.message || '设置失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (!tokens) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white shadow-md rounded-lg p-8 max-w-md w-full">
          <div className="text-center">
            <div className="text-red-600 text-xl mb-4">⚠️</div>
            <p className="text-gray-700">{error || '加载中...'}</p>
            <button
              onClick={() => router.push('/settings')}
              className="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              返回设置
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white shadow-md rounded-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">完成Google Ads设置</h1>

        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-900">
            <strong>提示：</strong>请输入您的Google Ads Customer ID。
            您可以在Google Ads后台右上角找到这个ID（格式：123-456-7890）。
          </p>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Google Ads Customer ID *
            </label>
            <input
              type="text"
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              required
              placeholder="123-456-7890"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500">可以包含或不包含连字符</p>
          </div>

          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '设置中...' : '完成设置'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/settings')}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            <strong>如何找到Customer ID：</strong>
          </p>
          <ol className="mt-2 text-xs text-gray-600 list-decimal list-inside space-y-1">
            <li>登录 ads.google.com</li>
            <li>点击右上角的工具图标</li>
            <li>在"设置"下找到"账号设置"</li>
            <li>Customer ID显示在页面顶部</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
