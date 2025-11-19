/**
 * Google Ads API真实凭证验证测试
 *
 * 使用.env中的真实Client ID/Secret/Token进行验证
 */

import { validateGoogleAdsConfig } from '../src/lib/settings'
import * as dotenv from 'dotenv'
import * as path from 'path'

// 加载.env文件
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function testRealCredentials() {
  console.log(`\n${'#'.repeat(80)}`)
  console.log(`# Google Ads API 真实凭证验证测试`)
  console.log(`# 测试时间: ${new Date().toISOString()}`)
  console.log(`${'#'.repeat(80)}\n`)

  // 从环境变量获取真实凭证
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || ''
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''

  // 检查是否加载了凭证
  if (!clientId || !clientSecret || !developerToken) {
    console.log(`❌ 错误: 未能从.env加载完整的Google Ads凭证`)
    console.log(``)
    console.log(`请确保.env文件包含以下变量:`)
    console.log(`  - GOOGLE_ADS_CLIENT_ID`)
    console.log(`  - GOOGLE_ADS_CLIENT_SECRET`)
    console.log(`  - GOOGLE_ADS_DEVELOPER_TOKEN`)
    console.log(``)
    return
  }

  console.log(`📝 真实凭证信息:`)
  console.log(`   Client ID: ${clientId.substring(0, 20)}...${clientId.substring(clientId.length - 10)}`)
  console.log(`   Client Secret: ${clientSecret.substring(0, 10)}...`)
  console.log(`   Developer Token: ${developerToken.substring(0, 10)}...\n`)

  console.log(`${'='.repeat(80)}`)
  console.log(`🧪 开始验证真实凭证`)
  console.log(`${'='.repeat(80)}\n`)

  try {
    const startTime = Date.now()

    console.log(`⏳ 执行5步验证流程...`)
    console.log(`   Step 1: 基础验证（字段非空检查）`)
    console.log(`   Step 2: 格式验证（Client ID/Secret/Token格式）`)
    console.log(`   Step 3: GoogleAdsApi实例创建`)
    console.log(`   Step 4: OAuth URL生成`)
    console.log(`   Step 5: OAuth服务器真实验证\n`)

    const result = await validateGoogleAdsConfig(
      clientId,
      clientSecret,
      developerToken
    )

    const duration = Date.now() - startTime

    console.log(`⏱️  验证总耗时: ${duration}ms\n`)
    console.log(`${'='.repeat(80)}`)
    console.log(`📊 验证结果`)
    console.log(`${'='.repeat(80)}\n`)

    if (result.valid) {
      console.log(`✅ 验证成功！`)
      console.log(``)
      console.log(`📋 结果详情:`)
      console.log(`   Valid: ${result.valid}`)
      console.log(`   Message: ${result.message}`)
      console.log(``)
      console.log(`🎉 真实凭证验证通过，说明:`)
      console.log(`   1. ✅ Client ID格式正确`)
      console.log(`   2. ✅ Client Secret格式正确`)
      console.log(`   3. ✅ Developer Token格式正确`)
      console.log(`   4. ✅ GoogleAdsApi实例成功创建`)
      console.log(`   5. ✅ OAuth URL生成成功`)
      console.log(`   6. ✅ Google OAuth服务器验证通过（或未返回invalid_client错误）`)
      console.log(``)
      console.log(`🚀 下一步:`)
      console.log(`   - 在前端页面进行Google Ads账号授权`)
      console.log(`   - 获取授权码并完成OAuth流程`)
      console.log(`   - 开始使用Google Ads API功能`)
      console.log(``)
    } else {
      console.log(`❌ 验证失败`)
      console.log(``)
      console.log(`📋 结果详情:`)
      console.log(`   Valid: ${result.valid}`)
      console.log(`   Message: ${result.message}`)
      console.log(``)
      console.log(`🔍 失败原因分析:`)

      if (result.message.includes('所有字段都是必填的')) {
        console.log(`   ❌ Step 1失败: 存在空字段`)
        console.log(`   建议: 检查.env文件是否包含完整凭证`)
      } else if (result.message.includes('.apps.googleusercontent.com')) {
        console.log(`   ❌ Step 2失败: Client ID格式错误`)
        console.log(`   建议: Client ID必须包含 .apps.googleusercontent.com`)
      } else if (result.message.includes('Client Secret格式不正确')) {
        console.log(`   ❌ Step 2失败: Client Secret长度过短`)
        console.log(`   建议: Client Secret应至少20个字符`)
      } else if (result.message.includes('Developer Token格式不正确')) {
        console.log(`   ❌ Step 2失败: Developer Token长度过短`)
        console.log(`   建议: Developer Token应至少20个字符`)
      } else if (result.message.includes('GoogleAdsApi')) {
        console.log(`   ❌ Step 3失败: GoogleAdsApi实例创建失败`)
        console.log(`   建议: 检查google-ads-api包是否正确安装`)
      } else if (result.message.includes('OAuth URL')) {
        console.log(`   ❌ Step 4失败: OAuth URL生成失败`)
        console.log(`   建议: 检查NEXT_PUBLIC_APP_URL环境变量`)
      } else if (result.message.includes('Client ID或Client Secret无效')) {
        console.log(`   ❌ Step 5失败: Google OAuth服务器返回invalid_client`)
        console.log(`   说明: Client ID或Client Secret在Google控制台中无效`)
        console.log(`   建议:`)
        console.log(`      1. 登录 https://console.cloud.google.com/`)
        console.log(`      2. 检查OAuth 2.0客户端ID是否正确`)
        console.log(`      3. 确认Client Secret未过期或被重置`)
        console.log(`      4. 验证项目是否启用了Google Ads API`)
      } else {
        console.log(`   ⚠️  未知错误类型`)
        console.log(`   建议: 查看完整错误消息进行排查`)
      }
      console.log(``)
    }

  } catch (error: any) {
    console.log(`❌ 测试异常: ${error.message}`)
    console.log(``)
    console.log(`堆栈信息:`)
    console.log(error.stack)
  }

  console.log(`${'#'.repeat(80)}`)
  console.log(`# 测试完成`)
  console.log(`${'#'.repeat(80)}\n`)
}

// 运行测试
if (require.main === module) {
  testRealCredentials().catch(console.error)
}

export { testRealCredentials }
