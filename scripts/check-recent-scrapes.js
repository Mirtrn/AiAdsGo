/**
 * 检查重新抓取后的数据状态
 */
const { Client } = require('pg')

async function checkRecentScrapes() {
  const connectionString = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
  
  const client = new Client({
    connectionString,
    ssl: false,
  })

  try {
    console.log('🔌 连接到新加坡服务器数据库...')
    await client.connect()
    console.log('✅ 连接成功\n')

    // 1. 检查最近更新的记录（按 updated_at 排序，因为是 text 类型）
    console.log('📊 检查最近更新的记录（最新 20 条）...\n')
    const recentQuery = `
      SELECT 
        id,
        brand,
        url,
        product_name,
        scrape_status,
        scraped_at,
        extracted_at,
        updated_at,
        CASE 
          WHEN product_name IS NOT NULL THEN '✅'
          ELSE '❌'
        END as has_product_name,
        CASE 
          WHEN extracted_keywords IS NOT NULL THEN '✅'
          ELSE '❌'
        END as has_keywords,
        CASE 
          WHEN extracted_headlines IS NOT NULL THEN '✅'
          ELSE '❌'
        END as has_headlines
      FROM offers 
      ORDER BY updated_at DESC
      LIMIT 20;
    `
    
    const recent = await client.query(recentQuery)
    
    if (recent.rows.length > 0) {
      console.log(`找到 ${recent.rows.length} 条最近更新的记录：\n`)
      console.log('ID\t品牌\t\t产品名\t关键词\t标题\t更新时间')
      console.log('='.repeat(120))
      recent.rows.forEach(row => {
        const brand = (row.brand || '').substring(0, 12).padEnd(12)
        const updateTime = row.updated_at ? row.updated_at.substring(0, 19) : 'N/A'
        console.log(`${row.id}\t${brand}\t${row.has_product_name}\t${row.has_keywords}\t${row.has_headlines}\t${updateTime}`)
      })
      console.log()
    }

    // 2. 统计当前数据完整性
    console.log('📈 当前数据完整性统计...\n')
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(product_name) as has_product_name,
        COUNT(extracted_keywords) as has_keywords,
        COUNT(extracted_headlines) as has_headlines,
        COUNT(extracted_descriptions) as has_descriptions,
        COUNT(extracted_at) as has_extracted_at,
        COUNT(scraped_at) as has_scraped_at
      FROM offers;
    `
    const stats = await client.query(statsQuery)
    const stat = stats.rows[0]
    
    const missing_product_name = stat.total - stat.has_product_name
    const missing_keywords = stat.total - stat.has_keywords
    const missing_headlines = stat.total - stat.has_headlines
    
    console.log(`总记录数: ${stat.total}`)
    console.log(`有产品名: ${stat.has_product_name} (${(stat.has_product_name/stat.total*100).toFixed(1)}%) | 缺失: ${missing_product_name}`)
    console.log(`有关键词: ${stat.has_keywords} (${(stat.has_keywords/stat.total*100).toFixed(1)}%) | 缺失: ${missing_keywords}`)
    console.log(`有标题: ${stat.has_headlines} (${(stat.has_headlines/stat.total*100).toFixed(1)}%) | 缺失: ${missing_headlines}`)
    console.log(`有描述: ${stat.has_descriptions} (${(stat.has_descriptions/stat.total*100).toFixed(1)}%)`)
    console.log(`有提取时间: ${stat.has_extracted_at} (${(stat.has_extracted_at/stat.total*100).toFixed(1)}%)`)
    console.log(`有抓取时间: ${stat.has_scraped_at} (${(stat.has_scraped_at/stat.total*100).toFixed(1)}%)`)
    console.log()

    // 3. 查看仍然缺失数据的记录
    console.log('⚠️  仍然缺失产品名的记录（前 10 条）...\n')
    const missingQuery = `
      SELECT 
        id,
        brand,
        url,
        scrape_status,
        scrape_error,
        scraped_at,
        extracted_at,
        updated_at
      FROM offers 
      WHERE product_name IS NULL
      ORDER BY id DESC
      LIMIT 10;
    `
    const missing = await client.query(missingQuery)
    
    if (missing.rows.length > 0) {
      console.log(`找到 ${missing.rows.length} 条缺失产品名的记录：\n`)
      missing.rows.forEach(row => {
        console.log('='.repeat(100))
        console.log(`ID: ${row.id}`)
        console.log(`品牌: ${row.brand}`)
        console.log(`URL: ${row.url}`)
        console.log(`抓取状态: ${row.scrape_status || '未知'}`)
        console.log(`抓取错误: ${row.scrape_error || '无'}`)
        console.log(`抓取时间: ${row.scraped_at || '未抓取'}`)
        console.log(`提取时间: ${row.extracted_at || '未提取'}`)
        console.log(`更新时间: ${row.updated_at}`)
        console.log()
      })
    } else {
      console.log('🎉 所有记录都有产品名！\n')
    }

    // 4. 检查 scraped_data 字段，看看原始数据是否存在
    console.log('🔍 检查缺失记录的原始抓取数据...\n')
    const rawDataQuery = `
      SELECT 
        id,
        brand,
        url,
        CASE 
          WHEN scraped_data IS NOT NULL AND scraped_data != '' THEN '✅ 有原始数据'
          ELSE '❌ 无原始数据'
        END as has_raw_data,
        LENGTH(scraped_data) as data_size,
        scrape_status
      FROM offers 
      WHERE product_name IS NULL
      ORDER BY id DESC
      LIMIT 10;
    `
    const rawData = await client.query(rawDataQuery)
    
    if (rawData.rows.length > 0) {
      console.log('缺失产品名的记录原始数据状态：\n')
      rawData.rows.forEach(row => {
        console.log(`ID ${row.id} (${row.brand}): ${row.has_raw_data} (${row.data_size || 0} 字节) | 状态: ${row.scrape_status || '未知'}`)
      })
      console.log()
      
      // 如果有原始数据但没有产品名，说明是解析问题
      const hasRawButNoProduct = rawData.rows.filter(r => r.data_size > 0)
      if (hasRawButNoProduct.length > 0) {
        console.log(`⚠️  发现 ${hasRawButNoProduct.length} 条记录有原始数据但缺失产品名`)
        console.log('   这说明问题在于数据解析/提取环节，而不是抓取环节\n')
      }
    } else {
      console.log('没有缺失产品名的记录\n')
    }

    // 5. 检查最近的抓取错误
    console.log('🚨 检查最近的抓取错误...\n')
    const errorQuery = `
      SELECT 
        id,
        brand,
        url,
        scrape_error,
        scrape_status,
        updated_at
      FROM offers 
      WHERE scrape_error IS NOT NULL AND scrape_error != ''
      ORDER BY id DESC
      LIMIT 5;
    `
    const errors = await client.query(errorQuery)
    
    if (errors.rows.length > 0) {
      console.log(`找到 ${errors.rows.length} 条有错误的记录：\n`)
      errors.rows.forEach(row => {
        console.log(`ID ${row.id}: ${row.scrape_error}`)
      })
    } else {
      console.log('✅ 没有抓取错误记录\n')
    }

  } catch (error) {
    console.error('❌ 错误:', error.message)
    console.error('详细信息:', error)
  } finally {
    await client.end()
    console.log('🔌 数据库连接已关闭')
  }
}

checkRecentScrapes().catch(console.error)
