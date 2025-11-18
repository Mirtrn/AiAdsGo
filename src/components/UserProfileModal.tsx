'use client'

import { useState } from 'react'
import ChangePasswordModal from './ChangePasswordModal'

interface UserProfileModalProps {
  isOpen: boolean
  onClose: () => void
  user: {
    username: string | null
    email: string
    displayName: string | null
    profilePicture: string | null
    role: string
    packageType: string
    validFrom: string | null
    validUntil: string | null
    createdAt: string
  }
}

export default function UserProfileModal({ isOpen, onClose, user }: UserProfileModalProps) {
  const [showChangePassword, setShowChangePassword] = useState(false)

  if (!isOpen) return null

  const packageLabels: Record<string, string> = {
    trial: '试用版',
    annual: '年卡版',
    lifetime: '终身版',
    enterprise: '私有化部署',
  }

  const packageColors: Record<string, string> = {
    trial: 'bg-gray-100 text-gray-800',
    annual: 'bg-blue-100 text-blue-800',
    lifetime: 'bg-green-100 text-green-800',
    enterprise: 'bg-purple-100 text-purple-800',
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  // 计算剩余天数
  const calculateRemainingDays = () => {
    if (!user.validUntil) return null
    const today = new Date()
    const expiryDate = new Date(user.validUntil)
    const diffTime = expiryDate.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const remainingDays = calculateRemainingDays()

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">个人中心</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6">
          {/* 个人基本信息 */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <svg className="w-5 h-5 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              个人基本信息
            </h3>
            <div className="bg-gray-50 rounded-lg p-5 space-y-4">
              {/* 头像和显示名称 */}
              <div className="flex items-center space-x-4">
                {user.profilePicture ? (
                  <img
                    src={user.profilePicture}
                    alt="Profile"
                    className="h-16 w-16 rounded-full ring-4 ring-indigo-100"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-indigo-600 flex items-center justify-center ring-4 ring-indigo-100">
                    <span className="text-2xl font-semibold text-white">
                      {user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-xl font-semibold text-gray-900">
                    {user.displayName || '未设置显示名称'}
                  </p>
                  {user.role === 'admin' && (
                    <span className="inline-block mt-1 px-2 py-1 text-xs bg-red-100 text-red-800 rounded">
                      管理员
                    </span>
                  )}
                </div>
              </div>

              {/* 详细信息 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <p className="text-sm text-gray-500 mb-1">用户名</p>
                  <p className="text-base font-medium text-gray-900">
                    {user.username || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">邮箱地址</p>
                  <p className="text-base font-medium text-gray-900 break-all">
                    {user.email}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">注册时间</p>
                  <p className="text-base font-medium text-gray-900">
                    {formatDate(user.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">账号角色</p>
                  <p className="text-base font-medium text-gray-900">
                    {user.role === 'admin' ? '管理员' : '普通用户'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 套餐类型 */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <svg className="w-5 h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              套餐类型
            </h3>
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-5 border border-green-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-2">当前套餐</p>
                  <span className={`inline-block px-4 py-2 text-base font-semibold rounded-lg ${packageColors[user.packageType] || 'bg-gray-100 text-gray-800'}`}>
                    {packageLabels[user.packageType] || user.packageType}
                  </span>
                </div>
                {user.packageType === 'trial' && (
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">升级套餐</p>
                    <button className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                      联系管理员 →
                    </button>
                  </div>
                )}
              </div>

              {/* 套餐说明 */}
              <div className="mt-4 pt-4 border-t border-green-200">
                <p className="text-xs text-gray-600">
                  {user.packageType === 'trial' && '试用版功能有限，升级后可使用完整功能'}
                  {user.packageType === 'annual' && '年卡版提供全功能访问，有效期1年'}
                  {user.packageType === 'lifetime' && '终身版享有永久使用权限'}
                  {user.packageType === 'enterprise' && '私有化部署版本，专属服务器'}
                </p>
              </div>
            </div>
          </div>

          {/* 套餐有效期 */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <svg className="w-5 h-5 mr-2 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              套餐有效期
            </h3>
            <div className={`rounded-lg p-5 border ${
              remainingDays !== null && remainingDays < 30
                ? 'bg-red-50 border-red-200'
                : 'bg-blue-50 border-blue-200'
            }`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600 mb-1">生效日期</p>
                  <p className="text-base font-semibold text-gray-900">
                    {formatDate(user.validFrom)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">到期日期</p>
                  <p className="text-base font-semibold text-gray-900">
                    {formatDate(user.validUntil)}
                  </p>
                </div>
              </div>

              {/* 剩余天数提示 */}
              {remainingDays !== null && (
                <div className={`mt-4 pt-4 border-t ${
                  remainingDays < 30 ? 'border-red-200' : 'border-blue-200'
                }`}>
                  {remainingDays > 0 ? (
                    <div className="flex items-center justify-between">
                      <p className={`text-sm ${
                        remainingDays < 30 ? 'text-red-700' : 'text-blue-700'
                      }`}>
                        {remainingDays < 30 && '⚠️ '}
                        剩余 <span className="font-bold text-lg mx-1">{remainingDays}</span> 天
                      </p>
                      {remainingDays < 30 && (
                        <button className="text-sm text-red-600 hover:text-red-700 font-medium">
                          联系续费 →
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="bg-red-100 rounded p-3">
                      <p className="text-sm text-red-800 font-medium">
                        ⚠️ 您的套餐已过期，请联系管理员续费
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
          <div className="flex justify-between">
            <button
              onClick={() => setShowChangePassword(true)}
              className="px-6 py-2 border border-indigo-600 text-indigo-600 rounded-md hover:bg-indigo-50 transition"
            >
              修改密码
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {/* 修改密码弹窗 */}
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        onSuccess={() => {
          setShowChangePassword(false)
          onClose()
          // 强制重新登录
          window.location.href = '/login'
        }}
      />
    </div>
  )
}
