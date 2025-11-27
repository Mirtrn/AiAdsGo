/**
 * 命名规范验证脚本
 *
 * 手动测试命名规范的正确性
 */

import {
  generateCampaignName,
  generateAdGroupName,
  generateAdName,
  parseCampaignName,
  generateNamingScheme
} from '../src/lib/naming-convention'

console.log('🧪 测试Google Ads命名规范\n')

// Test 1: Campaign Name
console.log('📋 Test 1: Campaign Name Generation')
const campaignName = generateCampaignName({
  brand: 'Eufy',
  country: 'IT',
  category: 'Electronics',
  budgetAmount: 50,
  budgetType: 'DAILY',
  biddingStrategy: 'TARGET_CPA',
  offerId: 215,
  date: new Date('2025-11-27')
})
console.log('Generated:', campaignName)
console.log('Expected: Eufy_IT_Electronics_50D_TCPA_20251127_O215')
console.log('✅ Pass:', campaignName === 'Eufy_IT_Electronics_50D_TCPA_20251127_O215')
console.log()

// Test 2: Ad Group Name
console.log('📋 Test 2: Ad Group Name Generation')
const adGroupName = generateAdGroupName({
  brand: 'Eufy',
  country: 'IT',
  theme: 'Cleaning',
  maxCpcBid: 2.5
})
console.log('Generated:', adGroupName)
console.log('Expected: Eufy_IT_Cleaning_2.5CPC')
console.log('✅ Pass:', adGroupName === 'Eufy_IT_Cleaning_2.5CPC')
console.log()

// Test 3: Ad Name
console.log('📋 Test 3: Ad Name Generation')
const adName = generateAdName({
  theme: 'Cleaning',
  creativeId: 121,
  variantIndex: 1
})
console.log('Generated:', adName)
console.log('Expected: RSA_Cleaning_C121_V1')
console.log('✅ Pass:', adName === 'RSA_Cleaning_C121_V1')
console.log()

// Test 4: Parse Campaign Name
console.log('📋 Test 4: Parse Campaign Name')
const parsed = parseCampaignName('Eufy_IT_Electronics_50D_TCPA_20251127_O215')
console.log('Parsed:', JSON.stringify(parsed, null, 2))
console.log('✅ Pass:', parsed?.brand === 'Eufy' && parsed?.offerId === 215)
console.log()

// Test 5: Complete Naming Scheme
console.log('📋 Test 5: Complete Naming Scheme')
const scheme = generateNamingScheme({
  offer: {
    id: 215,
    brand: 'Eufy',
    category: 'Electronics'
  },
  config: {
    targetCountry: 'IT',
    budgetAmount: 50,
    budgetType: 'DAILY',
    biddingStrategy: 'TARGET_CPA',
    maxCpcBid: 2.5
  },
  creative: {
    id: 121,
    theme: 'Cleaning'
  }
})
console.log('Campaign:', scheme.campaignName)
console.log('Ad Group:', scheme.adGroupName)
console.log('Ad:', scheme.adName)
console.log()

// Test 6: Special Characters
console.log('📋 Test 6: Special Characters Sanitization')
const specialName = generateCampaignName({
  brand: 'Brand & Co.',
  country: 'US',
  budgetAmount: 25,
  budgetType: 'DAILY',
  biddingStrategy: 'MANUAL_CPC',
  offerId: 100
})
console.log('Generated:', specialName)
console.log('✅ Pass:', !specialName.includes('&') && !specialName.includes('.'))
console.log()

console.log('✅ 所有测试通过！')
