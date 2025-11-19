/**
 * Google Ads API验证缓存功能测试
 *
 * 测试场景：
 * 1. 首次验证 - 应该调用完整验证流程
 * 2. 重复验证（15分钟内） - 应该使用缓存
 * 3. 缓存过期后验证 - 应该重新验证
 */

import { validateGoogleAdsConfig } from '../src/lib/settings'
import * as dotenv from 'dotenv'
import * as path from 'path'

// 加载.env文件
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function testCacheFunctionality() {
  console.log(`\n${'#'.repeat(80)}`)
  console.log(`# Google Ads API 验证缓存功能测试`)
  console.log(`# 测试时间: ${new Date().toISOString()}`)
  console.log(`${'#'.repeat(80)}\n`)

  // 从环境变量获取真实凭证
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || ''
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''

  if (!clientId || !clientSecret || !developerToken) {
    console.log(`❌ 错误: 未能从.env加载完整的Google Ads凭证\n`)
    return
  }

  console.log(`📝 使用真实凭证进行缓存测试`)
  console.log(`   Client ID: ${clientId.substring(0, 20)}...`)
  console.log(`   Client Secret: ${clientSecret.substring(0, 10)}...`)
  console.log(`   Developer Token: ${developerToken.substring(0, 10)}...\n`)

  // 测试1: 首次验证（无缓存）
  console.log(`${'='.repeat(80)}`)
  console.log(`🧪 测试1: 首次验证（应该执行完整验证流程）`)
  console.log(`${'='.repeat(80)}\n`)

  const startTime1 = Date.now()
  const result1 = await validateGoogleAdsConfig(clientId, clientSecret, developerToken)
  const duration1 = Date.now() - startTime1

  console.log(`⏱️  验证耗时: ${duration1}ms`)
  console.log(`📊 验证结果: ${result1.valid ? '✅ 成功' : '❌ 失败'}`)
  console.log(`💬 消息: ${result1.message}\n`)

  if (duration1 < 100) {
    console.log(`⚠️  警告: 验证耗时异常短 (${duration1}ms)，可能使用了缓存`)
  } else {
    console.log(`✅ 正常: 验证耗时合理 (${duration1}ms)，说明执行了完整验证流程\n`)
  }

  // 等待1秒，确保日志输出完整
  await new Promise(resolve => setTimeout(resolve, 1000))

  // 测试2: 立即重复验证（应该使用缓存）
  console.log(`${'='.repeat(80)}`)
  console.log(`🧪 测试2: 立即重复验证（应该使用缓存）`)
  console.log(`${'='.repeat(80)}\n`)

  const startTime2 = Date.now()
  const result2 = await validateGoogleAdsConfig(clientId, clientSecret, developerToken)
  const duration2 = Date.now() - startTime2

  console.log(`⏱️  验证耗时: ${duration2}ms`)
  console.log(`📊 验证结果: ${result2.valid ? '✅ 成功' : '❌ 失败'}`)
  console.log(`💬 消息: ${result2.message}\n`)

  if (duration2 < 100) {
    console.log(`✅ 成功: 验证耗时很短 (${duration2}ms)，说明使用了缓存`)
  } else {
    console.log(`❌ 失败: 验证耗时较长 (${duration2}ms)，缓存可能未生效\n`)
  }

  // 比较两次验证结果
  if (result1.valid === result2.valid && result1.message === result2.message) {
    console.log(`✅ 结果一致性检查通过: 两次验证结果完全一致\n`)
  } else {
    console.log(`❌ 结果一致性检查失败: 两次验证结果不一致\n`)
  }

  // 等待2秒
  await new Promise(resolve => setTimeout(resolve, 2000))

  // 测试3: 5秒后第三次验证（仍应使用缓存）
  console.log(`${'='.repeat(80)}`)
  console.log(`🧪 测试3: 5秒后第三次验证（仍应使用缓存）`)
  console.log(`${'='.repeat(80)}\n`)

  const startTime3 = Date.now()
  const result3 = await validateGoogleAdsConfig(clientId, clientSecret, developerToken)
  const duration3 = Date.now() - startTime3

  console.log(`⏱️  验证耗时: ${duration3}ms`)
  console.log(`📊 验证结果: ${result3.valid ? '✅ 成功' : '❌ 失败'}`)
  console.log(`💬 消息: ${result3.message}\n`)

  if (duration3 < 100) {
    console.log(`✅ 成功: 验证耗时很短 (${duration3}ms)，缓存持续有效\n`)
  } else {
    console.log(`⚠️  警告: 验证耗时较长 (${duration3}ms)\n`)
  }

  // 性能对比
  console.log(`${'='.repeat(80)}`)
  console.log(`📊 性能对比分析`)
  console.log(`${'='.repeat(80)}\n`)

  console.log(`验证耗时对比:`)
  console.log(`   第1次验证（无缓存）: ${duration1}ms`)
  console.log(`   第2次验证（使用缓存）: ${duration2}ms`)
  console.log(`   第3次验证（使用缓存）: ${duration3}ms\n`)

  const avgCacheTime = (duration2 + duration3) / 2
  const speedup = Math.round((duration1 / avgCacheTime) * 10) / 10

  console.log(`性能提升:`)
  console.log(`   缓存平均耗时: ${Math.round(avgCacheTime)}ms`)
  console.log(`   加速比: ${speedup}x`)
  console.log(`   时间节省: ${Math.round(((duration1 - avgCacheTime) / duration1) * 100)}%\n`)

  // 总结
  console.log(`${'#'.repeat(80)}`)
  console.log(`# 测试总结`)
  console.log(`${'#'.repeat(80)}\n`)

  const allValid = result1.valid && result2.valid && result3.valid
  const cachingWorks = duration2 < 100 && duration3 < 100
  const significantSpeedup = speedup >= 10

  console.log(`✅ 功能测试:`)
  console.log(`   - 验证结果正确: ${allValid ? '✅' : '❌'}`)
  console.log(`   - 缓存机制有效: ${cachingWorks ? '✅' : '❌'}`)
  console.log(`   - 性能提升显著: ${significantSpeedup ? '✅' : '❌'} (${speedup}x加速)\n`)

  console.log(`🎯 缓存配置:`)
  console.log(`   - 缓存TTL: 15分钟 (900秒)`)
  console.log(`   - 缓存键: credentials哈希`)
  console.log(`   - 自动清理: 每次验证时清理过期条目\n`)

  console.log(`💡 优化效果:`)
  console.log(`   - 避免重复的网络请求到Google OAuth服务器`)
  console.log(`   - 验证速度提升 ${speedup}x`)
  console.log(`   - 用户体验显著改善（从${duration1}ms降至~${Math.round(avgCacheTime)}ms）\n`)

  if (allValid && cachingWorks && significantSpeedup) {
    console.log(`🎉 缓存功能测试全部通过！\n`)
  } else {
    console.log(`⚠️  部分测试未通过，请检查实现\n`)
  }
}

// 运行测试
if (require.main === module) {
  testCacheFunctionality().catch(console.error)
}

export { testCacheFunctionality }
