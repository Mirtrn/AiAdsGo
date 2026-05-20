'use client'

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ArrowRight, Zap, AlertCircle, ShieldAlert } from 'lucide-react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: any) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
      getResponse: (widgetId: string) => string
    }
  }
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCaptcha, setShowCaptcha] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [securityWarning, setSecurityWarning] = useState<string | null>(null)
  const turnstileWidgetId = useRef<string | null>(null)
  const turnstileLoaded = useRef(false)

  const captchaEnabled = process.env.NEXT_PUBLIC_CAPTCHA_ENABLED === 'true'

  const renderTurnstile = useCallback(() => {
    if (window.turnstile && !turnstileWidgetId.current) {
      const container = document.getElementById('turnstile-container')
      if (container) {
        try {
          turnstileWidgetId.current = window.turnstile.render(container, {
            sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
            callback: (token: string) => {
              setCaptchaToken(token)
              setCaptchaLoading(false)
            },
            'error-callback': () => {
              setCaptchaLoading(false)
              setError('验证码加载失败，请刷新页面重试')
            },
            theme: 'dark',
          })
          setCaptchaLoading(false)
        } catch {
          setCaptchaLoading(false)
          setError('验证码初始化失败，请刷新页面重试')
        }
      }
    }
  }, [])

  useEffect(() => {
    const errorParam = searchParams?.get('error')
    if (errorParam) setError(decodeURIComponent(errorParam))
    const warningParam = searchParams?.get('security_warning')
    if (warningParam === 'true') {
      setSecurityWarning('检测到您的账户存在异常登录活动，请确认是否为本人操作。如非本人操作，建议立即修改密码。')
    }
  }, [searchParams])

  useEffect(() => {
    if (captchaEnabled && showCaptcha && !turnstileLoaded.current) {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      script.async = true
      script.defer = true
      script.onload = () => {
        turnstileLoaded.current = true
        setTimeout(renderTurnstile, 0)
      }
      script.onerror = () => setError('验证码脚本加载失败，请刷新页面重试')
      document.body.appendChild(script)
    }
  }, [captchaEnabled, showCaptcha, renderTurnstile])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const requestBody: { username: string; password: string; captchaToken?: string } = { username, password }
      if (showCaptcha && captchaToken) requestBody.captchaToken = captchaToken

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      const data = await response.json()

      if (!response.ok) {
        if (data.errorType === 'captcha_required') {
          setShowCaptcha(true)
          setCaptchaLoading(true)
          setCaptchaToken(null)
          setError(data.error || '请完成验证码验证')
          return
        }
        if (data.errorType === 'captcha_invalid') {
          if (turnstileWidgetId.current && window.turnstile) {
            window.turnstile.reset(turnstileWidgetId.current)
          }
          setCaptchaToken(null)
        }
        throw new Error(data.error || '登录失败')
      }

      if (data.user && data.user.mustChangePassword) {
        router.push('/change-password?forced=true')
        return
      }
      const redirect = searchParams?.get('redirect')
      router.push(redirect || '/dashboard')
    } catch (err: any) {
      setError(err.message || '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-violet-600/15 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] bg-indigo-600/10 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">AiAdsGo</span>
        </div>

        {/* Login box */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-8 backdrop-blur-sm shadow-2xl shadow-black/40">
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-white mb-1.5">欢迎回来</h1>
            <p className="text-white/40 text-sm">请登录您的 AiAdsGo 账号继续操作</p>
          </div>

          {securityWarning && (
            <div className="mb-5 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
              <div>
                <div className="font-medium mb-0.5 text-amber-300 text-sm">安全提醒</div>
                <div className="text-amber-400/80 text-xs leading-relaxed">{securityWarning}</div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-5 flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
                用户名 / 邮箱
              </label>
              <input
                type="text"
                autoComplete="username"
                required
                placeholder="name@company.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-11 bg-white/[0.05] border border-white/10 rounded-xl px-4 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
                  密码
                </label>
                <a href="#" className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
                  忘记密码?
                </a>
              </div>
              <input
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 bg-white/[0.05] border border-white/10 rounded-xl px-4 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-all"
              />
            </div>

            {showCaptcha && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
                  安全验证
                </label>
                <div className="relative bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
                  <div id="turnstile-container" className="flex justify-center items-center min-h-[65px]" />
                  {captchaLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#0a0f1e]/60 backdrop-blur-sm">
                      <div className="flex items-center gap-2 text-white/50 text-xs">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        加载验证码...
                      </div>
                    </div>
                  )}
                </div>
                {!captchaLoading && turnstileLoaded.current && !captchaToken && (
                  <button
                    type="button"
                    onClick={() => {
                      if (turnstileWidgetId.current && window.turnstile) {
                        window.turnstile.reset(turnstileWidgetId.current)
                      }
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    重新加载验证码
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || captchaLoading || (showCaptcha && !captchaToken)}
              className="w-full h-11 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                <>
                  立即登录
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-xs text-white/25 mt-6">
            还没有账号?{' '}
            <a href="#" className="text-violet-400 hover:text-violet-300 transition-colors">
              联系管理员开通
            </a>
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-5 mt-6 text-xs text-white/20">
          <a href="/privacy" className="hover:text-white/40 transition-colors">隐私政策</a>
          <span>·</span>
          <a href="/terms" className="hover:text-white/40 transition-colors">服务条款</a>
          <span>·</span>
          <span>&copy; 2025 AiAdsGo</span>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
