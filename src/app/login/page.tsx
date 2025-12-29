'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Loader2, CheckCircle2, ArrowRight, ShieldCheck, TrendingUp, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Cloudflare Turnstile types
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
  const turnstileWidgetId = useRef<string | null>(null)
  const turnstileLoaded = useRef(false)

  // 检查CAPTCHA功能是否启用
  const captchaEnabled = process.env.NEXT_PUBLIC_CAPTCHA_ENABLED === 'true'

  useEffect(() => {
    const errorParam = searchParams?.get('error')
    if (errorParam) {
      setError(decodeURIComponent(errorParam))
    }
  }, [searchParams])

  // Load Cloudflare Turnstile script
  useEffect(() => {
    if (captchaEnabled && showCaptcha && !turnstileLoaded.current) {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      script.async = true
      script.defer = true
      script.onload = () => {
        turnstileLoaded.current = true
        // 确保DOM已更新，使用setTimeout确保renderTurnstile在下一个事件循环执行
        setTimeout(renderTurnstile, 0)
      }
      script.onerror = () => {
        console.error('Failed to load Turnstile script')
        setError('验证码脚本加载失败，请刷新页面重试')
      }
      document.body.appendChild(script)
    }
  }, [captchaEnabled, showCaptcha])

  const renderTurnstile = () => {
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
            theme: 'light',
          })
          setCaptchaLoading(false)
        } catch (err) {
          console.error('Failed to render Turnstile:', err)
          setCaptchaLoading(false)
          setError('验证码初始化失败，请刷新页面重试')
        }
      }
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const requestBody: { username: string; password: string; captchaToken?: string } = {
        username,
        password,
      }

      // 如果需要CAPTCHA，添加token
      if (showCaptcha && captchaToken) {
        requestBody.captchaToken = captchaToken
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()

      if (!response.ok) {
        // 检查是否需要CAPTCHA
        if (data.errorType === 'captcha_required') {
          setShowCaptcha(true)
          setCaptchaLoading(true)
          setCaptchaToken(null)
          setError(data.error || '请完成验证码验证')
          // 不需要手动调用renderTurnstile，useEffect会自动处理
          // 当showCaptcha状态更新后，useEffect会检查脚本是否加载
          return
        }

        // CAPTCHA验证失败，重置widget
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
    <div className="min-h-screen flex bg-white">
      {/* Left Side - Product Showcase */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden">
        {/* Dynamic Background */}
        <div className="absolute inset-0 bg-[url('/dashboard-dark.webp')] bg-cover bg-center opacity-20 mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/90 via-slate-900/90 to-purple-900/90" />

        {/* Decorative Elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 right-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-16 w-full h-full text-white">
          {/* Logo Area */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold tracking-tight">AutoAds</span>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-12">
            <div className="space-y-6">
              <h1 className="text-5xl font-bold leading-tight tracking-tight">
                AI驱动的 <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                  Google Ads 自动化
                </span>
              </h1>
              <p className="text-xl text-slate-300 max-w-md leading-relaxed">
                从Offer筛选到广告上线，只需10分钟。让AI为您处理繁琐工作，专注于策略与增长。
              </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-dark p-5 rounded-2xl border border-white/10 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Zap className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-sm text-slate-400">效率提升</span>
                </div>
                <div className="text-3xl font-bold text-white">10x</div>
              </div>
              <div className="glass-dark p-5 rounded-2xl border border-white/10 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-purple-400" />
                  </div>
                  <span className="text-sm text-slate-400">ROI 增长</span>
                </div>
                <div className="text-3xl font-bold text-white">3.5x</div>
              </div>
            </div>

            {/* Testimonial */}
            <div className="glass-dark p-6 rounded-2xl border border-white/10">
              <div className="flex gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <svg key={i} className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <p className="text-slate-200 italic mb-4">
                "AutoAds彻底改变了我们的投放流程。现在我们可以同时测试数百个Offer，而无需增加人手。"
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-sm font-bold">
                  LM
                </div>
                <div>
                  <div className="font-semibold text-white">李明</div>
                  <div className="text-xs text-slate-400">Top10 联盟营销团队创始人</div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>&copy; 2025 AutoAds Inc.</span>
            <div className="flex gap-4">
              <a href="#" className="hover:text-white transition-colors">隐私政策</a>
              <a href="#" className="hover:text-white transition-colors">服务条款</a>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-12 bg-white">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left space-y-2">
            <div className="lg:hidden flex justify-center mb-6">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Zap className="w-7 h-7 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">欢迎回来</h2>
            <p className="text-slate-500">
              请输入您的账号信息以继续使用 AutoAds
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
              <div className="p-1 bg-red-100 rounded-full">
                <ShieldCheck className="w-4 h-4" />
              </div>
              {error}
            </div>
          )}

          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username">用户名 / 邮箱</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="name@company.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">密码</Label>
                  <a href="#" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                    忘记密码?
                  </a>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12"
                />
              </div>
            </div>

            {/* Cloudflare Turnstile CAPTCHA (条件显示) */}
            {showCaptcha && (
              <div className="space-y-2">
                <Label htmlFor="turnstile-container">安全验证</Label>
                <div className="relative">
                  <div
                    id="turnstile-container"
                    className="flex justify-center items-center min-h-[65px] bg-slate-50 rounded-lg border border-slate-200"
                  />
                  {captchaLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded-lg backdrop-blur-sm">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
                        <span className="text-xs text-slate-600">加载验证码...</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <p className="text-xs text-slate-500 flex-1">
                    为了您的账户安全，请完成验证后继续登录
                  </p>
                  {!captchaLoading && turnstileLoaded.current && !captchaToken && (
                    <button
                      type="button"
                      onClick={() => {
                        if (turnstileWidgetId.current && window.turnstile) {
                          window.turnstile.reset(turnstileWidgetId.current)
                        }
                      }}
                      className="text-xs text-blue-600 hover:text-blue-500 whitespace-nowrap flex-shrink-0"
                    >
                      重新加载
                    </button>
                  )}
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || captchaLoading || (showCaptcha && !captchaToken)}
              className="w-full h-12 text-base font-medium bg-slate-900 hover:bg-slate-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  登录中...
                </>
              ) : (
                <>
                  立即登录
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-500">
              还没有账号?{' '}
              <a href="#" className="font-medium text-blue-600 hover:text-blue-500 hover:underline underline-offset-4">
                联系管理员开通
              </a>
            </p>
          </div>
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
