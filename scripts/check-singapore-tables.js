/**
 * 检查新加坡服务器数据库表结构和产品抓取数据
 */
const { Client } = require('pg')

async function checkDatabase() {
  const connectionString = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
  
  const client = new Client({
    connectionString,
    ssl: false,
  })

  try {
    console.log('🔌 连接到新加坡服务器数据库...')
    await client.connect()
    console.log('✅ 连接成功\n')

    // 1. 查询所有表
    console.log('📋 查询数据库中的所有表...\n')
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `
    const tables = await client.query(tablesQuery)
    console.log(`找到 ${tables.rows.length} 个表：`)
    tables.rows.forEach(row => console.log(`  - ${row.table_name}`))
    console.log()

    // 2. 查询 offers 表的数据
    console.log('📦 查询 offers 表数据...\n')
    const offersQuery = `
      SELECT 
        id,
        user_id,
        url,
        title,
        brand,
        price,
        currency,
        image_url,
        description,
        product_name,
        created_at,
        updated_at
      FROM offers 
      ORDER BY created_at DESC 
      LIMIT 10;
    `
    const offers = await client.query(offersQuery)
    
    if (offers.rows.length > 0) {
      console.log(`找到 ${offers.rows.length} 条 offer 记录（最近10条）：\n`)
      for (const offer of offers.rows) {
        console.log('='.repeat(80))
        console.log(`ID: ${offer.id}`)
        console.log(`用户ID: ${offer.user_id}`)
        console.log(`URL: ${offer.url}`)
        console.log(`标题: ${offer.title || '❌ 未抓取'}`)
        console.log(`品牌: ${offer.brand || '❌ 未抓取'}`)
        console.log(`产品名: ${offer.product_name || '❌ 未抓取'}`)
        console.log(`价格: ${offer.price || '❌ 未抓取'} ${offer.currency || ''}`)
        console.log(`图片: ${offer.image_url ? '✅ 已抓取' : '❌ 未抓取'}`)
        console.log(`描述: ${offer.description ? (offer.description.substring(0, 50) + '...') : '❌ 未抓取'}`)
        console.log(`创建时间: ${offer.created_at}`)
        console.log(`更新时间: ${offer.updated_at}`)
        console.log('='.repeat(80))
        console.log()
      }
    } else {
      console.log('❌ offers 表中没有数据\n')
    }

    // 3. 统计 offers 表中的数据情况
    console.log('📊 统计 offers 表数据完整性...\n')
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(title) as has_title,
        COUNT(brand) as has_brand,
        COUNT(product_name) as has_product_name,
        COUNT(price) as has_price,
        COUNT(image_url) as has_image,
        COUNT(description) as has_description
      FROM offers;
    `
    const stats = await client.query(statsQuery)
    const stat = stats.rows[0]
    
    console.log(`总记录数: ${stat.total}`)
    console.log(`有标题: ${stat.has_title} (${(stat.has_title/stat.total*100).toFixed(1)}%)`)
    console.log(`有品牌: ${stat.has_brand} (${(stat.has_brand/stat.total*100).toFixed(1)}%)`)
    console.log(`有产品名: ${stat.has_product_name} (${(stat.has_product_name/stat.total*100).toFixed(1)}%)`)
    console.log(`有价格: ${stat.has_price} (${(stat.has_price/stat.total*100).toFixed(1)}%)`)
    console.log(`有图片: ${stat.has_image} (${(stat.has_image/stat.total*100).toFixed(1)}%)`)
    console.log(`有描述: ${stat.has_description} (${(stat.has_description/stat.total*100).toFixed(1)}%)`)
    console.log()

    // 4. 查询最近失败的抓取记录（如果有相关表）
    const hasExtractionLog = tables.rows.some(row => row.table_name === 'extraction_logs' || row.table_name === 'scrape_logs')
    
    if (hasExtractionLog) {
      console.log('📜 查询抓取日志...\n')
      const logQuery = `
        SELECT * FROM extraction_logs 
        ORDER BY created_at DESC 
        LIMIT 10;
      `
      try {
        const logs = await client.query(logQuery)
        console.log(`找到 ${logs.rows.length} 条日志记录`)
        logs.rows.forEach(log => {
          console.log(`  ${log.created_at} | ${log.status} | ${log.message}`)
        })
      } catch (err) {
        console.log('extraction_logs 表查询失败，尝试其他日志表...')
      }
    }

  } catch (error) {
    console.error('❌ 错误:', error.message)
    console.error('详细信息:', error)
  } finally {
    await client.end()
    console.log('\n🔌 数据库连接已关闭')
  }
}

checkDatabase().catch(console.error)
