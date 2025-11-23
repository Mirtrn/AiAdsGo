#!/usr/bin/env tsx
/**
 * 测试异步抓取 vs 手动抓取
 * 验证两者使用相同逻辑
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = path.resolve(__dirname, '../data/autoads.db')
const db = new Database(dbPath)

const TEST_URL = 'https://pboost.me/ILK1tG3'
const TEST_BRAND = 'PBoost Test Product'
const USER_ID = 1

interface OfferRow {
  id: number
  brand: string
  scrape_status: string
  scrape_error: string | null
  created_at: string
  scraped_at: string | null
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function createTestOffer(): Promise<number> {
  console.log('\n🎯 创建测试Offer（触发异步抓取）...')

  const result = db.prepare(`
    INSERT INTO offers (
      user_id, url, brand, category, target_country,
      scrape_status, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    USER_ID,
    TEST_URL,
    TEST_BRAND,
    'Electronics',
    'US',
    'pending',
    1
  )

  const offerId = result.lastInsertRowid as number
  console.log(`✅ Offer #${offerId} 创建成功`)
  console.log(`   URL: ${TEST_URL}`)
  console.log(`   初始状态: pending`)

  return offerId
}

async function monitorOfferStatus(offerId: number, maxWaitSeconds: number = 60) {
  console.log(`\n⏱️  监控 Offer #${offerId} 抓取状态（最多等待${maxWaitSeconds}秒）...`)

  const startTime = Date.now()
  let lastStatus = ''

  while (true) {
    const offer = db.prepare(`
      SELECT id, brand, scrape_status, scrape_error, created_at, scraped_at
      FROM offers WHERE id = ?
    `).get(offerId) as OfferRow

    if (offer.scrape_status !== lastStatus) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[${elapsed}s] 状态变化: ${lastStatus || '(初始)'} → ${offer.scrape_status}`)

      if (offer.scrape_error) {
        console.log(`   ❌ 错误信息: ${offer.scrape_error}`)
      }

      lastStatus = offer.scrape_status
    }

    // 完成或失败
    if (offer.scrape_status === 'completed' || offer.scrape_status === 'failed') {
      console.log(`\n✅ 抓取${offer.scrape_status === 'completed' ? '成功' : '失败'}`)
      if (offer.scraped_at) {
        console.log(`   完成时间: ${offer.scraped_at}`)
      }
      return offer
    }

    // 超时
    const elapsed = (Date.now() - startTime) / 1000
    if (elapsed > maxWaitSeconds) {
      console.log(`\n⚠️  等待超时（${maxWaitSeconds}秒），当前状态: ${offer.scrape_status}`)
      return offer
    }

    await sleep(2000) // 每2秒检查一次
  }
}

async function triggerManualScraping(offerId: number) {
  console.log(`\n🔧 触发手动抓取 Offer #${offerId}...`)

  try {
    const response = await fetch(`http://localhost:3000/api/offers/${offerId}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'auth_token=your_test_token_here' // 需要从浏览器复制真实token
      }
    })

    if (response.ok) {
      console.log('✅ 手动抓取已触发')
      return true
    } else {
      const error = await response.text()
      console.log(`❌ 手动抓取触发失败: ${response.status}`)
      console.log(`   ${error}`)
      return false
    }
  } catch (error: any) {
    console.log(`❌ 手动抓取请求失败: ${error.message}`)
    return false
  }
}

async function compareScrapingResults(asyncOfferId: number, manualOfferId: number) {
  console.log('\n📊 对比异步抓取 vs 手动抓取结果...\n')

  const asyncOffer = db.prepare(`
    SELECT * FROM offers WHERE id = ?
  `).get(asyncOfferId) as any

  const manualOffer = db.prepare(`
    SELECT * FROM offers WHERE id = ?
  `).get(manualOfferId) as any

  console.log('异步抓取结果:')
  console.log(`  状态: ${asyncOffer.scrape_status}`)
  console.log(`  品牌描述: ${asyncOffer.brand_description ? '✅' : '❌'}`)
  console.log(`  产品亮点: ${asyncOffer.product_highlights ? '✅' : '❌'}`)
  console.log(`  目标受众: ${asyncOffer.target_audience ? '✅' : '❌'}`)
  console.log(`  USP: ${asyncOffer.unique_selling_points ? '✅' : '❌'}`)

  console.log('\n手动抓取结果:')
  console.log(`  状态: ${manualOffer.scrape_status}`)
  console.log(`  品牌描述: ${manualOffer.brand_description ? '✅' : '❌'}`)
  console.log(`  产品亮点: ${manualOffer.product_highlights ? '✅' : '❌'}`)
  console.log(`  目标受众: ${manualOffer.target_audience ? '✅' : '❌'}`)
  console.log(`  USP: ${manualOffer.unique_selling_points ? '✅' : '❌'}`)

  // 对比字段
  const fieldsToCompare = [
    'brand_description',
    'product_highlights',
    'target_audience',
    'unique_selling_points'
  ]

  let identical = true
  for (const field of fieldsToCompare) {
    const asyncValue = asyncOffer[field]
    const manualValue = manualOffer[field]

    if (asyncValue !== manualValue) {
      console.log(`\n⚠️  字段 ${field} 不一致:`)
      console.log(`   异步: ${asyncValue?.substring(0, 100)}...`)
      console.log(`   手动: ${manualValue?.substring(0, 100)}...`)
      identical = false
    }
  }

  if (identical) {
    console.log('\n✅ 异步抓取和手动抓取结果完全一致！')
  }
}

async function main() {
  console.log('=' .repeat(60))
  console.log('测试异步抓取 vs 手动抓取')
  console.log('=' .repeat(60))

  // 测试1: 创建Offer，触发异步抓取
  const asyncOfferId = await createTestOffer()

  console.log('\n💡 提示: 异步抓取应该立即开始（通过 setImmediate 触发）')
  console.log('   请检查服务器日志是否有 "[OfferScraping] 触发异步抓取" 消息\n')

  // 等待3秒让异步抓取启动
  await sleep(3000)

  // 监控抓取状态
  const asyncResult = await monitorOfferStatus(asyncOfferId, 120)

  console.log('\n' + '='.repeat(60))
  console.log('异步抓取测试完成')
  console.log('='.repeat(60))
  console.log(`\nOffer ID: ${asyncOfferId}`)
  console.log(`最终状态: ${asyncResult.scrape_status}`)
  console.log(`错误信息: ${asyncResult.scrape_error || '无'}`)

  // 询问是否进行手动抓取对比测试
  console.log('\n' + '='.repeat(60))
  console.log('如需测试手动抓取对比，请：')
  console.log('1. 在浏览器中登录系统')
  console.log('2. 打开开发者工具，复制 auth_token cookie')
  console.log('3. 更新此脚本中的 triggerManualScraping 函数的 Cookie 值')
  console.log('4. 创建另一个Offer进行手动抓取测试')
  console.log('='.repeat(60))
}

main().catch(console.error).finally(() => {
  db.close()
})
