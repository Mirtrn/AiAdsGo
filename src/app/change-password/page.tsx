'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])

  // 密码复杂度验证
  const validatePasswordStrength = (password: string): string[] => {
    const errors: string[] = []

    if (password.length < 8) {
      errors.push('密码至少需要8个字符')
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('密码至少需要1个大写字母')
    }
    if (!/[a-z]/.test(password)) {
      errors.push('密码至少需要1个小写字母')
    }
    if (!/[0-9]/.test(password)) {
      errors.push('密码至少需要1个数字')
    }
    if (!/[!@#$%^&*]/.test(password)) {
      errors.push('密码至少需要1个特殊字符（!@#$%^&*）')
    }

    return errors
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setFormData({ ...formData, newPassword })

    // 实时验证密码强度
    if (newPassword) {
      const errors = validatePasswordStrength(newPassword)
      setPasswordErrors(errors)
    } else {
      setPasswordErrors([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 验证新密码和确认密码是否一致
    if (formData.newPassword !== formData.confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    // 验证密码强度
    const errors = validatePasswordStrength(formData.newPassword)
    if (errors.length > 0) {
      setError('密码不符合复杂度要求')
      return
    }

    setLoading(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '修改密码失败')
      }

      // 修改成功，重定向到dashboard
      alert('密码修改成功！')
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message || '修改密码失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-xl shadow-lg">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            首次登录 - 修改密码
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            为了您的账号安全，请修改初始密码
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded relative">
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm space-y-4">
            <div>
              <label htmlFor="current-password" className="block text-sm font-medium text-gray-700">
                当前密码
              </label>
              <input
                id="current-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="请输入当前密码"
                value={formData.currentPassword}
                onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
                新密码
              </label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="请输入新密码"
                value={formData.newPassword}
                onChange={handlePasswordChange}
              />

              {/* 密码强度提示 */}
              {formData.newPassword && (
                <div className="mt-2">
                  {passwordErrors.length > 0 ? (
                    <div className="text-xs text-red-600 space-y-1">
                      {passwordErrors.map((err, index) => (
                        <div key={index}>• {err}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-green-600">
                      ✓ 密码强度符合要求
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
                确认新密码
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="请再次输入新密码"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              />
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <h3 className="text-sm font-medium text-blue-900 mb-2">密码要求：</h3>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• 最少8个字符</li>
              <li>• 至少1个大写字母</li>
              <li>• 至少1个小写字母</li>
              <li>• 至少1个数字</li>
              <li>• 至少1个特殊字符（!@#$%^&*）</li>
            </ul>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading || passwordErrors.length > 0}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? '修改中...' : '修改密码'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
