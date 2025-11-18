import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt'

// 需要认证的路径前缀
const protectedPaths = [
  '/dashboard',
  '/offers',
  '/campaigns',
  '/settings',
  '/api/offers',
  '/api/campaigns',
  '/api/settings',
  '/api/creatives',
]

// 公开路径（无需认证）
const publicPaths = [
  '/',
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/google',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 检查是否是受保护的路径
  const isProtected = protectedPaths.some(path => pathname.startsWith(path))

  // 如果不是受保护的路径，直接放行
  if (!isProtected) {
    return NextResponse.next()
  }

  // 从请求头中提取token
  const authHeader = request.headers.get('authorization')
  const token = extractTokenFromHeader(authHeader)

  // 如果没有token，返回401
  if (!token) {
    return NextResponse.json(
      { error: '未提供认证token，请先登录' },
      { status: 401 }
    )
  }

  // 验证token
  const payload = verifyToken(token)
  if (!payload) {
    return NextResponse.json(
      { error: 'Token无效或已过期，请重新登录' },
      { status: 401 }
    )
  }

  // Token有效，在请求头中添加用户信息，供后续API使用
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', payload.userId.toString())
  requestHeaders.set('x-user-email', payload.email)
  requestHeaders.set('x-user-role', payload.role)
  requestHeaders.set('x-user-package', payload.packageType)

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

// 配置中间件匹配的路径
export const config = {
  matcher: [
    /*
     * 匹配所有请求路径，除了：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico (网站图标)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
