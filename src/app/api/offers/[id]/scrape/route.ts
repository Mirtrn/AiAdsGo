import { NextRequest, NextResponse } from 'next/server'
import { findOfferById, updateOfferScrapeStatus } from '@/lib/offers'
import { scrapeUrl } from '@/lib/scraper'
import { analyzeProductPage } from '@/lib/ai'

/**
 * POST /api/offers/:id/scrape
 * 触发产品信息抓取和AI分析
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

/**
 * 后台执行抓取和AI分析任务
 */
async function performScrapeAndAnalysis(
  offerId: number,
  userId: number,
  url: string,
  brand: string
): Promise<void> {
  try {
    console.log(`开始抓取Offer ${offerId}:`, url)

    // 1. 抓取网页内容
    const pageData = await scrapeUrl(url)
    console.log(`抓取完成，页面标题:`, pageData.title)

    // 2. 使用AI分析产品信息
    const productInfo = await analyzeProductPage({
      url,
      brand,
      title: pageData.title,
      description: pageData.description,
      text: pageData.text,
    })
    console.log(`AI分析完成:`, productInfo)

    // 3. 更新数据库
    updateOfferScrapeStatus(offerId, userId, 'completed', undefined, {
      brand_description: productInfo.brandDescription,
      unique_selling_points: productInfo.uniqueSellingPoints,
      product_highlights: productInfo.productHighlights,
      target_audience: productInfo.targetAudience,
      category: productInfo.category,
    })

    console.log(`Offer ${offerId} 抓取和分析完成`)
  } catch (error: any) {
    console.error(`Offer ${offerId} 抓取失败:`, error)
    throw error
  }
}
