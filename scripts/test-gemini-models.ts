/**
 * 测试 Gemini 模型连接
 *
 * 使用方法:
 * npx tsx scripts/test-gemini-models.ts
 */

import { config } from 'dotenv'
config() // 加载 .env 文件

import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getProxyIp } from '../src/lib/proxy/fetch-proxy-ip'

const MODELS_TO_TEST = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
]

async function testModel(model: string): Promise<{ success: boolean; message: string; duration: number }> {
  console.log(`\n🧪 测试模型: ${model}`)
  const startTime = Date.now()

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 未配置')
    }

    // 配置代理
    const proxyUrl = process.env.PROXY_URL
    if (!proxyUrl) {
      throw new Error('PROXY_URL 未配置')
    }

    const proxy = await getProxyIp(proxyUrl)
    const proxyAgent = new HttpsProxyAgent(
      `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
    )

    // 直接使用 axios 调用，可以看到完整响应
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        contents: [
          {
            parts: [{ text: 'What is 2+2? Reply with just the number.' }],
            role: 'user',
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200, // Gemini 2.5 需要更多tokens用于思考过程
        },
      },
      {
        params: { key: apiKey },
        httpsAgent: proxyAgent,
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' },
      }
    )

    const duration = Date.now() - startTime

    // 详细日志响应结构
    console.log(`   📊 响应结构:`, JSON.stringify(response.data, null, 2).substring(0, 500))

    // 检查响应
    if (!response.data.candidates || response.data.candidates.length === 0) {
      // 检查是否有 promptFeedback
      if (response.data.promptFeedback) {
        console.log(`   ⚠️ 提示反馈:`, response.data.promptFeedback)
      }
      throw new Error('无 candidates 返回')
    }

    const candidate = response.data.candidates[0]

    // 检查 finishReason
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      console.log(`   ⚠️ finishReason: ${candidate.finishReason}`)
    }

    // 提取文本
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new Error(`候选无内容，finishReason: ${candidate.finishReason}`)
    }

    const text = candidate.content.parts[0].text
    console.log(`   ✅ 成功 (${duration}ms)`)
    console.log(`   📝 响应: ${text.trim().substring(0, 100)}`)

    return {
      success: true,
      message: text.trim().substring(0, 100),
      duration,
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    console.log(`   ❌ 失败 (${duration}ms)`)

    // 详细错误信息
    if (error.response) {
      console.log(`   📊 HTTP状态: ${error.response.status}`)
      console.log(`   📊 错误详情:`, JSON.stringify(error.response.data, null, 2).substring(0, 500))
    } else {
      console.log(`   📝 错误: ${error.message}`)
    }

    return {
      success: false,
      message: error.response?.data?.error?.message || error.message,
      duration,
    }
  }
}

async function main() {
  console.log('='.repeat(50))
  console.log('Gemini 模型连接测试')
  console.log('='.repeat(50))

  // 检查环境变量
  if (!process.env.GEMINI_API_KEY) {
    console.error('\n❌ 错误: GEMINI_API_KEY 未配置')
    console.log('请在 .env 文件中设置 GEMINI_API_KEY')
    process.exit(1)
  }
  console.log('\n✓ GEMINI_API_KEY 已配置')

  if (process.env.PROXY_ENABLED !== 'true') {
    console.warn('\n⚠️ 警告: 代理未启用，可能无法访问 Gemini API')
    console.log('如果测试失败，请在 .env 中设置 PROXY_ENABLED=true')
  } else {
    console.log('✓ 代理已启用')
  }

  // 测试所有模型
  const results: Array<{ model: string; success: boolean; message: string; duration: number }> = []

  for (const model of MODELS_TO_TEST) {
    const result = await testModel(model)
    results.push({ model, ...result })
  }

  // 打印汇总
  console.log('\n' + '='.repeat(50))
  console.log('测试结果汇总')
  console.log('='.repeat(50))

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  console.log(`\n总计: ${results.length} 个模型`)
  console.log(`✅ 成功: ${successCount}`)
  console.log(`❌ 失败: ${failCount}`)

  console.log('\n详细结果:')
  for (const result of results) {
    const status = result.success ? '✅' : '❌'
    console.log(`  ${status} ${result.model}: ${result.duration}ms`)
    if (!result.success) {
      console.log(`     错误: ${result.message.substring(0, 80)}`)
    }
  }

  // 退出码
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('测试脚本执行失败:', error)
  process.exit(1)
})
