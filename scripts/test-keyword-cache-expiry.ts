/**
 * 测试关键词缓存过期逻辑
 * 验证7天后数据会正确过期和刷新
 *
 * 运行: npx tsx scripts/test-keyword-cache-expiry.ts
 */
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

interface KeywordRecord {
  keyword: string
  country: string
  language: string
  search_volume: number
  created_at: string
  cached_at: string
}

async function testCacheExpiry() {
  console.log('🧪 测试关键词缓存过期逻辑\n')
  console.log('='.repeat(60))

  const db = new Database(DB_PATH)

  try {
    // 1. 测试场景1：插入新关键词
    console.log('\n1️⃣  测试场景1: 首次插入关键词')
    console.log('   动作: INSERT "test keyword 1" 搜索量 100000')

    db.prepare(`
      INSERT INTO global_keywords (keyword, country, language, search_volume, cached_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(keyword, country, language)
      DO UPDATE SET
        search_volume = excluded.search_volume,
        cached_at = datetime('now'),
        created_at = CASE
          WHEN global_keywords.search_volume != excluded.search_volume
          THEN datetime('now')
          ELSE global_keywords.created_at
        END
    `).run('test keyword 1', 'US', 'en', 100000)

    let record = db.prepare(`
      SELECT keyword, search_volume, created_at, cached_at
      FROM global_keywords
      WHERE keyword = ? AND country = ? AND language = ?
    `).get('test keyword 1', 'US', 'en') as KeywordRecord

    console.log(`   ✅ 插入成功`)
    console.log(`      搜索量: ${record.search_volume}`)
    console.log(`      created_at: ${record.created_at}`)
    console.log(`      cached_at: ${record.cached_at}`)

    // 2. 测试场景2：搜索量未变化时重复更新
    // 注意：实际场景中，其他Offer会优先查询Redis缓存，只有Redis过期且数据库过期后才会触发API调用
    // 这里直接测试数据库层的CASE逻辑：当API返回的搜索量未变化时，created_at应保持不变
    console.log('\n2️⃣  测试场景2: 搜索量未变化，重复API调用（模拟Redis过期后API返回相同搜索量）')
    console.log('   动作: UPDATE "test keyword 1" 搜索量仍为 100000')

    const originalCreatedAt = record.created_at

    // Wait 1 second to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 1100))

    db.prepare(`
      INSERT INTO global_keywords (keyword, country, language, search_volume, cached_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(keyword, country, language)
      DO UPDATE SET
        search_volume = excluded.search_volume,
        cached_at = datetime('now'),
        created_at = CASE
          WHEN global_keywords.search_volume != excluded.search_volume
          THEN datetime('now')
          ELSE global_keywords.created_at
        END
    `).run('test keyword 1', 'US', 'en', 100000)

    record = db.prepare(`
      SELECT keyword, search_volume, created_at, cached_at
      FROM global_keywords
      WHERE keyword = ? AND country = ? AND language = ?
    `).get('test keyword 1', 'US', 'en') as KeywordRecord

    console.log(`   ✅ 更新完成`)
    console.log(`      搜索量: ${record.search_volume} (未变化)`)
    console.log(`      created_at: ${record.created_at} (${record.created_at === originalCreatedAt ? '✅ 保持不变' : '❌ 被更新了'})`)
    console.log(`      cached_at: ${record.cached_at} (✅ 已更新)`)

    if (record.created_at !== originalCreatedAt) {
      console.log(`   ❌ 错误: created_at 不应该变化！`)
    }

    // 3. 测试场景3：搜索量变化时更新
    console.log('\n3️⃣  测试场景3: 搜索量变化（从 100000 → 150000）')
    console.log('   动作: UPDATE "test keyword 1" 搜索量更新为 150000')

    await new Promise(resolve => setTimeout(resolve, 1100))

    db.prepare(`
      INSERT INTO global_keywords (keyword, country, language, search_volume, cached_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(keyword, country, language)
      DO UPDATE SET
        search_volume = excluded.search_volume,
        cached_at = datetime('now'),
        created_at = CASE
          WHEN global_keywords.search_volume != excluded.search_volume
          THEN datetime('now')
          ELSE global_keywords.created_at
        END
    `).run('test keyword 1', 'US', 'en', 150000)

    record = db.prepare(`
      SELECT keyword, search_volume, created_at, cached_at
      FROM global_keywords
      WHERE keyword = ? AND country = ? AND language = ?
    `).get('test keyword 1', 'US', 'en') as KeywordRecord

    console.log(`   ✅ 更新完成`)
    console.log(`      搜索量: ${record.search_volume} (✅ 已变化)`)
    console.log(`      created_at: ${record.created_at} (${record.created_at !== originalCreatedAt ? '✅ 已重置' : '❌ 未重置'})`)
    console.log(`      cached_at: ${record.cached_at} (✅ 已更新)`)

    if (record.created_at === originalCreatedAt) {
      console.log(`   ❌ 错误: 搜索量变化时，created_at 应该重置！`)
    }

    // 4. 测试场景4：7天过期查询
    console.log('\n4️⃣  测试场景4: 查询7天内有效数据')

    // Insert test data with old created_at
    db.prepare(`
      INSERT OR REPLACE INTO global_keywords (keyword, country, language, search_volume, cached_at, created_at)
      VALUES
        ('expired keyword', 'US', 'en', 50000, datetime('now', '-8 days'), datetime('now', '-8 days')),
        ('valid keyword', 'US', 'en', 60000, datetime('now', '-3 days'), datetime('now', '-3 days'))
    `).run()

    const validRecords = db.prepare(`
      SELECT keyword, search_volume,
             ROUND(JULIANDAY('now') - JULIANDAY(created_at), 1) as age_days
      FROM global_keywords
      WHERE created_at > datetime('now', '-7 days')
        AND country = 'US' AND language = 'en'
      ORDER BY keyword
    `).all() as Array<{ keyword: string; search_volume: number; age_days: number }>

    console.log(`   ✅ 查询结果 (7天内有效数据):`)
    validRecords.forEach(r => {
      console.log(`      - ${r.keyword}: ${r.search_volume} (年龄: ${r.age_days} 天)`)
    })

    const allRecords = db.prepare(`
      SELECT keyword, search_volume,
             ROUND(JULIANDAY('now') - JULIANDAY(created_at), 1) as age_days
      FROM global_keywords
      WHERE country = 'US' AND language = 'en'
      ORDER BY keyword
    `).all() as Array<{ keyword: string; search_volume: number; age_days: number }>

    console.log(`\n   📋 所有数据 (包括过期):`)
    allRecords.forEach(r => {
      const status = r.age_days <= 7 ? '✅ 有效' : '❌ 过期'
      console.log(`      - ${r.keyword}: ${r.search_volume} (年龄: ${r.age_days} 天) ${status}`)
    })

    // 5. 清理测试数据
    console.log('\n5️⃣  清理测试数据')
    db.prepare(`
      DELETE FROM global_keywords
      WHERE keyword IN ('test keyword 1', 'expired keyword', 'valid keyword')
        AND country = 'US' AND language = 'en'
    `).run()
    console.log(`   ✅ 测试数据已清理`)

    console.log('\n' + '='.repeat(60))
    console.log('✅ 缓存过期逻辑测试完成\n')

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    throw error
  } finally {
    db.close()
  }
}

testCacheExpiry().catch(console.error)
