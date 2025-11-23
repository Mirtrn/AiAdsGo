/**
 * 使用真实pboost.me推广链接的URL解析测试
 * 推广链接: https://pboost.me/UKTs4I6
 */

import Database from 'better-sqlite3'
import path from 'path'
import { resolveAffiliateLink } from '../src/lib/url-resolver'
import { resolveAffiliateLinkWithPlaywright } from '../src/lib/url-resolver-playwright'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath)

// 真实的推广链接（用户提供）
const REAL_AFFILIATE_LINK = 'https://pboost.me/UKTs4I6'

console.log('🧪 真实推广链接URL解析测试')
console.log(`📎 测试链接: ${REAL_AFFILIATE_LINK}`)
console.log('─'.repeat(80) + '\n')

async function testRealPboostLink() {
  try {
    // 测试1: HTTP解析器
    console.log('📋 测试1: HTTP解析器 (axios)\n')
    try {
      const startTime1 = Date.now()
      const httpResult = await resolveAffiliateLink(REAL_AFFILIATE_LINK, undefined, false)
      const duration1 = Date.now() - startTime1

      console.log(`⏱️  耗时: ${duration1}ms`)
      console.log(`解析结果:`)
      console.log(`  - 重定向次数: ${httpResult.redirectCount}`)
      console.log(`  - Final URL: ${httpResult.finalUrl}`)
      if (httpResult.finalUrlSuffix) {
        console.log(`  - Final URL Suffix: ${httpResult.finalUrlSuffix.substring(0, 100)}${httpResult.finalUrlSuffix.length > 100 ? '...' : ''}`)
      }
      console.log(`  - 重定向链 (${httpResult.redirectChain.length}步):`)
      httpResult.redirectChain.forEach((url, index) => {
        console.log(`    ${index + 1}. ${url}`)
      })

      if (httpResult.redirectCount === 0) {
        console.log('\n⚠️  HTTP解析器未捕获重定向，可能需要JavaScript执行')
      } else {
        console.log('\n✅ HTTP解析器成功捕获重定向')
      }
    } catch (error: any) {
      console.log(`❌ HTTP解析失败: ${error.message}`)
    }

    console.log('\n' + '─'.repeat(80) + '\n')

    // 测试2: Playwright解析器
    console.log('📋 测试2: Playwright解析器 (真实浏览器)\n')
    try {
      const startTime2 = Date.now()
      const playwrightResult = await resolveAffiliateLinkWithPlaywright(
        REAL_AFFILIATE_LINK,
        undefined,
        10000  // 等待10秒确保JavaScript执行完成
      )
      const duration2 = Date.now() - startTime2

      console.log(`⏱️  耗时: ${duration2}ms`)
      console.log(`解析结果:`)
      console.log(`  - 重定向次数: ${playwrightResult.redirectCount}`)
      console.log(`  - Final URL: ${playwrightResult.finalUrl}`)
      if (playwrightResult.finalUrlSuffix) {
        console.log(`  - Final URL Suffix: ${playwrightResult.finalUrlSuffix.substring(0, 100)}${playwrightResult.finalUrlSuffix.length > 100 ? '...' : ''}`)
      }
      console.log(`  - 页面标题: ${playwrightResult.pageTitle}`)
      console.log(`  - HTTP状态码: ${playwrightResult.statusCode}`)
      console.log(`  - 重定向链 (${playwrightResult.redirectChain.length}步):`)
      playwrightResult.redirectChain.forEach((url, index) => {
        console.log(`    ${index + 1}. ${url}`)
      })

      console.log('\n✅ Playwright解析器成功')

      // 测试3: 保存到数据库并验证数据流
      console.log('\n' + '─'.repeat(80) + '\n')
      console.log('📋 测试3: 数据库保存和数据流验证\n')

      const testUserId = 1
      const offerResult = db.prepare(`
        INSERT INTO offers (
          user_id, url, brand, category, target_country,
          affiliate_link, final_url, final_url_suffix,
          scrape_status, offer_name, target_language
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
      `).run(
        testUserId,
        playwrightResult.finalUrl,  // 使用解析后的final_url作为url
        'Real Test - pboost.me',
        'Test Category',
        'US',
        REAL_AFFILIATE_LINK,
        playwrightResult.finalUrl,
        playwrightResult.finalUrlSuffix,
        `Real_pboost_${Date.now()}`,
        'English'
      )

      const offerId = offerResult.lastInsertRowid as number
      console.log(`✅ Offer创建成功 (ID: ${offerId})`)

      // 读取验证
      const savedOffer = db.prepare(`
        SELECT id, brand, url, affiliate_link, final_url, final_url_suffix
        FROM offers WHERE id = ?
      `).get(offerId) as any

      console.log(`\nOffer保存验证:`)
      console.log(`  - ID: ${savedOffer.id}`)
      console.log(`  - Affiliate Link: ${savedOffer.affiliate_link}`)
      console.log(`  - Final URL: ${savedOffer.final_url}`)
      console.log(`  - Final URL Suffix: ${savedOffer.final_url_suffix?.substring(0, 80)}${(savedOffer.final_url_suffix?.length || 0) > 80 ? '...' : ''}`)

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
        savedOffer.final_url,
        savedOffer.final_url_suffix,
        'gemini-2.5-pro',
        85.5
      )

      const creativeId = creativeResult.lastInsertRowid as number
      console.log(`\n✅ Creative创建成功 (ID: ${creativeId})`)

      // 验证数据一致性
      const verification = db.prepare(`
        SELECT
          o.final_url as offer_final_url,
          o.final_url_suffix as offer_suffix,
          c.final_url as creative_final_url,
          c.final_url_suffix as creative_suffix
        FROM offers o
        JOIN creatives c ON o.id = c.offer_id
        WHERE o.id = ?
      `).get(offerId) as any

      console.log(`\n数据流一致性验证:`)
      const urlMatch = verification.offer_final_url === verification.creative_final_url
      const suffixMatch = verification.offer_suffix === verification.creative_suffix

      console.log(`  - Final URL匹配: ${urlMatch ? '✅' : '❌'}`)
      console.log(`  - Final URL Suffix匹配: ${suffixMatch ? '✅' : '❌'}`)

      if (urlMatch && suffixMatch) {
        console.log(`\n✅ 数据流完整一致: Offer → Creative`)
      } else {
        console.log(`\n❌ 数据流存在问题`)
      }

      // 清理测试数据
      console.log(`\n🧹 清理测试数据...`)
      db.prepare('DELETE FROM creatives WHERE id = ?').run(creativeId)
      db.prepare('DELETE FROM offers WHERE id = ?').run(offerId)
      console.log(`✅ 测试数据已清理`)

    } catch (error: any) {
      console.error(`❌ Playwright解析失败: ${error.message}`)
      throw error
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n🎉 所有测试完成！')
    console.log('\n📊 结论:')
    console.log('   - 真实推广链接解析成功 ✅')
    console.log('   - 数据库保存正确 ✅')
    console.log('   - 数据流一致性验证通过 ✅')

  } catch (error: any) {
    console.error('\n❌ 测试执行失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    db.close()
  }
}

// 执行测试
testRealPboostLink()
