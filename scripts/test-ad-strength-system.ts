/**
 * Ad Strength优化系统测试脚本
 *
 * 测试目标：
 * 1. 创意生成（优化Prompt）
 * 2. Ad Strength评估（5维度评分）
 * 3. 自动重试机制
 * 4. 评估结果验证
 */

import { generateAdCreative } from '../src/lib/ad-creative-generator'
import { evaluateAdStrength } from '../src/lib/ad-strength-evaluator'
import { getLanguageConfig, containsCTA, containsNumber, containsUrgency } from '../src/lib/ad-strength-i18n'
import { getDatabase } from '../src/lib/db'
import type { HeadlineAsset, DescriptionAsset } from '../src/lib/ad-creative'

const TEST_AFFILIATE_LINK = 'https://pboost.me/UKTs4I6'

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 Ad Strength优化系统测试')
  console.log('='.repeat(60))
  console.log('')

  try {
    const db = getDatabase()

    // 1. 查找或创建测试Offer
    console.log('📋 步骤1: 准备测试Offer')
    console.log('-'.repeat(40))

    let offer = db.prepare(
      `SELECT * FROM offers WHERE affiliate_link = ? LIMIT 1`
    ).get(TEST_AFFILIATE_LINK) as any

    if (!offer) {
      console.log('未找到测试Offer，创建新的...')
      const result = db.prepare(`
        INSERT INTO offers (
          user_id, url, affiliate_link, brand, target_country,
          brand_description, unique_selling_points, product_highlights, target_audience,
          scrape_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        1,
        TEST_AFFILIATE_LINK,
        TEST_AFFILIATE_LINK,
        'Premium Tech Store',
        'US',
        'Leading online retailer for premium electronics and tech gadgets',
        'Free shipping, 30-day returns, 24/7 customer support, Price match guarantee',
        'Latest smartphones, laptops, tablets, and accessories from top brands',
        'Tech enthusiasts and professionals looking for quality electronics',
        'completed'
      )

      offer = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(result.lastInsertRowid) as any
      console.log(`✅ 创建测试Offer: ID=${offer.id}`)
    } else {
      console.log(`✅ 找到测试Offer: ID=${offer.id}, Brand=${offer.brand}`)
    }

    console.log(`   - 品牌: ${offer.brand}`)
    console.log(`   - 目标国家: ${offer.target_country}`)
    console.log(`   - 推广链接: ${offer.affiliate_link}`)
    console.log('')

    // 2. 测试创意生成
    console.log('📝 步骤2: 生成广告创意（使用优化Prompt）')
    console.log('-'.repeat(40))

    const startTime = Date.now()
    const creative = await generateAdCreative(offer.id, 1, { skipCache: true })
    const generationTime = Date.now() - startTime

    console.log(`✅ 创意生成成功 (耗时: ${generationTime}ms)`)
    console.log(`   - Headlines: ${creative.headlines.length}个`)
    console.log(`   - Descriptions: ${creative.descriptions.length}个`)
    console.log(`   - Keywords: ${creative.keywords.length}个`)
    console.log(`   - 主题: ${creative.theme}`)
    console.log('')

    // 显示部分Headlines
    console.log('📌 Headlines示例:')
    creative.headlines.slice(0, 5).forEach((h, i) => {
      console.log(`   ${i + 1}. "${h}" (${h.length}字符)`)
    })
    console.log(`   ... 共${creative.headlines.length}个`)
    console.log('')

    // 显示Descriptions
    console.log('📌 Descriptions:')
    creative.descriptions.forEach((d, i) => {
      console.log(`   ${i + 1}. "${d.substring(0, 50)}..." (${d.length}字符)`)
    })
    console.log('')

    // 3. 准备评估数据
    console.log('📊 步骤3: Ad Strength评估')
    console.log('-'.repeat(40))

    // 转换为带metadata的格式
    const headlinesWithMetadata: HeadlineAsset[] = creative.headlinesWithMetadata ||
      creative.headlines.map(text => ({
        text,
        length: text.length,
        hasNumber: /\d/.test(text),
        hasUrgency: /limited|today|now|hurry|exclusive|only|sale/i.test(text)
      }))

    const descriptionsWithMetadata: DescriptionAsset[] = creative.descriptionsWithMetadata ||
      creative.descriptions.map(text => ({
        text,
        length: text.length,
        hasCTA: /shop|buy|get|order|learn|sign|try|start/i.test(text)
      }))

    // 4. 执行评估
    const evaluation = await evaluateAdStrength(
      headlinesWithMetadata,
      descriptionsWithMetadata,
      creative.keywords
    )

    console.log(`✅ 评估完成`)
    console.log('')
    console.log('🎯 评估结果:')
    console.log(`   总分: ${evaluation.overallScore}/100`)
    console.log(`   评级: ${evaluation.rating}`)
    console.log('')

    // 5维度详情
    console.log('📈 5维度评分:')
    console.log(`   1. Diversity (多样性):    ${evaluation.dimensions.diversity.score}/25`)
    console.log(`      - 类型分布: ${evaluation.dimensions.diversity.details.typeDistribution}`)
    console.log(`      - 长度梯度: ${evaluation.dimensions.diversity.details.lengthDistribution}`)
    console.log(`      - 文本独特性: ${evaluation.dimensions.diversity.details.textUniqueness}`)
    console.log('')
    console.log(`   2. Relevance (相关性):    ${evaluation.dimensions.relevance.score}/25`)
    console.log(`      - 关键词覆盖: ${evaluation.dimensions.relevance.details.keywordCoverage}`)
    console.log(`      - 关键词自然度: ${evaluation.dimensions.relevance.details.keywordNaturalness}`)
    console.log('')
    console.log(`   3. Completeness (完整性): ${evaluation.dimensions.completeness.score}/20`)
    console.log(`      - 资产数量: ${evaluation.dimensions.completeness.details.assetCount}`)
    console.log(`      - 字符合规: ${evaluation.dimensions.completeness.details.characterCompliance}`)
    console.log('')
    console.log(`   4. Quality (质量):        ${evaluation.dimensions.quality.score}/20`)
    console.log(`      - 数字使用: ${evaluation.dimensions.quality.details.numberUsage}`)
    console.log(`      - CTA存在: ${evaluation.dimensions.quality.details.ctaPresence}`)
    console.log(`      - 紧迫感: ${evaluation.dimensions.quality.details.urgencyExpression}`)
    console.log('')
    console.log(`   5. Compliance (合规性):   ${evaluation.dimensions.compliance.score}/10`)
    console.log(`      - 政策遵守: ${evaluation.dimensions.compliance.details.policyAdherence}`)
    console.log(`      - 无违规词: ${evaluation.dimensions.compliance.details.noSpamWords}`)
    console.log('')

    // 改进建议
    if (evaluation.suggestions.length > 0) {
      console.log('💡 改进建议:')
      evaluation.suggestions.forEach(suggestion => {
        console.log(`   ${suggestion}`)
      })
      console.log('')
    }

    // 5. 测试多语言支持
    console.log('🌍 步骤4: 多语言支持测试')
    console.log('-'.repeat(40))

    const langConfig = getLanguageConfig(offer.target_country)
    console.log(`   目标国家: ${offer.target_country}`)
    console.log(`   语言配置: ${langConfig.name} (${langConfig.code})`)
    console.log(`   最大Headline长度: ${langConfig.maxHeadlineLength}字符`)
    console.log(`   最大Description长度: ${langConfig.maxDescriptionLength}字符`)
    console.log('')

    // 测试CTA检测
    const ctaCount = creative.descriptions.filter(d => containsCTA(d, langConfig)).length
    const numberCount = creative.headlines.filter(h => containsNumber(h, langConfig)).length
    const urgencyCount = creative.headlines.filter(h => containsUrgency(h, langConfig)).length

    console.log('   资产特征分析:')
    console.log(`   - 包含CTA的Descriptions: ${ctaCount}/${creative.descriptions.length}`)
    console.log(`   - 包含数字的Headlines: ${numberCount}/${creative.headlines.length}`)
    console.log(`   - 包含紧迫感的Headlines: ${urgencyCount}/${creative.headlines.length}`)
    console.log('')

    // 6. 测试结果总结
    console.log('='.repeat(60))
    console.log('📋 测试结果总结')
    console.log('='.repeat(60))
    console.log('')

    const isExcellent = evaluation.rating === 'EXCELLENT'
    const isGood = evaluation.rating === 'GOOD'

    console.log(`🎯 Ad Strength评级: ${evaluation.rating}`)
    console.log(`📊 总分: ${evaluation.overallScore}/100`)
    console.log('')

    if (isExcellent) {
      console.log('✅ 测试通过！已达到Google Ads最高标准（EXCELLENT）')
    } else if (isGood) {
      console.log('⚠️ 测试通过！已达到GOOD标准，建议继续优化以达到EXCELLENT')
    } else {
      console.log('❌ 未达到预期标准，需要检查Prompt或评估算法')
    }

    console.log('')
    console.log('📌 关键指标:')
    console.log(`   - Headlines数量: ${creative.headlines.length >= 15 ? '✅' : '❌'} ${creative.headlines.length}/15`)
    console.log(`   - Descriptions数量: ${creative.descriptions.length >= 4 ? '✅' : '❌'} ${creative.descriptions.length}/4`)
    console.log(`   - 多样性得分: ${evaluation.dimensions.diversity.score >= 20 ? '✅' : '⚠️'} ${evaluation.dimensions.diversity.score}/25`)
    console.log(`   - 相关性得分: ${evaluation.dimensions.relevance.score >= 20 ? '✅' : '⚠️'} ${evaluation.dimensions.relevance.score}/25`)
    console.log(`   - 质量得分: ${evaluation.dimensions.quality.score >= 16 ? '✅' : '⚠️'} ${evaluation.dimensions.quality.score}/20`)
    console.log('')

    // 返回测试结果
    return {
      success: true,
      offerId: offer.id,
      rating: evaluation.rating,
      score: evaluation.overallScore,
      headlinesCount: creative.headlines.length,
      descriptionsCount: creative.descriptions.length,
      generationTime
    }

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message)
    console.error(error.stack)
    return {
      success: false,
      error: error.message
    }
  }
}

// 运行测试
main()
  .then(result => {
    console.log('')
    console.log('='.repeat(60))
    if (result.success) {
      console.log(`✅ 测试完成 - ${result.rating} (${result.score}分)`)
    } else {
      console.log(`❌ 测试失败 - ${result.error}`)
    }
    console.log('='.repeat(60))
    process.exit(result.success ? 0 : 1)
  })
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
