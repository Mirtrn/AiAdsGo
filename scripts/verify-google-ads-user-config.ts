/**
 * Verify Google Ads Configuration for autoads user
 */
import { getDatabase } from '../src/lib/db'

function verifyGoogleAdsConfig() {
  console.log('🔍 Verifying Google Ads Configuration\n')

  const db = getDatabase()

  // Get autoads user ID
  const user = db.prepare('SELECT id, username, email FROM users WHERE username = ?').get('autoads') as any

  if (!user) {
    console.error('❌ autoads user not found')
    process.exit(1)
  }

  console.log(`✅ User found: ${user.username} (ID: ${user.id}, Email: ${user.email})\n`)

  // Get user's Google Ads config
  const userConfigs = db.prepare(`
    SELECT config_key, config_value, is_required, description
    FROM system_settings
    WHERE category = 'google_ads' AND user_id = ?
    ORDER BY config_key
  `).all(user.id) as Array<{ config_key: string; config_value: string | null; is_required: number; description: string }>

  // Get global config
  const globalConfigs = db.prepare(`
    SELECT config_key, config_value, is_required, description
    FROM system_settings
    WHERE category = 'google_ads' AND user_id IS NULL
    ORDER BY config_key
  `).all() as Array<{ config_key: string; config_value: string | null; is_required: number; description: string }>

  console.log('📋 User-level Configuration (user_id=1):')
  console.log('─'.repeat(80))
  if (userConfigs.length === 0) {
    console.log('⚠️  No user-level config found\n')
  } else {
    for (const config of userConfigs) {
      const hasValue = !!config.config_value
      const status = hasValue ? '✅' : (config.is_required ? '❌' : '⚠️')
      const valueDisplay = hasValue ? `[SET: ${config.config_value!.substring(0, 20)}...]` : '[NOT SET]'
      console.log(`${status} ${config.config_key.padEnd(20)} ${valueDisplay}`)
      console.log(`   ${config.description}`)
    }
    console.log()
  }

  console.log('📋 Global Configuration (user_id=NULL):')
  console.log('─'.repeat(80))
  if (globalConfigs.length === 0) {
    console.log('⚠️  No global config found\n')
  } else {
    for (const config of globalConfigs) {
      const hasValue = !!config.config_value
      const status = hasValue ? '✅' : (config.is_required ? '❌' : '⚠️')
      const valueDisplay = hasValue ? `[SET: ${config.config_value!.substring(0, 20)}...]` : '[NOT SET]'
      console.log(`${status} ${config.config_key.padEnd(20)} ${valueDisplay}`)
      console.log(`   ${config.description}`)
    }
    console.log()
  }

  // Check required fields
  const requiredFields = ['client_id', 'client_secret', 'developer_token']
  const missingRequired: string[] = []

  for (const field of requiredFields) {
    const userConfig = userConfigs.find(c => c.config_key === field)
    const globalConfig = globalConfigs.find(c => c.config_key === field)

    const hasUserValue = userConfig && !!userConfig.config_value
    const hasGlobalValue = globalConfig && !!globalConfig.config_value

    if (!hasUserValue && !hasGlobalValue) {
      missingRequired.push(field)
    }
  }

  console.log('📊 Configuration Summary:')
  console.log('─'.repeat(80))
  console.log(`User configs: ${userConfigs.length} items`)
  console.log(`Global configs: ${globalConfigs.length} items`)

  if (missingRequired.length > 0) {
    console.log(`❌ Missing required fields: ${missingRequired.join(', ')}`)
    console.log('\n⚠️  Google Ads API will not work without these fields')
  } else {
    console.log('✅ All required fields are configured')
  }

  console.log()
  console.log('💡 Configuration Priority:')
  console.log('   1. User-level config (user_id=1)')
  console.log('   2. Global config (user_id=NULL)')
  console.log('   3. Environment variables (.env)')
  console.log()

  console.log('📝 To configure Google Ads credentials:')
  console.log('   1. Visit /settings page in the application')
  console.log('   2. Navigate to Google Ads API section')
  console.log('   3. Enter credentials and save')
}

verifyGoogleAdsConfig()
