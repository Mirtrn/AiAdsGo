/**
 * Test script for Bagsmart brand keyword expansion
 */
import { getKeywordSuggestions } from '../src/lib/keyword-planner'

async function testBagsmart() {
  console.log('Testing brand keyword expansion for: Bagsmart\n')

  const suggestions = await getKeywordSuggestions(
    ['Bagsmart'],
    'US',
    'en',
    30
  )

  // Filter keywords containing 'bagsmart'
  const brandKeywords = suggestions
    .filter(v => v.keyword.toLowerCase().includes('bagsmart'))
    .sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches)

  console.log('Brand keywords found:', brandKeywords.length)
  console.log('\nKeywords with search volume >= 500:\n')

  const highVolume = brandKeywords.filter(k => k.avgMonthlySearches >= 500)
  highVolume.forEach((k, i) => {
    console.log(`${i+1}. ${k.keyword}`)
    console.log(`   Search Volume: ${k.avgMonthlySearches.toLocaleString()}`)
    console.log(`   Competition: ${k.competition}`)
    console.log(`   CPC Range: $${k.lowTopPageBid.toFixed(2)} - $${k.highTopPageBid.toFixed(2)}\n`)
  })

  if (highVolume.length === 0) {
    console.log('(No keywords found with volume >= 500)\n')
  }

  const lowVolume = brandKeywords.filter(k => k.avgMonthlySearches < 500)
  if (lowVolume.length > 0) {
    console.log('\nKeywords with search volume < 500 (would be filtered out):\n')
    lowVolume.forEach(k => {
      console.log(`- ${k.keyword}: ${k.avgMonthlySearches}`)
    })
  }

  // Also show all suggestions for context
  console.log('\n\n--- All Keyword Suggestions (not just brand) ---\n')
  suggestions
    .sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches)
    .slice(0, 15)
    .forEach((k, i) => {
      const isBrand = k.keyword.toLowerCase().includes('bagsmart')
      console.log(`${i+1}. ${k.keyword} ${isBrand ? '✓' : ''}`)
      console.log(`   Volume: ${k.avgMonthlySearches.toLocaleString()}`)
    })
}

testBagsmart().catch(console.error)
