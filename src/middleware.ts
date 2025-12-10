import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Middleware在Edge Runtime中运行，使用jose库进行JWT验证
// 注意：Edge Runtime不支持直接import config.ts，需要直接读取环境变量
// 🔴 重要：必须验证环境变量存在，否则会静默失败导致所有用户被登出
const JWT_SECRET_RAW = process.env.JWT_SECRET
if (!JWT_SECRET_RAW) {
  console.error('❌ CRITICAL: JWT_SECRET environment variable is not defined in Edge Runtime!')
  console.error('   This will cause ALL authenticated requests to fail.')
  console.error('   Please ensure JWT_SECRET is set in .env file and restart the server.')
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW || '')

/**
 * 验证JWT Token（Edge Runtime兼容）
 */
async function verifyTokenEdge(token: string): Promise<any | null> {
  // 🔴 检查 JWT_SECRET 是否正确加载
  if (JWT_SECRET.length === 0) {
    console.error('❌ JWT_SECRET is empty! Token verification will fail.')
    console.error('   JWT_SECRET_RAW:', JWT_SECRET_RAW ? `${JWT_SECRET_RAW.substring(0, 10)}... (${JWT_SECRET_RAW.length} chars)` : 'UNDEFINED')
    return null
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload
  } catch (error: any) {
    // 详细的错误日志帮助诊断
    console.error('❌ JWT验证失败:', {
      errorName: error?.name,
      errorMessage: error?.message,
      tokenPreview: token ? `${token.substring(0, 20)}...` : 'NO_TOKEN',
      secretLength: JWT_SECRET.length,
    })
    return null
  }
}

// 需要认证的路径前缀（仅API路由，页面路由在客户端组件中检查）
const protectedPaths = [
  '/api/offers',
  '/api/campaigns',
  '/api/settings',
  '/api/creatives',
  '/api/user',
  '/api/google-ads',
  '/api/ads-accounts',
]

// 公开路径（无需认证） - 需求27: 除首页和登录页，其他页面都需要登录
const publicPaths = [
  '/',               // 营销首页
  '/login',          // 登录页面
  '/privacy',        // 隐私政策
  '/terms',          // 服务条款
  '/about',          // 关于我们
  '/contact',        // 联系我们
  '/api/auth/login', // 登录API
  '/api/auth/google', // Google OAuth
  '/robots.txt',     // SEO - robots.txt
  '/sitemap.xml',    // SEO - sitemap.xml
]

// 🛡️ 恶意请求拦截：直接返回404，不记录日志，节省资源
// 这些是自动化漏洞扫描器常见的攻击路径
const MALICIOUS_PATTERNS = [
  // PHP文件（本项目是Next.js，不存在PHP）
  /\.php($|\?|\/)/i,
  // WordPress相关路径（包括目录）
  /^\/wp-/i,
  /^\/wordpress/i,
  // .well-known 漏洞探测（保留合法的 /.well-known/security.txt 等）
  /^\/\.well-known\/?$/i,                    // /.well-known 或 /.well-known/
  /^\/\.well-known\/acme-challenge/i,        // SSL证书验证路径探测
  /^\/\.well-known\/pki-validation/i,        // PKI验证路径探测
  /^\/\.well-knownold/i,                     // 旧版本探测
  // 常见漏洞路径
  /^\/vendor\//i,                            // Composer vendor目录
  /^\/cgi-bin/i,
  /^\/\.git/i,
  /^\/\.env/i,
  /^\/\.htaccess/i,
  /^\/\.svn/i,
  /^\/\.hg/i,
  /^\/\.DS_Store/i,
  /^\/phpmyadmin/i,
  /^\/pma/i,
  /^\/mysql/i,
  /^\/adminer/i,
  /^\/xmlrpc/i,
  // 常见后门/Web Shell路径
  /^\/shell/i,
  /^\/c99/i,
  /^\/r57/i,
  /^\/webshell/i,
  /^\/backdoor/i,
  /^\/alfa/i,                                // ALFA Shell
  /^\/ALFA/i,
  /^\/b374k/i,                               // b374k Shell
  /^\/wso/i,                                 // WSO Shell
  // 上传目录探测
  /^\/uploads?\/?$/i,                        // /upload 或 /uploads
  /^\/upload\/\w+\.php/i,
  /^\/uploads\/\w+\.php/i,
  /^\/files?\/?$/i,                          // /file 或 /files
  /^\/temp\/?$/i,
  /^\/tmp\/?$/i,
  // 备份文件探测
  /^\/backup/i,
  /^\/bak/i,
  /^\/old/i,
  /^\/copy/i,
  /\.(bak|backup|old|orig|)$/i,
  // 配置文件探测
  /^\/config\.(php|inc|ini|conf|yml|yaml|json|xml)$/i,
  /^\/configuration\./i,
  /^\/settings\.(php|inc|ini)$/i,
  /^\/database\./i,
  /^\/db\.(php|inc|sql)$/i,
  // 日志文件探测
  /^\/logs?\/?$/i,
  /^\/error_log/i,
  /^\/access_log/i,
  /\.(log|logs)$/i,
  // 其他常见攻击路径
  /^\/test\.(php|html?)$/i,
  /^\/info\.php$/i,
  /^\/phpinfo/i,
  /^\/debug/i,
  /^\/console/i,
  /^\/manager\/?$/i,
  /^\/administrator\/?$/i,
  /^\/admin\/?$/i,                           // 注意：不影响 /admin/queue 等合法路径
]

// 🛡️ 合法路径白名单（优先于恶意模式检查）
const LEGITIMATE_PATHS = [
  /^\/admin\//,                              // /admin/queue, /admin/users 等
  /^\/api\//,                                // API路由
]

export async function middleware(request: NextRequest) {
  const { pathname} = request.nextUrl

  // 🛡️ 第一道防线：拦截恶意请求，直接返回404
  // 不记录日志、不重定向、不渲染页面，最小化资源消耗
  // 先检查白名单，避免误拦截合法路径
  const isLegitimate = LEGITIMATE_PATHS.some(pattern => pattern.test(pathname))
  if (!isLegitimate && MALICIOUS_PATTERNS.some(pattern => pattern.test(pathname))) {
    return new NextResponse(null, { status: 404 })
  }

  // 检查是否是公开路径
  const isPublicPath = publicPaths.some(path => {
    if (path === '/') {
      // 首页需要精确匹配
      return pathname === '/'
    }
    // 其他路径使用startsWith匹配
    return pathname === path || pathname.startsWith(path + '/')
  })

  // 公开路径直接放行
  if (isPublicPath) {
    return NextResponse.next()
  }

  // 从Cookie中读取token（HttpOnly Cookie方式）
  const token = request.cookies.get('auth_token')?.value
  const isApiRoute = pathname.startsWith('/api/')

  // 如果没有token，重定向到登录页
  if (!token) {

    if (isApiRoute) {
      // API路径：返回401 JSON
      return NextResponse.json(
        { error: '未提供认证token，请先登录' },
        { status: 401 }
      )
    } else {
      // 页面路径：重定向到登录页
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      console.log(`[Middleware] Redirecting ${pathname} to ${loginUrl.toString()}`)
      return NextResponse.redirect(loginUrl)
    }
  }

  // 验证token（异步）
  const payload = await verifyTokenEdge(token)
  if (!payload) {
    if (isApiRoute) {
      // API路径：返回401 JSON
      return NextResponse.json(
        { error: 'Token无效或已过期，请重新登录' },
        { status: 401 }
      )
    } else {
      // 页面路径：重定向到登录页并清除无效cookie
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      loginUrl.searchParams.set('error', encodeURIComponent('登录已过期，请重新登录'))

      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('auth_token')
      return response
    }
  }

  // Token有效，在请求头中添加用户信息，供后续API使用
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-user-id', String(payload.userId))
  requestHeaders.set('x-user-email', String(payload.email))
  requestHeaders.set('x-user-role', String(payload.role))
  requestHeaders.set('x-user-package', String(payload.packageType))

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
