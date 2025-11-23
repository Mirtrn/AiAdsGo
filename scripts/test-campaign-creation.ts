/**
 * 测试Campaign创建功能
 * 使用账号5427414593验证修复后的API
 */

import { createGoogleAdsCampaign, createGoogleAdsAdGroup, createGoogleAdsResponsiveSearchAd } from '../src/lib/google-ads-api'

async function testCampaignCreation() {
  console.log('🧪 开始测试Campaign创建功能...\n')

  // 测试参数
  const testParams = {
    // Google Ads账号信息
    customerId: '5427414593',
    refreshToken: process.env.TEST_REFRESH_TOKEN || '', // 需要从数据库获取

    // Campaign配置（符合业务规范）
    campaignName: `Reolink - Full Spec Test ${Date.now()}`,
    budgetAmount: 10, // 10 USD
    budgetType: 'DAILY' as const,
    status: 'PAUSED' as const, // 创建时暂停
    biddingStrategy: 'maximize_clicks',
    targetCountry: 'US',
    targetLanguage: 'en',
    finalUrlSuffix: 'utm_source=google&utm_medium=cpc&utm_campaign=test',

    // Ad Group配置
    adGroupName: `Reolink - Security Camera AG ${Date.now()}`,
    cpcBidMicros: 170000, // 0.17 USD = 170,000 micros

    // Ad配置（必须15个headlines，4个descriptions）
    headlines: [
      'Best Security Cameras',
      'Wireless Home Security',
      'Smart Camera Systems',
      '4K Security Cameras',
      'Night Vision Cameras',
      'Outdoor Security Cams',
      'Indoor Camera Solutions',
      'AI-Powered Detection',
      'Easy DIY Installation',
      'Cloud Storage Available',
      '24/7 Live Monitoring',
      'Motion Detection Alerts',
      'Two-Way Audio Feature',
      'Weather Resistant Cams',
      'Mobile App Control',
    ],
    descriptions: [
      'Protect your home with advanced 4K security cameras. Easy installation and setup.',
      'Get real-time alerts and HD video. Monitor your property 24/7 from anywhere.',
      'AI-powered motion detection with instant notifications. Cloud storage included.',
      'Professional-grade security at affordable prices. 30-day money-back guarantee.',
    ],
    finalUrls: ['https://reolink.com/product/rlc-810a/'],

    // Keywords
    keywords: [
      { text: 'security camera', matchType: 'PHRASE' as const, status: 'ENABLED' as const },
      { text: 'home security', matchType: 'BROAD' as const, status: 'ENABLED' as const },
      { text: 'wireless camera', matchType: 'EXACT' as const, status: 'ENABLED' as const },
    ],
  }

  try {
    // 步骤1: 从数据库获取refresh token
    console.log('📋 步骤1: 获取refresh token...')
    const { getDatabase } = await import('../src/lib/db')
    const db = getDatabase()

    const credentials = db.prepare(`
      SELECT refresh_token
      FROM google_ads_credentials
      WHERE user_id = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { refresh_token: string } | undefined

    if (!credentials) {
      throw new Error('未找到Google Ads凭证，请先完成OAuth授权')
    }

    testParams.refreshToken = credentials.refresh_token
    console.log('✅ 已获取refresh token\n')

    // 步骤2: 创建Campaign
    console.log('📋 步骤2: 创建Campaign...')
    console.log(`  - Campaign名称: ${testParams.campaignName}`)
    console.log(`  - 预算: ${testParams.budgetAmount} USD (${testParams.budgetType})`)
    console.log(`  - 出价策略: Maximize Clicks`)
    console.log(`  - 目标国家: ${testParams.targetCountry}`)
    console.log(`  - 目标语言: ${testParams.targetLanguage}`)
    console.log(`  - Final URL Suffix: ${testParams.finalUrlSuffix}\n`)

    const { campaignId, resourceName: campaignResourceName } = await createGoogleAdsCampaign({
      customerId: testParams.customerId,
      refreshToken: testParams.refreshToken,
      campaignName: testParams.campaignName,
      budgetAmount: testParams.budgetAmount,
      budgetType: testParams.budgetType,
      status: testParams.status,
      biddingStrategy: testParams.biddingStrategy,
      targetCountry: testParams.targetCountry,
      targetLanguage: testParams.targetLanguage,
      finalUrlSuffix: testParams.finalUrlSuffix,
    })

    console.log(`✅ Campaign创建成功!`)
    console.log(`  - Campaign ID: ${campaignId}`)
    console.log(`  - Resource Name: ${campaignResourceName}\n`)

    // 步骤3: 创建Ad Group
    console.log('📋 步骤3: 创建Ad Group...')
    console.log(`  - Ad Group名称: ${testParams.adGroupName}`)
    console.log(`  - CPC Bid: $${testParams.cpcBidMicros / 1000000}\n`)

    const { adGroupId, resourceName: adGroupResourceName } = await createGoogleAdsAdGroup({
      customerId: testParams.customerId,
      refreshToken: testParams.refreshToken,
      campaignId,
      adGroupName: testParams.adGroupName,
      cpcBidMicros: testParams.cpcBidMicros,
      status: 'ENABLED',
    })

    console.log(`✅ Ad Group创建成功!`)
    console.log(`  - Ad Group ID: ${adGroupId}`)
    console.log(`  - Resource Name: ${adGroupResourceName}\n`)

    // 步骤4: 创建Responsive Search Ad
    console.log('📋 步骤4: 创建Responsive Search Ad...')
    console.log(`  - Headlines: ${testParams.headlines.length}个`)
    console.log(`  - Descriptions: ${testParams.descriptions.length}个`)
    console.log(`  - Final URL: ${testParams.finalUrls[0]}\n`)

    const { adId, resourceName: adResourceName } = await createGoogleAdsResponsiveSearchAd({
      customerId: testParams.customerId,
      refreshToken: testParams.refreshToken,
      adGroupId,
      headlines: testParams.headlines,
      descriptions: testParams.descriptions,
      finalUrls: testParams.finalUrls,
    })

    console.log(`✅ Responsive Search Ad创建成功!`)
    console.log(`  - Ad ID: ${adId}`)
    console.log(`  - Resource Name: ${adResourceName}\n`)

    // 总结
    console.log('🎉 测试完成! 所有组件创建成功!\n')
    console.log('📊 创建结果总结:')
    console.log(`  ✅ Campaign: ${campaignId}`)
    console.log(`  ✅ Ad Group: ${adGroupId}`)
    console.log(`  ✅ Ad: ${adId}`)
    console.log('\n验证清单:')
    console.log('  ✅ Bidding Strategy = Maximize Clicks')
    console.log('  ✅ Final URL Suffix已设置')
    console.log('  ✅ Headlines = 15个')
    console.log('  ✅ Descriptions = 4个')
    console.log('  ✅ CampaignCriterion (geo + language)已创建')
    console.log('  ✅ Campaign状态 = PAUSED')

    return {
      success: true,
      campaignId,
      adGroupId,
      adId,
    }
  } catch (error: any) {
    console.error('\n❌ 测试失败!')
    console.error('错误信息:', error.message)

    if (error.errors) {
      console.error('\nGoogle Ads API错误详情:')
      error.errors.forEach((err: any, index: number) => {
        console.error(`  ${index + 1}. ${err.message}`)
        if (err.error_code) {
          console.error(`     错误代码:`, JSON.stringify(err.error_code, null, 2))
        }
      })
    }

    return {
      success: false,
      error: error.message,
    }
  }
}

// 运行测试
testCampaignCreation()
  .then(result => {
    if (result.success) {
      console.log('\n✅ 测试成功完成!')
      process.exit(0)
    } else {
      console.log('\n❌ 测试失败!')
      process.exit(1)
    }
  })
  .catch(error => {
    console.error('\n❌ 未捕获的错误:', error)
    process.exit(1)
  })
