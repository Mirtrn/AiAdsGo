/**
 * 统一队列配置API
 * GET /api/queue/config - 获取配置
 * PUT /api/queue/config - 更新配置（仅管理员）
 *
 * 支持Redis + 内存回退架构
 */

import { NextRequest, NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/queue'
import { verifyAuth } from '@/lib/auth'
import { z } from 'zod'

// 统一队列配置验证Schema
const queueConfigSchema = z.object({
  globalConcurrency: z.number().min(1).max(50).optional(),
  perUserConcurrency: z.number().min(1).max(20).optional(),
  perTypeConcurrency: z.record(z.number().min(1).max(10)).optional(),
  maxQueueSize: z.number().min(10).max(10000).optional(),
  taskTimeout: z.number().min(10000).max(600000).optional(), // 10秒 - 10分钟
  defaultMaxRetries: z.number().min(0).max(5).optional(),
  retryDelay: z.number().min(1000).max(60000).optional(),
})

/**
 * GET /api/queue/config
 * 获取统一队列配置（需要登录）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 获取统一队列管理器的当前配置
    const queueManager = getQueueManager()
    const currentConfig = queueManager.getConfig()

    // 返回实际配置（排除敏感内部字段）
    return NextResponse.json({
      success: true,
      config: {
        globalConcurrency: currentConfig.globalConcurrency,
        perUserConcurrency: currentConfig.perUserConcurrency,
        perTypeConcurrency: currentConfig.perTypeConcurrency,
        maxQueueSize: currentConfig.maxQueueSize,
        taskTimeout: currentConfig.taskTimeout,
        defaultMaxRetries: currentConfig.defaultMaxRetries,
        retryDelay: currentConfig.retryDelay,
        // 状态信息
        storageType: currentConfig.redisUrl ? 'redis' : 'memory',
        redisConnected: !!currentConfig.redisUrl
      }
    })
  } catch (error: any) {
    console.error('[UnifiedQueueConfig] 获取配置失败:', error)
    return NextResponse.json(
      { error: error.message || '获取配置失败' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/queue/config
 * 更新统一队列配置（仅管理员）
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

    // 更新队列管理器配置（立即生效）
    const queueManager = getQueueManager()
    queueManager.updateConfig(config)

    console.log(`[UnifiedQueueConfig] 管理员 ${auth.user.email} (ID: ${auth.user.userId}) 更新了队列配置:`, config)

    return NextResponse.json({
      success: true,
      message: '配置已保存并生效',
      config,
    })
  } catch (error: any) {
    console.error('[UnifiedQueueConfig] 更新配置失败:', error)
    return NextResponse.json(
      { error: error.message || '更新配置失败' },
      { status: 500 }
    )
  }
}
