/**
 * Test Google Ads Configuration with Decryption
 */
import { getDatabase } from '../src/lib/db'
import { decrypt } from '../src/lib/crypto'

function testGoogleAdsConfig() {
  console.log('🔍 Testing Google Ads Configuration with Decryption\n')

  const db = getDatabase()
  const autoadsUserId = 1

  // Get user configs
  const userConfigs = db.prepare(`
    SELECT config_key, config_value, encrypted_value
    FROM system_settings
    WHERE category = 'google_ads' AND user_id = ?
    ORDER BY config_key
  `).all(autoadsUserId) as Array<{ config_key: string; config_value: string | null; encrypted_value: string | null }>

  console.log('📋 User Configuration (user_id=1):')
  console.log('─'.repeat(80))

  const configMap: Record<string, string> = {}

  for (const config of userConfigs) {
    let value = ''
    let source = ''

    if (config.encrypted_value) {
      const decrypted = decrypt(config.encrypted_value)
      if (decrypted) {
        value = decrypted
        source = 'encrypted'
      } else {
        value = '[DECRYPTION FAILED]'
        source = 'error'
      }
    } else if (config.config_value) {
      value = config.config_value
      source = 'plaintext'
    } else {
      value = '[NOT SET]'
      source = 'empty'
    }

    configMap[config.config_key] = value

    const status = value && value !== '[NOT SET]' && value !== '[DECRYPTION FAILED]' ? '✅' : '❌'
    const displayValue = value && value !== '[NOT SET]' && value !== '[DECRYPTION FAILED]'
      ? `${value.substring(0, 20)}... (${source})`
      : value

    console.log(`${status} ${config.config_key.padEnd(20)} ${displayValue}`)
  }

  // Check google_ads_credentials table (OAuth saved data)
  console.log('\n📋 Google Ads Credentials (OAuth):')
  console.log('─'.repeat(80))

  const credentials = db.prepare(`
    SELECT refresh_token, access_token, access_token_expires_at, is_active, last_verified_at
    FROM google_ads_credentials
    WHERE user_id = ?
  `).get(autoadsUserId) as { refresh_token: string | null; access_token: string | null; access_token_expires_at: string | null; is_active: number; last_verified_at: string | null } | undefined

  if (!credentials) {
    console.log('⚠️  No OAuth credentials found')
  } else {
    const tokenStatus = credentials.refresh_token ? '✅ HAS REFRESH TOKEN' : '❌ NO REFRESH TOKEN'
    const accessStatus = credentials.access_token ? '✅ HAS ACCESS TOKEN' : '❌ NO ACCESS TOKEN'
    console.log(`${tokenStatus}`)
    console.log(`${accessStatus}`)
    if (credentials.refresh_token) {
      console.log(`   Refresh Token: ${credentials.refresh_token.substring(0, 20)}...`)
    }
    if (credentials.access_token) {
      console.log(`   Access Token: ${credentials.access_token.substring(0, 20)}...`)
      console.log(`   Expires At: ${credentials.access_token_expires_at || 'N/A'}`)
    }
    if (credentials.last_verified_at) {
      console.log(`   Last Verified: ${credentials.last_verified_at}`)
    }
  }

  // Check google_ads_accounts table
  console.log('\n📋 Google Ads Accounts:')
  console.log('─'.repeat(80))

  const accounts = db.prepare(`
    SELECT customer_id, refresh_token, is_active
    FROM google_ads_accounts
    WHERE user_id = ?
    ORDER BY is_active DESC, customer_id
    LIMIT 5
  `).all(autoadsUserId) as Array<{ customer_id: string; refresh_token: string | null; is_active: number }>

  if (accounts.length === 0) {
    console.log('⚠️  No accounts found')
  } else {
    for (const account of accounts) {
      const status = account.is_active ? '✅' : '⚠️'
      const tokenStatus = account.refresh_token ? 'HAS TOKEN' : 'NO TOKEN'
      console.log(`${status} ${account.customer_id.padEnd(15)} ${tokenStatus}`)
    }
    console.log(`\n💡 Note: ${accounts.length} customer accounts available`)
  }

  // Check .env
  console.log('\n📋 Environment Variables:')
  console.log('─'.repeat(80))

  const envVars = [
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
    'GOOGLE_ADS_CUSTOMER_IDS'
  ]

  for (const envVar of envVars) {
    const value = process.env[envVar]
    const status = value ? '✅' : '❌'
    const display = value ? `${value.substring(0, 20)}...` : '[NOT SET]'
    console.log(`${status} ${envVar.padEnd(35)} ${display}`)
  }

  // Summary
  console.log('\n📊 Configuration Summary:')
  console.log('─'.repeat(80))

  const hasClientId = !!configMap.client_id && configMap.client_id !== '[NOT SET]'
  const hasClientSecret = !!configMap.client_secret && configMap.client_secret !== '[NOT SET]'
  const hasDeveloperToken = !!configMap.developer_token && configMap.developer_token !== '[NOT SET]'
  const hasLoginCustomerId = !!configMap.login_customer_id && configMap.login_customer_id !== '[NOT SET]'
  const hasRefreshToken = (credentials && !!credentials.refresh_token) || accounts.some(a => a.refresh_token) || !!process.env.GOOGLE_ADS_REFRESH_TOKEN
  const hasCustomerId = accounts.length > 0 || !!process.env.GOOGLE_ADS_CUSTOMER_IDS

  console.log(`${hasClientId ? '✅' : '❌'} Client ID`)
  console.log(`${hasClientSecret ? '✅' : '❌'} Client Secret`)
  console.log(`${hasDeveloperToken ? '✅' : '❌'} Developer Token`)
  console.log(`${hasLoginCustomerId ? '✅' : '❌'} Login Customer ID (MCC)`)
  console.log(`${hasRefreshToken ? '✅' : '❌'} Refresh Token`)
  console.log(`${hasCustomerId ? '✅' : '❌'} Customer ID`)

  const allRequired = hasClientId && hasClientSecret && hasDeveloperToken && hasLoginCustomerId
  const canCallApi = allRequired && hasRefreshToken && hasCustomerId

  console.log()
  if (canCallApi) {
    console.log('🎉 All required credentials are configured!')
    console.log('✅ System is ready to call Google Ads API')
  } else {
    console.log('⚠️  Configuration incomplete:')
    if (!allRequired) console.log('   - Missing basic credentials (client_id, client_secret, developer_token, or login_customer_id)')
    if (!hasRefreshToken) console.log('   - Missing refresh_token (required for API calls)')
    if (!hasCustomerId) console.log('   - Missing customer_id (required for API calls)')
  }

  console.log()
  console.log('💡 Next steps:')
  if (!hasRefreshToken) {
    console.log('   1. Obtain refresh_token via OAuth flow: /api/google-ads/oauth/start')
    console.log('   2. Or use Google OAuth Playground: https://developers.google.com/oauthplayground/')
  }
  if (!hasCustomerId && accounts.length === 0) {
    console.log('   3. Add Google Ads accounts via UI or database')
  }
}

testGoogleAdsConfig()
