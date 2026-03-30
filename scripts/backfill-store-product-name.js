/**
 * 回填 store 页面缺失的 product_name
 * 使用 scraped_data 中的 storeName 或 products[0].name 作为后备值
 */
const { Client } = require('pg')

async function backfillStoreProductName() {
  const connectionString = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
  
  const client = new Client({
    connectionString,
    ssl: false,
  })

  try {
    console.log('🔌 连接到新加坡服务器数据库...')
    await client.connect()
    console.log('✅ 连接成功\n')

    // 1. 查询所有缺失 product_name 且有 scraped_data 的记录
    console.log('📊 查询缺失产品名的记录...\n')
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
      ORDER BY id DESC;
    `
    
    const result = await client.query(query)
    console.log(`找到 ${result.rows.length} 条缺失产品名的记录\n`)

    let updated = 0
    let skipped = 0
    let failed = 0

    for (const row of result.rows) {
      try {
        const data = JSON.parse(row.scraped_data)
        
        // 尝试多种后备方案提取产品名
        let productName = null
        
        // 1. storeName（品牌官网/店铺页最常见）
        if (data.storeName && typeof data.storeName === 'string' && data.storeName.trim()) {
          productName = data.storeName.trim()
        }
        
        // 2. deepScrapeResults.topProducts[0].productData.productName（Amazon深度抓取）
        if (!productName && data.deepScrapeResults?.topProducts?.length > 0) {
          const firstProduct = data.deepScrapeResults.topProducts[0]
          const deepProductName = firstProduct?.productData?.productName
          if (deepProductName && typeof deepProductName === 'string' && deepProductName.trim() &&
              !deepProductName.includes('problem loading') && deepProductName.length < 200) {
            productName = deepProductName.trim()
          }
        }
        
        // 3. products[0].name（产品列表第一个）
        if (!productName && Array.isArray(data.products) && data.products.length > 0) {
          const firstName = data.products[0]?.name
          if (firstName && typeof firstName === 'string' && firstName.trim() && firstName.length < 200) {
            productName = firstName.trim()
          }
        }
        
        // 4. brand（最后后备）
        if (!productName && row.brand && typeof row.brand === 'string' && row.brand.trim()) {
          productName = `${row.brand.trim()} Store`
        }
        
        if (!productName) {
          console.log(`⏭️  ID ${row.id}: 无法提取产品名，跳过`)
          skipped++
          continue
        }
        
        // 更新数据库
        await client.query(`
          UPDATE offers 
          SET product_name = $1, updated_at = NOW()
          WHERE id = $2 AND product_name IS NULL
        `, [productName, row.id])
        
        console.log(`✅ ID ${row.id} (${row.brand}): "${productName}"`)
        updated++
        
      } catch (e) {
        console.log(`❌ ID ${row.id}: 解析失败 - ${e.message}`)
        failed++
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('📊 回填统计:')
    console.log(`  ✅ 更新成功: ${updated} 条`)
    console.log(`  ⏭️  跳过: ${skipped} 条`)
    console.log(`  ❌ 失败: ${failed} 条`)
    console.log(`  📋 总计: ${result.rows.length} 条`)

    // 验证结果
    console.log('\n🔍 验证回填结果...')
    const verifyResult = await client.query(`
      SELECT COUNT(*) as remaining_null
      FROM offers 
      WHERE product_name IS NULL;
    `)
    console.log(`  剩余缺失产品名: ${verifyResult.rows[0].remaining_null} 条`)

  } catch (error) {
    console.error('❌ 错误:', error.message)
    console.error('详细信息:', error)
  } finally {
    await client.end()
    console.log('\n🔌 数据库连接已关闭')
  }
}

backfillStoreProductName().catch(console.error)
