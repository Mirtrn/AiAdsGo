import { NextRequest, NextResponse } from 'next/server'
import { generateContent } from '@/lib/gemini'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

/**
 * POST /api/admin/feedback-analysis
 * AI分析用户反馈并进行多轮对话
 */
export async function POST(request: NextRequest) {
  try {
    // 验证管理员权限
    const userId = request.headers.get('x-user-id')
    const userRole = request.headers.get('x-user-role')

    if (!userId || userRole !== 'admin') {
      return NextResponse.json({ error: '无权访问' }, { status: 403 })
    }

    const body = await request.json()
    const {
      feedback,
      scrapeData,
      creativeData,
      conversationHistory = []
    } = body

    // 构建对话上下文
    let systemPrompt = `你是AutoAds系统的优化顾问，专门负责分析用户反馈并提供具体的优化方案。

## 你的职责
1. 深入分析用户的反馈意见
2. 识别问题的根本原因
3. 提供具体、可执行的优化建议
4. 与用户进行多轮对话，理解其需求
5. 最终形成清晰的优化方案

## 当前系统上下文`

    // 添加抓取数据上下文
    if (scrapeData) {
      systemPrompt += `

### 数据抓取信息
- 页面标题: ${scrapeData.title}
- 是否使用缓存: ${scrapeData.cached ? '是' : '否'}
- 提取的文本长度: ${scrapeData.text?.length || 0} 字符
- SEO信息:
  - Meta标题: ${scrapeData.seo?.metaTitle || '无'}
  - H1标签数量: ${scrapeData.seo?.h1?.length || 0}
  - 图片Alt数量: ${scrapeData.seo?.imageAlts?.length || 0}`
    }

    // 添加创意数据上下文
    if (creativeData) {
      systemPrompt += `

### AI创意生成信息
- 标题1: ${creativeData.headline1}
- 标题2: ${creativeData.headline2}
- 标题3: ${creativeData.headline3}
- 描述1: ${creativeData.description1}
- 描述2: ${creativeData.description2}
- 质量评分: ${creativeData.qualityScore}/100
- 使用模型: ${creativeData.modelUsed}
- 创意导向: ${creativeData.orientation}`
    }

    systemPrompt += `

## 用户反馈
- 评价: ${feedback.rating === 'good' ? '好评 👍' : '差评 👎'}
- 反馈内容: ${feedback.comment}

## 分析要求
1. **问题识别**: 明确指出用户反馈中提到的具体问题
2. **根因分析**: 分析问题可能的根本原因（数据抓取、AI Prompt、评分逻辑等）
3. **优化建议**: 提供3-5个具体的优化措施，包括：
   - 优化点描述
   - 具体实施方法
   - 预期效果
4. **追问引导**: 如果信息不足，向用户提出关键问题以获得更多上下文

请用结构化、专业的方式回复，保持简洁但全面。`

    // 如果是多轮对话，构建对话历史
    let conversationContext = systemPrompt

    if (conversationHistory.length > 0) {
      conversationContext += '\n\n## 对话历史\n'
      conversationHistory.forEach((msg: Message) => {
        conversationContext += `\n**${msg.role === 'user' ? '用户' : 'AI顾问'}**: ${msg.content}\n`
      })
    }

    // 调用AI生成分析
    const analysis = await generateContent({
      model: 'gemini-2.5-pro',
      prompt: conversationContext,
      temperature: 0.8,
      maxOutputTokens: 2048,
    })

    return NextResponse.json({
      success: true,
      analysis,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('AI反馈分析失败:', error)
    return NextResponse.json(
      { error: error.message || 'AI反馈分析失败' },
      { status: 500 }
    )
  }
}
