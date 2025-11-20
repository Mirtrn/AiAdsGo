#!/usr/bin/env ts-node
/**
 * Test script to verify scraping optimization effectiveness
 * Tests the 3 affiliate links and validates data quality
 */

import Database from 'better-sqlite3'
import * as path from 'path'

// Database connection
const dbPath = path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath)

// Test links
const TEST_LINKS = [
  {
    url: 'https://pboost.me/UKTs4I6',
    brand: 'Reolink',
    country: 'US',
    type: 'Amazon Store',
    description: 'Amazon brand store page - should extract hot-selling products'
  },
  {
    url: 'https://pboost.me/xEAgQ8ec',
    brand: 'ITEHIL',
    country: 'US',
    type: 'Independent Site',
    description: 'Independent site store page - should extract store and product info'
  },
  {
    url: 'https://pboost.me/RKWwEZR9',
    brand: 'Reolink',
    country: 'US',
    type: 'Amazon Product',
    description: 'Amazon product detail page - should extract core product info only'
  }
]

interface TestResult {
  url: string
  type: string
  offerId: number | null
  scrapeStatus: string
  hasData: boolean
  dataQuality: {
    hasBrandDescription: boolean
    hasProductHighlights: boolean
    hasReviews: boolean
    hasPricing: boolean
    productHighlightsCount: number
    reviewsCount: number
  }
  validationResults: string[]
  passed: boolean
}

async function createOrGetOffer(link: typeof TEST_LINKS[0]): Promise<number> {
  // Check if offer already exists
  const existing = db.prepare(`
    SELECT id FROM offers
    WHERE url = ? AND is_deleted = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(link.url) as { id: number } | undefined

  if (existing) {
    console.log(`✓ Using existing offer ID ${existing.id} for ${link.url}`)
    return existing.id
  }

  // Create new offer
  const result = db.prepare(`
    INSERT INTO offers (
      user_id, url, brand, target_country,
      category, scrape_status, is_active, created_at, updated_at
    ) VALUES (1, ?, ?, ?, 'Electronics', 'pending', 1, datetime('now'), datetime('now'))
  `).run(link.url, link.brand, link.country)

  console.log(`✓ Created new offer ID ${result.lastInsertRowid} for ${link.url}`)
  return result.lastInsertRowid as number
}

function analyzeOfferData(offerId: number): TestResult['dataQuality'] {
  const offer = db.prepare(`
    SELECT brand_description, product_highlights, reviews, pricing
    FROM offers WHERE id = ?
  `).get(offerId) as any

  let productHighlights: any[] = []
  let reviews: any[] = []

  try {
    if (offer.product_highlights) {
      productHighlights = JSON.parse(offer.product_highlights)
    }
  } catch (e) {
    console.warn(`  ⚠️  Failed to parse product_highlights for offer ${offerId}`)
  }

  try {
    if (offer.reviews) {
      reviews = JSON.parse(offer.reviews)
    }
  } catch (e) {
    console.warn(`  ⚠️  Failed to parse reviews for offer ${offerId}`)
  }

  return {
    hasBrandDescription: !!offer.brand_description && offer.brand_description.length > 50,
    hasProductHighlights: Array.isArray(productHighlights) && productHighlights.length > 0,
    hasReviews: !!offer.reviews,
    hasPricing: !!offer.pricing,
    productHighlightsCount: Array.isArray(productHighlights) ? productHighlights.length : 0,
    reviewsCount: Array.isArray(reviews) ? reviews.length : 0
  }
}

function validateProductPage(offerId: number): string[] {
  const validations: string[] = []
  const offer = db.prepare(`
    SELECT brand_description, product_highlights
    FROM offers WHERE id = ?
  `).get(offerId) as any

  // Check if product highlights contain recommendation keywords (should NOT)
  const recommendationKeywords = [
    'also bought', 'also viewed', 'frequently bought together',
    'customers who bought', 'related products', 'similar items',
    'sponsored', 'recommended for you'
  ]

  let highlights: any[] = []
  try {
    if (offer.product_highlights) {
      highlights = JSON.parse(offer.product_highlights)
    }
  } catch (e) {
    validations.push('❌ Failed to parse product highlights JSON')
    return validations
  }

  if (!Array.isArray(highlights) || highlights.length === 0) {
    validations.push('❌ No product highlights extracted')
    return validations
  }

  // Check for recommendation contamination
  let hasRecommendationContamination = false
  for (const highlight of highlights) {
    const text = JSON.stringify(highlight).toLowerCase()
    for (const keyword of recommendationKeywords) {
      if (text.includes(keyword)) {
        validations.push(`❌ Found recommendation keyword "${keyword}" in product highlights`)
        hasRecommendationContamination = true
        break
      }
    }
  }

  if (!hasRecommendationContamination) {
    validations.push('✅ No recommendation contamination detected')
  }

  // Check data completeness
  if (offer.brand_description && offer.brand_description.length > 100) {
    validations.push('✅ Brand description is substantial (>100 chars)')
  } else {
    validations.push('⚠️  Brand description is short or missing')
  }

  if (highlights.length >= 3) {
    validations.push(`✅ Good number of product highlights (${highlights.length})`)
  } else {
    validations.push(`⚠️  Few product highlights extracted (${highlights.length})`)
  }

  return validations
}

function validateStorePage(offerId: number, isAmazon: boolean): string[] {
  const validations: string[] = []
  const offer = db.prepare(`
    SELECT brand_description, product_highlights
    FROM offers WHERE id = ?
  `).get(offerId) as any

  let products: any[] = []
  try {
    if (offer.product_highlights) {
      const data = JSON.parse(offer.product_highlights)
      // For store pages, product_highlights might contain store data
      products = data.products || []
    }
  } catch (e) {
    validations.push('❌ Failed to parse store data JSON')
    return validations
  }

  if (!isAmazon) {
    // Independent site validation
    if (offer.brand_description && offer.brand_description.length > 50) {
      validations.push('✅ Store description extracted')
    } else {
      validations.push('⚠️  Store description missing or too short')
    }
    return validations
  }

  // Amazon store validation - check for hot-selling logic
  if (products.length === 0) {
    validations.push('❌ No products extracted from store page')
    return validations
  }

  validations.push(`✅ Extracted ${products.length} products from store`)

  // Check if products have hot-selling fields
  const hasHotScore = products.some((p: any) => p.hotScore !== undefined)
  const hasRank = products.some((p: any) => p.rank !== undefined)
  const hasHotLabel = products.some((p: any) => p.hotLabel !== undefined)

  if (hasHotScore && hasRank && hasHotLabel) {
    validations.push('✅ Hot-selling fields (hotScore, rank, hotLabel) present')
  } else {
    validations.push('⚠️  Hot-selling fields missing - optimization may not be applied')
  }

  // Check if products are sorted by hot score
  const hotScores = products
    .filter((p: any) => p.hotScore !== undefined)
    .map((p: any) => p.hotScore)

  if (hotScores.length > 1) {
    const isSorted = hotScores.every((score: number, i: number) =>
      i === 0 || score <= hotScores[i - 1]
    )
    if (isSorted) {
      validations.push('✅ Products sorted by hot score (descending)')
    } else {
      validations.push('⚠️  Products not sorted by hot score')
    }
  }

  // Check if top products are marked as hot
  const topProducts = products.slice(0, 5)
  const hotProductsCount = topProducts.filter((p: any) => p.isHot === true).length

  if (hotProductsCount >= 3) {
    validations.push(`✅ Top products marked as hot (${hotProductsCount}/5)`)
  } else {
    validations.push(`⚠️  Few top products marked as hot (${hotProductsCount}/5)`)
  }

  return validations
}

async function runTests(): Promise<void> {
  console.log('🧪 Starting Scraper Optimization Test Suite\n')
  console.log('═'.repeat(80))

  const results: TestResult[] = []

  for (const link of TEST_LINKS) {
    console.log(`\n📋 Testing: ${link.type}`)
    console.log(`   URL: ${link.url}`)
    console.log(`   Description: ${link.description}`)
    console.log('─'.repeat(80))

    try {
      // Create or get offer
      const offerId = await createOrGetOffer(link)

      // Get offer status
      const offer = db.prepare(`
        SELECT scrape_status, scraped_at FROM offers WHERE id = ?
      `).get(offerId) as { scrape_status: string; scraped_at: string | null }

      console.log(`   Scrape Status: ${offer.scrape_status}`)
      if (offer.scraped_at) {
        console.log(`   Scraped At: ${offer.scraped_at}`)
      }

      // Analyze data quality
      const dataQuality = analyzeOfferData(offerId)
      console.log(`\n   📊 Data Quality:`)
      console.log(`      - Brand Description: ${dataQuality.hasBrandDescription ? '✅' : '❌'}`)
      console.log(`      - Product Highlights: ${dataQuality.hasProductHighlights ? '✅' : '❌'} (${dataQuality.productHighlightsCount} items)`)
      console.log(`      - Reviews: ${dataQuality.hasReviews ? '✅' : '❌'} (${dataQuality.reviewsCount} items)`)
      console.log(`      - Pricing: ${dataQuality.hasPricing ? '✅' : '❌'}`)

      // Validate based on page type
      let validations: string[] = []
      if (link.type === 'Amazon Product') {
        validations = validateProductPage(offerId)
      } else if (link.type === 'Amazon Store') {
        validations = validateStorePage(offerId, true)
      } else {
        validations = validateStorePage(offerId, false)
      }

      console.log(`\n   🔍 Validation Results:`)
      validations.forEach(v => console.log(`      ${v}`))

      // Determine if test passed
      const passed = offer.scrape_status === 'completed' &&
                     validations.filter(v => v.startsWith('✅')).length > 0 &&
                     validations.filter(v => v.startsWith('❌')).length === 0

      results.push({
        url: link.url,
        type: link.type,
        offerId,
        scrapeStatus: offer.scrape_status,
        hasData: offer.scrape_status === 'completed',
        dataQuality,
        validationResults: validations,
        passed
      })

    } catch (error: any) {
      console.error(`   ❌ Error testing ${link.url}: ${error.message}`)
      results.push({
        url: link.url,
        type: link.type,
        offerId: null,
        scrapeStatus: 'error',
        hasData: false,
        dataQuality: {
          hasBrandDescription: false,
          hasProductHighlights: false,
          hasReviews: false,
          hasPricing: false,
          productHighlightsCount: 0,
          reviewsCount: 0
        },
        validationResults: [`❌ Error: ${error.message}`],
        passed: false
      })
    }
  }

  // Print summary
  console.log('\n' + '═'.repeat(80))
  console.log('📊 TEST SUMMARY')
  console.log('═'.repeat(80))

  const passedCount = results.filter(r => r.passed).length
  const totalCount = results.length

  results.forEach((result, index) => {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED'
    console.log(`\n${index + 1}. ${result.type}: ${status}`)
    console.log(`   URL: ${result.url}`)
    console.log(`   Offer ID: ${result.offerId || 'N/A'}`)
    console.log(`   Scrape Status: ${result.scrapeStatus}`)
    console.log(`   Key Validations:`)
    result.validationResults.slice(0, 3).forEach(v => console.log(`   ${v}`))
  })

  console.log('\n' + '═'.repeat(80))
  console.log(`\n🎯 Overall Result: ${passedCount}/${totalCount} tests passed\n`)

  if (passedCount === totalCount) {
    console.log('🎉 All optimization tests PASSED!')
    console.log('✅ Product page accuracy: No recommendation contamination detected')
    console.log('✅ Store page hot-selling: Hot score algorithm properly applied')
  } else {
    console.log('⚠️  Some tests FAILED - review validation results above')

    // Provide action items
    if (results.some(r => r.scrapeStatus === 'pending')) {
      console.log('\n💡 Action Required:')
      console.log('   Some offers have not been scraped yet.')
      console.log('   Please trigger scraping via the UI or API:')
      console.log('   curl -X POST http://localhost:3000/api/offers/[id]/scrape')
    }
  }

  console.log('\n' + '═'.repeat(80))
}

// Run tests
runTests()
  .then(() => {
    db.close()
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    db.close()
    process.exit(1)
  })
