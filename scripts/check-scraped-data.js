/**
 * 查看缺失产品名的记录的原始抓取数据
 */
const { Client } = require('pg')

async function checkScrapedData() {
  const connectionString = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
  
  const client = new Client({
    connectionString,
    ssl: false,
  })

  try {
    console.log('🔌 连接到新加坡服务器数据库...')
    await client.connect()
    console.log('✅ 连接成功\n')

    // 查看最近几条缺失产品名的记录的 scraped_data
    const query = `
      SELECT 
        id,
        brand,
        url,
        page_type,
        scraped_data
      FROM offers 
      WHERE product_name IS NULL
        AND scraped_data IS NOT NULL
      ORDER BY id DESC
      LIMIT 3;
    `
    
    const result = await client.query(query)
    
    for (const row of result.rows) {
      console.log('='.repeat(80))
      console.log(`ID: ${row.id} | 品牌: ${row.brand} | page_type: ${row.page_type}`)
      console.log(`URL: ${row.url}`)
      
      try {
        const data = JSON.parse(row.scraped_data)
        
        // 重点检查 productName 相关字段
        console.log('\n📦 关键字段检查:')
        console.log(`  productName: ${JSON.stringify(data.productName)}`)
        console.log(`  pageType: ${JSON.stringify(data.pageType)}`)
        console.log(`  brand: ${JSON.stringify(data.brand)}`)
        console.log(`  finalUrl: ${JSON.stringify(data.finalUrl)}`)
        
        // 检查是否有产品列表
        if (data.products && data.products.length > 0) {
          console.log(`  products: ${data.products.length} 个产品`)
          console.log(`  products[0].name: ${JSON.stringify(data.products[0]?.name)}`)
        } else {
          console.log(`  products: 无`)
        }
        
        // 检查是否有 deepScrapeResults
        if (data.deepScrapeResults) {
          console.log(`  deepScrapeResults.topProducts: ${data.deepScrapeResults.topProducts?.length || 0} 个`)
          if (data.deepScrapeResults.topProducts?.length > 0) {
            console.log(`  deepScrapeResults.topProducts[0].productData.productName: ${JSON.stringify(data.deepScrapeResults.topProducts[0]?.productData?.productName)}`)
          }
        }
        
        // 检查 storeName
        if (data.storeName) {
          console.log(`  storeName: ${JSON.stringify(data.storeName)}`)
        }
        
        // 显示所有顶层字段
        console.log('\n📋 所有顶层字段:')
        Object.keys(data).forEach(key => {
          const value = data[key]
          const valueStr = typeof value === 'object' 
            ? (Array.isArray(value) ? `[数组, ${value.length}项]` : `{对象}`)
            : JSON.stringify(value)
          console.log(`  ${key}: ${valueStr}`)
        })
        
      } catch (e) {
        console.log(`解析 scraped_data 失败: ${e.message}`)
        console.log(`原始数据前200字符: ${row.scraped_data.substring(0, 200)}`)
      }
      
      console.log()
    }

  } catch (error) {
    console.error('❌ 错误:', error.message)
  } finally {
    await client.end()
    console.log('🔌 数据库连接已关闭')
  }
}

checkScrapedData().catch(console.error)
