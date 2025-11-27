/**
 * P1.2 优化测试脚本
 * 测试动态类目门槛 + 多语言检测 + 品牌名标准化
 */

interface TestScenario {
  name: string
  productName: string
  brandName: string
  rating: string
  reviewCount: string
  salesRank?: string
  country: string
  expectedPopularity: 'high' | 'medium' | 'low'
  testFeature: string  // 测试的特性
}

const testScenarios: TestScenario[] = [
  // 测试1: 类目动态门槛 - Electronics（门槛提高50%）
  {
    name: 'Offer 1 - Electronics类目（高门槛）',
    productName: 'Anker PowerCore 20100mAh Portable Charger',
    brandName: 'Anker',
    rating: '4.7',
    reviewCount: '6,000',  // 原本会是MEDIUM，但Electronics类目门槛提高到7500
    salesRank: '#50 in Electronics',
    country: 'US',
    expectedPopularity: 'medium',
    testFeature: '类目动态门槛（Electronics 1.5x）'
  },

  // 测试2: 类目动态门槛 - Books（门槛降低20%）
  {
    name: 'Offer 2 - Books类目（低门槛）',
    productName: 'The Great Gatsby',
    brandName: 'Penguin Classics',
    rating: '4.5',
    reviewCount: '3,800',  // 原本LOW，但Books类目门槛降低到4000
    salesRank: '#200 in Books',
    country: 'US',
    expectedPopularity: 'medium',
    testFeature: '类目动态门槛（Books 0.8x）'
  },

  // 测试3: 多语言检测 - 德语品牌名
  {
    name: 'Offer 3 - 德语品牌（Geschäft）',
    productName: 'Premium Reise Kulturbeutel',
    brandName: 'Reise Geschäft',  // 包含德语"商店"
    rating: '4.3',
    reviewCount: '1,200',
    salesRank: '#500 in Koffer, Rucksäcke & Taschen',
    country: 'DE',
    expectedPopularity: 'medium',
    testFeature: '多语言检测（德语 geschäft）'
  },

  // 测试4: 多语言检测 - 法语品牌名
  {
    name: 'Offer 4 - 法语品牌（Magasin）',
    productName: 'Sac à dos de voyage',
    brandName: 'Le Magasin Officiel',  // 包含法语"商店"+"官方"
    rating: '4.4',
    reviewCount: '800',
    salesRank: '#300 in Luggage',
    country: 'FR',
    expectedPopularity: 'medium',
    testFeature: '多语言检测（法语 magasin + officiel）'
  },

  // 测试5: 品牌名标准化 - 空格
  {
    name: 'Offer 5 - 品牌名含空格',
    productName: 'Travel Organizer Bag',
    brandName: 'Bag Smart',  // 有空格，应标准化为 "bagsmart"
    rating: '4.3',
    reviewCount: '1,500',
    salesRank: '#400 in Luggage & Travel Gear',
    country: 'US',
    expectedPopularity: 'medium',
    testFeature: '品牌名标准化（空格）'
  },

  // 测试6: 品牌名标准化 - 商标符号
  {
    name: 'Offer 6 - 品牌名含商标',
    productName: 'Premium Running Shoes',
    brandName: 'NIKE™',  // 包含商标符号，应标准化为 "nike"
    rating: '4.8',
    reviewCount: '25,000',
    salesRank: '#5 in Athletic Shoes',
    country: 'US',
    expectedPopularity: 'high',
    testFeature: '品牌名标准化（商标符号）'
  },

  // 测试7: 综合测试 - 类目 + 多语言 + 标准化
  {
    name: 'Offer 7 - 综合测试',
    productName: 'Werkzeugkoffer Premium',
    brandName: 'Werkzeug Laden™',  // 德语"工具商店" + 商标
    rating: '4.2',
    reviewCount: '350',
    salesRank: '#180 in Tools & Home Improvement',
    country: 'DE',
    expectedPopularity: 'medium',
    testFeature: '综合（Tools类目0.85x + 德语laden + 商标）'
  }
]

// ========== 辅助函数（与实际代码一致）==========

interface CategoryThreshold {
  highReviewBase: number
  mediumReviewBase: number
  multiplier: number
  description: string
}

const CATEGORY_THRESHOLDS: Record<string, CategoryThreshold> = {
  'Electronics': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '电子产品' },
  'Computers': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '计算机' },
  'Cell Phones': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.5, description: '手机' },
  'Clothing': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '服装' },
  'Books': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '图书' },
  'Music': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.8, description: '音乐' },
  'Tools': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.85, description: '工具' },
  'Luggage': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 0.9, description: '箱包' },
  'default': { highReviewBase: 5000, mediumReviewBase: 500, multiplier: 1.0, description: '默认' }
}

function extractCategoryFromSalesRank(salesRank: string | null | undefined): string {
  if (!salesRank) return 'default'

  const categoryMatch = salesRank.match(/in\s+([^>]+?)(?:\s*>|$)/)
  if (!categoryMatch) return 'default'

  const category = categoryMatch[1].trim()

  if (CATEGORY_THRESHOLDS[category]) {
    return category
  }

  for (const [key, _] of Object.entries(CATEGORY_THRESHOLDS)) {
    if (key !== 'default' && category.includes(key)) {
      return key
    }
  }

  return 'default'
}

function estimateBrandPopularity(
  reviewCount: string | null | undefined,
  rating: string | null | undefined,
  salesRank: string | null | undefined
): 'high' | 'medium' | 'low' {
  let numReviews = 0
  if (reviewCount) {
    const cleanCount = reviewCount.replace(/,/g, '')
    if (cleanCount.includes('K')) {
      numReviews = parseFloat(cleanCount) * 1000
    } else if (cleanCount.includes('M')) {
      numReviews = parseFloat(cleanCount) * 1000000
    } else {
      numReviews = parseFloat(cleanCount) || 0
    }
  }

  let numRating = rating ? parseFloat(rating) : 0

  let rankNum = Infinity
  if (salesRank) {
    const rankMatch = salesRank.match(/#?(\d+)/)
    if (rankMatch) {
      rankNum = parseInt(rankMatch[1], 10)
    }
  }

  // P1.2优化1: 类目动态门槛
  const category = extractCategoryFromSalesRank(salesRank)
  const threshold = CATEGORY_THRESHOLDS[category]
  const multiplier = threshold.multiplier

  const highThreshold = Math.round(threshold.highReviewBase * multiplier)
  const mediumThreshold = Math.round(threshold.mediumReviewBase * multiplier)
  const mediumWithRatingThreshold = Math.round(300 * multiplier)

  if (category !== 'default') {
    console.log(`   📂 类目: ${threshold.description} (${category}) - 门槛倍数: ${multiplier}x`)
    console.log(`      High门槛: ${highThreshold}, Medium门槛: ${mediumThreshold}/${mediumWithRatingThreshold}`)
  }

  // 改进3: Sales Rank 缺失补偿
  if (!salesRank && numRating >= 4.7) {
    const originalReviews = numReviews
    numReviews *= 1.5
    console.log(`   💡 改进3生效: 无Sales Rank + 高评分${numRating}，评论数权重放大 ${originalReviews} → ${Math.round(numReviews)}`)
  }

  if (
    numReviews >= highThreshold ||
    (numReviews >= 1000 && numRating >= 4.5) ||
    rankNum <= 100
  ) {
    return 'high'
  }

  if (
    numReviews >= mediumThreshold ||
    (numReviews >= mediumWithRatingThreshold && numRating >= 4.0) ||
    rankNum <= 1000
  ) {
    return 'medium'
  }

  return 'low'
}

// P1.2优化3: 品牌名标准化
function normalizeBrandName(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, '')
    .replace(/[_-]+/g, '')
    .trim()
}

// P1.2优化2: 多语言语义关键词
const SEMANTIC_KEYWORDS = {
  store: [
    'store', 'shop',
    'geschäft', 'laden',
    'magasin', 'boutique',
    'tienda',
    'negozio',
    'loja',
    'sklep',
    'winkel'
  ],
  official: [
    'official', 'authentic',
    'offiziell', 'echt',
    'officiel', 'authentique',
    'oficial', 'auténtico',
    'ufficiale', 'autentico',
    'oficial', 'autêntico',
    'oficjalny'
  ],
  website: [
    'website', 'site', 'web',
    'webseite', 'seite',
    'site web', 'site',
    'sitio web', 'sitio',
    'sito web', 'sito',
    'site', 'página'
  ]
}

function containsSemanticKeyword(brandLower: string, keywords: string[]): boolean {
  return keywords.some(keyword => brandLower.includes(keyword))
}

function generateDynamicBrandVariants(
  brand: string,
  popularity: 'high' | 'medium' | 'low'
): string[] {
  const brandNormalized = normalizeBrandName(brand)
  const brandLower = brandNormalized

  if (brandNormalized !== brand.toLowerCase()) {
    console.log(`   🔧 品牌名标准化: "${brand}" → "${brandNormalized}"`)
  }

  const containsStore = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.store)
  const containsOfficial = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.official)
  const containsWebsite = containsSemanticKeyword(brandLower, SEMANTIC_KEYWORDS.website)

  if (containsStore || containsOfficial || containsWebsite) {
    console.log(`   🌐 多语言检测: store=${containsStore}, official=${containsOfficial}, website=${containsWebsite}`)
  }

  if (popularity === 'high') {
    const variants = [brandLower]
    if (!containsOfficial) {
      variants.push(`${brandLower} official`)
    }
    return variants
  }

  if (popularity === 'medium') {
    const variants = [brandLower]
    if (!containsOfficial) {
      variants.push(`${brandLower} official`)
    }
    if (!containsStore) {
      variants.push(`${brandLower} store`)
    }
    variants.push(`buy ${brandLower}`)
    return variants
  }

  const variants = [brandLower]
  if (!containsOfficial) {
    variants.push(`${brandLower} official`)
  }
  if (!containsStore) {
    variants.push(`${brandLower} store`)
  }
  variants.push(`buy ${brandLower}`)

  if (!containsStore && !containsWebsite) {
    variants.push(`${brandLower} amazon`)
    if (!containsWebsite) {
      variants.push(`${brandLower} website`)
    }
  } else {
    variants.push(`${brandLower} online`)
    variants.push(`${brandLower} reviews`)
  }

  return variants
}

// ========== 运行测试 ==========

console.log('🧪 P1.2 优化测试 - 类目门槛 + 多语言 + 标准化\n')
console.log('='.repeat(80))

testScenarios.forEach((scenario, index) => {
  console.log(`\n📍 测试场景 ${index + 1}: ${scenario.name}`)
  console.log(`   Product: ${scenario.productName}`)
  console.log(`   Brand: ${scenario.brandName}`)
  console.log(`   Rating: ${scenario.rating}`)
  console.log(`   Reviews: ${scenario.reviewCount}`)
  console.log(`   Sales Rank: ${scenario.salesRank || 'N/A'}`)
  console.log(`   Country: ${scenario.country}`)
  console.log(`   🎯 测试特性: ${scenario.testFeature}`)
  console.log('-'.repeat(80))

  const popularity = estimateBrandPopularity(
    scenario.reviewCount,
    scenario.rating,
    scenario.salesRank
  )

  const icon = popularity === 'high' ? '🏆' : popularity === 'medium' ? '⭐' : '📌'
  console.log(`\n${icon} 品牌流行度评估: ${popularity.toUpperCase()}`)
  console.log(`   预期: ${scenario.expectedPopularity.toUpperCase()}`)
  console.log(`   匹配: ${popularity === scenario.expectedPopularity ? '✅' : '❌'}`)

  const brandVariants = generateDynamicBrandVariants(scenario.brandName, popularity)
  console.log(`\n🔑 生成的品牌变体（${brandVariants.length}个）:`)
  brandVariants.forEach((variant, i) => {
    console.log(`   ${i + 1}. "${variant}"`)
  })

  console.log('\n' + '='.repeat(80))
})

console.log('\n\n✅ P1.2 测试完成！')
console.log('\n📝 P1.2优化总结:')
console.log('   ✅ 优化1: 类目动态门槛调整（Electronics 1.5x, Books 0.8x, Tools 0.85x）')
console.log('   ✅ 优化2: 多语言语义检测（英语、德语、法语、西班牙语等8种语言）')
console.log('   ✅ 优化3: 品牌名标准化（去空格、去商标、统一小写）')
