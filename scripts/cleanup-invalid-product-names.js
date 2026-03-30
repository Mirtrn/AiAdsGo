/**
 * 清理无效的 product_name 值，将其重置为 NULL
 * 避免 "Loading...", "Video", "Sorry! Something went wrong!" 等垃圾数据影响广告质量
 */
const { Client } = require('pg')

// 无效的 product_name 关键词黑名单（不区分大小写）
const INVALID_PATTERNS = [
  'loading...',
  'sorry! something went wrong',
  'page not found',
  '提取中...',
  'error page',
  'before we continue',
  'video',
  'free',
  'fine',
  'hello',
  'official site',
  'men\'s clothes',
  'men\'s & women\'s clothing',
]

// 完全匹配的无效值
const EXACT_INVALID_VALUES = [
  'Loading...',
  'Sorry! Something went wrong!',
  'Page Not Found',
  'Video',
  'Free',
  'Fine',
  'Hello',
  'Official Site',
  'Pet',
]

async function cleanupInvalidProductNames() {
  const connectionString = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
  
  const client = new Client({
    connectionString,
    ssl: false,
  })

  try {
    console.log('🔌 连接到新加坡服务器数据库...')
    await client.connect()
    console.log('✅ 连接成功\n')

    // 1. 查看当前所有 product_name 的分布（找出可疑值）
    console.log('📊 查看可疑的 product_name 值...\n')
    const suspiciousQuery = `
      SELECT product_name, COUNT(*) as count
      FROM offers
      WHERE product_name IS NOT NULL
        AND (
          LENGTH(product_name) < 3
          OR product_name ILIKE '%loading%'
          OR product_name ILIKE '%sorry%something went wrong%'
          OR product_name ILIKE '%page not found%'
          OR product_name ILIKE '%提取中%'
          OR product_name ILIKE '%error page%'
          OR product_name ILIKE '%before we continue%'
          OR product_name = 'Video'
          OR product_name = 'Free'
          OR product_name = 'Fine'
          OR product_name = 'Hello'
          OR product_name = 'Pet'
          OR product_name = 'Official Site'
          OR product_name ILIKE '%men''s clothes%'
          OR product_name ILIKE '%25% off%'
          OR product_name ILIKE '%valentine%day%'
          OR product_name ILIKE '%fresh start%'
          OR product_name ILIKE '%storewide%'
        )
      GROUP BY product_name
      ORDER BY count DESC
      LIMIT 50;
    `
    
    const suspicious = await client.query(suspiciousQuery)
    
    if (suspicious.rows.length > 0) {
      console.log(`发现 ${suspicious.rows.length} 种可疑的 product_name 值：\n`)
      suspicious.rows.forEach(row => {
        console.log(`  "${row.product_name}" → ${row.count} 条记录`)
      })
      console.log()
    }

    // 2. 执行清理 - 将无效值重置为 NULL
    console.log('🧹 开始清理无效的 product_name 值...\n')
    
    const cleanupResult = await client.query(`
      UPDATE offers
      SET product_name = NULL, updated_at = NOW()
      WHERE product_name IS NOT NULL
        AND (
          LENGTH(product_name) < 3
          OR product_name ILIKE '%loading%'
          OR product_name ILIKE '%sorry%something went wrong%'
          OR product_name ILIKE '%page not found%'
          OR product_name ILIKE '%提取中%'
          OR product_name ILIKE '%error page%'
          OR product_name ILIKE '%before we continue%'
          OR product_name = 'Video'
          OR product_name = 'Free'
          OR product_name = 'Fine'
          OR product_name = 'Hello'
          OR product_name = 'Pet'
          OR product_name = 'Official Site'
          OR product_name ILIKE '%men''s clothes%'
          OR product_name ILIKE '%25% off%'
          OR product_name ILIKE '%valentine%day%'
          OR product_name ILIKE '%fresh start%'
          OR product_name ILIKE '%storewide%'
        )
      RETURNING id, brand, product_name
    `)
    
    console.log(`✅ 清理完成：重置了 ${cleanupResult.rowCount} 条无效记录\n`)
    
    if (cleanupResult.rowCount > 0) {
      console.log('被清理的记录样本（前20条）：')
      cleanupResult.rows.slice(0, 20).forEach(row => {
        console.log(`  ID ${row.id}: ${row.brand} → "${row.product_name}" → NULL`)
      })
      console.log()
    }

    // 3. 最终统计
    console.log('📈 清理后数据完整性统计：\n')
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(product_name) as has_product_name,
        COUNT(*) - COUNT(product_name) as missing_product_name
      FROM offers;
    `)
    
    const stat = statsResult.rows[0]
    console.log(`总记录数: ${stat.total}`)
    console.log(`有产品名: ${stat.has_product_name} (${(stat.has_product_name/stat.total*100).toFixed(1)}%)`)
    console.log(`缺失产品名: ${stat.missing_product_name} (${(stat.missing_product_name/stat.total*100).toFixed(1)}%)`)

  } catch (error) {
    console.error('❌ 错误:', error.message)
  } finally {
    await client.end()
    console.log('\n🔌 数据库连接已关闭')
  }
}

cleanupInvalidProductNames().catch(console.error)
