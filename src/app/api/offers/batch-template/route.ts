/**
 * GET /api/offers/batch-template
 * P2-1优化：提供批量导入CSV模板下载
 *
 * 调用方式：
 * - 浏览器直接访问：触发文件下载
 * - 前端按钮：window.open('/api/offers/batch-template')
 */

import { NextResponse } from 'next/server'

export async function GET() {
  // P2-1: CSV模板内容（包含示例数据）
  const csv = `推广链接,品牌名称,推广国家,店铺或商品落地页,产品价格,佣金比例
https://example.com/affiliate/product1,BrandA,US,https://example.com/store/product1,$699.00,6.75%
https://example.com/affiliate/product2,BrandB,DE,https://example.de/shop/product2,€299.00,8.00%
https://example.com/affiliate/product3,BrandC,UK,https://example.co.uk/products/product3,£499.00,7.50%
https://example.com/affiliate/product4,BrandD,FR,https://example.fr/boutique/product4,€799.00,5.00%
`

  // 返回CSV文件响应
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="offer-import-template.csv"',
      'Cache-Control': 'public, max-age=86400', // 缓存24小时
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
