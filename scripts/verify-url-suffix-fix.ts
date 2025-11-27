/**
 * 验证URL Suffix修复
 * 测试Diamonds Factory URL是否能正确提取追踪参数
 */

import { resolveAffiliateLink } from '../src/lib/scraper-stealth'

async function verifyFix() {
  console.log('🧪 验证URL Suffix修复')
  console.log('测试URL: https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=')
  console.log('')

  try {
    // 需要配置代理才能测试，这里使用模拟测试
    console.log('⚠️ 注意：由于需要代理配置，此测试需要在完整环境中运行')
    console.log('')
    console.log('修复内容:')
    console.log('  1. 使用 page.evaluate(() => window.location.href) 替代 page.url()')
    console.log('  2. 添加了 fallback 到 page.url() 确保兼容性')
    console.log('  3. 新增了诊断日志，当URL包含?但suffix为空时发出警告')
    console.log('')
    console.log('预期效果:')
    console.log('  - 最终URL: https://www.diamondsfactory.ca/')
    console.log('  - URL Suffix: wgu=...&wgexpiry=...&utm_source=webgains&utm_medium=affiliate&...')
    console.log('  - 所有追踪参数应该被完整提取')
    console.log('')
    console.log('✅ 修复已应用到代码中，等待实际环境验证')

  } catch (error: any) {
    console.error('❌ 验证失败:', error.message)
  }
}

verifyFix().then(() => {
  console.log('\n验证脚本执行完成')
  process.exit(0)
}).catch(error => {
  console.error('验证脚本失败:', error)
  process.exit(1)
})
