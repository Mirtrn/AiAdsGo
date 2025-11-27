/**
 * 测试 Diamonds Factory URL 解析问题
 * 验证最终URL和追踪参数是否正确提取
 */

import { resolveAffiliateLink } from '../src/lib/scraper-stealth'

async function testDiamondsFactoryUrl() {
  const testUrl = 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url='

  console.log('🧪 测试 Diamonds Factory URL解析')
  console.log('推广链接:', testUrl)
  console.log('目标国家: US')
  console.log('')

  try {
    const result = await resolveAffiliateLink(testUrl, {
      targetCountry: 'US',
      skipCache: true,
    })

    console.log('✅ 解析成功!')
    console.log('')
    console.log('📊 解析结果:')
    console.log('  - 最终URL:', result.finalUrl)
    console.log('  - URL Suffix:', result.finalUrlSuffix || '(空)')
    console.log('  - 重定向次数:', result.redirectCount)
    console.log('  - 重定向链:', JSON.stringify(result.redirectChain, null, 2))
    console.log('')

    // 检查是否丢失参数
    if (!result.finalUrlSuffix || result.finalUrlSuffix.length === 0) {
      console.error('❌ BUG确认: URL Suffix为空!')
      console.error('   预期应包含追踪参数: wgu, wgexpiry, utm_source, utm_medium, utm_campaign, utm_content, wgdp, cname')
    } else {
      console.log('✅ URL Suffix已提取:', result.finalUrlSuffix.length, '字符')

      // 检查关键追踪参数
      const hasWgu = result.finalUrlSuffix.includes('wgu=')
      const hasUtmSource = result.finalUrlSuffix.includes('utm_source=')
      const hasUtmCampaign = result.finalUrlSuffix.includes('utm_campaign=')

      console.log('   - wgu参数:', hasWgu ? '✅' : '❌')
      console.log('   - utm_source参数:', hasUtmSource ? '✅' : '❌')
      console.log('   - utm_campaign参数:', hasUtmCampaign ? '✅' : '❌')
    }

  } catch (error: any) {
    console.error('❌ 解析失败:', error.message)
    console.error('错误详情:', error)
  }
}

testDiamondsFactoryUrl().then(() => {
  console.log('\n测试完成')
  process.exit(0)
}).catch(error => {
  console.error('测试失败:', error)
  process.exit(1)
})
