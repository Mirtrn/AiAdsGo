/**
 * 测试 Keyword Planner API 调用 - 调试脚本
 * 用于排查API调用失败的原因
 *
 * 运行: npx tsx scripts/test-keyword-planner-debug.ts
 */
import { GoogleAdsApi, enums } from 'google-ads-api'
import Database from 'better-sqlite3'
import path from 'path'
import { decrypt } from '../src/lib/crypto'

const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

async function testKeywordPlannerAPI() {
  console.log('🔍 开始测试 Keyword Planner API...\n')

  const db = new Database(DB_PATH, { readonly: true })

  // 1. 获取配置
  const configs = db.prepare(`
    SELECT config_key, config_value, encrypted_value
    FROM system_settings
    WHERE category = 'google_ads' AND user_id = 1
  `).all() as any[]

  const configMap: Record<string, string> = {}
  for (const c of configs) {
    if (c.encrypted_value) {
      const decrypted = decrypt(c.encrypted_value)
      if (decrypted) configMap[c.config_key] = decrypted
    } else if (c.config_value) {
      configMap[c.config_key] = c.config_value
    }
  }

  // 获取 refresh_token
  const credentials = db.prepare(`
    SELECT refresh_token FROM google_ads_credentials WHERE user_id = 1 AND is_active = 1
  `).get() as any

  // 获取 customer_id - 修复：只选择ENABLED且非Manager的账号
  const account = db.prepare(`
    SELECT customer_id, account_name, status
    FROM google_ads_accounts
    WHERE user_id = 1
      AND is_active = 1
      AND status = 'ENABLED'
      AND is_manager_account = 0
    ORDER BY id ASC
    LIMIT 1
  `).get() as any

  db.close()

  const hasClientId = !!configMap.client_id
  const hasClientSecret = !!configMap.client_secret
  const hasDeveloperToken = !!configMap.developer_token
  const hasLoginCustomerId = !!configMap.login_customer_id
  const hasRefreshToken = !!credentials?.refresh_token
  const hasCustomerId = !!account?.customer_id

  console.log('📋 配置信息:')
  console.log('  - client_id:', hasClientId ? '✅ 已配置' : '❌ 未配置')
  console.log('  - client_secret:', hasClientSecret ? '✅ 已配置' : '❌ 未配置')
  console.log('  - developer_token:', hasDeveloperToken ? '✅ 已配置' : '❌ 未配置')
  console.log('  - login_customer_id:', configMap.login_customer_id || '❌ 未配置')
  console.log('  - refresh_token:', hasRefreshToken ? '✅ 已配置' : '❌ 未配置')
  console.log('  - customer_id:', account?.customer_id || '❌ 未配置')
  console.log('  - account_name:', account?.account_name || 'N/A')
  console.log('  - account_status:', account?.status || 'N/A')
  console.log()

  if (!hasClientId || !hasClientSecret || !hasDeveloperToken || !hasRefreshToken || !hasCustomerId) {
    console.log('❌ 配置不完整，无法测试')
    return
  }

  // 2. 创建客户端
  console.log('🔗 创建 Google Ads API 客户端...')

  try {
    const client = new GoogleAdsApi({
      client_id: configMap.client_id,
      client_secret: configMap.client_secret,
      developer_token: configMap.developer_token,
    })

    const customer = client.Customer({
      customer_id: account.customer_id,
      login_customer_id: configMap.login_customer_id,
      refresh_token: credentials.refresh_token,
    })

    console.log('✅ 客户端创建成功\n')

    // 3. 测试 API 调用
    console.log('📊 调用 generateKeywordIdeas API...')
    console.log('  - 关键词: ["security camera"]')
    console.log('  - 国家: US (geoTargetConstants/2840)')
    console.log('  - 语言: English (languageConstants/1000)')
    console.log()

    const startTime = Date.now()

    const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
      customer_id: account.customer_id,
      language: 'languageConstants/1000',
      geo_target_constants: ['geoTargetConstants/2840'],
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      keyword_seed: { keywords: ['security camera'] },
      include_adult_keywords: false,
      page_token: '',
      page_size: 10,
      keyword_annotation: [],
    } as any)

    const duration = Date.now() - startTime

    console.log('✅ API 调用成功! 耗时:', duration, 'ms')
    console.log()
    console.log('📋 返回数据类型:', typeof response)

    const ideas = (response as any).results || response || []
    console.log('📋 返回关键词数量:', Array.isArray(ideas) ? ideas.length : 'N/A')

    if (Array.isArray(ideas) && ideas.length > 0) {
      console.log('\n📋 前3个关键词:')
      for (let i = 0; i < Math.min(3, ideas.length); i++) {
        const idea = ideas[i]
        console.log('  -', idea.text, '| 搜索量:', idea.keyword_idea_metrics?.avg_monthly_searches)
      }
    }

  } catch (error: any) {
    console.log('❌ API 调用失败!')
    console.log()
    console.log('🔍 错误详情:')
    console.log('  - error.message:', error.message)
    console.log('  - error.code:', error.code)
    console.log('  - error.status:', error.status)
    console.log('  - error.details:', error.details)

    if (error.errors) {
      console.log('\n📋 error.errors:')
      console.log(JSON.stringify(error.errors, null, 2))
    }

    if (error.error) {
      console.log('\n📋 error.error:')
      console.log(JSON.stringify(error.error, null, 2))
    }

    // 检查是否是 gRPC 错误
    if (error.metadata) {
      console.log('\n📋 gRPC metadata:')
      console.log(error.metadata)
    }

    console.log('\n📋 完整错误对象 keys:', Object.keys(error))
    console.log('\n📋 错误堆栈:')
    console.log(error.stack)
  }
}

testKeywordPlannerAPI().catch(console.error)
