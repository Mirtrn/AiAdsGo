import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { LITELLM_SUPPORTED_MODELS, LITELLM_MODEL_ALIAS, LITELLM_MODEL_COST } from '@/lib/gemini-models'

// GET /api/ai-models — 返回启用的模型列表（普通登录用户可读），用于设置页下拉
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = getDatabase()
    const rows = await db.query(
      `SELECT model_id, display_name, cost_label
       FROM ai_models
       WHERE is_enabled = true
       ORDER BY sort_order ASC, id ASC`
    )

    if (rows.length > 0) {
      return NextResponse.json({ models: rows, source: 'db' })
    }

    // 兜底：DB 无数据时返回静态列表
    return NextResponse.json({ models: getFallbackModels(), source: 'static' })
  } catch (error: any) {
    // DB 错误时返回静态列表，保证用户侧可用性
    console.error('[ai-models GET] DB error, falling back to static list:', error.message)
    return NextResponse.json({ models: getFallbackModels(), source: 'static' })
  }
}

function getFallbackModels() {
  return LITELLM_SUPPORTED_MODELS.map(m => ({
    model_id: m,
    display_name: LITELLM_MODEL_ALIAS[m] || (m.includes('/') ? m.split('/').slice(1).join('/') : m),
    cost_label: LITELLM_MODEL_COST[m] || '',
  }))
}
