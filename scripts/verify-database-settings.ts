import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🔍 验证数据库配置一致性...')
console.log('📍 数据库路径:', dbPath)

// 创建数据库连接
const db = new Database(dbPath)

// 期望的配置项（与init-database.ts保持一致）
const expectedSettings = [
  // Google Ads API配置
  { category: 'google_ads', key: 'client_id', dataType: 'string', isSensitive: 1, isRequired: 1 },
  { category: 'google_ads', key: 'client_secret', dataType: 'string', isSensitive: 1, isRequired: 1 },
  { category: 'google_ads', key: 'developer_token', dataType: 'string', isSensitive: 1, isRequired: 1 },

  // AI配置
  { category: 'ai', key: 'gemini_api_key', dataType: 'string', isSensitive: 1, isRequired: 1 },
  { category: 'ai', key: 'gemini_model', dataType: 'string', isSensitive: 0, isRequired: 1 },

  // 代理配置
  { category: 'proxy', key: 'enabled', dataType: 'boolean', isSensitive: 0, isRequired: 0 },
  { category: 'proxy', key: 'url', dataType: 'string', isSensitive: 0, isRequired: 0 },

  // 系统配置
  { category: 'system', key: 'currency', dataType: 'string', isSensitive: 0, isRequired: 1 },
  { category: 'system', key: 'language', dataType: 'string', isSensitive: 0, isRequired: 1 },
  { category: 'system', key: 'sync_interval_hours', dataType: 'number', isSensitive: 0, isRequired: 1 },
  { category: 'system', key: 'link_check_enabled', dataType: 'boolean', isSensitive: 0, isRequired: 1 },
  { category: 'system', key: 'link_check_time', dataType: 'string', isSensitive: 0, isRequired: 1 },
]

// 不应该存在的配置（历史遗留问题）
const forbiddenSettings = [
  { category: 'ai', key: 'claude_api_key', reason: '不使用Claude API，应使用Gemini' },
  { category: 'ai', key: 'primary_model', reason: '应使用gemini_model' },
  { category: 'proxy', key: 'host', reason: '已改为使用url配置' },
  { category: 'proxy', key: 'port', reason: '已改为使用url配置' },
]

interface SettingRow {
  category: string
  config_key: string
  data_type: string
  is_sensitive: number
  is_required: number
}

try {
  // 获取所有系统配置
  const actualSettings = db.prepare(`
    SELECT category, config_key, data_type, is_sensitive, is_required
    FROM system_settings
    WHERE user_id IS NULL
    ORDER BY category, config_key
  `).all() as SettingRow[]

  console.log('\n📊 数据库中的配置项数量:', actualSettings.length)
  console.log('📋 期望的配置项数量:', expectedSettings.length)

  let hasErrors = false
  const errors: string[] = []
  const warnings: string[] = []

  // 1. 检查禁止的配置项
  console.log('\n🚫 检查禁止的配置项...')
  for (const forbidden of forbiddenSettings) {
    const found = actualSettings.find(
      s => s.category === forbidden.category && s.config_key === forbidden.key
    )
    if (found) {
      hasErrors = true
      errors.push(`❌ 发现禁止的配置: ${forbidden.category}.${forbidden.key} - ${forbidden.reason}`)
    }
  }
  if (errors.length === 0) {
    console.log('✅ 未发现禁止的配置项')
  }

  // 2. 检查缺失的配置项
  console.log('\n📝 检查缺失的配置项...')
  for (const expected of expectedSettings) {
    const found = actualSettings.find(
      s => s.category === expected.category && s.config_key === expected.key
    )
    if (!found) {
      hasErrors = true
      errors.push(`❌ 缺失配置: ${expected.category}.${expected.key}`)
    }
  }

  // 3. 检查配置项属性是否正确
  console.log('\n🔍 检查配置项属性...')
  for (const expected of expectedSettings) {
    const actual = actualSettings.find(
      s => s.category === expected.category && s.config_key === expected.key
    )
    if (actual) {
      const key = `${expected.category}.${expected.key}`

      if (actual.data_type !== expected.dataType) {
        warnings.push(`⚠️  ${key}: 数据类型不匹配 (期望: ${expected.dataType}, 实际: ${actual.data_type})`)
      }
      if (actual.is_sensitive !== expected.isSensitive) {
        warnings.push(`⚠️  ${key}: 敏感标记不匹配 (期望: ${expected.isSensitive}, 实际: ${actual.is_sensitive})`)
      }
      if (actual.is_required !== expected.isRequired) {
        warnings.push(`⚠️  ${key}: 必填标记不匹配 (期望: ${expected.isRequired}, 实际: ${actual.is_required})`)
      }
    }
  }

  // 4. 检查未预期的配置项
  console.log('\n🔎 检查未预期的配置项...')
  for (const actual of actualSettings) {
    const expected = expectedSettings.find(
      e => e.category === actual.category && e.key === actual.config_key
    )
    const forbidden = forbiddenSettings.find(
      f => f.category === actual.category && f.key === actual.config_key
    )
    if (!expected && !forbidden) {
      warnings.push(`⚠️  发现未定义的配置: ${actual.category}.${actual.config_key}`)
    }
  }

  // 输出结果
  console.log('\n' + '='.repeat(60))

  if (errors.length > 0) {
    console.log('\n❌ 发现严重问题:')
    errors.forEach(err => console.log(err))
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  发现警告:')
    warnings.forEach(warn => console.log(warn))
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ 数据库配置完全正确！')
  } else {
    console.log(`\n📊 统计: ${errors.length} 个错误, ${warnings.length} 个警告`)

    if (hasErrors) {
      console.log('\n💡 建议: 运行以下命令修复问题:')
      console.log('   npm run db:clean-settings')
      process.exit(1)
    }
  }

} catch (error) {
  console.error('❌ 验证失败:', error)
  process.exit(1)
} finally {
  db.close()
}
