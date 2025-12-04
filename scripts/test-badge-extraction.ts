/**
 * Test script for P3 Badge Extraction Validation
 *
 * Validates badge extraction logic with test HTML samples
 * Target: ≥95% accuracy
 */

interface BadgeTestCase {
  name: string
  html: string
  expected: string | null
  category: 'amazons_choice' | 'best_seller' | 'generic' | 'none'
}

const testCases: BadgeTestCase[] = [
  // Amazon's Choice badges
  {
    name: 'Amazon\'s Choice - Standard Format',
    html: '<div class="ac-badge-wrapper"><span class="ac-badge-text-primary">Amazon\'s Choice</span></div>',
    expected: 'Amazon\'s Choice',
    category: 'amazons_choice'
  },
  {
    name: 'Amazon\'s Choice - With Category',
    html: '<span class="a-badge-text">Amazon\'s Choice for security cameras</span>',
    expected: 'Amazon\'s Choice',
    category: 'amazons_choice'
  },
  {
    name: 'Amazon\'s Choice - Data Attribute',
    html: '<div data-a-badge-color="sx-gulfstream"><span class="a-badge-text">Amazon\'s Choice</span></div>',
    expected: 'Amazon\'s Choice',
    category: 'amazons_choice'
  },

  // Best Seller badges
  {
    name: 'Best Seller - With Rank',
    html: '<div id="zeitgeist-module"><span class="a-badge-text">#1 Best Seller in Electronics</span></div>',
    expected: '#1 Best Seller',
    category: 'best_seller'
  },
  {
    name: 'Best Seller - Generic',
    html: '<div class="badge-wrapper"><span class="badge-text">Best Seller</span></div>',
    expected: 'Best Seller',
    category: 'best_seller'
  },
  {
    name: 'Best Seller - Rank #2',
    html: '<span>#2 Best Seller in Home & Kitchen</span>',
    expected: '#2 Best Seller',
    category: 'best_seller'
  },

  // Generic badges (valid)
  {
    name: 'Generic Badge - Short',
    html: '<span class="a-badge-text">Editor\'s Pick</span>',
    expected: 'Editor\'s Pick',
    category: 'generic'
  },
  {
    name: 'Generic Badge - Exactly 25 chars',
    html: '<span class="a-badge-text">Premium Quality Product</span>',
    expected: 'Premium Quality Product',  // 23 chars, valid
    category: 'generic'
  },

  // Edge cases - should return null
  {
    name: 'No Badge - Empty HTML',
    html: '<div class="product-title">Product Name</div>',
    expected: null,
    category: 'none'
  },
  {
    name: 'Too Long Badge - Should Reject',
    html: '<span class="a-badge-text">This is a very long badge text that exceeds 25 characters</span>',
    expected: null,
    category: 'none'
  },
  {
    name: 'Badge with Category - Should Strip',
    html: '<span class="a-badge-text">#1 Best Seller in Electronics & Computers</span>',
    expected: '#1 Best Seller',  // Should strip " in Electronics & Computers"
    category: 'best_seller'
  }
]

// Simulate jQuery-like selector functions
function createJQueryMock(html: string) {
  return (selector: string) => {
    const mockElement = {
      text: () => {
        // Simplified extraction for test - just get text content
        const match = html.match(/>([^<]+)</)
        return match ? match[1] : ''
      },
      trim: () => mockElement.text().trim(),
      length: html.includes(selector.replace(/[.#]/g, '')) ? 1 : 0
    }

    const result = {
      text: () => {
        const text = mockElement.text()
        return text
      },
      trim: () => result.text().trim(),
      first: () => result,
      length: mockElement.length
    }

    return result
  }
}

// Badge extraction logic (copied from scraper-stealth.ts)
function extractBadge(html: string): string | null {
  const $ = createJQueryMock(html) as any

  let badge: string | null = null

  // Strategy 1: Amazon's Choice badge
  const amazonChoiceBadge = $('.ac-badge-wrapper .ac-badge-text-primary').text().trim() ||
                            $('span.a-badge-text:contains("Amazon\'s Choice")').text().trim() ||
                            $('[data-a-badge-color="sx-gulfstream"] span.a-badge-text').text().trim()

  // Strategy 2: Best Seller badge
  const bestSellerBadge = $('#zeitgeist-module .a-badge-text').text().trim() ||
                          $('.badge-wrapper .badge-text:contains("Best Seller")').text().trim() ||
                          $('span:contains("#1 Best Seller")').text().trim()

  // Strategy 3: Generic badge detection
  const genericBadge = $('.a-badge-text').text().trim() ||
                       $('i.a-icon-addon-badge').parent().text().trim()

  // Priority: Amazon's Choice > Best Seller > Generic
  if (amazonChoiceBadge && amazonChoiceBadge.includes("Amazon's Choice")) {
    badge = "Amazon's Choice"
  } else if (bestSellerBadge) {
    // Normalize Best Seller badge text
    if (bestSellerBadge.match(/#\d+\s+Best Seller/i)) {
      const match = bestSellerBadge.match(/(#\d+\s+Best Seller)/i)
      badge = match ? match[1] : "Best Seller"
    } else if (bestSellerBadge.toLowerCase().includes('best seller')) {
      badge = "Best Seller"
    }
  } else if (genericBadge && genericBadge.length > 0 && genericBadge.length <= 25) {
    badge = genericBadge
  }

  // Validate badge quality
  if (badge) {
    badge = badge.trim()
    // Remove category info
    if (badge.includes(' for ') || badge.includes(' in ')) {
      badge = badge.split(' for ')[0].split(' in ')[0].trim()
    }
    // Final length validation
    if (badge.length > 25 || badge.length === 0) {
      badge = null
    }
  }

  return badge
}

// Run tests
function runTests() {
  console.log('🧪 P3 Badge Extraction Validation Test')
  console.log('=' .repeat(60))

  let passed = 0
  let failed = 0
  const failures: { test: string; expected: string | null; actual: string | null }[] = []

  for (const testCase of testCases) {
    const actual = extractBadge(testCase.html)
    const success = actual === testCase.expected

    if (success) {
      passed++
      console.log(`✅ PASS: ${testCase.name}`)
      console.log(`   Expected: "${testCase.expected}" | Got: "${actual}"`)
    } else {
      failed++
      failures.push({ test: testCase.name, expected: testCase.expected, actual })
      console.log(`❌ FAIL: ${testCase.name}`)
      console.log(`   Expected: "${testCase.expected}" | Got: "${actual}"`)
    }
  }

  console.log('=' .repeat(60))
  console.log(`\n📊 Test Results:`)
  console.log(`   Total: ${testCases.length}`)
  console.log(`   Passed: ${passed} (${(passed / testCases.length * 100).toFixed(1)}%)`)
  console.log(`   Failed: ${failed}`)

  const accuracy = (passed / testCases.length) * 100
  console.log(`\n🎯 Accuracy: ${accuracy.toFixed(1)}%`)
  console.log(`   Target: ≥95%`)
  console.log(`   Status: ${accuracy >= 95 ? '✅ PASS' : '❌ FAIL'}`)

  if (failures.length > 0) {
    console.log(`\n❌ Failed Tests:`)
    failures.forEach(f => {
      console.log(`   - ${f.test}`)
      console.log(`     Expected: "${f.expected}"`)
      console.log(`     Got: "${f.actual}"`)
    })
  }

  return accuracy >= 95
}

// Execute
const success = runTests()
process.exit(success ? 0 : 1)
