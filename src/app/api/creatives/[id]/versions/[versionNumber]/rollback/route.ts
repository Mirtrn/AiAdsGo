import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/database'

/**
 * POST /api/creatives/:id/versions/:versionNumber/rollback
 * 回滚到指定版本
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; versionNumber: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const creativeId = parseInt(params.id, 10)
    const versionNumber = parseInt(params.versionNumber, 10)

    if (isNaN(creativeId) || isNaN(versionNumber)) {
      return NextResponse.json(
        { error: '无效的Creative ID或版本号' },
        { status: 400 }
      )
    }

    const db = getDatabase()
    const userId = authResult.user.id

    // 验证Creative所有权
    const creative = db
      .prepare('SELECT user_id FROM creatives WHERE id = ?')
      .get(creativeId) as { user_id: number } | undefined

    if (!creative) {
      return NextResponse.json({ error: 'Creative不存在' }, { status: 404 })
    }

    if (creative.user_id !== userId) {
      return NextResponse.json({ error: '无权修改此Creative' }, { status: 403 })
    }

    // 获取目标版本
    const targetVersion = db
      .prepare(
        `
        SELECT
          headlines,
          descriptions,
          final_url,
          path_1,
          path_2,
          quality_score,
          quality_details
        FROM creative_versions
        WHERE creative_id = ? AND version_number = ?
      `
      )
      .get(creativeId, versionNumber) as
      | {
          headlines: string
          descriptions: string
          final_url: string
          path_1: string | null
          path_2: string | null
          quality_score: number | null
          quality_details: string | null
        }
      | undefined

    if (!targetVersion) {
      return NextResponse.json({ error: '目标版本不存在' }, { status: 404 })
    }

    // 解析JSON
    const headlines = JSON.parse(targetVersion.headlines)
    const descriptions = JSON.parse(targetVersion.descriptions)
    const qualityDetails = targetVersion.quality_details
      ? JSON.parse(targetVersion.quality_details)
      : null

    // 获取当前最大版本号
    const maxVersionRow = db
      .prepare(
        'SELECT MAX(version_number) as max_version FROM creative_versions WHERE creative_id = ?'
      )
      .get(creativeId) as { max_version: number | null }

    const newVersionNumber = (maxVersionRow.max_version || 0) + 1

    // 创建新版本（回滚版本）
    const result = db
      .prepare(
        `
        INSERT INTO creative_versions (
          creative_id,
          version_number,
          headlines,
          descriptions,
          final_url,
          path_1,
          path_2,
          quality_score,
          quality_details,
          created_by,
          creation_method,
          change_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        creativeId,
        newVersionNumber,
        JSON.stringify(headlines),
        JSON.stringify(descriptions),
        targetVersion.final_url,
        targetVersion.path_1,
        targetVersion.path_2,
        targetVersion.quality_score,
        targetVersion.quality_details,
        userId.toString(),
        'rollback',
        `回滚到版本 ${versionNumber}`
      )

    // 同时更新creatives表的当前内容
    db.prepare(
      `
      UPDATE creatives
      SET
        headline_1 = ?,
        headline_2 = ?,
        headline_3 = ?,
        description_1 = ?,
        description_2 = ?,
        final_url = ?,
        path_1 = ?,
        path_2 = ?,
        quality_score = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(
      headlines[0] || '',
      headlines[1] || null,
      headlines[2] || null,
      descriptions[0] || '',
      descriptions[1] || null,
      targetVersion.final_url,
      targetVersion.path_1,
      targetVersion.path_2,
      targetVersion.quality_score,
      creativeId
    )

    // 获取新创建的版本
    const newVersion = db
      .prepare('SELECT * FROM creative_versions WHERE id = ?')
      .get(result.lastInsertRowid) as any

    return NextResponse.json({
      success: true,
      data: {
        version: {
          ...newVersion,
          headlines: JSON.parse(newVersion.headlines),
          descriptions: JSON.parse(newVersion.descriptions),
          quality_details: newVersion.quality_details
            ? JSON.parse(newVersion.quality_details)
            : null,
        },
      },
      message: `成功回滚到版本 ${versionNumber}（新版本号: ${newVersionNumber}）`,
    })
  } catch (error) {
    console.error('回滚版本失败:', error)
    return NextResponse.json(
      {
        error: '回滚版本失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
