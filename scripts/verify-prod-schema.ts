/**
 * 验证生产环境数据库结构完整性
 * 运行: npx tsx scripts/verify-prod-schema.ts
 */

import postgres from 'postgres'

const DATABASE_URL = 'postgresql://postgres:<REDACTED_DB_PASSWORD>@<REDACTED_HOST>:32243/postgres'

async function verifySchema() {
  const sql = postgres(DATABASE_URL)

  console.log('🔍 验证生产环境数据库结构...\n')

  try {
    // 1. 检查offers表的字段
    console.log('📋 检查offers表字段:')
    const offersColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'offers'
      ORDER BY ordinal_position
    `

    const requiredFields = [
      'enhanced_keywords',
      'enhanced_product_info',
      'enhanced_review_analysis',
      'extraction_quality_score',
      'extraction_enhanced_at',
      'enhanced_headlines',
      'enhanced_descriptions',
      'localization_adapt',
      'brand_analysis',
      'is_deleted',
      'deleted_at',
      'product_currency'
    ]

    const existingColumns = offersColumns.map(c => c.column_name)

    for (const field of requiredFields) {
      const exists = existingColumns.includes(field)
      console.log(`  ${exists ? '✅' : '❌'} ${field}`)
    }

    // 2. 检查ab_tests表字段
    console.log('\n📋 检查ab_tests表字段:')
    const abTestsColumns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ab_tests'
      ORDER BY ordinal_position
    `

    const abTestsRequiredFields = [
      'is_auto_test',
      'test_mode',
      'parent_campaign_id',
      'test_dimension'
    ]

    const abTestsExisting = abTestsColumns.map(c => c.column_name)
    for (const field of abTestsRequiredFields) {
      const exists = abTestsExisting.includes(field)
      console.log(`  ${exists ? '✅' : '❌'} ${field}`)
    }

    // 3. 检查risk_alerts表字段
    console.log('\n📋 检查risk_alerts表字段:')
    const riskAlertsColumns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'risk_alerts'
      ORDER BY ordinal_position
    `

    const riskAlertsRequiredFields = [
      'alert_type',
      'resource_type',
      'resource_id',
      'details',
      'acknowledged_at'
    ]

    const riskAlertsExisting = riskAlertsColumns.map(c => c.column_name)
    for (const field of riskAlertsRequiredFields) {
      const exists = riskAlertsExisting.includes(field)
      console.log(`  ${exists ? '✅' : '❌'} ${field}`)
    }

    // 4. 检查google_ads_accounts表字段
    console.log('\n📋 检查google_ads_accounts表字段:')
    const gadsColumns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'google_ads_accounts'
      ORDER BY ordinal_position
    `

    const gadsRequiredFields = [
      'parent_mcc_id',
      'test_account'
    ]

    const gadsExisting = gadsColumns.map(c => c.column_name)
    for (const field of gadsRequiredFields) {
      const exists = gadsExisting.includes(field)
      console.log(`  ${exists ? '✅' : '❌'} ${field}`)
    }

    // 5. 检查迁移历史
    console.log('\n📋 迁移历史:')
    const migrations = await sql`
      SELECT migration_name, executed_at
      FROM migration_history
      ORDER BY executed_at
    `

    for (const m of migrations) {
      console.log(`  ✅ ${m.migration_name} (${m.executed_at})`)
    }

    // 6. 检查prompt_versions数量
    console.log('\n📋 检查prompt_versions数据:')
    const promptCount = await sql`SELECT COUNT(*) as count FROM prompt_versions`
    console.log(`  记录数: ${promptCount[0].count}`)

    console.log('\n✅ 验证完成')

  } catch (error) {
    console.error('❌ 验证失败:', error)
  } finally {
    await sql.end()
  }
}

verifySchema()
