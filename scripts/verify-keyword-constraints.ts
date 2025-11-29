/**
 * 验证关键词约束条件
 * 强制约束：
 * 1. 必须保留品牌词 "eufy"（不管搜索量）
 * 2. 除了品牌词之外，其他关键词搜索量都不能少于 500
 * 3. 最后留下来的关键词数量不少于 10 个
 */

import Database from 'better-sqlite3'

const db = new Database('./data/autoads.db')

function verifyCreativeKeywords(offerId: number) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`🔍 验证 Offer #${offerId} 的关键词约束条件`)
  console.log(`${'='.repeat(80)}\n`)

  // 获取所有创意
  const creatives = db.prepare(`
    SELECT id, score, keywords, keywords_with_volume
    FROM ad_creatives
    WHERE offer_id = ?
    ORDER BY created_at DESC
  `).all(offerId) as any[]

  if (creatives.length === 0) {
    console.log('❌ 未找到任何创意')
    return
  }

  console.log(`📊 找到 ${creatives.length} 个创意\n`)

  const brandKeyword = 'eufy'
  let allPass = true

  creatives.forEach((creative, index) => {
    console.log(`\n${'─'.repeat(80)}`)
    console.log(`📍 创意 #${creative.id} (分数: ${creative.score})`)
    console.log(`${'─'.repeat(80)}`)

    const keywords = JSON.parse(creative.keywords || '[]') as string[]
    const keywordsWithVolume = JSON.parse(creative.keywords_with_volume || '[]') as Array<{
      keyword: string
      searchVolume: number
    }>

    console.log(`\n📋 关键词列表 (${keywords.length} 个):`)
    keywords.forEach((kw, i) => {
      const volume = keywordsWithVolume.find(k => k.keyword === kw)?.searchVolume ?? 0
      const isBrand = kw.toLowerCase() === brandKeyword.toLowerCase()
      const volumeStatus = isBrand ? '(品牌词)' : volume >= 500 ? `✅ ${volume}/月` : `❌ ${volume}/月`
      console.log(`   ${i + 1}. "${kw}" ${volumeStatus}`)
    })

    // 验证约束条件
    console.log(`\n🎯 约束条件验证:`)

    // 约束1：必须包含品牌词
    const hasBrandKeyword = keywords.some(kw => kw.toLowerCase() === brandKeyword.toLowerCase())
    const constraint1Pass = hasBrandKeyword
    console.log(`   ${constraint1Pass ? '✅' : '❌'} 约束1: 包含品牌词 "${brandKeyword}"`)
    if (!constraint1Pass) {
      console.log(`      ❌ 缺少品牌词 "${brandKeyword}"`)
      allPass = false
    }

    // 约束2：非品牌词搜索量 >= 500
    const nonBrandKeywords = keywordsWithVolume.filter(
      kw => kw.keyword.toLowerCase() !== brandKeyword.toLowerCase()
    )
    const lowVolumeKeywords = nonBrandKeywords.filter(kw => kw.searchVolume < 500)
    const constraint2Pass = lowVolumeKeywords.length === 0
    console.log(`   ${constraint2Pass ? '✅' : '❌'} 约束2: 所有非品牌词搜索量 >= 500`)
    if (!constraint2Pass) {
      console.log(`      ❌ 有 ${lowVolumeKeywords.length} 个非品牌词搜索量 < 500:`)
      lowVolumeKeywords.forEach(kw => {
        console.log(`         - "${kw.keyword}" (${kw.searchVolume}/月)`)
      })
      allPass = false
    }

    // 约束3：关键词数量 >= 10
    const constraint3Pass = keywords.length >= 10
    console.log(`   ${constraint3Pass ? '✅' : '❌'} 约束3: 关键词数量 >= 10 (当前: ${keywords.length})`)
    if (!constraint3Pass) {
      console.log(`      ❌ 关键词数量不足，需要至少 10 个，当前只有 ${keywords.length} 个`)
      allPass = false
    }

    // 总体结果
    const creativePass = constraint1Pass && constraint2Pass && constraint3Pass
    console.log(`\n${creativePass ? '✅' : '❌'} 创意 #${creative.id} ${creativePass ? '通过' : '未通过'}所有约束条件`)
  })

  console.log(`\n${'='.repeat(80)}`)
  console.log(`${allPass ? '✅ 所有创意都通过了约束条件验证' : '❌ 有创意未通过约束条件验证'}`)
  console.log(`${'='.repeat(80)}\n`)
}

// 验证 offer 236
verifyCreativeKeywords(236)
