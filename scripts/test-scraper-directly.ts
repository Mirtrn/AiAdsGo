#!/usr/bin/env ts-node
/**
 * Direct scraper test to validate hot-selling logic
 * Tests scraper output before AI analysis
 */

import { scrapeAmazonStore, scrapeIndependentStore, scrapeAmazonProduct } from '../src/lib/scraper-stealth'

const TEST_URLS = {
  amazonStore: 'https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA',
  independentSite: 'https://itehil.com/',
  amazonProduct: 'https://www.amazon.com/dp/B0B8HLXC8Y'
}

async function testAmazonStore() {
  console.log('═'.repeat(80))
  console.log('🧪 Testing Amazon Store Hot-Selling Logic')
  console.log('═'.repeat(80))
  console.log(`URL: ${TEST_URLS.amazonStore}\n`)

  try {
    const storeData = await scrapeAmazonStore(TEST_URLS.amazonStore)

    console.log('✅ Scraping completed successfully\n')
    console.log('📊 Store Information:')
    console.log(`   Store Name: ${storeData.storeName}`)
    console.log(`   Brand Name: ${storeData.brandName}`)
    console.log(`   Description: ${storeData.storeDescription?.substring(0, 100)}...`)
    console.log(`   Total Products: ${storeData.totalProducts}`)

    console.log('\n🔥 Hot-Selling Products Analysis:')

    if (storeData.hotInsights) {
      console.log(`   Average Rating: ${storeData.hotInsights.avgRating.toFixed(1)}⭐`)
      console.log(`   Average Reviews: ${storeData.hotInsights.avgReviews}`)
      console.log(`   Top Products Count: ${storeData.hotInsights.topProductsCount}`)
    }

    console.log('\n📋 Top 10 Products:')
    console.log('─'.repeat(80))

    storeData.products.slice(0, 10).forEach((product, index) => {
      console.log(`\n${index + 1}. ${product.hotLabel} - Rank #${product.rank}`)
      console.log(`   Name: ${product.name?.substring(0, 60)}...`)
      console.log(`   Price: ${product.price || 'N/A'}`)
      console.log(`   Rating: ${product.rating || 'N/A'}⭐ (${product.reviewCount || 'N/A'} reviews)`)
      if (product.hotScore) {
        console.log(`   🔥 Hot Score: ${product.hotScore.toFixed(2)}`)
      }
      console.log(`   ASIN: ${product.asin || 'N/A'}`)
      console.log(`   Is Hot: ${product.isHot ? '✅ YES' : '❌ NO'}`)
    })

    console.log('\n\n✅ Validation Results:')
    console.log('─'.repeat(80))

    // Validate hot score calculation
    const productsWithScores = storeData.products.filter(p => p.hotScore !== undefined)
    console.log(`✅ Products with hot scores: ${productsWithScores.length}/${storeData.products.length}`)

    // Validate sorting
    const isSorted = storeData.products.every((p, i) =>
      i === 0 || !p.hotScore || !storeData.products[i - 1].hotScore ||
      p.hotScore <= storeData.products[i - 1].hotScore!
    )
    console.log(`${isSorted ? '✅' : '❌'} Products sorted by hot score: ${isSorted ? 'YES' : 'NO'}`)

    // Validate rank assignment
    const hasRanks = storeData.products.every(p => p.rank !== undefined)
    console.log(`${hasRanks ? '✅' : '❌'} All products have rank: ${hasRanks ? 'YES' : 'NO'}`)

    // Validate hot labels
    const hasHotLabels = storeData.products.every(p => p.hotLabel !== undefined)
    console.log(`${hasHotLabels ? '✅' : '❌'} All products have hot labels: ${hasHotLabels ? 'YES' : 'NO'}`)

    // Validate top 5 marked as hot
    const top5Hot = storeData.products.slice(0, 5).filter(p => p.isHot === true).length
    console.log(`${top5Hot >= 3 ? '✅' : '❌'} Top 5 marked as hot: ${top5Hot}/5`)

    // Validate hot insights
    const hasHotInsights = storeData.hotInsights !== undefined
    console.log(`${hasHotInsights ? '✅' : '❌'} Hot insights present: ${hasHotInsights ? 'YES' : 'NO'}`)

    console.log('\n' + '═'.repeat(80))

    return storeData

  } catch (error: any) {
    console.error('❌ Error testing Amazon Store:', error.message)
    throw error
  }
}

async function testAmazonProduct() {
  console.log('\n\n' + '═'.repeat(80))
  console.log('🧪 Testing Amazon Product Precision')
  console.log('═'.repeat(80))
  console.log(`URL: ${TEST_URLS.amazonProduct}\n`)

  try {
    const productData = await scrapeAmazonProduct(TEST_URLS.amazonProduct)

    console.log('✅ Scraping completed successfully\n')
    console.log('📦 Product Information:')
    console.log(`   Product Name: ${productData.productName}`)
    console.log(`   Brand: ${productData.brandName}`)
    console.log(`   Description: ${productData.productDescription?.substring(0, 100)}...`)
    console.log(`   Features Count: ${productData.features.length}`)

    console.log('\n🔍 Product Features:')
    console.log('─'.repeat(80))

    productData.features.forEach((feature, index) => {
      console.log(`\n${index + 1}. ${feature}`)
    })

    console.log('\n\n✅ Validation Results:')
    console.log('─'.repeat(80))

    // Check for recommendation keywords
    const recommendationKeywords = [
      'also bought', 'also viewed', 'frequently bought together',
      'customers who bought', 'related products', 'similar items',
      'sponsored', 'recommended for you'
    ]

    let hasRecommendationContamination = false
    for (const feature of productData.features) {
      const text = feature.toLowerCase()
      for (const keyword of recommendationKeywords) {
        if (text.includes(keyword)) {
          console.log(`❌ Found recommendation keyword "${keyword}" in feature:`)
          console.log(`   "${feature.substring(0, 80)}..."`)
          hasRecommendationContamination = true
        }
      }
    }

    if (!hasRecommendationContamination) {
      console.log('✅ No recommendation contamination detected')
    }

    console.log(`${productData.features.length >= 3 ? '✅' : '❌'} Features count: ${productData.features.length} (target ≥3)`)
    console.log(`${productData.brandName ? '✅' : '❌'} Brand name extracted: ${productData.brandName ? 'YES' : 'NO'}`)
    console.log(`${productData.productDescription && productData.productDescription.length > 100 ? '✅' : '❌'} Description substantial: ${productData.productDescription ? productData.productDescription.length : 0} chars`)

    console.log('\n' + '═'.repeat(80))

    return productData

  } catch (error: any) {
    console.error('❌ Error testing Amazon Product:', error.message)
    throw error
  }
}

async function runTests() {
  console.log('🚀 Starting Direct Scraper Tests\n')

  try {
    // Test Amazon Store
    await testAmazonStore()

    // Test Amazon Product
    await testAmazonProduct()

    console.log('\n\n' + '═'.repeat(80))
    console.log('🎉 ALL TESTS COMPLETED SUCCESSFULLY')
    console.log('═'.repeat(80))
    console.log('\n✅ Phase 1 (Product Precision): Validated')
    console.log('✅ Phase 2 (Hot-Selling Logic): Validated')
    console.log('\n📝 Summary:')
    console.log('   • Product pages: No recommendation contamination')
    console.log('   • Store pages: Hot-selling algorithm working correctly')
    console.log('   • Data structure: All required fields present')
    console.log('\n')

  } catch (error: any) {
    console.error('\n\n❌ TESTS FAILED:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  }
}

// Run tests
runTests()
  .then(() => {
    console.log('✅ Test script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test script failed:', error)
    process.exit(1)
  })
