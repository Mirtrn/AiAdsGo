'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface UserInfo {
  id: number
  email: string
  displayName: string | null
  profilePicture: string | null
  role: string
  packageType: string
  packageExpiresAt: string | null
  createdAt: string
}

export default function DashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // 检查URL参数中是否有token（Google OAuth回调）
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      localStorage.setItem('auth_token', tokenParam)
      // 移除URL中的token参数
      router.replace('/dashboard')
    }

    fetchUserInfo()
  }, [searchParams])

  const fetchUserInfo = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('认证失败')
      }

      const data = await response.json()
      setUser(data.user)
    } catch (err: any) {
      setError(err.message || '获取用户信息失败')
      localStorage.removeItem('auth_token')
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    router.push('/login')
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

  if (error || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error || '加载失败'}</p>
          <button
            onClick={() => router.push('/login')}
            className="mt-4 text-indigo-600 hover:text-indigo-500"
          >
            返回登录
          </button>
        </div>
      </div>
    )
  }

  const packageLabels = {
    trial: '试用版',
    annual: '年卡',
    lifetime: '终身版',
    enterprise: '私有化部署',
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">AutoAds Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                {user.profilePicture && (
                  <img
                    src={user.profilePicture}
                    alt="Profile"
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <span className="text-sm text-gray-700">
                  {user.displayName || user.email}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                登出
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              欢迎回来，{user.displayName || '用户'}！
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">邮箱</p>
                <p className="text-lg font-semibold text-gray-900">{user.email}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">套餐类型</p>
                <p className="text-lg font-semibold text-gray-900">
                  {packageLabels[user.packageType as keyof typeof packageLabels]}
                </p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">角色</p>
                <p className="text-lg font-semibold text-gray-900">
                  {user.role === 'admin' ? '管理员' : '用户'}
                </p>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">注册时间</p>
                <p className="text-lg font-semibold text-gray-900">
                  {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">快速开始</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href="/offers"
                className="block p-6 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition"
              >
                <h4 className="text-lg font-semibold mb-2">Offer管理</h4>
                <p className="text-sm opacity-90">创建和管理您的Offer产品</p>
              </a>
              <a
                href="/campaigns"
                className="block p-6 bg-gradient-to-r from-green-500 to-teal-600 text-white rounded-lg hover:from-green-600 hover:to-teal-700 transition"
              >
                <h4 className="text-lg font-semibold mb-2">广告系列</h4>
                <p className="text-sm opacity-90">查看和管理Google Ads广告系列</p>
              </a>
              <a
                href="/settings"
                className="block p-6 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded-lg hover:from-purple-600 hover:to-pink-700 transition"
              >
                <h4 className="text-lg font-semibold mb-2">系统配置</h4>
                <p className="text-sm opacity-90">配置Google Ads和AI API密钥</p>
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
