/**
 * 查看 offers 表的结构和数据
 */
const { Client } = require('pg')

async function checkOffersStructure() {
  const connectionString = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
  
  const client = new Client({
    connectionString,
    ssl: false,
  })

  try {
    console.log('🔌 连接到新加坡服务器数据库...')
    await client.connect()
    console.log('✅ 连接成功\n')

    // 1. 查询 offers 表的列结构
    console.log('📋 查询 offers 表的列结构...\n')
    const columnsQuery = `
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'offers'
      ORDER BY ordinal_position;
    `
    const columns = await client.query(columnsQuery)
    
    console.log(`offers 表有 ${columns.rows.length} 个列：\n`)
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`)
    })
    console.log()

    // 2. 查询 offers 表的总记录数
    const countQuery = `SELECT COUNT(*) as total FROM offers;`
    const countResult = await client.query(countQuery)
    console.log(`📊 offers 表总记录数: ${countResult.rows[0].total}\n`)

    // 3. 查询最近的 5 条记录（使用实际存在的列）
    console.log('📦 查询最近的 5 条 offer 记录...\n')
    const offersQuery = `
      SELECT * 
      FROM offers 
      ORDER BY created_at DESC 
      LIMIT 5;
    `
    const offers = await client.query(offersQuery)
    
    if (offers.rows.length > 0) {
      console.log(`找到 ${offers.rows.length} 条记录：\n`)
      for (const offer of offers.rows) {
        console.log('='.repeat(100))
        console.log(JSON.stringify(offer, null, 2))
        console.log('='.repeat(100))
        console.log()
      }
    } else {
      console.log('❌ offers 表中没有数据\n')
    }

    // 4. 检查是否有空字段的记录
    console.log('🔍 检查数据完整性...\n')
    
    // 动态构建查询，检查每个可能为空的字段
    const nullCheckQueries = []
    for (const col of columns.rows) {
      if (col.is_nullable === 'YES' && !['id', 'created_at', 'updated_at'].includes(col.column_name)) {
        nullCheckQueries.push(`
          SELECT '${col.column_name}' as field_name, COUNT(*) as null_count
          FROM offers 
          WHERE ${col.column_name} IS NULL
        `)
      }
    }
    
    if (nullCheckQueries.length > 0) {
      const nullCheckQuery = nullCheckQueries.join(' UNION ALL ')
      const nullChecks = await client.query(nullCheckQuery)
      
      console.log('空值统计：')
      nullChecks.rows.forEach(row => {
        if (row.null_count > 0) {
          console.log(`  ⚠️  ${row.field_name}: ${row.null_count} 条记录为空`)
        }
      })
      console.log()
    }

  } catch (error) {
    console.error('❌ 错误:', error.message)
    console.error('详细信息:', error)
  } finally {
    await client.end()
    console.log('🔌 数据库连接已关闭')
  }
}

checkOffersStructure().catch(console.error)
