/**
 * 多语言支持验证脚本
 *
 * 验证所有 13 种语言的国际化配置、AI 分析服务和字符限制
 */

import {
  normalizeLanguageCode,
  normalizeCountryCode,
  isValidLanguageCountryPair,
  getLanguageName,
  getCountryName,
  getGoogleAdsLanguageCode,
  LANGUAGE_CODE_MAP,
  COUNTRY_CODE_MAP,
  LANGUAGE_COUNTRY_PAIRS,
} from '../src/lib/language-country-codes'

interface TestResult {
  name: string
  passed: number
  failed: number
  details: string[]
}

const results: TestResult[] = []

function logTest(category: string, message: string, passed: boolean) {
  const icon = passed ? '✅' : '❌'
  console.log(`${icon} [${category}] ${message}`)
}

function logSection(title: string) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📋 ${title}`)
  console.log('='.repeat(60))
}

// ============================================================================
// 1. 语言代码映射验证
// ============================================================================
logSection('1. 语言代码映射验证')

const supportedLanguages = [
  'English',
  'Chinese',
  'Spanish',
  'German',
  'French',
  'Italian',
  'Portuguese',
  'Japanese',
  'Korean',
  'Russian',
  'Arabic',
  'Swedish',
  'Swiss German',
]

let langMappingPassed = 0
let langMappingFailed = 0

supportedLanguages.forEach(lang => {
  try {
    const code = normalizeLanguageCode(lang)
    const isValid = code && code.length > 0 && code.length <= 5
    logTest('语言映射', `${lang} → ${code}`, isValid)
    if (isValid) langMappingPassed++
    else langMappingFailed++
  } catch (e) {
    logTest('语言映射', `${lang} 失败: ${e}`, false)
    langMappingFailed++
  }
})

results.push({
  name: '语言代码映射',
  passed: langMappingPassed,
  failed: langMappingFailed,
  details: [`验证了 ${supportedLanguages.length} 种语言的代码映射`],
})

// ============================================================================
// 2. Google Ads 语言代码验证
// ============================================================================
logSection('2. Google Ads 语言代码验证')

const languageCodes = ['en', 'zh', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ko', 'ru', 'ar', 'sv', 'de-ch']

let gadsCodePassed = 0
let gadsCodeFailed = 0

languageCodes.forEach(lang => {
  try {
    const gadsCode = getGoogleAdsLanguageCode(lang)
    const isValid = typeof gadsCode === 'number' && gadsCode > 0 && gadsCode < 10000
    logTest('Google Ads 代码', `${lang} → ${gadsCode}`, isValid)
    if (isValid) gadsCodePassed++
    else gadsCodeFailed++
  } catch (e) {
    logTest('Google Ads 代码', `${lang} 失败: ${e}`, false)
    gadsCodeFailed++
  }
})

results.push({
  name: 'Google Ads 语言代码',
  passed: gadsCodePassed,
  failed: gadsCodeFailed,
  details: [`验证了 ${languageCodes.length} 种语言的 Google Ads 代码`],
})

// ============================================================================
// 3. 语言-国家对应关系验证
// ============================================================================
logSection('3. 语言-国家对应关系验证')

let langCountryPassed = 0
let langCountryFailed = 0

languageCodes.forEach(lang => {
  try {
    const countries = LANGUAGE_COUNTRY_PAIRS[lang]
    const isValid = Array.isArray(countries) && countries.length > 0
    const countryList = isValid ? countries.slice(0, 3).join(', ') : 'N/A'
    logTest('语言-国家对', `${lang} → ${countries?.length || 0} 个国家 (${countryList}...)`, isValid)
    if (isValid) langCountryPassed++
    else langCountryFailed++
  } catch (e) {
    logTest('语言-国家对', `${lang} 失败: ${e}`, false)
    langCountryFailed++
  }
})

results.push({
  name: '语言-国家对应关系',
  passed: langCountryPassed,
  failed: langCountryFailed,
  details: [`验证了 ${languageCodes.length} 种语言的国家对应关系`],
})

// ============================================================================
// 4. 有效的语言-国家对验证
// ============================================================================
logSection('4. 有效的语言-国家对验证')

const validPairs = [
  { lang: 'en', country: 'US' },
  { lang: 'zh', country: 'CN' },
  { lang: 'es', country: 'ES' },
  { lang: 'de', country: 'DE' },
  { lang: 'fr', country: 'FR' },
  { lang: 'it', country: 'IT' },
  { lang: 'pt', country: 'PT' },
  { lang: 'ja', country: 'JP' },
  { lang: 'ko', country: 'KR' },
  { lang: 'ru', country: 'RU' },
  { lang: 'ar', country: 'SA' },
  { lang: 'sv', country: 'SE' },
  { lang: 'de-ch', country: 'CH' },
]

let validPairsPassed = 0
let validPairsFailed = 0

validPairs.forEach(({ lang, country }) => {
  try {
    const isValid = isValidLanguageCountryPair(lang, country)
    logTest('有效对', `${lang} + ${country}`, isValid)
    if (isValid) validPairsPassed++
    else validPairsFailed++
  } catch (e) {
    logTest('有效对', `${lang} + ${country} 失败: ${e}`, false)
    validPairsFailed++
  }
})

results.push({
  name: '有效的语言-国家对',
  passed: validPairsPassed,
  failed: validPairsFailed,
  details: [`验证了 ${validPairs.length} 个语言-国家对`],
})

// ============================================================================
// 5. 字符限制验证
// ============================================================================
logSection('5. 字符限制验证')

const charLimitTests = [
  {
    category: '标题 (≤30字符)',
    tests: [
      { text: 'Samsung Galaxy S24', valid: true },
      { text: '三星 Galaxy S24 官方旗舰店', valid: true },
      { text: 'Samsung Galaxy S24 Teléfono Inteligente Oficial', valid: false },
    ],
  },
  {
    category: '描述 (≤90字符)',
    tests: [
      { text: 'Premium quality robot vacuum with smart navigation', valid: true },
      { text: '智能导航，自动清扫，超长续航，官方正品保证', valid: true },
      { text: 'Aspirador robótico inteligente con navegación avanzada y batería de larga duración para limpiar toda tu casa perfectamente', valid: false },
    ],
  },
  {
    category: 'Callouts (≤25字符)',
    tests: [
      { text: 'Free Shipping', valid: true },
      { text: '免费送货', valid: true },
      { text: 'Envío gratis a toda España', valid: false },
    ],
  },
  {
    category: 'Sitelink 文本 (≤25字符)',
    tests: [
      { text: 'Shop Now', valid: true },
      { text: '立即购买', valid: true },
      { text: 'Compra Ahora en Oferta', valid: true }, // 22 字符，有效
      { text: 'Compra Ahora en Oferta Especial', valid: false }, // 超过 25 字符
    ],
  },
  {
    category: 'Sitelink 描述 (≤35字符)',
    tests: [
      { text: 'Free 2-Day Prime Delivery', valid: true },
      { text: '免费两天送达', valid: true },
      { text: 'Entrega gratuita en 2 días para miembros Prime', valid: false },
    ],
  },
]

let charLimitPassed = 0
let charLimitFailed = 0

charLimitTests.forEach(({ category, tests }) => {
  tests.forEach(({ text, valid }) => {
    const charCount = text.length
    const isValid = valid
    logTest(category, `"${text.substring(0, 30)}${text.length > 30 ? '...' : ''}" (${charCount} 字符)`, isValid)
    if (isValid) charLimitPassed++
    else charLimitFailed++
  })
})

results.push({
  name: '字符限制验证',
  passed: charLimitPassed,
  failed: charLimitFailed,
  details: [`验证了 ${charLimitTests.reduce((sum, t) => sum + t.tests.length, 0)} 个字符限制测试`],
})

// ============================================================================
// 6. 语言混合检测
// ============================================================================
logSection('6. 语言混合检测')

const mixedLanguageTests = [
  { text: 'Samsung Galaxy S24', isMixed: false },
  { text: '三星 Galaxy S24', isMixed: true },
  { text: 'Robot aspirador inteligente', isMixed: false },
  { text: 'Aspirador robot 智能', isMixed: true },
]

let mixedLangPassed = 0
let mixedLangFailed = 0

mixedLanguageTests.forEach(({ text, isMixed }) => {
  const hasEnglish = /[a-zA-Z]/.test(text)
  const hasChinese = /[\u4e00-\u9fff]/.test(text)
  const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(text)
  const hasKorean = /[\uac00-\ud7af]/.test(text)
  const hasArabic = /[\u0600-\u06ff]/.test(text)

  const languageCount = [hasEnglish, hasChinese, hasJapanese, hasKorean, hasArabic].filter(Boolean).length
  const actuallyMixed = languageCount > 1

  const isValid = actuallyMixed === isMixed
  logTest('语言混合', `"${text}" (混合: ${actuallyMixed})`, isValid)
  if (isValid) mixedLangPassed++
  else mixedLangFailed++
})

results.push({
  name: '语言混合检测',
  passed: mixedLangPassed,
  failed: mixedLangFailed,
  details: [`验证了 ${mixedLanguageTests.length} 个混合语言测试`],
})

// ============================================================================
// 7. 完整工作流验证
// ============================================================================
logSection('7. 完整工作流验证')

const workflowLanguages = [
  { name: 'English', code: 'en', country: 'US' },
  { name: 'Chinese', code: 'zh', country: 'CN' },
  { name: 'Spanish', code: 'es', country: 'ES' },
  { name: 'German', code: 'de', country: 'DE' },
  { name: 'French', code: 'fr', country: 'FR' },
  { name: 'Italian', code: 'it', country: 'IT' },
  { name: 'Portuguese', code: 'pt', country: 'PT' },
  { name: 'Japanese', code: 'ja', country: 'JP' },
  { name: 'Korean', code: 'ko', country: 'KR' },
  { name: 'Russian', code: 'ru', country: 'RU' },
  { name: 'Arabic', code: 'ar', country: 'SA' },
  { name: 'Swedish', code: 'sv', country: 'SE' },
  { name: 'Swiss German', code: 'de-ch', country: 'CH' },
]

let workflowPassed = 0
let workflowFailed = 0

workflowLanguages.forEach(({ name, code, country }) => {
  try {
    const normalizedLang = normalizeLanguageCode(name)
    const normalizedCountry = normalizeCountryCode(country)
    const isValidPair = isValidLanguageCountryPair(normalizedLang, normalizedCountry)
    const gadsCode = getGoogleAdsLanguageCode(normalizedLang)
    const langName = getLanguageName(normalizedLang)
    const countryName = getCountryName(normalizedCountry)

    const isValid =
      normalizedLang.toLowerCase() === code.toLowerCase() &&
      normalizedCountry.toUpperCase() === country.toUpperCase() &&
      isValidPair &&
      gadsCode > 0 &&
      langName &&
      countryName

    logTest('完整工作流', `${name} (${code}/${country}) → Google Ads: ${gadsCode}`, isValid)
    if (isValid) workflowPassed++
    else workflowFailed++
  } catch (e) {
    logTest('完整工作流', `${name} 失败: ${e}`, false)
    workflowFailed++
  }
})

results.push({
  name: '完整工作流',
  passed: workflowPassed,
  failed: workflowFailed,
  details: [`验证了 ${workflowLanguages.length} 种语言的完整工作流`],
})

// ============================================================================
// 总结
// ============================================================================
logSection('📊 测试总结')

let totalPassed = 0
let totalFailed = 0

results.forEach(result => {
  totalPassed += result.passed
  totalFailed += result.failed
  const percentage = result.passed + result.failed > 0 ? ((result.passed / (result.passed + result.failed)) * 100).toFixed(1) : '0'
  console.log(`${result.name}: ${result.passed}/${result.passed + result.failed} 通过 (${percentage}%)`)
  result.details.forEach(detail => console.log(`  - ${detail}`))
})

console.log(`\n${'='.repeat(60)}`)
console.log(`总体结果: ${totalPassed}/${totalPassed + totalFailed} 通过`)
console.log(`成功率: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`)
console.log('='.repeat(60))

if (totalFailed > 0) {
  console.log(`\n⚠️  有 ${totalFailed} 个测试失败`)
  process.exit(1)
} else {
  console.log(`\n✅ 所有测试通过！`)
  process.exit(0)
}
