/**
 * 测试 Gemini API axios 代理调用（带自动降级）
 * GET /api/test-gemini-axios
 * GET /api/test-gemini-axios?model=gemini-2.5-flash (测试指定模型)
 */

import { NextResponse } from 'next/server'
import { generateContent } from '@/lib/gemini-axios'

export async function GET(request: Request) {
  try {
    // 从 URL 参数获取模型名称（可选）
    const { searchParams } = new URL(request.url)
    const model = searchParams.get('model') || 'gemini-2.5-pro' // 默认使用 Pro 模型

    console.log(`🧪 开始测试 Gemini API (axios方案, 模型: ${model})...`)

    const startTime = Date.now()

    const content = await generateContent({
      model: model as 'gemini-2.5-pro' | 'gemini-2.5-flash',
      prompt: 'Hello, please respond with "Success"',
      temperature: 0.1,
      maxOutputTokens: 50,
    })

    const duration = Date.now() - startTime

    console.log(`✅ Gemini API (axios) 调用成功! 耗时: ${duration}ms`)

    return NextResponse.json({
      success: true,
      content: content,
      requestedModel: model,
      method: 'axios + HttpsProxyAgent',
      duration: `${duration}ms`,
      fallbackSupported: true,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('❌ Gemini API (axios) 调用失败:', error.message)

    let errorType = 'unknown'
    if (error.message.includes('User location is not supported')) {
      errorType = 'geo_restricted'
    } else if (error.message.includes('代理')) {
      errorType = 'proxy_config'
    } else if (error.message.includes('overload')) {
      errorType = 'model_overload'
    } else if (error.response) {
      errorType = 'api_error'
    } else {
      errorType = 'network'
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        errorType,
        errorDetails: error.response?.data || null,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
