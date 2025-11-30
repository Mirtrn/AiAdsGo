/**
 * 调试脚本：对比两个API对"eufy"关键词的返回数据
 *
 * 用法：npx tsx scripts/debug-eufy-keyword.ts
 */

import { getKeywordSearchVolumes } from '../src/lib/keyword-planner'
import { getKeywordIdeas } from '../src/lib/google-ads-keyword-planner'
import { getSQLiteDatabase } from '../src/lib/db'

async function debugEufyKeyword() {
  console.log('🔍 调试eufy关键词搜索量不一致问题\n')

  const db = getSQLiteDatabase()
  const userId = 1 // autoads用户

  // 获取Google Ads账号
  const account = db.prepare(`
    SELECT customer_id, refresh_token
    FROM google_ads_accounts
    WHERE user_id = ? AND is_active = 1
    LIMIT 1
  `).get(userId) as { customer_id: string; refresh_token: string } | undefined

  if (!account) {
    console.error('❌ 未找到活跃的Google Ads账号')
    return
  }

  const country = 'IT'
  const language = 'Italian'

  console.log(`📍 测试参数: country=${country}, language=${language}\n`)

  // ==========================================
  // 测试1: generateKeywordHistoricalMetrics
  // ==========================================
  console.log('📊 测试1: 基础直查 (generateKeywordHistoricalMetrics)')
  console.log('输入: ["eufy", "eufi"]')

  try {
    const historicalResults = await getKeywordSearchVolumes(
      ['eufy', 'eufi'],
      country,
      language,
      userId
    )

    console.log('✅ 返回结果:')
    historicalResults.forEach(kw => {
      console.log(`   - "${kw.keyword}": ${kw.avgMonthlySearches} 搜索量/月`)
    })
  } catch (error: any) {
    console.error('❌ 查询失败:', error.message)
  }

  console.log('\n' + '='.repeat(60) + '\n')

  // ==========================================
  // 测试2: generateKeywordIdeas
  // ==========================================
  console.log('📊 测试2: 关键词扩展 (generateKeywordIdeas)')
  console.log('输入: seedKeywords=["robot vacuum", "eufy"]')

  try {
    const ideasResults = await getKeywordIdeas({
      customerId: account.customer_id,
      refreshToken: account.refresh_token,
      seedKeywords: ['robot vacuum', 'eufy'],
      targetCountry: country,
      targetLanguage: language,
      userId
    })

    console.log(`✅ 返回 ${ideasResults.length} 个关键词建议:`)

    // 只显示包含"eufy"或"eufi"的结果
    const eufyRelated = ideasResults.filter(kw =>
      kw.text.toLowerCase().includes('eufy') || kw.text.toLowerCase().includes('eufi')
    )

    if (eufyRelated.length > 0) {
      console.log('\n🎯 包含"eufy/eufi"的建议:')
      eufyRelated.forEach(kw => {
        console.log(`   - "${kw.text}": ${kw.avgMonthlySearches} 搜索量/月 (竞争: ${kw.competition})`)
      })
    } else {
      console.log('⚠️  未找到包含"eufy/eufi"的关键词建议')
    }

    console.log(`\n📋 所有返回的关键词（前20个）:`)
    ideasResults.slice(0, 20).forEach((kw, idx) => {
      console.log(`   ${idx + 1}. "${kw.text}": ${kw.avgMonthlySearches}/月`)
    })

  } catch (error: any) {
    console.error('❌ 查询失败:', error.message)
  }

  console.log('\n' + '='.repeat(60) + '\n')

  // ==========================================
  // 测试3: 查看数据库缓存
  // ==========================================
  console.log('📊 测试3: 数据库缓存记录')

  const cachedRecords = db.prepare(`
    SELECT keyword, search_volume, country, language, cached_at
    FROM global_keywords
    WHERE keyword IN ('eufy', 'eufi')
      AND country = ?
      AND language IN ('Italian', 'it', '1')
    ORDER BY cached_at DESC
    LIMIT 10
  `).all(country) as Array<{
    keyword: string
    search_volume: number
    country: string
    language: string
    cached_at: string
  }>

  if (cachedRecords.length > 0) {
    console.log('✅ 缓存记录:')
    cachedRecords.forEach(record => {
      console.log(`   - "${record.keyword}": ${record.search_volume}/月 (${record.language}, ${record.cached_at})`)
    })
  } else {
    console.log('⚠️  未找到缓存记录')
  }

  console.log('\n' + '='.repeat(60) + '\n')
  console.log('✅ 调试完成')
}

// 运行调试
debugEufyKeyword().catch(console.error)
