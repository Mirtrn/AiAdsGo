/**
 * 测试脚本：验证多轮 Keyword Planner 查询和最终关键词过滤
 */
import { generateAdCreative } from '../src/lib/ad-creative-generator'

async function testMultiRoundKeywordPlanner() {
  console.log('🔍 开始测试多轮 Keyword Planner 查询和最终关键词过滤...\n')

  try {
    console.log('🚀 调用 generateAdCreative (offer_id=236, userId=1)...')
    const startTime = Date.now()

    const creative = await generateAdCreative(
      236, // offerId
      1, // userId
      { skipCache: true }
    )

    const duration = Date.now() - startTime
    console.log(`\n✅ 创意生成成功! 耗时: ${(duration / 1000).toFixed(1)}s\n`)

    console.log('📊 生成的创意统计:')
    console.log('  - Keywords:', creative.keywords.length, '个')
    console.log('  - Keywords with Volume:', creative.keywordsWithVolume?.length || 0, '个')
    console.log('  - Negative Keywords:', creative.negativeKeywords?.length || 0, '个')
    console.log()

    if (creative.keywordsWithVolume && creative.keywordsWithVolume.length > 0) {
      console.log('📋 所有关键词（带搜索量）:')
      creative.keywordsWithVolume.forEach((kw, i) => {
        console.log(`  ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月)`)
      })
      console.log()

      // 验证所有关键词的搜索量都 >= 500
      const lowVolumeKeywords = creative.keywordsWithVolume.filter(kw => kw.searchVolume < 500)
      if (lowVolumeKeywords.length > 0) {
        console.log(`❌ 警告: 发现 ${lowVolumeKeywords.length} 个搜索量 < 500 的关键词:`)
        lowVolumeKeywords.forEach(kw => {
          console.log(`   - "${kw.keyword}" (${kw.searchVolume}/月)`)
        })
      } else {
        console.log(`✅ 验证通过: 所有 ${creative.keywordsWithVolume.length} 个关键词的搜索量都 >= 500`)
      }
    }

  } catch (error: any) {
    console.log('❌ 创意生成失败!')
    console.log('错误:', error.message)
    console.log(error.stack)
  }
}

testMultiRoundKeywordPlanner().catch(console.error)
