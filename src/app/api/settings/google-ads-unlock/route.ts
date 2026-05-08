import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/settings/google-ads-unlock
 * 验证管理员密码，用于解锁 Google Ads 配置区块
 * 密码由环境变量 GOOGLE_ADS_ADMIN_PASSWORD 配置
 * 如果环境变量未设置，则拒绝所有解锁请求（安全优先）
 */
export async function POST(request: NextRequest) {
  // 通过中间件注入的 x-user-id 判断是否已登录
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 })
  }

  const adminPassword = process.env.GOOGLE_ADS_ADMIN_PASSWORD
  if (!adminPassword) {
    // 环境变量未配置，拒绝解锁（不能因未配置而跳过保护）
    return NextResponse.json(
      { error: '管理员密码未配置，请联系系统管理员设置 GOOGLE_ADS_ADMIN_PASSWORD 环境变量' },
      { status: 403 }
    )
  }

  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '无效的请求格式' }, { status: 400 })
  }

  const { password } = body
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: '请提供密码' }, { status: 400 })
  }

  if (password !== adminPassword) {
    return NextResponse.json({ error: '密码错误，请联系管理员获取正确密码' }, { status: 403 })
  }

  return NextResponse.json({ success: true })
}
