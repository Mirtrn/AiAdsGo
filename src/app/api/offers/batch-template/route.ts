/**
 * GET /api/offers/batch-template
 * 提供批量导入CSV模板下载
 *
 * 调用方式：
 * - 浏览器直接访问：触发文件下载
 * - 前端按钮：window.open('/api/offers/batch-template')
 *
 * 模板字段说明：
 * - 必填：affiliate_link（推广链接）, target_country（推广国家）
 * - 可选：brand_name（品牌名）, product_price（产品价格）, commission_payout（佣金比例）
 * - 说明：Final URL、评论分析、竞品分析等信息会通过自动抓取获得
 */

import { NextResponse } from 'next/server'

export async function GET() {
  // Excel 兼容：在部分 Mac 版 Microsoft Excel 中，UTF-8 CSV 如果没有 BOM 会出现中文列名乱码
  // 这里主动添加 UTF-8 BOM（\uFEFF），并使用 CRLF 换行，提升跨平台兼容性
  const csv = `\uFEFF${[
    '推广链接,推广国家,品牌名,产品价格,佣金比例',
    'https://pboost.me/UKTs4I6,US,kaspersky,$699.00,6.75%',
    'https://pboost.me/xEAgQ8ec,DE,,€299.00,8.00%',
    'https://pboost.me/RKWwEZR9,UK,,£499.00,7.50%',
    'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=,US,,,5.00%',
    '',
  ].join('\r\n')}`

  // 返回CSV文件响应
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="offer-import-template.csv"',
      'Cache-Control': 'no-cache, no-store, must-revalidate', // 禁用缓存，确保始终获取最新模板
    },
  })
}

// 健康检查（可选）
export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
    },
  })
}
