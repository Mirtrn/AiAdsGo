/**
 * 验证广告创意中所有文本元素的语言一致性
 * 检查项：标题、描述、关键词、附加信息、附加链接
 */

import Database from 'better-sqlite3'

const db = new Database('./data/autoads.db')

// 语言检测函数
function detectLanguage(text: string): string {
  if (!text) return 'UNKNOWN'

  // 意大利语特征词
  const italianPatterns = [
    /\b(il|la|di|da|per|con|che|è|sono|questo|quello|aspirapolvere|robot|pulizia|casa|acquista|compra|prezzo|offerta|sconto)\b/gi,
    /[àèéìòù]/g, // 意大利语重音符号
  ]

  // 西班牙语特征词
  const spanishPatterns = [
    /\b(el|la|de|para|con|que|es|este|ese|aspirador|robot|limpieza|casa|compra|precio|oferta|descuento)\b/gi,
    /[áéíóúñü]/g, // 西班牙语重音符号
  ]

  // 法语特征词
  const frenchPatterns = [
    /\b(le|la|de|pour|avec|que|est|ce|cet|aspirateur|robot|nettoyage|maison|acheter|prix|offre|remise)\b/gi,
    /[àâäéèêëïîôöùûüœæç]/g, // 法语重音符号
  ]

  // 德语特征词
  const germanPatterns = [
    /\b(der|die|das|von|für|mit|dass|ist|dieser|jener|staubsauger|roboter|reinigung|haus|kaufen|preis|angebot|rabatt)\b/gi,
    /[äöüß]/g, // 德语特殊字符
  ]

  // 中文特征
  const chinesePattern = /[\u4e00-\u9fff]/g

  // 英文特征词
  const englishPatterns = [
    /\b(the|a|an|of|to|for|with|that|is|this|that|vacuum|robot|cleaning|home|buy|price|offer|discount)\b/gi,
  ]

  let scores = {
    Italian: 0,
    Spanish: 0,
    French: 0,
    German: 0,
    Chinese: 0,
    English: 0,
  }

  // 检测意大利语
  italianPatterns.forEach(pattern => {
    const matches = text.match(pattern)
    if (matches) scores.Italian += matches.length
  })

  // 检测西班牙语
  spanishPatterns.forEach(pattern => {
    const matches = text.match(pattern)
    if (matches) scores.Spanish += matches.length
  })

  // 检测法语
  frenchPatterns.forEach(pattern => {
    const matches = text.match(pattern)
    if (matches) scores.French += matches.length
  })

  // 检测德语
  germanPatterns.forEach(pattern => {
    const matches = text.match(pattern)
    if (matches) scores.German += matches.length
  })

  // 检测中文
  const chineseMatches = text.match(chinesePattern)
  if (chineseMatches) scores.Chinese += chineseMatches.length * 2

  // 检测英文
  englishPatterns.forEach(pattern => {
    const matches = text.match(pattern)
    if (matches) scores.English += matches.length
  })

  // 找出得分最高的语言
  const maxScore = Math.max(...Object.values(scores))
  if (maxScore === 0) return 'UNKNOWN'

  const detectedLanguage = Object.entries(scores).find(([_, score]) => score === maxScore)?.[0] || 'UNKNOWN'
  return detectedLanguage
}

function verifyCreativeLanguageConsistency(offerId: number) {
  console.log(`\n${'='.repeat(100)}`)
  console.log(`🌍 验证 Offer #${offerId} 的广告创意语言一致性`)
  console.log(`${'='.repeat(100)}\n`)

  // 获取 offer 的目标语言
  const offer = db.prepare('SELECT id, target_language FROM offers WHERE id = ?').get(offerId) as any
  if (!offer) {
    console.log('❌ 未找到 Offer')
    return
  }

  const targetLanguage = offer.target_language || 'English'
  console.log(`📍 Offer 目标语言: ${targetLanguage}\n`)

  // 获取所有创意
  const creatives = db.prepare(`
    SELECT id, headlines, descriptions, keywords, callouts, sitelinks
    FROM ad_creatives
    WHERE offer_id = ?
    ORDER BY created_at DESC
  `).all(offerId) as any[]

  if (creatives.length === 0) {
    console.log('❌ 未找到任何创意')
    return
  }

  console.log(`📊 找到 ${creatives.length} 个创意\n`)

  let allPass = true

  creatives.forEach((creative, index) => {
    console.log(`${'─'.repeat(100)}`)
    console.log(`📍 创意 #${creative.id}`)
    console.log(`${'─'.repeat(100)}`)

    const elements = {
      headlines: JSON.parse(creative.headlines || '[]') as string[],
      descriptions: JSON.parse(creative.descriptions || '[]') as string[],
      keywords: JSON.parse(creative.keywords || '[]') as string[],
      callouts: JSON.parse(creative.callouts || '[]') as string[],
      sitelinks: JSON.parse(creative.sitelinks || '[]') as Array<{ text: string; description: string }>,
    }

    const results: Record<string, { detected: string; pass: boolean; samples: string[] }> = {}

    // 检查标题
    if (elements.headlines.length > 0) {
      const detectedLangs = elements.headlines.map(h => detectLanguage(h))
      const mostCommon = detectedLangs.sort((a, b) => detectedLangs.filter(x => x === a).length - detectedLangs.filter(x => x === b).length).pop()
      const pass = mostCommon === targetLanguage || mostCommon === 'UNKNOWN'
      results.Headlines = {
        detected: mostCommon || 'UNKNOWN',
        pass,
        samples: elements.headlines.slice(0, 2),
      }
    }

    // 检查描述
    if (elements.descriptions.length > 0) {
      const detectedLangs = elements.descriptions.map(d => detectLanguage(d))
      const mostCommon = detectedLangs.sort((a, b) => detectedLangs.filter(x => x === a).length - detectedLangs.filter(x => x === b).length).pop()
      const pass = mostCommon === targetLanguage || mostCommon === 'UNKNOWN'
      results.Descriptions = {
        detected: mostCommon || 'UNKNOWN',
        pass,
        samples: elements.descriptions.slice(0, 2),
      }
    }

    // 检查关键词
    if (elements.keywords.length > 0) {
      const detectedLangs = elements.keywords.map(k => detectLanguage(k))
      const mostCommon = detectedLangs.sort((a, b) => detectedLangs.filter(x => x === a).length - detectedLangs.filter(x => x === b).length).pop()
      const pass = mostCommon === targetLanguage || mostCommon === 'UNKNOWN'
      results.Keywords = {
        detected: mostCommon || 'UNKNOWN',
        pass,
        samples: elements.keywords.slice(0, 5),
      }
    }

    // 检查附加信息
    if (elements.callouts.length > 0) {
      const detectedLangs = elements.callouts.map(c => detectLanguage(c))
      const mostCommon = detectedLangs.sort((a, b) => detectedLangs.filter(x => x === a).length - detectedLangs.filter(x => x === b).length).pop()
      const pass = mostCommon === targetLanguage || mostCommon === 'UNKNOWN'
      results.Callouts = {
        detected: mostCommon || 'UNKNOWN',
        pass,
        samples: elements.callouts.slice(0, 2),
      }
    }

    // 检查附加链接
    if (elements.sitelinks.length > 0) {
      const allText = elements.sitelinks.map(s => `${s.text} ${s.description}`).join(' ')
      const detected = detectLanguage(allText)
      const pass = detected === targetLanguage || detected === 'UNKNOWN'
      results.Sitelinks = {
        detected,
        pass,
        samples: elements.sitelinks.slice(0, 2).map(s => `${s.text}: ${s.description}`),
      }
    }

    // 输出结果
    console.log(`\n📋 语言检测结果:`)
    Object.entries(results).forEach(([element, result]) => {
      const status = result.pass ? '✅' : '❌'
      console.log(`   ${status} ${element}: 检测到 ${result.detected} (目标: ${targetLanguage})`)
      result.samples.forEach(sample => {
        const preview = typeof sample === 'string' ? sample.substring(0, 60) : sample
        console.log(`      - "${preview}${preview.length > 60 ? '...' : ''}"`)
      })
      if (!result.pass) allPass = false
    })

    console.log()
  })

  console.log(`${'='.repeat(100)}`)
  console.log(`${allPass ? '✅ 所有创意的语言都一致' : '❌ 有创意的语言不一致'}`)
  console.log(`${'='.repeat(100)}\n`)
}

// 验证 offer 236
verifyCreativeLanguageConsistency(236)
