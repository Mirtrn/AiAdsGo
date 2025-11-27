#!/usr/bin/env npx tsx

import Database from 'better-sqlite3'

const dbPath = '/Users/jason/Documents/Kiro/autobb/data/autoads.db'

async function testOfferFlow() {
  console.log('🚀 测试完整Offer创建流程（修复后）')
  console.log('='.repeat(80))

  const db = new Database(dbPath)

  // 创建Offer
  const url = 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url='
  const userId = 1
  const targetCountry = 'US'

  const insertStmt = db.prepare(`
    INSERT INTO offers (
      user_id, url, brand, target_country, scrape_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
  `)

  const result = insertStmt.run(userId, url, 'Unknown', targetCountry)
  const offerId = result.lastInsertRowid as number

  console.log(`✅ Offer已创建 (ID: ${offerId})`)
  console.log(`   URL: ${url}`)
  console.log(`   Target Country: ${targetCountry}`)
  console.log('')

  // 触发抓取
  console.log('🕷️  触发异步抓取...')
  const { triggerOfferScraping } = await import('../src/lib/offer-scraping')
  triggerOfferScraping(offerId, userId, url, 'Unknown')

  console.log('✅ 抓取任务已触发')
  console.log('')
  console.log('📊 监控Offer状态（每5秒检查一次）')
  console.log('='.repeat(80))

  // 监控状态
  const startTime = Date.now()
  let attempts = 0

  const checkStatus = () => {
    attempts++
    const elapsed = Math.floor((Date.now() - startTime) / 1000)

    const offer = db.prepare(`
      SELECT scrape_status, brand, final_url, final_url_suffix,
             LENGTH(brand_description) as desc_len
      FROM offers WHERE id = ?
    `).get(offerId) as any

    const status = offer.scrape_status
    const statusEmoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '🔄'

    console.log(`[${String(attempts).padStart(3)}] ${statusEmoji} ${String(status).padEnd(12)} | 品牌: ${String(offer.brand).padEnd(20)} | 耗时: ${elapsed}s`)

    if (status === 'completed' || status === 'failed') {
      console.log('')
      console.log('='.repeat(80))
      console.log('📊 最终结果:')
      console.log(`   状态: ${status}`)
      console.log(`   品牌: ${offer.brand}`)
      console.log(`   Final URL: ${offer.final_url}`)
      console.log(`   Final URL Suffix: ${offer.final_url_suffix ? offer.final_url_suffix.substring(0, 80) + '...' : '(无)'}`)
      console.log(`   描述长度: ${offer.desc_len} 字符`)
      console.log('='.repeat(80))

      // 验证结果
      console.log('')
      if (offer.final_url?.includes('diamondsfactory.ca')) {
        console.log('✅ Final URL正确: diamondsfactory.ca')
        if (offer.brand !== 'Unknown') {
          console.log(`✅ 品牌提取成功: ${offer.brand}`)
          console.log('')
          console.log('🎉 测试完全成功！')
        } else {
          console.log('⚠️  品牌仍然是Unknown，需要进一步调查AI分析')
        }
      } else {
        console.log('❌ Final URL错误或未更新')
        console.log(`   期望: https://www.diamondsfactory.ca/`)
        console.log(`   实际: ${offer.final_url}`)
      }

      db.close()
      clearInterval(interval)
      process.exit(0)
    }

    if (elapsed > 120) {
      console.log('')
      console.log('⏱️  超时（120秒），停止监控')
      db.close()
      clearInterval(interval)
      process.exit(1)
    }
  }

  const interval = setInterval(checkStatus, 5000)
  checkStatus() // 立即检查一次
}

testOfferFlow()
