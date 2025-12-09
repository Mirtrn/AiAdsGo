/**
 * 统一队列配置API
 * GET /api/queue/config - 获取配置
 * PUT /api/queue/config - 更新配置（仅管理员）
 *
 * 🔥 修复：配置持久化到数据库，解决多实例环境配置不同步问题
 */

import { NextRequest, NextResponse } from 'next/server'
import { getQueueManager } from '@/lib/queue'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { z } from 'zod'

// 默认队列配置
const DEFAULT_QUEUE_CONFIG = {
  globalConcurrency: 5,
  perUserConcurrency: 2,
  perTypeConcurrency: {
    scrape: 3,
    'ai-analysis': 2,
    sync: 1,
    backup: 1,
    email: 3,
    export: 2,
    'link-check': 2,
    cleanup: 1,
    'offer-extraction': 2,
    'batch-offer-creation': 1,
    'ad-creative': 1  // 创意生成任务（AI密集型，串行避免API限流）
  },
  maxQueueSize: 1000,
  taskTimeout: 600000,
  defaultMaxRetries: 3,
  retryDelay: 5000,
}

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
 * 从数据库读取队列配置
 */
async function getQueueConfigFromDB(): Promise<typeof DEFAULT_QUEUE_CONFIG | null> {
  try {
    const db = await getDatabase()
    const result = await db.queryOne<{ value: string }>(`
      SELECT value FROM system_settings
      WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
      LIMIT 1
    `)

    if (result?.value) {
      return JSON.parse(result.value)
    }
    return null
  } catch (error) {
    console.error('[QueueConfig] 从数据库读取配置失败:', error)
    return null
  }
}

/**
 * 保存队列配置到数据库
 */
async function saveQueueConfigToDB(config: typeof DEFAULT_QUEUE_CONFIG): Promise<void> {
  const db = await getDatabase()
  const configJson = JSON.stringify(config)

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(`
    SELECT id FROM system_settings
    WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
  `)

  if (existing) {
    // 更新现有配置
    await db.exec(`
      UPDATE system_settings
      SET value = ?, updated_at = datetime('now')
      WHERE category = 'queue' AND key = 'config' AND user_id IS NULL
    `, [configJson])
  } else {
    // 插入新配置
    // 🔥 修复：使用参数化查询传入布尔值，避免PostgreSQL类型错误
    await db.exec(`
      INSERT INTO system_settings (
        user_id, category, key, value, data_type, is_sensitive, is_required, description
      ) VALUES (
        NULL, 'queue', 'config', ?, 'json', ?, ?, '统一队列系统配置'
      )
    `, [configJson, false, false])
  }
}

/**
 * GET /api/queue/config
 * 获取统一队列配置（需要登录）
 * 优先从数据库读取，确保多实例环境配置一致
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 🔥 优先从数据库读取配置（确保多实例一致性）
    const dbConfig = await getQueueConfigFromDB()
    const config = dbConfig || DEFAULT_QUEUE_CONFIG

    // 同步更新内存中的队列管理器配置
    const queueManager = getQueueManager()
    if (dbConfig) {
      queueManager.updateConfig(dbConfig)
    }

    // 返回配置
    return NextResponse.json({
      success: true,
      config: {
        globalConcurrency: config.globalConcurrency,
        perUserConcurrency: config.perUserConcurrency,
        perTypeConcurrency: config.perTypeConcurrency,
        maxQueueSize: config.maxQueueSize,
        taskTimeout: config.taskTimeout,
        defaultMaxRetries: config.defaultMaxRetries,
        retryDelay: config.retryDelay,
        // 状态信息
        storageType: process.env.REDIS_URL ? 'redis' : 'memory',
        redisConnected: !!process.env.REDIS_URL,
        // 🔥 新增：标识配置来源
        configSource: dbConfig ? 'database' : 'default'
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
 * 同时保存到数据库和更新内存，确保多实例环境配置一致
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

    const newConfig = validationResult.data

    // 🔥 先从数据库读取现有配置，合并后保存
    const existingConfig = await getQueueConfigFromDB() || DEFAULT_QUEUE_CONFIG
    const mergedConfig = {
      ...existingConfig,
      ...newConfig,
      // 确保 perTypeConcurrency 也正确合并
      perTypeConcurrency: {
        ...existingConfig.perTypeConcurrency,
        ...(newConfig.perTypeConcurrency || {})
      }
    }

    // 🔥 保存到数据库（持久化）
    await saveQueueConfigToDB(mergedConfig)

    // 更新当前实例的内存配置
    const queueManager = getQueueManager()
    queueManager.updateConfig(mergedConfig)

    console.log(`[UnifiedQueueConfig] 管理员 ${auth.user.email} (ID: ${auth.user.userId}) 更新了队列配置:`, newConfig)

    return NextResponse.json({
      success: true,
      message: '配置已保存到数据库并在当前实例生效',
      config: mergedConfig,
    })
  } catch (error: any) {
    console.error('[UnifiedQueueConfig] 更新配置失败:', error)
    return NextResponse.json(
      { error: error.message || '更新配置失败' },
      { status: 500 }
    )
  }
}
