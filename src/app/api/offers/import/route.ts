import { NextRequest, NextResponse } from 'next/server'

/**
 * /api/offers/import -> /api/offers/batch 兼容性别名
 *
 * CSV批量导入Offer的完整API文档:
 *
 * GET /api/offers/batch (或 /api/offers/import)
 *   - 下载CSV模板文件
 *   - 返回: text/csv 文件
 *
 * POST /api/offers/batch (或 /api/offers/import)
 *   - 批量导入Offers
 *   - 支持格式:
 *     1. FormData上传CSV文件 (Content-Type: multipart/form-data)
 *        - field名: file
 *     2. JSON带CSV文本 (Content-Type: application/json)
 *        - { "csv": "affiliate_link,target_country,...\nhttps://..." }
 *     3. JSON数组 (Content-Type: application/json)
 *        - { "offers": [{ "affiliate_link": "...", "target_country": "..." }] }
 *
 * CSV必填字段（与手动创建保持一致）:
 *   - affiliate_link: 推广链接 (如: https://pboost.me/UKTs4I6)
 *   - target_country: 目标国家代码 (如: US, DE, GB)
 *
 * CSV可选字段:
 *   - product_price: 产品价格 (如: $699.00)
 *   - commission_payout: 佣金比例 (如: 6.75%)
 *
 * 处理流程:
 *   1. 验证CSV数据格式
 *   2. 创建Offer记录（状态: pending）
 *   3. 异步触发信息提取（解析Final URL + 识别品牌名称）
 *   4. 异步触发数据抓取（获取产品详情）
 *
 * 限制:
 *   - 单次最多100条Offer
 *
 * 返回示例:
 *   {
 *     "success": true,
 *     "summary": { "total": 3, "success": 2, "failed": 1 },
 *     "results": [
 *       { "success": true, "row": 1, "offer": { "id": 1, "scrape_status": "pending" } },
 *       { "success": false, "row": 2, "error": "无效的推广链接格式" }
 *     ]
 *   }
 */

// Re-export from batch route
export { GET, POST } from '../batch/route'
