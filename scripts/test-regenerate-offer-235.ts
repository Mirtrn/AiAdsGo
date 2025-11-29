/**
 * 测试脚本：重新生成 offer 235 的创意
 * 用于测试 Keyword Planner 是否正常工作
 */
import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { getSQLiteDatabase } from '../src/lib/db'

async function testRegenerateOffer235() {
  console.log('🔍 开始重新生成 offer 235 的创意...\n')

  const db = getSQLiteDatabase()

  // 查询 offer 235
  const offer = db.prepare(`
    SELECT * FROM offers WHERE id = 235
  `).get() as any

  if (!offer) {
    console.log('❌ Offer 235 不存在')
    return
  }

  console.log('📋 Offer 信息:')
  console.log('  - ID:', offer.id)
  console.log('  - Brand:', offer.brand)
  console.log('  - Target Country:', offer.target_country)
  console.log('  - Target Language:', offer.target_language)
  console.log()

  try {
    console.log('🚀 调用 generateAdCreative...')
    const startTime = Date.now()

    const creative = await generateAdCreative(
      235, // offerId
      1, // userId
      { skipCache: true }
    )

    const duration = Date.now() - startTime
    console.log(`\n✅ 创意生成成功! 耗时: ${(duration / 1000).toFixed(1)}s\n`)

    console.log('📊 生成的创意:')
    console.log('  - Keywords:', creative.keywords.length, '个')
    console.log('  - Keywords with Volume:', creative.keywordsWithVolume?.length || 0, '个')
    console.log('  - Negative Keywords:', creative.negativeKeywords?.length || 0, '个')
    console.log()

    if (creative.keywordsWithVolume && creative.keywordsWithVolume.length > 0) {
      console.log('📋 前 10 个关键词（带搜索量）:')
      creative.keywordsWithVolume.slice(0, 10).forEach((kw, i) => {
        console.log(`  ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月)`)
      })
    }

  } catch (error: any) {
    console.log('❌ 创意生成失败!')
    console.log('错误:', error.message)
    console.log(error.stack)
  }
}

testRegenerateOffer235().catch(console.error)
