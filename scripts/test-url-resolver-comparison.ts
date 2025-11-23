/**
 * URL解析器对比测试
 * 比较HTTP和Playwright两种解析方式的效果
 */

import Database from 'better-sqlite3'
import path from 'path'
import { resolveAffiliateLink } from '../src/lib/url-resolver'
import { resolveAffiliateLinkWithPlaywright } from '../src/lib/url-resolver-playwright'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath)

console.log('🧪 URL解析器对比测试\n')
console.log('比较HTTP解析器 vs Playwright解析器\n')
console.log('─'.repeat(80) + '\n')

async function testUrlResolverComparison() {
  const testCases = [
    {
      name: 'Amazon Affiliate Link (pboost.me)',
      url: 'https://pboost.me/UKts4I6',
      expectsJavaScript: true,
      description: 'Amazon联盟链接，可能需要JavaScript重定向'
    },
    {
      name: 'Generic Short Link (bit.ly)',
      url: 'https://bit.ly/3example',
      expectsJavaScript: false,
      description: '通用短链接，HTTP重定向'
    }
  ]

  for (const testCase of testCases) {
    console.log(`\n🔗 测试案例: ${testCase.name}`)
    console.log(`   URL: ${testCase.url}`)
    console.log(`   描述: ${testCase.description}`)
    console.log(`   预期需要JavaScript: ${testCase.expectsJavaScript ? '是' : '否'}`)
    console.log('\n' + '─'.repeat(80))

    // 测试1: HTTP解析器
    console.log('\n📋 方法1: HTTP解析器 (axios)')
    try {
      const startTime = Date.now()
      const httpResult = await resolveAffiliateLink(testCase.url, undefined, false)
      const duration = Date.now() - startTime

      console.log(`   ⏱️  耗时: ${duration}ms`)
      console.log(`   ✅ 解析成功:`)
      console.log(`      - 重定向次数: ${httpResult.redirectCount}`)
      console.log(`      - Final URL: ${httpResult.finalUrl.substring(0, 80)}${httpResult.finalUrl.length > 80 ? '...' : ''}`)
      console.log(`      - Final URL Suffix: ${httpResult.finalUrlSuffix.substring(0, 60)}${httpResult.finalUrlSuffix.length > 60 ? '...' : ''}`)
      console.log(`      - 重定向链: ${httpResult.redirectChain.length}步`)
    } catch (error: any) {
      console.log(`   ❌ 解析失败: ${error.message}`)
    }

    // 测试2: Playwright解析器
    console.log('\n📋 方法2: Playwright解析器 (真实浏览器)')
    try {
      const startTime = Date.now()
      const playwrightResult = await resolveAffiliateLinkWithPlaywright(testCase.url, undefined, 5000)
      const duration = Date.now() - startTime

      console.log(`   ⏱️  耗时: ${duration}ms`)
      console.log(`   ✅ 解析成功:`)
      console.log(`      - 重定向次数: ${playwrightResult.redirectCount}`)
      console.log(`      - Final URL: ${playwrightResult.finalUrl.substring(0, 80)}${playwrightResult.finalUrl.length > 80 ? '...' : ''}`)
      console.log(`      - Final URL Suffix: ${playwrightResult.finalUrlSuffix.substring(0, 60)}${playwrightResult.finalUrlSuffix.length > 60 ? '...' : ''}`)
      console.log(`      - 页面标题: ${playwrightResult.pageTitle?.substring(0, 60) || 'N/A'}`)
      console.log(`      - HTTP状态码: ${playwrightResult.statusCode}`)
      console.log(`      - 重定向链: ${playwrightResult.redirectChain.length}步`)
    } catch (error: any) {
      console.log(`   ❌ 解析失败: ${error.message}`)
    }

    console.log('\n' + '='.repeat(80))
  }

  // 测试3: 数据库集成测试
  console.log('\n\n📋 测试3: 完整数据流验证（使用Playwright解析器）\n')

  const testUrl = 'https://bit.ly/3example'
  console.log(`测试URL: ${testUrl}`)

  try {
    // 解析URL
    const resolved = await resolveAffiliateLinkWithPlaywright(testUrl, undefined, 5000)
    console.log(`✅ URL解析成功`)

    // 创建Offer
    const testUserId = 1
    const offerResult = db.prepare(`
      INSERT INTO offers (
        user_id, url, brand, category, target_country,
        affiliate_link, final_url, final_url_suffix,
        scrape_status, offer_name, target_language
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
    `).run(
      testUserId,
      resolved.finalUrl,
      'Test Playwright Integration',
      'Test',
      'US',
      testUrl,
      resolved.finalUrl,
      resolved.finalUrlSuffix,
      `Playwright_Test_${Date.now()}`,
      'English'
    )

    const offerId = offerResult.lastInsertRowid as number
    console.log(`✅ Offer创建成功 (ID: ${offerId})`)

    // 创建Creative
    const creativeResult = db.prepare(`
      INSERT INTO creatives (
        user_id, offer_id, version,
        headline_1, headline_2, headline_3,
        description_1, description_2,
        final_url, final_url_suffix,
        ai_model, quality_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testUserId,
      offerId,
      1,
      'Test Headline 1',
      'Test Headline 2',
      'Test Headline 3',
      'Test Description 1',
      'Test Description 2',
      resolved.finalUrl,
      resolved.finalUrlSuffix,
      'gemini-2.5-pro',
      90.0
    )

    const creativeId = creativeResult.lastInsertRowid as number
    console.log(`✅ Creative创建成功 (ID: ${creativeId})`)

    // 验证数据一致性
    const verification = db.prepare(`
      SELECT
        o.id as offer_id,
        o.final_url as offer_final_url,
        o.final_url_suffix as offer_suffix,
        c.id as creative_id,
        c.final_url as creative_final_url,
        c.final_url_suffix as creative_suffix
      FROM offers o
      JOIN creatives c ON o.id = c.offer_id
      WHERE o.id = ?
    `).get(offerId) as any

    console.log(`\n数据一致性验证:`)
    console.log(`   Offer Final URL: ${verification.offer_final_url.substring(0, 60)}...`)
    console.log(`   Creative Final URL: ${verification.creative_final_url.substring(0, 60)}...`)
    console.log(`   URL匹配: ${verification.offer_final_url === verification.creative_final_url ? '✅' : '❌'}`)
    console.log(`   Suffix匹配: ${verification.offer_suffix === verification.creative_suffix ? '✅' : '❌'}`)

    // 清理测试数据
    console.log(`\n🧹 清理测试数据...`)
    db.prepare('DELETE FROM creatives WHERE id = ?').run(creativeId)
    db.prepare('DELETE FROM offers WHERE id = ?').run(offerId)
    console.log(`✅ 测试数据已清理`)

  } catch (error: any) {
    console.error(`❌ 测试失败: ${error.message}`)
  }

  console.log('\n\n🎉 所有对比测试完成！')
  console.log('\n📊 总结:')
  console.log('   - HTTP解析器: 快速，适用于简单HTTP重定向')
  console.log('   - Playwright解析器: 完整，支持JavaScript重定向，但速度较慢')
  console.log('   - 建议: 优先使用HTTP解析器，失败时回退到Playwright')
}

// 执行测试
testUrlResolverComparison()
  .catch(error => {
    console.error('测试执行失败:', error)
    process.exit(1)
  })
  .finally(() => {
    db.close()
  })
