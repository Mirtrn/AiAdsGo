/**
 * 测试 Keyword Planner 修复效果
 * 验证是否能从 google_ads_credentials 表读取 refresh_token
 */
import { getDatabase } from '../src/lib/db'
import { decrypt } from '../src/lib/crypto'

async function testKeywordPlannerFix() {
  console.log('🔍 测试 Keyword Planner 修复效果\n')

  const db = getDatabase()
  const autoadsUserId = 1

  // 模拟 getGoogleAdsConfig() 函数的逻辑
  console.log('📋 Step 1: 读取 system_settings 配置 (encrypted)')
  console.log('─'.repeat(80))

  const userConfigs = db.prepare(`
    SELECT config_key, config_value, encrypted_value
    FROM system_settings
    WHERE category = 'google_ads' AND user_id = ?
  `).all(autoadsUserId) as Array<{ config_key: string; config_value: string | null; encrypted_value: string | null }>

  const userConfigMap: Record<string, string> = {}
  for (const c of userConfigs) {
    // Try encrypted_value first, then config_value
    if (c.encrypted_value) {
      const decrypted = decrypt(c.encrypted_value)
      if (decrypted) {
        userConfigMap[c.config_key] = decrypted
        console.log(`✅ ${c.config_key.padEnd(20)} ${decrypted.substring(0, 20)}... (encrypted)`)
      }
    } else if (c.config_value) {
      userConfigMap[c.config_key] = c.config_value
      console.log(`✅ ${c.config_key.padEnd(20)} ${c.config_value}`)
    }
  }

  console.log('\n📋 Step 2: 从 google_ads_credentials 表读取 refresh_token (OAuth 保存)')
  console.log('─'.repeat(80))

  let refreshToken = userConfigMap.refresh_token || process.env.GOOGLE_ADS_REFRESH_TOKEN || ''
  let customerId = userConfigMap.customer_id || process.env.GOOGLE_ADS_CUSTOMER_IDS?.split(',')[0] || ''

  if (!refreshToken || !customerId) {
    // Priority 1: Try google_ads_credentials table (OAuth saved data)
    const credentials = db.prepare(`
      SELECT refresh_token, login_customer_id
      FROM google_ads_credentials
      WHERE user_id = ? AND is_active = 1
    `).get(autoadsUserId) as { refresh_token: string; login_customer_id: string } | undefined

    if (credentials && credentials.refresh_token) {
      refreshToken = credentials.refresh_token
      console.log('✅ 在 google_ads_credentials 表找到 refresh_token')
      console.log(`   Refresh Token: ${refreshToken.substring(0, 20)}...`)
      console.log(`   Login Customer ID: ${credentials.login_customer_id || 'N/A'}`)
    } else {
      console.log('❌ google_ads_credentials 表中没有 refresh_token')
    }

    // Priority 2: Try google_ads_accounts table
    if (!customerId || !refreshToken) {
      const account = db.prepare(`
        SELECT customer_id, refresh_token
        FROM google_ads_accounts
        WHERE user_id = ? AND is_active = 1
        LIMIT 1
      `).get(autoadsUserId) as { customer_id: string; refresh_token: string | null } | undefined

      if (account) {
        if (!customerId) {
          customerId = account.customer_id
          console.log(`✅ 在 google_ads_accounts 表找到 customer_id: ${customerId}`)
        }
        if (!refreshToken && account.refresh_token) {
          refreshToken = account.refresh_token
          console.log(`✅ 在 google_ads_accounts 表找到 refresh_token: ${refreshToken.substring(0, 20)}...`)
        }
      } else {
        console.log('⚠️  google_ads_accounts 表中没有找到账户')
      }
    }
  }

  console.log('\n📊 Step 3: 最终配置汇总')
  console.log('─'.repeat(80))

  const config = {
    clientId: userConfigMap.client_id || process.env.GOOGLE_ADS_CLIENT_ID || '',
    clientSecret: userConfigMap.client_secret || process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    developerToken: userConfigMap.developer_token || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    refreshToken,
    loginCustomerId: userConfigMap.login_customer_id || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '',
    customerId,
  }

  console.log(`${config.clientId ? '✅' : '❌'} Client ID:        ${config.clientId ? config.clientId.substring(0, 20) + '...' : '[NOT SET]'}`)
  console.log(`${config.clientSecret ? '✅' : '❌'} Client Secret:    ${config.clientSecret ? config.clientSecret.substring(0, 20) + '...' : '[NOT SET]'}`)
  console.log(`${config.developerToken ? '✅' : '❌'} Developer Token:  ${config.developerToken ? config.developerToken.substring(0, 20) + '...' : '[NOT SET]'}`)
  console.log(`${config.loginCustomerId ? '✅' : '❌'} Login Customer ID: ${config.loginCustomerId || '[NOT SET]'}`)
  console.log(`${config.refreshToken ? '✅' : '❌'} Refresh Token:    ${config.refreshToken ? config.refreshToken.substring(0, 20) + '...' : '[NOT SET]'}`)
  console.log(`${config.customerId ? '✅' : '❌'} Customer ID:      ${config.customerId || '[NOT SET]'}`)

  const allConfigured = config.clientId && config.clientSecret && config.developerToken &&
                        config.refreshToken && config.loginCustomerId && config.customerId

  console.log()
  if (allConfigured) {
    console.log('🎉 所有必需的凭证都已配置！')
    console.log('✅ Keyword Planner 现在可以调用 Google Ads API')
    console.log()
    console.log('💡 下一步：')
    console.log('   1. 在前端生成创意时，关键词将自动获取真实搜索量')
    console.log('   2. 搜索量数据会缓存到 Redis (7天) 和 global_keywords 表')
    console.log('   3. 访问 http://localhost:3001/offers 选择Offer并生成创意查看效果')
  } else {
    console.log('⚠️  配置不完整，缺少以下凭证：')
    if (!config.clientId) console.log('   - Client ID')
    if (!config.clientSecret) console.log('   - Client Secret')
    if (!config.developerToken) console.log('   - Developer Token')
    if (!config.loginCustomerId) console.log('   - Login Customer ID')
    if (!config.refreshToken) console.log('   - Refresh Token (需要完成 OAuth 授权)')
    if (!config.customerId) console.log('   - Customer ID')
  }

  console.log()
  console.log('📝 配置来源说明：')
  console.log('   • client_id, client_secret, developer_token → system_settings (加密)')
  console.log('   • login_customer_id → system_settings (明文)')
  console.log('   • refresh_token → google_ads_credentials (OAuth授权后保存)')
  console.log('   • customer_id → google_ads_accounts (30个可用账户)')
}

testKeywordPlannerFix()
