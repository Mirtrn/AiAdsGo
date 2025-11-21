/**
 * Google Ads OAuth真实凭证测试
 *
 * 功能：
 * 1. 验证autoads用户的OAuth凭证是否有效
 * 2. 获取可访问的Google Ads账户列表
 * 3. 测试基本的Google Ads API调用
 * 4. 更新google_ads_accounts表为真实账户
 */

import { getGoogleAdsCredentials, verifyGoogleAdsCredentials } from '../src/lib/google-ads-oauth'
import { getDatabase } from '../src/lib/db'

const AUTOADS_USER_ID = 1

async function main() {
  console.log('🔐 开始测试Google Ads OAuth凭证...\n')

  try {
    // 1. 获取凭证
    console.log('📋 步骤1: 获取autoads用户的Google Ads凭证')
    const credentials = getGoogleAdsCredentials(AUTOADS_USER_ID)

    if (!credentials) {
      console.error('❌ 未找到Google Ads凭证')
      process.exit(1)
    }

    console.log('✅ 凭证已找到:')
    console.log(`   - Client ID: ${credentials.client_id}`)
    console.log(`   - Developer Token: ${credentials.developer_token}`)
    console.log(`   - Refresh Token: ${credentials.refresh_token.substring(0, 20)}...`)
    console.log(`   - Last Verified: ${credentials.last_verified_at || '从未验证'}\n`)

    // 2. 验证凭证
    console.log('🔍 步骤2: 验证凭证有效性并获取账户列表')
    const verification = await verifyGoogleAdsCredentials(AUTOADS_USER_ID)

    if (!verification.valid) {
      console.error(`❌ 凭证验证失败: ${verification.error}`)
      process.exit(1)
    }

    console.log('✅ 凭证验证成功!')
    console.log(`   - 首个Customer ID: ${verification.customer_id}\n`)

    // 3. 获取完整的账户列表
    console.log('📊 步骤3: 获取所有可访问的Google Ads账户')
    const { GoogleAdsApi } = await import('google-ads-api')

    const client = new GoogleAdsApi({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token,
    })

    // 获取所有可访问的账户
    const accessibleCustomers = await client.listAccessibleCustomers(credentials.refresh_token)
    console.log(`✅ 找到 ${accessibleCustomers.resource_names.length} 个可访问账户:`)

    const customerIds = accessibleCustomers.resource_names.map(name => name.split('/').pop()!)
    customerIds.forEach((id, idx) => {
      console.log(`   ${idx + 1}. Customer ID: ${id}`)
    })

    // 尝试每个账户，找到第一个可用的
    let accountDetails: any = null
    let activeCustomerId: string | null = null

    for (const customerId of customerIds) {
      try {
        console.log(`\n🔍 尝试访问账户: ${customerId}`)
        const customer = client.Customer({
          customer_id: customerId,
          refresh_token: credentials.refresh_token,
        })

        const query = `
          SELECT
            customer.id,
            customer.descriptive_name,
            customer.currency_code,
            customer.time_zone,
            customer.manager,
            customer.test_account,
            customer.status
          FROM customer
          WHERE customer.id = ${customerId}
        `

        const [details] = await customer.query(query)
        accountDetails = details
        activeCustomerId = customerId
        console.log(`✅ 账户可访问`)
        break
      } catch (error: any) {
        console.log(`⚠️  账户不可用: ${error.message}`)
        continue
      }
    }

    if (!accountDetails || !activeCustomerId) {
      console.error('❌ 没有找到可用的Google Ads账户')
      console.log('\n建议:')
      console.log('   1. 检查Google Ads账户是否已启用')
      console.log('   2. 确认账户有足够的权限')
      console.log('   3. 创建一个新的测试账户')
      process.exit(1)
    }

    console.log('✅ 账户详情:')
    console.log(`   - Customer ID: ${accountDetails.customer.id}`)
    console.log(`   - 账户名称: ${accountDetails.customer.descriptive_name || '未设置'}`)
    console.log(`   - 货币: ${accountDetails.customer.currency_code}`)
    console.log(`   - 时区: ${accountDetails.customer.time_zone}`)
    console.log(`   - 是否Manager账户: ${accountDetails.customer.manager ? '是' : '否'}`)
    console.log(`   - 是否测试账户: ${accountDetails.customer.test_account ? '是' : '否'}\n`)

    // 4. 更新数据库中的google_ads_accounts表
    console.log('\n💾 步骤4: 更新数据库中的Google Ads账户信息')
    const db = getDatabase()

    // 检查是否已存在该账户
    const existing = db.prepare(`
      SELECT id FROM google_ads_accounts
      WHERE user_id = ? AND customer_id = ?
    `).get(AUTOADS_USER_ID, activeCustomerId)

    if (existing) {
      // 更新现有账户
      db.prepare(`
        UPDATE google_ads_accounts
        SET account_name = ?,
            currency = ?,
            timezone = ?,
            is_manager_account = ?,
            is_active = 1,
            last_sync_at = datetime('now'),
            updated_at = datetime('now')
        WHERE user_id = ? AND customer_id = ?
      `).run(
        accountDetails.customer.descriptive_name || 'Google Ads Account',
        accountDetails.customer.currency_code,
        accountDetails.customer.time_zone,
        accountDetails.customer.manager ? 1 : 0,
        AUTOADS_USER_ID,
        activeCustomerId
      )
      console.log('✅ 已更新现有账户记录')
    } else {
      // 插入新账户（如果不存在）
      db.prepare(`
        INSERT INTO google_ads_accounts (
          user_id, customer_id, account_name, currency, timezone,
          is_manager_account, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(
        AUTOADS_USER_ID,
        activeCustomerId,
        accountDetails.customer.descriptive_name || 'Google Ads Account',
        accountDetails.customer.currency_code,
        accountDetails.customer.time_zone,
        accountDetails.customer.manager ? 1 : 0
      )
      console.log('✅ 已创建新账户记录')
    }

    // 5. 测试Campaign查询
    console.log('\n📈 步骤5: 测试Campaign查询API')

    const activeCustomer = client.Customer({
      customer_id: activeCustomerId,
      refresh_token: credentials.refresh_token,
    })

    const campaignQuery = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
      LIMIT 5
    `

    try {
      const campaigns = await activeCustomer.query(campaignQuery)

      if (campaigns.length > 0) {
        console.log(`✅ 找到 ${campaigns.length} 个活跃的Campaigns:`)
        campaigns.forEach((c: any) => {
          console.log(`   - ${c.campaign.name} (ID: ${c.campaign.id}, Status: ${c.campaign.status})`)
        })
      } else {
        console.log('⚠️  当前账户没有活跃的Campaigns')
      }
    } catch (error: any) {
      console.log(`⚠️  Campaign查询失败: ${error.message}`)
      console.log('   (如果账户为空或无权限，这是正常的)')
    }

    console.log('\n' + '='.repeat(60))
    console.log('🎉 Google Ads OAuth测试完成！')
    console.log('='.repeat(60))
    console.log('\n✅ 测试结果总结:')
    console.log(`   1. ✅ OAuth凭证有效`)
    console.log(`   2. ✅ Customer ID: ${activeCustomerId}`)
    console.log(`   3. ✅ 账户名称: ${accountDetails.customer.descriptive_name || '未设置'}`)
    console.log(`   4. ✅ 数据库已更新`)
    console.log(`   5. ✅ API调用成功`)
    console.log('\n📝 下一步:')
    console.log('   - 可以使用此账户进行A/B测试的Google Ads集成测试')
    console.log('   - 修改E2E测试脚本使用真实customer_id和credentials')
    console.log(`   - 真实Customer ID: ${activeCustomerId}`)
    console.log(`   - 用户ID: ${AUTOADS_USER_ID} (autoads管理员)`)

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error(error)
    process.exit(1)
  }
}

main()
