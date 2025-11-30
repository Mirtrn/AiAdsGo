import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/admin/prompts/[promptId]
 * 获取指定Prompt的完整信息和所有版本历史
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  try {
    const { promptId } = params
    const db = getDatabase()

    // 获取当前激活版本
    const activeVersion = await db.queryOne<any>(
      `SELECT
        pv.*,
        u.username as created_by_name
       FROM prompt_versions pv
       LEFT JOIN users u ON pv.created_by = u.id
       WHERE pv.prompt_id = ? AND pv.is_active = 1`,
      [promptId]
    )

    if (!activeVersion) {
      return NextResponse.json(
        { success: false, error: 'Prompt不存在' },
        { status: 404 }
      )
    }

    // 获取所有版本历史
    const versions = await db.query<any>(
      `SELECT
        pv.id,
        pv.version,
        pv.prompt_content,
        pv.language,
        pv.created_at,
        pv.is_active,
        pv.change_notes,
        u.username as created_by_name,
        (
          SELECT SUM(call_count)
          FROM prompt_usage_stats
          WHERE prompt_id = pv.prompt_id AND version = pv.version
        ) as total_calls,
        (
          SELECT SUM(total_cost)
          FROM prompt_usage_stats
          WHERE prompt_id = pv.prompt_id AND version = pv.version
        ) as total_cost
       FROM prompt_versions pv
       LEFT JOIN users u ON pv.created_by = u.id
       WHERE pv.prompt_id = ?
       ORDER BY pv.created_at DESC`,
      [promptId]
    )

    // 获取使用统计（最近30天）
    const usageStats = await db.query<any>(
      `SELECT
        usage_date,
        SUM(call_count) as calls,
        SUM(total_tokens) as tokens,
        SUM(total_cost) as cost
       FROM prompt_usage_stats
       WHERE prompt_id = ?
         AND usage_date >= date('now', '-30 days')
       GROUP BY usage_date
       ORDER BY usage_date DESC`,
      [promptId]
    )

    return NextResponse.json({
      success: true,
      data: {
        promptId: activeVersion.prompt_id,
        category: activeVersion.category,
        name: activeVersion.name,
        description: activeVersion.description,
        filePath: activeVersion.file_path,
        functionName: activeVersion.function_name,
        currentVersion: {
          version: activeVersion.version,
          promptContent: activeVersion.prompt_content,
          language: activeVersion.language,
          createdBy: activeVersion.created_by_name,
          createdAt: activeVersion.created_at,
          changeNotes: activeVersion.change_notes,
        },
        versions: versions.map(v => ({
          id: v.id,
          version: v.version,
          promptContent: v.prompt_content,
          language: v.language,
          createdBy: v.created_by_name,
          createdAt: v.created_at,
          isActive: v.is_active === 1,
          changeNotes: v.change_notes,
          totalCalls: v.total_calls || 0,
          totalCost: v.total_cost || 0,
        })),
        usageStats: usageStats.map(s => ({
          date: s.usage_date,
          calls: s.calls || 0,
          tokens: s.tokens || 0,
          cost: s.cost || 0,
        })),
      }
    })
  } catch (error: any) {
    console.error('获取Prompt详情失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/admin/prompts/[promptId]
 * 激活指定版本
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  try {
    const { promptId } = params
    const body = await request.json()
    const { version } = body

    if (!version) {
      return NextResponse.json(
        { success: false, error: '缺少版本号' },
        { status: 400 }
      )
    }

    const db = getDatabase()

    // 检查版本是否存在
    const versionExists = await db.queryOne<any>(
      'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = ?',
      [promptId, version]
    )

    if (!versionExists) {
      return NextResponse.json(
        { success: false, error: '版本不存在' },
        { status: 404 }
      )
    }

    // 取消其他版本的激活状态
    await db.exec(
      'UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = ?',
      [promptId]
    )

    // 激活指定版本
    await db.exec(
      'UPDATE prompt_versions SET is_active = 1 WHERE prompt_id = ? AND version = ?',
      [promptId, version]
    )

    return NextResponse.json({
      success: true,
      message: `版本 ${version} 已激活`
    })
  } catch (error: any) {
    console.error('激活版本失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
