/**
 * 真实URL解析测试
 * 验证实际的affiliate link解析流程和数据保存
 */

import Database from 'better-sqlite3'
import path from 'path'
import { resolveAffiliateLink, getUrlResolverCacheStats } from '../src/lib/url-resolver'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath)

console.log('🧪 真实URL解析测试\n')

async function testRealUrlResolution() {
  try {
    // 测试用的affiliate links
    const testLinks = [
      {
        name: '测试链接1 - pboost.me',
        url: 'https://pboost.me/UKts4I6',
        description: '真实Amazon联盟链接（多次重定向）'
      },
      {
        name: '测试链接2 - 短链接',
        url: 'https://bit.ly/3example',
        description: '通用短链接服务'
      }
    ]

    // 测试1: URL解析功能验证
    console.log('📋 测试1: URL解析功能验证\n')

    for (const testLink of testLinks) {
      console.log(`\n🔗 测试: ${testLink.name}`)
      console.log(`   URL: ${testLink.url}`)
      console.log(`   描述: ${testLink.description}`)
      console.log(`   解析中...\n`)

      try {
        const resolved = await resolveAffiliateLink(testLink.url, undefined, false)

        console.log('✅ 解析成功:')
        console.log(`   重定向次数: ${resolved.redirectCount}`)
        console.log(`   Final URL: ${resolved.finalUrl}`)
        console.log(`   Final URL Suffix: ${resolved.finalUrlSuffix.substring(0, 100)}${resolved.finalUrlSuffix.length > 100 ? '...' : ''}`)
        console.log(`   重定向链 (${resolved.redirectChain.length}步):`)
        resolved.redirectChain.forEach((url, index) => {
          console.log(`     ${index + 1}. ${url.length > 80 ? url.substring(0, 77) + '...' : url}`)
        })

        // 测试2: 保存到数据库验证
        console.log(`\n📋 测试2: 数据库保存验证`)

        const testUserId = 1
        const offerResult = db.prepare(`
          INSERT INTO offers (
            user_id, url, brand, category, target_country,
            affiliate_link, final_url, final_url_suffix,
            scrape_status, offer_name, target_language
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
        `).run(
          testUserId,
          resolved.finalUrl,  // 使用解析后的final_url作为原始url
          `Test Brand - ${testLink.name}`,
          'Test Category',
          'US',
          testLink.url,  // 原始affiliate link
          resolved.finalUrl,
          resolved.finalUrlSuffix,
          `Test_${Date.now()}`,
          'English'
        )

        const offerId = offerResult.lastInsertRowid as number
        console.log(`   ✅ Offer创建成功 (ID: ${offerId})`)

        // 验证保存的数据
        const savedOffer = db.prepare(`
          SELECT id, brand, url, affiliate_link, final_url, final_url_suffix
          FROM offers WHERE id = ?
        `).get(offerId) as any

        console.log(`   验证保存的数据:`)
        console.log(`     - URL: ${savedOffer.url}`)
        console.log(`     - Affiliate Link: ${savedOffer.affiliate_link}`)
        console.log(`     - Final URL: ${savedOffer.final_url}`)
        console.log(`     - Final URL Suffix: ${savedOffer.final_url_suffix?.substring(0, 50)}${(savedOffer.final_url_suffix?.length || 0) > 50 ? '...' : ''}`)

        // 测试3: 创意生成验证
        console.log(`\n📋 测试3: 创意使用Final URL验证`)

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
        console.log(`   ✅ Creative创建成功 (ID: ${creativeId})`)

        const savedCreative = db.prepare(`
          SELECT id, final_url, final_url_suffix
          FROM creatives WHERE id = ?
        `).get(creativeId) as any

        console.log(`   验证Creative中的URL:`)
        console.log(`     - Final URL: ${savedCreative.final_url}`)
        console.log(`     - Final URL Suffix: ${savedCreative.final_url_suffix?.substring(0, 50)}${(savedCreative.final_url_suffix?.length || 0) > 50 ? '...' : ''}`)

        // 验证数据一致性
        if (savedCreative.final_url === savedOffer.final_url &&
            savedCreative.final_url_suffix === savedOffer.final_url_suffix) {
          console.log(`   ✅ 数据流一致: Offer → Creative`)
        } else {
          console.log(`   ❌ 数据流不一致`)
        }

        // 清理测试数据
        console.log(`\n🧹 清理测试数据...`)
        db.prepare('DELETE FROM creatives WHERE id = ?').run(creativeId)
        db.prepare('DELETE FROM offers WHERE id = ?').run(offerId)
        console.log(`   ✅ 测试数据已清理`)

      } catch (error: any) {
        console.error(`❌ 测试失败: ${error.message}`)
        console.error(error.stack)
      }

      console.log('\n' + '─'.repeat(80) + '\n')
    }

    // 测试4: 缓存验证
    console.log('📋 测试4: URL解析缓存验证\n')
    const cacheStats = getUrlResolverCacheStats()
    console.log(`   缓存统计:`)
    console.log(`     - 总缓存条目: ${cacheStats.totalCached}`)
    console.log(`     - 有效缓存: ${cacheStats.validCached}`)
    console.log(`     - 过期缓存: ${cacheStats.expiredCached}`)

    console.log('\n🎉 所有测试完成！')

  } catch (error: any) {
    console.error('\n❌ 测试执行失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    db.close()
  }
}

// 执行测试
testRealUrlResolution()
