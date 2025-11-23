/**
 * Test script: Generate ad creative for Offer 35 to validate gemini-2.5-pro
 *
 * Validates TC-13 requirements:
 * - 15 headlines (≤30 chars each)
 * - 4 descriptions (≤90 chars each)
 * - 10-15 keywords
 * - 4-6 callouts (≤25 chars each)
 * - 4 sitelinks (text≤25, description≤35 chars)
 */

import { getDatabase } from '../src/lib/db'
import { generateAdCreative } from '../src/lib/ad-creative-generator'

async function testCreativeGeneration() {
  console.log('🎨 开始生成广告创意 (Offer 35)...\n')

  try {
    // Get database connection
    const db = getDatabase()

    // Get offer details
    const offer = db.prepare(`
      SELECT * FROM offers WHERE id = ?
    `).get(35) as any

    if (!offer) {
      throw new Error('Offer 35 not found')
    }

    console.log('📋 Offer信息:')
    console.log('   ID:', offer.id)
    console.log('   Brand:', offer.brand)
    console.log('   URL:', offer.url)
    console.log('   Target:', offer.target_country, '/', offer.target_language)
    console.log()

    // Generate creative with theme='brand' (first variant)
    console.log('⚙️  调用AI生成创意 (theme: brand)...')

    const creative = await generateAdCreative(
      35,  // offerId
      1,   // userId (autoads admin)
      {
        theme: 'brand',  // First of 3 variants
        skipCache: true   // Force new generation
      }
    )

    console.log('\n✅ 创意生成成功！\n')

    // Validate TC-13 requirements
    console.log('📊 TC-13 验证结果:')
    console.log('═'.repeat(60))

    // AI Model
    console.log(`\n🤖 AI模型: ${creative.ai_model}`)
    const modelOk = creative.ai_model.includes('gemini-2.5-pro') ||
                    creative.ai_model.includes('gemini-2.0-flash')
    console.log(`   ${modelOk ? '✅' : '❌'} 模型版本验证`)

    // Headlines
    const headlines = creative.headlines ||  []
    console.log(`\n📝 Headlines: ${headlines.length}个`)
    headlines.forEach((h: any, i: number) => {
      const text = typeof h === 'string' ? h : h.text
      const len = text.length
      const ok = len <= 30
      console.log(`   ${i + 1}. [${len}字符] ${ok ? '✅' : '❌'} ${text}`)
    })
    const headlinesOk = headlines.length === 15 && headlines.every((h: any) => {
      const text = typeof h === 'string' ? h : h.text
      return text.length <= 30
    })
    console.log(`   ${headlinesOk ? '✅' : '❌'} 数量和长度验证 (要求: 15个, ≤30字符)`)

    // Descriptions
    const descriptions = creative.descriptions || []
    console.log(`\n📄 Descriptions: ${descriptions.length}个`)
    descriptions.forEach((d: any, i: number) => {
      const text = typeof d === 'string' ? d : d.text
      const len = text.length
      const ok = len <= 90
      console.log(`   ${i + 1}. [${len}字符] ${ok ? '✅' : '❌'} ${text}`)
    })
    const descriptionsOk = descriptions.length === 4 && descriptions.every((d: any) => {
      const text = typeof d === 'string' ? d : d.text
      return text.length <= 90
    })
    console.log(`   ${descriptionsOk ? '✅' : '❌'} 数量和长度验证 (要求: 4个, ≤90字符)`)

    // Keywords
    const keywords = creative.keywords || []
    console.log(`\n🔑 Keywords: ${keywords.length}个`)
    keywords.forEach((k: any, i: number) => {
      const keyword = typeof k === 'string' ? k : k.keyword
      console.log(`   ${i + 1}. ${keyword}`)
    })
    const keywordsOk = keywords.length >= 10 && keywords.length <= 15
    console.log(`   ${keywordsOk ? '✅' : '❌'} 数量验证 (要求: 10-15个)`)

    // Callouts
    const callouts = creative.callouts || []
    console.log(`\n📢 Callouts: ${callouts.length}个`)
    callouts.forEach((c: string, i: number) => {
      const len = c.length
      const ok = len <= 25
      console.log(`   ${i + 1}. [${len}字符] ${ok ? '✅' : '❌'} ${c}`)
    })
    const calloutsOk = callouts.length >= 4 && callouts.length <= 6 && callouts.every((c: string) => c.length <= 25)
    console.log(`   ${calloutsOk ? '✅' : '❌'} 数量和长度验证 (要求: 4-6个, ≤25字符)`)

    // Sitelinks
    const sitelinks = creative.sitelinks || []
    console.log(`\n🔗 Sitelinks: ${sitelinks.length}个`)
    sitelinks.forEach((s: any, i: number) => {
      const textLen = s.text.length
      const descLen = s.description.length
      const textOk = textLen <= 25
      const descOk = descLen <= 35
      console.log(`   ${i + 1}. ${textOk ? '✅' : '❌'} [${textLen}字符] ${s.text}`)
      console.log(`      ${descOk ? '✅' : '❌'} [${descLen}字符] ${s.description}`)
    })
    const sitelinksOk = sitelinks.length === 4 &&
                        sitelinks.every((s: any) => s.text.length <= 25 && s.description.length <= 35)
    console.log(`   ${sitelinksOk ? '✅' : '❌'} 数量和长度验证 (要求: 4个, text≤25, desc≤35字符)`)

    // Overall score
    const score = creative.score
    console.log(`\n⭐ 质量评分: ${score}/100`)
    const scoreOk = score >= 80
    console.log(`   ${scoreOk ? '✅' : '❌'} 评分验证 (要求: ≥80分)`)

    // Summary
    console.log('\n' + '═'.repeat(60))
    const allOk = modelOk && headlinesOk && descriptionsOk && keywordsOk && calloutsOk && sitelinksOk && scoreOk

    if (allOk) {
      console.log('✅ TC-13 全部验证通过！')
    } else {
      console.log('⚠️  部分验证未通过，需要优化')
    }

    console.log('\n💾 创意已保存到数据库 (ID: ' + creative.id + ')')

  } catch (error: any) {
    console.error('\n❌ 生成失败:', error.message)
    if (error.stack) {
      console.error('\n堆栈信息:', error.stack)
    }
    process.exit(1)
  }
}

testCreativeGeneration()
