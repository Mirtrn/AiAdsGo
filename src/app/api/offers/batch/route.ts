import { NextRequest, NextResponse } from 'next/server'
import { createOffer } from '@/lib/offers'
import { triggerOfferScraping, OfferScrapingPriority } from '@/lib/offer-scraping'
import { z } from 'zod'

/**
 * POST /api/offers/batch
 * 批量导入Offer - 与手动创建保持一致的参数
 *
 * 必填字段：
 * - affiliate_link（推广链接）
 * - target_country（推广国家）
 *
 * 可选字段：
 * - product_price（产品价格）
 * - commission_payout（佣金比例）
 *
 * 注意：CSV模板下载请使用 /api/offers/batch-template
 */
const batchOfferSchema = z.object({
  // 必填字段
  affiliate_link: z.string().url('无效的推广链接格式'),
  target_country: z.string().min(2, '目标国家代码至少2个字符'),
  // 选填字段
  product_price: z.string().optional().or(z.literal('')),
  commission_payout: z.string().optional().or(z.literal('')),
})

/**
 * 解析CSV字符串为JSON数组
 * 支持中文和英文表头
 */
function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) {
    throw new Error('CSV文件必须包含标题行和至少一行数据')
  }

  // 中文表头映射为英文字段名
  const fieldMapping: Record<string, string> = {
    '推广链接': 'affiliate_link',
    '推广国家': 'target_country',
    '产品价格': 'product_price',
    '佣金比例': 'commission_payout',
    // 兼容英文表头
    'affiliate_link': 'affiliate_link',
    'target_country': 'target_country',
    'product_price': 'product_price',
    'commission_payout': 'commission_payout',
  }

  // 解析标题行
  const rawHeaders = lines[0].split(',').map(h => h.trim())
  const headers = rawHeaders.map(h => fieldMapping[h] || h.toLowerCase().replace(/\s+/g, '_'))

  // 解析数据行
  const results: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // 简单的CSV解析（处理引号内的逗号）
    const values: string[] = []
    let current = ''
    let inQuotes = false

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())

    // 创建对象
    const obj: Record<string, string> = {}
    headers.forEach((header, index) => {
      obj[header] = values[index] || ''
    })
    results.push(obj)
  }

  return results
}

/**
 * POST /api/offers/batch
 * 批量创建Offers（支持JSON和CSV格式）
 * 需求23: 支持CSV文件导入
 */
export async function POST(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    let offers: any[] = []
    const contentType = request.headers.get('content-type') || ''

    // 根据Content-Type解析请求体
    if (contentType.includes('text/csv') || contentType.includes('multipart/form-data')) {
      // CSV格式
      const formData = await request.formData()
      const file = formData.get('file') as File | null

      if (!file) {
        return NextResponse.json(
          { error: '请上传CSV文件' },
          { status: 400 }
        )
      }

      const csvText = await file.text()
      try {
        offers = parseCSV(csvText)
      } catch (error: any) {
        return NextResponse.json(
          { error: `CSV解析失败: ${error.message}` },
          { status: 400 }
        )
      }
    } else {
      // JSON格式
      const body = await request.json()

      // 支持直接传CSV文本
      if (body.csv) {
        try {
          offers = parseCSV(body.csv)
        } catch (error: any) {
          return NextResponse.json(
            { error: `CSV解析失败: ${error.message}` },
            { status: 400 }
          )
        }
      } else {
        offers = body.offers || []
      }
    }

    if (!Array.isArray(offers) || offers.length === 0) {
      return NextResponse.json(
        { error: 'offers必须是非空数组' },
        { status: 400 }
      )
    }

    if (offers.length > 100) {
      return NextResponse.json(
        { error: '单次最多上传100条Offer' },
        { status: 400 }
      )
    }

    const results: {
      success: boolean
      row: number
      offer?: any
      error?: string
    }[] = []

    // 逐条验证和创建
    for (let i = 0; i < offers.length; i++) {
      const offerData = offers[i]

      try {
        // 验证数据
        const validationResult = batchOfferSchema.safeParse(offerData)

        if (!validationResult.success) {
          results.push({
            success: false,
            row: i + 1,
            error: validationResult.error.errors[0].message,
          })
          continue
        }

        // 创建Offer（使用推广链接作为临时URL，品牌名称待提取）
        const offer = await createOffer(parseInt(userId, 10), {
          url: validationResult.data.affiliate_link, // 临时使用推广链接，后续会更新为Final URL
          brand: '提取中...', // 临时品牌名，后续会更新
          target_country: validationResult.data.target_country,
          affiliate_link: validationResult.data.affiliate_link,
          product_price: validationResult.data.product_price || undefined,
          commission_payout: validationResult.data.commission_payout || undefined,
        })

        // 🚀 自动触发完整抓取流程（与手动创建保持一致）
        // 包含：推广链接解析 + 网页抓取 + AI分析 + 评论分析 + 竞品分析 + 广告元素提取 + scraped_products持久化
        // 🎯 优化: 批量导入使用LOW优先级，避免阻塞手动创建的Offer
        if (offer.scrape_status === 'pending') {
          setImmediate(() => {
            triggerOfferScraping(
              offer.id,
              parseInt(userId, 10),
              validationResult.data.affiliate_link,
              offer.brand || '提取中...',
              OfferScrapingPriority.LOW
            )
          })
        }

        results.push({
          success: true,
          row: i + 1,
          offer: {
            id: offer.id,
            affiliate_link: offer.affiliate_link,
            target_country: offer.target_country,
            scrape_status: offer.scrape_status,
          },
        })
      } catch (error: any) {
        results.push({
          success: false,
          row: i + 1,
          error: error.message || '创建失败',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length

    return NextResponse.json({
      success: true,
      summary: {
        total: offers.length,
        success: successCount,
        failed: failureCount,
      },
      results,
    })
  } catch (error: any) {
    console.error('批量创建Offer失败:', error)

    return NextResponse.json(
      {
        error: error.message || '批量创建Offer失败',
      },
      { status: 500 }
    )
  }
}
