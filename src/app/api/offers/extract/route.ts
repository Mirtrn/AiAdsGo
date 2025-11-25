/**
 * POST /api/offers/extract
 * 自动提取Offer信息（Final URL、品牌名称等）
 * 🔥 KISS优化：使用统一的extractOffer核心函数
 */

import { NextRequest, NextResponse } from 'next/server'
import { createError, AppError } from '@/lib/errors'
import { extractOffer } from '@/lib/offer-extraction-core'

export const maxDuration = 60 // 最长60秒

export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    const userIdNum = userId ? parseInt(userId, 10) : undefined

    const body = await request.json()
    const {
      affiliate_link,
      target_country,
      skipCache = true,      // 🔥 强制跳过缓存（所有场景），确保获取最新URL重定向数据
      batchMode = false      // 🔥 批量处理模式：启用快速失败策略
    } = body

    // 验证必填参数
    if (!affiliate_link || !target_country) {
      const missing = []
      if (!affiliate_link) missing.push('affiliate_link')
      if (!target_country) missing.push('target_country')

      const error = createError.requiredField(missing.join(', '))
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    console.log(`🔍 开始自动提取: ${affiliate_link} (国家: ${target_country})`)

    // 验证用户认证
    if (!userIdNum) {
      const error = createError.unauthorized({
        suggestion: '请先登录后再使用此功能'
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 🔥 KISS优化：调用统一的核心提取函数
    const result = await extractOffer({
      affiliateLink: affiliate_link,
      targetCountry: target_country,
      userId: userIdNum,
      skipCache,
      batchMode,
    })

    // 如果提取失败，返回错误
    if (!result.success) {
      const error = createError.internalError({
        operation: 'offer_extraction',
        message: result.error?.message || '提取失败',
        originalError: result.error?.details,
      })
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 返回成功结果
    return NextResponse.json({
      success: true,
      data: result.data,
    })
  } catch (error: any) {
    console.error('自动提取失败:', error)

    // 如果是AppError，直接返回
    if (error instanceof AppError) {
      return NextResponse.json(error.toJSON(), { status: error.httpStatus })
    }

    // 通用系统错误
    const appError = createError.internalError({
      operation: 'offer_extraction',
      originalError: error.message
    })
    return NextResponse.json(appError.toJSON(), { status: appError.httpStatus })
  }
}
