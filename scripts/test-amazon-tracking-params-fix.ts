/**
 * 测试Amazon推广参数修复
 * 验证scraper是否正确传递finalUrl + finalUrlSuffix
 *
 * 测试目标: https://pboost.me/UKTs4I6
 * 预期结果: 成功抓取Amazon Store数据，无404错误
 */

import { resolveAffiliateLink } from '@/lib/url-resolver-enhanced'
import { scrapeAmazonStore } from '@/lib/scraper-stealth'
import { initializeProxyPool } from '@/lib/offer-utils'

async function testAmazonTrackingParamsFix() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🧪 测试Amazon推广参数修复')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const affiliateLink = 'https://pboost.me/UKTs4I6'
  const targetCountry = 'US'
  const userId = 1 // 使用autoads管理员账号

  try {
    // ========== 步骤1: 初始化代理池 ==========
    console.log('📋 步骤1: 初始化代理池...')
    await initializeProxyPool(userId, targetCountry)
    console.log('✅ 代理池初始化完成\n')

    // ========== 步骤2: 解析推广链接 ==========
    console.log('📋 步骤2: 解析推广链接...')
    const resolvedData = await resolveAffiliateLink(affiliateLink, {
      targetCountry: targetCountry,
      skipCache: true, // 确保获取最新追踪参数
    })

    console.log('✅ URL解析完成:')
    console.log('  - Final URL:', resolvedData.finalUrl)
    console.log('  - URL Suffix:', resolvedData.finalUrlSuffix || '(无)')
    console.log('  - 重定向次数:', resolvedData.redirectCount)
    console.log('  - 解析方法:', resolvedData.resolveMethod)
    console.log('')

    // ========== 步骤3: 拼接完整URL（验证逻辑） ==========
    console.log('📋 步骤3: 拼接完整URL（包含追踪参数）...')
    const fullTargetUrl = resolvedData.finalUrlSuffix
      ? `${resolvedData.finalUrl}?${resolvedData.finalUrlSuffix}`
      : resolvedData.finalUrl

    console.log('✅ 完整目标URL:', fullTargetUrl)
    console.log('')

    // 验证是否包含推广参数
    if (!fullTargetUrl.includes('maas=') || !fullTargetUrl.includes('aa_campaignid=')) {
      console.error('❌ 警告: 完整URL缺少推广参数!')
      console.error('   这可能导致Amazon 404拦截')
      return
    }
    console.log('✅ 推广参数验证通过 (包含maas和aa_campaignid)')
    console.log('')

    // ========== 步骤4: 抓取Amazon Store数据 ==========
    console.log('📋 步骤4: 抓取Amazon Store数据...')
    console.log('⏳ 这可能需要10-30秒...\n')

    // 获取代理URL（从环境变量或数据库）
    const proxyUrl = process.env.PROXY_URL
    if (!proxyUrl) {
      throw new Error('未配置PROXY_URL环境变量')
    }

    const startTime = Date.now()
    const storeData = await scrapeAmazonStore(fullTargetUrl, proxyUrl)
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(`✅ Amazon Store抓取成功 (耗时: ${duration}秒)`)
    console.log('  - 品牌名称:', storeData.brandName || storeData.storeName)
    console.log('  - 店铺描述:', storeData.storeDescription?.substring(0, 100) + '...')
    console.log('  - 产品数量:', storeData.totalProducts)
    console.log('  - 热销商品:', storeData.products.length, '个')
    console.log('')

    // ========== 步骤5: 验证结果 ==========
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ 测试通过！修复生效')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('')
    console.log('验证要点:')
    console.log('1. ✅ URL Suffix正确提取')
    console.log('2. ✅ 完整URL包含推广参数')
    console.log('3. ✅ Playwright成功访问（无404）')
    console.log('4. ✅ Amazon Store数据成功提取')
    console.log('')

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('❌ 测试失败')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('错误类型:', error?.constructor?.name || 'Unknown')
    console.error('错误消息:', error?.message || String(error))
    console.error('错误堆栈:', error?.stack)
    console.error('')

    // 诊断建议
    if (error.message.includes('404')) {
      console.error('🔍 诊断: 仍然出现404错误')
      console.error('   可能原因:')
      console.error('   - finalUrlSuffix未正确传递到scraper')
      console.error('   - URL拼接逻辑有误')
      console.error('   - 推广参数格式不正确')
    } else if (error.message.includes('timeout')) {
      console.error('🔍 诊断: 请求超时')
      console.error('   可能原因:')
      console.error('   - 代理IP响应缓慢')
      console.error('   - 网络连接问题')
    } else if (error.message.includes('代理')) {
      console.error('🔍 诊断: 代理配置问题')
      console.error('   请检查: PROXY_URL环境变量是否正确配置')
    }

    process.exit(1)
  }
}

// 运行测试
testAmazonTrackingParamsFix()
  .then(() => {
    console.log('🎉 所有测试完成！')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 未捕获的错误:', error)
    process.exit(1)
  })
