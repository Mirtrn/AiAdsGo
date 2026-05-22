import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'

/**
 * POST /api/admin/ai-models/test
 * 测试指定AI模型是否可用
 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || auth.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {

    const body = await request.json()
    const { model_id } = body

    if (!model_id) {
      return NextResponse.json({ error: 'model_id is required' }, { status: 400 })
    }

    // 导入 LiteLLM 生成函数
    const { generateContent } = await import('@/lib/litellm')
    
    // 尝试用该模型生成一个简单的测试请求
    const result = await generateContent(
      {
        model: model_id,
        prompt: 'Hi',
        maxOutputTokens: 10,
        timeoutMs: 15000,
        operationType: 'model_test',
      },
      auth.user.userId
    )

    return NextResponse.json({
      success: true,
      model_used: result.model,
      message: '模型测试成功',
    })
  } catch (error: any) {
    console.error('模型测试失败:', error)
    return NextResponse.json({
      success: false,
      error: error.message || String(error),
    }, { status: 200 }) // 仍返回200，但带error字段
  }
}
