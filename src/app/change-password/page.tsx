'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { showSuccess } from '@/lib/toast-utils'

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
    if (password.length < 8) errors.push('密码至少需要8个字符')
    if (!/[A-Z]/.test(password)) errors.push('密码至少需要1个大写字母')
    if (!/[a-z]/.test(password)) errors.push('密码至少需要1个小写字母')
    if (!/[0-9]/.test(password)) errors.push('密码至少需要1个数字')
    if (!/[!@#$%^&*]/.test(password)) errors.push('密码至少需要1个特殊字符（!@#$%^&*）')
    return errors
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setFormData({ ...formData, newPassword })
    if (newPassword) {
      setPasswordErrors(validatePasswordStrength(newPassword))
    } else {
      setPasswordErrors([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (formData.newPassword !== formData.confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    const errors = validatePasswordStrength(formData.newPassword)
    if (errors.length > 0) {
      setError('密码不符合复杂度要求')
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '修改密码失败')
      showSuccess('密码修改成功', '即将跳转到控制台')
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message || '修改密码失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-gray-900 font-semibold text-xl tracking-tight">AiAdsGo</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 mb-1">修改密码</h1>
            <p className="text-gray-500 text-sm">为了您的账号安全，请设置新密码</p>
          </div>

          {error && (
            <div className="mb-5 flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              <svg className="w-4 h-4 shrink-0 fill-current" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" fillRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="current-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                当前密码
              </label>
              <input
                id="current-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full h-10 bg-gray-50 border border-gray-200 rounded-lg px-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                placeholder="请输入当前密码"
                value={formData.currentPassword}
                onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                新密码
              </label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                className="w-full h-10 bg-gray-50 border border-gray-200 rounded-lg px-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                placeholder="请输入新密码"
                value={formData.newPassword}
                onChange={handlePasswordChange}
              />
              {formData.newPassword && (
                <div className="mt-2">
                  {passwordErrors.length > 0 ? (
                    <div className="text-xs text-red-500 space-y-0.5">
                      {passwordErrors.map((err, index) => (
                        <div key={index}>• {err}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-green-600 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                      密码强度符合要求
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                确认新密码
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                className="w-full h-10 bg-gray-50 border border-gray-200 rounded-lg px-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                placeholder="请再次输入新密码"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              />
            </div>

            {/* 密码要求 */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-blue-700 mb-1.5">密码必须包含：</p>
              <div className="grid grid-cols-2 gap-1 text-xs text-blue-600">
                <span>• 最少8个字符</span>
                <span>• 至少1个大写字母</span>
                <span>• 至少1个小写字母</span>
                <span>• 至少1个数字</span>
                <span className="col-span-2">• 至少1个特殊字符（!@#$%^&*）</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || passwordErrors.length > 0}
              className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white flex items-center justify-center transition-all"
            >
              {loading ? '提交中...' : '确认修改'}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-4 mt-5 text-xs text-gray-400">
          <a href="/privacy" className="hover:text-gray-600 transition-colors">隐私政策</a>
          <span>·</span>
          <a href="/terms" className="hover:text-gray-600 transition-colors">服务条款</a>
          <span>·</span>
          <span>&copy; 2025 AiAdsGo</span>
        </div>
      </div>
    </div>
  )
}
