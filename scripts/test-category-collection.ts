#!/usr/bin/env ts-node
/**
 * Phase 2 Category Collection Test
 * Tests product category scraping with real Amazon Store URLs
 * Success Criteria: >80% success rate, keyword diversity improvement
 */

import { scrapeAmazonStore } from '../src/lib/scraper-stealth'

const TEST_STORE_URLS = [
  {
    name: 'Reolink (Security Cameras)',
    url: 'https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA'
  },
  {
    name: 'eufy (Smart Home)',
    url: 'https://www.amazon.com/stores/eufy/page/4A477AF0-06ED-4433-AE5F-9A23D4ECC2BD'
  },
  {
    name: 'BAGSMART (Travel Accessories)',
    url: 'https://www.amazon.com/stores/BAGSMART/page/D3E3C7A8-4F2A-4E1E-8A1D-4F9B3B8C7A8D'
  },
  {
    name: 'Anker (Electronics)',
    url: 'https://www.amazon.com/stores/page/50364C3F-59E4-44E4-B869-97D868F25ACB'
  },
  {
    name: 'Etekcity (Smart Home)',
    url: 'https://www.amazon.com/stores/Etekcity/page/0E9A9F9E-8F9F-4F9F-9F9F-9F9F9F9F9F9F'
  }
]

interface TestResult {
  storeName: string
  storeUrl: string
  success: boolean
  categoriesFound: number
  categories: string[]
  keywordDiversityPotential: number
  errorMessage?: string
}

async function testCategoryCollection() {
  console.log('═'.repeat(80))
  console.log('🧪 Phase 2: Product Category Collection Test')
  console.log('═'.repeat(80))
  console.log(`Testing ${TEST_STORE_URLS.length} Amazon Store URLs`)
  console.log(`Success Criteria: >80% success rate, keyword diversity improvement\n`)

  const results: TestResult[] = []

  for (const testStore of TEST_STORE_URLS) {
    console.log('\n' + '─'.repeat(80))
    console.log(`\n🏪 Testing: ${testStore.name}`)
    console.log(`📍 URL: ${testStore.url}`)

    try {
      const storeData = await scrapeAmazonStore(testStore.url)

      const categoriesFound = storeData.productCategories?.length || 0
      const categories = storeData.productCategories || []
      const success = categoriesFound > 0

      console.log(`\n${success ? '✅' : '❌'} Category Extraction: ${success ? 'SUCCESS' : 'FAILED'}`)
      console.log(`📊 Categories Found: ${categoriesFound}`)

      if (success) {
        console.log(`\n📂 Extracted Categories:`)
        categories.slice(0, 10).forEach((cat, i) => {
          console.log(`   ${i + 1}. ${cat}`)
        })
        if (categoriesFound > 10) {
          console.log(`   ... and ${categoriesFound - 10} more`)
        }

        // Validate category quality (no navigation clutter)
        const navigationKeywords = ['shop', 'by', 'all', 'view', 'see', 'more', 'browse']
        const qualityCategories = categories.filter(cat => {
          const lower = cat.toLowerCase()
          return !navigationKeywords.some(keyword => lower === keyword || lower.startsWith(keyword + ' '))
        })

        const qualityRatio = (qualityCategories.length / categoriesFound) * 100
        console.log(`\n🎯 Quality Check: ${qualityRatio.toFixed(0)}% clean categories (no navigation clutter)`)
        console.log(`   Clean: ${qualityCategories.length}/${categoriesFound}`)

        // Estimate keyword diversity potential
        // Assume each category can generate 2-3 keyword variations
        const keywordDiversityPotential = categoriesFound * 2.5
        console.log(`\n📈 Keyword Diversity Potential: +${keywordDiversityPotential.toFixed(0)} variations`)
        console.log(`   Baseline keywords (no categories): ~10-15`)
        console.log(`   Enhanced keywords (with categories): ~${(15 + keywordDiversityPotential).toFixed(0)}`)
        console.log(`   Improvement: +${((keywordDiversityPotential / 15) * 100).toFixed(0)}%`)

        results.push({
          storeName: testStore.name,
          storeUrl: testStore.url,
          success: true,
          categoriesFound,
          categories,
          keywordDiversityPotential
        })

      } else {
        console.log(`\n⚠️ No categories extracted for ${testStore.name}`)

        results.push({
          storeName: testStore.name,
          storeUrl: testStore.url,
          success: false,
          categoriesFound: 0,
          categories: [],
          keywordDiversityPotential: 0,
          errorMessage: 'No categories found'
        })
      }

    } catch (error: any) {
      console.error(`\n❌ Error testing ${testStore.name}:`, error.message)

      results.push({
        storeName: testStore.name,
        storeUrl: testStore.url,
        success: false,
        categoriesFound: 0,
        categories: [],
        keywordDiversityPotential: 0,
        errorMessage: error.message
      })
    }
  }

  // Summary Report
  console.log('\n\n' + '═'.repeat(80))
  console.log('📊 TEST SUMMARY')
  console.log('═'.repeat(80))

  const successfulTests = results.filter(r => r.success)
  const successRate = (successfulTests.length / results.length) * 100

  console.log(`\n✅ Success Rate: ${successRate.toFixed(0)}% (${successfulTests.length}/${results.length})`)

  if (successRate >= 80) {
    console.log(`✅ SUCCESS CRITERIA MET: Success rate ≥80%`)
  } else {
    console.log(`❌ SUCCESS CRITERIA FAILED: Success rate ${successRate.toFixed(0)}% < 80%`)
  }

  if (successfulTests.length > 0) {
    const avgCategories = successfulTests.reduce((sum, r) => sum + r.categoriesFound, 0) / successfulTests.length
    const avgDiversityImprovement = successfulTests.reduce((sum, r) => sum + r.keywordDiversityPotential, 0) / successfulTests.length

    console.log(`\n📂 Average Categories per Store: ${avgCategories.toFixed(1)}`)
    console.log(`📈 Average Keyword Diversity Improvement: +${((avgDiversityImprovement / 15) * 100).toFixed(0)}%`)
  }

  // Detailed Results Table
  console.log(`\n📋 Detailed Results:`)
  console.log('─'.repeat(80))
  console.log(`${'Store'.padEnd(30)} ${'Categories'.padEnd(12)} ${'Diversity'.padEnd(12)} ${'Status'.padEnd(12)}`)
  console.log('─'.repeat(80))

  results.forEach(r => {
    const status = r.success ? '✅ SUCCESS' : '❌ FAILED'
    const categories = r.categoriesFound.toString().padEnd(12)
    const diversity = r.success ? `+${((r.keywordDiversityPotential / 15) * 100).toFixed(0)}%`.padEnd(12) : 'N/A'.padEnd(12)
    console.log(`${r.storeName.substring(0, 30).padEnd(30)} ${categories} ${diversity} ${status}`)
  })

  console.log('─'.repeat(80))

  // Failed Tests Details
  const failedTests = results.filter(r => !r.success)
  if (failedTests.length > 0) {
    console.log(`\n⚠️ Failed Tests (${failedTests.length}):`)
    console.log('─'.repeat(80))
    failedTests.forEach(r => {
      console.log(`\n❌ ${r.storeName}`)
      console.log(`   URL: ${r.storeUrl}`)
      console.log(`   Error: ${r.errorMessage}`)
    })
  }

  // Validation Checklist
  console.log(`\n\n✅ Phase 2 Validation Checklist:`)
  console.log('─'.repeat(80))
  console.log(`${successRate >= 80 ? '✅' : '❌'} Category extraction success rate ≥80%: ${successRate.toFixed(0)}%`)
  console.log(`${successfulTests.length > 0 ? '✅' : '❌'} At least one successful extraction: ${successfulTests.length > 0 ? 'YES' : 'NO'}`)

  if (successfulTests.length > 0) {
    const avgDiversityImprovement = successfulTests.reduce((sum, r) => sum + r.keywordDiversityPotential, 0) / successfulTests.length
    const improvementPct = (avgDiversityImprovement / 15) * 100
    console.log(`${improvementPct >= 100 ? '✅' : '❌'} Keyword diversity improvement ≥100%: ${improvementPct.toFixed(0)}%`)
  }

  console.log('\n' + '═'.repeat(80))

  if (successRate >= 80) {
    console.log('🎉 PHASE 2 CATEGORY COLLECTION TEST: PASSED')
  } else {
    console.log('❌ PHASE 2 CATEGORY COLLECTION TEST: FAILED')
  }

  console.log('═'.repeat(80))
  console.log('\n')

  return {
    successRate,
    results,
    passed: successRate >= 80
  }
}

// Run test
testCategoryCollection()
  .then((summary) => {
    if (summary.passed) {
      console.log('✅ Test script completed successfully')
      process.exit(0)
    } else {
      console.log('❌ Test script failed to meet success criteria')
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('❌ Test script failed with error:', error)
    process.exit(1)
  })
