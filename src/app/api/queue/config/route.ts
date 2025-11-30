/**
 * 队列配置API
 * GET /api/queue/config - 获取配置
 * PUT /api/queue/config - 更新配置（仅管理员）
 */

import { NextRequest, NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/scrape-queue-manager'
import { getQueueConfig, saveQueueConfig } from '@/lib/queue-config'
import { verifyAuth } from '@/lib/auth'
import { z } from 'zod'

// 配置验证Schema
const queueConfigSchema = z.object({
  globalConcurrency: z.number().min(1).max(50).optional(),
  perUserConcurrency: z.number().min(1).max(20).optional(),
  maxQueueSize: z.number().min(10).max(10000).optional(),
  taskTimeout: z.number().min(10000).max(600000).optional(), // 10秒 - 10分钟
  enablePriority: z.boolean().optional(),
})

/**
 * GET /api/queue/config
 * 获取队列配置（需要登录）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取配置
    const config = getQueueConfig(auth.user.userId)

    return NextResponse.json({
      success: true,
      config,
    })
  } catch (error: any) {
    console.error('[QueueConfig] 获取配置失败:', error)
    return NextResponse.json(
      { error: error.message || '获取配置失败' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/queue/config
 * 更新队列配置（仅管理员）
 */
export async function PUT(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 检查用户是否为管理员
    if (auth.user.role !== 'admin') {
      return NextResponse.json(
        {
          error: '权限不足',
          message: '只有管理员可以修改系统队列配置'
        },
        { status: 403 }
      )
    }

    // 解析请求体
    const body = await request.json()

    // 验证配置
    const validationResult = queueConfigSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: '配置格式错误', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const config = validationResult.data

    // 保存配置到数据库（系统级别，user_id = NULL）
    saveQueueConfig(config, undefined)

    // 更新队列管理器配置（立即生效）
    const queueManager = getQueueManager()
    queueManager.updateConfig(config)

    console.log(`[QueueConfig] 管理员 ${auth.user.email} (ID: ${auth.user.userId}) 更新了队列配置:`, config)

    return NextResponse.json({
      success: true,
      message: '配置已保存并生效',
      config,
    })
  } catch (error: any) {
    console.error('[QueueConfig] 更新配置失败:', error)
    return NextResponse.json(
      { error: error.message || '更新配置失败' },
      { status: 500 }
    )
  }
}
