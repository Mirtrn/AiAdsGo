'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  Megaphone,
  Lightbulb,
  Rocket,
  Settings,
  Users,
  Database,
  LogOut,
  Menu,
  X,
  ChevronDown,
  User as UserIcon,
  Shield,
  Key,
  Link2,
  Eye,
  EyeOff,
  Beaker
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

// 套餐类型中文映射
const PACKAGE_TYPE_MAP: Record<string, string> = {
  trial: '试用版',
  annual: '年卡',
  lifetime: '终身买断',
  enterprise: '私有化部署',
}

// 角色中文映射
const ROLE_MAP: Record<string, string> = {
  admin: '管理员',
  user: '普通用户',
}

interface UserInfo {
  id: number
  email: string
  username?: string
  displayName: string | null
  role: string
  packageType: string
}

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  requireAdmin?: boolean
}

const navigationItems: NavItem[] = [
  {
    label: '仪表盘',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Offer管理',
    href: '/offers',
    icon: Package,
  },
  {
    label: '广告系列',
    href: '/campaigns',
    icon: Megaphone,
  },
  {
    label: '创意管理',
    href: '/creatives',
    icon: Lightbulb,
  },
  {
    label: '投放评分',
    href: '/launch-score',
    icon: Rocket,
  },
  {
    label: 'Google Ads账号',
    href: '/settings/google-ads',
    icon: Link2,
  },
  {
    label: '数据管理',
    href: '/data-management',
    icon: Database,
  },
  {
    label: '系统设置',
    href: '/settings',
    icon: Settings,
  },
]

const adminNavigationItems: NavItem[] = [
  {
    label: '用户管理',
    href: '/admin/users',
    icon: Users,
    requireAdmin: true,
  },
  {
    label: '备份管理',
    href: '/admin/backups',
    icon: Database,
    requireAdmin: true,
  },
  {
    label: '抓取与AI测试',
    href: '/admin/scrape-test',
    icon: Beaker,
    requireAdmin: true,
  },
]

// 全局用户缓存，避免重复请求
let cachedUser: UserInfo | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5分钟缓存

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<UserInfo | null>(cachedUser)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [loading, setLoading] = useState(!cachedUser)
  const [changingPassword, setChangingPassword] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const fetchingRef = useRef(false)

  useEffect(() => {
    // 如果已有缓存且未过期，直接使用
    const now = Date.now()
    if (cachedUser && (now - cacheTimestamp) < CACHE_DURATION) {
      setUser(cachedUser)
      setLoading(false)
      return
    }

    // 避免重复请求
    if (fetchingRef.current) return
    fetchUserInfo()
  }, [])

  const fetchUserInfo = async () => {
    // 防止并发请求
    if (fetchingRef.current) return
    fetchingRef.current = true

    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        cache: 'no-store', // 禁用 Next.js 自动缓存
      })

      if (!response.ok) {
        cachedUser = null
        cacheTimestamp = 0
        router.push('/login')
        return
      }

      const data = await response.json()
      // 更新缓存
      cachedUser = data.user
      cacheTimestamp = Date.now()
      setUser(data.user)
    } catch (err) {
      cachedUser = null
      cacheTimestamp = 0
      router.push('/login')
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }

  // 提供刷新用户信息的方法（用于登出后清除缓存）
  const clearUserCache = () => {
    cachedUser = null
    cacheTimestamp = 0
  }

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      // 清除用户缓存（无论API是否成功）
      clearUserCache()
      setUser(null)

      if (response.ok) {
        toast.success('已退出登录')
      } else {
        // API失败时也要退出，因为可能是token已失效
        console.warn('Logout API returned error, but proceeding with logout')
      }

      // 使用 replace 防止用户后退回到需要登录的页面
      router.replace('/login')
    } catch (err) {
      console.error('Logout error:', err)
      // 即使API调用失败，也清除本地状态并跳转
      clearUserCache()
      setUser(null)
      toast.error('退出登录时发生错误')
      router.replace('/login')
    }
  }

  const handleChangePassword = async () => {
    // 验证表单
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error('请填写所有密码字段')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('新密码和确认密码不匹配')
      return
    }

    if (passwordForm.newPassword.length < 8) {
      toast.error('新密码长度至少8位')
      return
    }

    setChangingPassword(true)

    try {
      const response = await fetch('/api/user/password', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '修改密码失败')
      }

      toast.success('密码修改成功，请重新登录')

      // 清除用户缓存
      clearUserCache()

      // 关闭弹窗
      setPasswordModalOpen(false)
      setProfileModalOpen(false)

      // 重置表单
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })

      // 强制跳转到登录页面
      router.push('/login')
    } catch (err: any) {
      toast.error(err.message || '修改密码失败')
    } finally {
      setChangingPassword(false)
    }
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname?.startsWith(href) || false
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
      </div>
    )
  }

  if (!user) return null

  // 过滤导航项（管理员可见全部）
  const visibleNavItems = user.role === 'admin'
    ? [...navigationItems, ...adminNavigationItems]
    : navigationItems

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-900">
      {/* Mobile Menu Button */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 glass px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="hover:bg-slate-100"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <h1 className="font-bold text-lg bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">AutoAds</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600 font-medium">{user.username || user.email}</span>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-white/80 backdrop-blur-xl border-r border-slate-200/60 z-40 transition-all duration-300 shadow-sm
          ${sidebarOpen ? 'w-64' : 'w-20'}
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo & Toggle */}
        <div className="h-16 flex items-center justify-between px-4 mb-2">
          {sidebarOpen && (
            <h1 className="font-bold text-2xl bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-tight">
              AutoAds
            </h1>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden lg:flex text-slate-400 hover:text-slate-600 hover:bg-slate-50"
          >
            <Menu className="w-5 h-5" />
          </Button>
        </div>

        {/* User Info - Clickable */}
        <div className="px-3 mb-6">
          <button
            onClick={() => setProfileModalOpen(true)}
            className={`
              w-full flex items-center gap-3 p-2 rounded-xl transition-all duration-200
              ${sidebarOpen ? 'bg-slate-50 hover:bg-slate-100 border border-slate-100' : 'justify-center hover:bg-slate-50'}
            `}
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-200">
              <UserIcon className="w-5 h-5" />
            </div>
            {sidebarOpen && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {user.displayName || user.username || user.email}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <p className="text-xs text-slate-500 font-medium">{user.packageType}</p>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </>
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="px-3 space-y-1 flex-1 overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {/* 用户功能区 */}
          {sidebarOpen && (
            <div className="px-3 py-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Main Menu
              </span>
            </div>
          )}
          {navigationItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)

            return (
              <a
                key={item.href}
                href={item.href}
                className={`
                  group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                  ${active
                    ? 'bg-blue-50/80 text-blue-600 font-medium shadow-sm shadow-blue-100/50'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  }
                  ${!sidebarOpen && 'justify-center'}
                `}
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                {sidebarOpen && <span className="text-sm">{item.label}</span>}
                {sidebarOpen && active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />
                )}
              </a>
            )
          })}

          {/* 管理员功能区 - 仅管理员可见 */}
          {user.role === 'admin' && (
            <>
              {sidebarOpen && (
                <div className="px-3 py-2 mt-6">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Shield className="w-3 h-3" />
                    Admin
                  </span>
                </div>
              )}
              {!sidebarOpen && (
                <div className="my-3 border-t border-slate-100" />
              )}
              {adminNavigationItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)

                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`
                      group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                      ${active
                        ? 'bg-purple-50/80 text-purple-600 font-medium shadow-sm shadow-purple-100/50'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      }
                      ${!sidebarOpen && 'justify-center'}
                    `}
                    title={!sidebarOpen ? item.label : undefined}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${active ? 'text-purple-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    {sidebarOpen && <span className="text-sm">{item.label}</span>}
                  </a>
                )
              })}
            </>
          )}
        </nav>

        {/* Logout Button */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/50">
          <Button
            variant="ghost"
            onClick={handleLogout}
            className={`
              w-full flex items-center gap-3 text-slate-500 hover:text-red-600 hover:bg-red-50/50 transition-colors
              ${!sidebarOpen && 'justify-center'}
            `}
          >
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span className="font-medium">退出登录</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`
          transition-all duration-300 pt-16 lg:pt-0 min-h-screen
          ${sidebarOpen ? 'lg:ml-64' : 'lg:ml-20'}
        `}
      >
        {children}
      </main>

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Personal Center Modal */}
      <Dialog open={profileModalOpen} onOpenChange={setProfileModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>个人中心</DialogTitle>
            <DialogDescription>
              查看和管理您的账号信息
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* User Avatar */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                <UserIcon className="w-8 h-8" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  {user.displayName || user.username || user.email}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-slate-500">{user.email}</span>
                  {user.role === 'admin' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                      <Shield className="w-3 h-3" />
                      管理员
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Account Info */}
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">套餐类型</span>
                <span className="text-sm font-medium text-slate-900">
                  {PACKAGE_TYPE_MAP[user.packageType] || user.packageType}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">用户ID</span>
                <span className="text-sm font-mono text-slate-900">{user.id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">角色</span>
                <span className="text-sm font-medium text-slate-900">
                  {ROLE_MAP[user.role] || user.role}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t border-slate-200 pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => {
                  setPasswordModalOpen(true)
                }}
              >
                <Key className="w-4 h-4" />
                修改密码
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => {
                  setProfileModalOpen(false)
                  handleLogout()
                }}
              >
                <LogOut className="w-4 h-4" />
                退出登录
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Password Change Modal */}
      <Dialog open={passwordModalOpen} onOpenChange={setPasswordModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>
              请输入当前密码和新密码
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">当前密码</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                  placeholder="输入当前密码"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                >
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                  placeholder="输入新密码（至少8位）"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="再次输入新密码"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setPasswordModalOpen(false)
                  setPasswordForm({
                    currentPassword: '',
                    newPassword: '',
                    confirmPassword: '',
                  })
                }}
              >
                取消
              </Button>
              <Button
                className="flex-1"
                onClick={handleChangePassword}
                disabled={changingPassword}
              >
                {changingPassword ? '修改中...' : '确认修改'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
