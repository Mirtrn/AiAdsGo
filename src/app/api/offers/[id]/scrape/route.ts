import { NextRequest, NextResponse } from 'next/server'
import { findOfferById, updateOfferScrapeStatus } from '@/lib/offers'
import { performScrapeAndAnalysis } from '@/lib/offer-scraping-core'

/**
 * POST /api/offers/:id/scrape
 * 触发产品信息抓取和AI分析
 *
 * 🔥 重构优化：调用统一的核心抓取函数 (offer-scraping-core.ts)
 * 包含完整的抓取流程：
 * - 推广链接解析
 * - 网页抓取（Amazon Store/Product/独立站）
 * - AI分析
 * - 评论分析
 * - 竞品分析
 * - 广告元素提取
 * - scraped_products持久化
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 更新状态为抓取中
    updateOfferScrapeStatus(offer.id, parseInt(userId, 10), 'in_progress')

    // 🔥 重构优化：调用统一的核心抓取函数
    // 启动后台抓取任务（不等待完成）
    performScrapeAndAnalysis(offer.id, parseInt(userId, 10), offer.url, offer.brand)
      .catch(error => {
        console.error('后台抓取任务失败:', error)
        updateOfferScrapeStatus(
          offer.id,
          parseInt(userId, 10),
          'failed',
          error.message
        )
      })

    return NextResponse.json({
      success: true,
      message: '抓取任务已启动，请稍后查看结果',
    })
  } catch (error: any) {
    console.error('触发抓取失败:', error)

    return NextResponse.json(
      {
        error: error.message || '触发抓取失败',
      },
      { status: 500 }
    )
  }
}
