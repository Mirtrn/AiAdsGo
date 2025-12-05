/**
 * 统一队列恢复API
 * POST /api/queue/recover
 *
 * 手动触发队列恢复
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { queueRecoveryManager } from '@/lib/queue/queue-recovery'

export async function POST(request: NextRequest) {
  try {
    // 验证身份（需要管理员权限）
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    // 检查是否为管理员
    if (authResult.user.role !== 'admin') {
      return NextResponse.json(
        { error: '权限不足', message: '只有管理员可以手动恢复队列' },
        { status: 403 }
      )
    }

    // 检查是否有待恢复的任务
    if (!queueRecoveryManager.hasPendingRecovery()) {
      return NextResponse.json({
        success: true,
        message: '没有检测到待恢复的任务',
        recovered: 0,
        failed: 0
      })
    }

    // 执行队列恢复
    console.log('🚀 管理员手动触发队列恢复...')
    const recoveryResult = await queueRecoveryManager.executeQueueRecovery()

    return NextResponse.json({
      success: true,
      message: '队列恢复完成',
      ...recoveryResult
    })
  } catch (error: any) {
    console.error('[UnifiedQueueRecovery] 队列恢复失败:', error)
    return NextResponse.json(
      { error: '队列恢复失败', details: error.message },
      { status: 500 }
    )
  }
}
