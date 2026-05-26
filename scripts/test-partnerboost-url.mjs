/**
 * 测试 partnerboost 链接解析
 * 验证 url= 参数直接提取方案
 */

const testUrl = 'https://app.partnerboost.com/track/1aa9dvw7GI7lKck232OZNXDsS6m0RqadDZsMT4VDp0W0iV2b4QE8ouV8ciSB63NS8QrVroGwFkw_c?url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB08HS45N13%3Fmaas%3Dmaas_adg_api_579991495871079815_static_12_201%26ref_%3Daa_maas%26tag%3Dmaas%26aa_campaignid%3DPBa477c0bda19fb9901ce191bb864d6441%26aa_adgroupid%3Dfe6c3R4bSLofF1JnFLOsIEOKEFbjC3DKnXB8cci0y_b5qTxw_bZjvhlK8k_azGqMUfChviqb42IUpJS1SyrQORe_aDE_c%26aa_creativeid%3D1c48HShz2QqqFJ5yaheGDrlN484cJpnmhznUUH5Kgrthwik_c'

console.log('=== partnerboost URL 解析测试 ===\n')
console.log('原始链接:', testUrl.substring(0, 80) + '...')

// 1. 检测 partnerboost 链接格式
function isPartnerboostUrl(url) {
  try {
    const { hostname } = new URL(url)
    return hostname.includes('partnerboost.com')
  } catch {
    return false
  }
}

// 2. 直接从 url= 参数提取最终 Amazon URL（不需要 HTTP 重定向）
function extractEmbeddedUrl(url) {
  try {
    const parsed = new URL(url)
    const embedded = parsed.searchParams.get('url')
    if (embedded) {
      console.log('\n✅ 发现嵌入的 url= 参数，直接提取（无需重定向）')
      return embedded
    }
    return null
  } catch {
    return null
  }
}

// 3. 从 Amazon URL 提取基础 URL 和 suffix
function splitAmazonUrl(amazonUrl) {
  try {
    const urlObj = new URL(amazonUrl)
    const finalUrl = `${urlObj.origin}${urlObj.pathname}`
    const suffix = urlObj.search.substring(1)  // 去掉开头的 ?
    return { finalUrl, suffix }
  } catch {
    return null
  }
}

// 执行解析
console.log('\n--- 步骤1: 检测链接类型 ---')
const isPartnerboost = isPartnerboostUrl(testUrl)
console.log(`是否 partnerboost 链接: ${isPartnerboost}`)

console.log('\n--- 步骤2: 提取嵌入的 Amazon URL ---')
const embeddedUrl = extractEmbeddedUrl(testUrl)
if (embeddedUrl) {
  console.log('提取到的 Amazon URL:', embeddedUrl)
  
  console.log('\n--- 步骤3: 分割 Final URL 和 Suffix ---')
  const split = splitAmazonUrl(embeddedUrl)
  if (split) {
    console.log('Final URL (干净地址):', split.finalUrl)
    console.log('Final URL Suffix (参数):', split.suffix.substring(0, 100) + '...')
    
    // 提取 ASIN
    const asinMatch = split.finalUrl.match(/\/dp\/([A-Z0-9]{10})/)
    if (asinMatch) {
      console.log('\n✅ 提取到 ASIN:', asinMatch[1])
    }
  }
} else {
  console.log('❌ 未找到 url= 参数，需要 HTTP 重定向解析')
}

console.log('\n=== 结论 ===')
console.log('partnerboost /track/ 链接通常带有 url= 参数')
console.log('只需 URL decode 即可获取真实 Amazon 地址，无需 HTTP 请求或 Playwright')
console.log('现有代码逻辑: 有 offer.final_url → 直接用。没有 → 走 Playwright（403）')
console.log('优化方案: 先检查 url= 参数，能提取就直接用，不需要 Playwright')
