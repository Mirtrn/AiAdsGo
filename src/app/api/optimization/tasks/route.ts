import { NextRequest, NextResponse } from 'next/server'
import { getSQLiteDatabase } from '@/lib/db'

/**
 * GET /api/optimization/tasks
 * 获取用户的优化任务列表
 * 数据通过 user_id 隔离
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const status = searchParams.get('status') // pending, in_progress, completed, all

    const db = getSQLiteDatabase()

    // 构建查询条件
    let whereClause = 'WHERE user_id = ?'
    const params: any[] = [parseInt(userId, 10)]

    if (status && status !== 'all') {
      whereClause += ' AND status = ?'
      params.push(status)
    }

    // 获取优化任务（user_id 隔离）
    const tasks = db.prepare(`
      SELECT
        id,
        task_type as title,
        description,
        severity,
        status,
        campaign_id as campaignId,
        created_at as createdAt,
        updated_at as updatedAt
      FROM optimization_tasks
      ${whereClause}
      ORDER BY
        CASE severity
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
        END,
        created_at DESC
      LIMIT ?
    `).all(...params, limit) as any[]

    return NextResponse.json({
      success: true,
      tasks: tasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        severity: task.severity || 'medium',
        status: task.status,
        campaignId: task.campaignId,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      })),
      total: tasks.length
    })
  } catch (error: any) {
    console.error('获取优化任务失败:', error)
    return NextResponse.json(
      { error: error.message || '获取优化任务失败' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/optimization/tasks
 * 更新优化任务状态
 * 数据通过 user_id 隔离
 */
export async function PUT(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { taskId, status } = body

    if (!taskId || !status) {
      return NextResponse.json(
        { error: '缺少必要参数: taskId, status' },
        { status: 400 }
      )
    }

    const validStatuses = ['pending', 'in_progress', 'completed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: '无效的状态值' },
        { status: 400 }
      )
    }

    const db = getSQLiteDatabase()

    // 更新任务状态（确保 user_id 隔离）
    const result = db.prepare(`
      UPDATE optimization_tasks
      SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(status, taskId, parseInt(userId, 10))

    if (result.changes === 0) {
      return NextResponse.json(
        { error: '任务不存在或无权访问' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: '任务状态已更新'
    })
  } catch (error: any) {
    console.error('更新优化任务失败:', error)
    return NextResponse.json(
      { error: error.message || '更新优化任务失败' },
      { status: 500 }
    )
  }
}
