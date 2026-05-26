/**
 * 独立采集测试脚本 - 不依赖任何 app 模块，直接用 axios + cheerio 测试
 * 运行方式: node scripts/test-scraper-standalone.mjs
 */

import axios from 'axios'
import { load } from 'cheerio'

const TEST_URLS = [
  // Amazon 真实单品页（用户提供）
  {
    label: '🛒 Amazon 单品页 - Levoit 空气净化器 B08HS45N13',
    url: 'https://www.amazon.com/dp/B08HS45N13',
    type: 'product',
  },
  // Amazon 店铺主页（用户提供，去掉中文 -/zh/ 前缀）
  {
    label: '🏪 Amazon 店铺页 - Levoit Store (EN)',
    url: 'https://www.amazon.com/stores/Levoit/page/36E5D100-D40D-4618-AEA6-A8FF8AD39805?lp_asin=B08HS45N13&ref_=ast_bln',
    type: 'store',
  },
]

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
]

async function scrapeUrl(url) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
    maxRedirects: 5,
  })
  return response.data
}

function extractAmazonProduct($, url) {
  const pageTitle = $('title').text().trim()
  const isBlocked = pageTitle.includes('Robot Check') ||
    pageTitle.includes('Sorry!') ||
    pageTitle.includes('bot check') ||
    $('body').text().includes('Enter the characters you see below') ||
    $('body').text().includes('Type the characters')

  console.log(`  📄 页面标题: "${pageTitle.slice(0, 80)}"`)
  console.log(`  🚫 被拦截: ${isBlocked}`)

  if (isBlocked) return { blocked: true, pageTitle }

  // ==================== 评分 & 评论数 ====================
  const ratingText = $('#acrPopover').attr('title') ||
    $('span[data-hook="rating-out-of-text"]').text().trim() ||
    $('.a-icon-star span').first().text().trim() ||
    $('.a-icon-alt').first().text().trim() || null
  const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

  const reviewCountText = $('#acrCustomerReviewText').text().trim() ||
    $('span[data-hook="total-review-count"]').text().trim() ||
    $('a[href*="customerReviews"]').text().trim() || null
  const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

  // ==================== 评论亮点 ====================
  const reviewHighlights = []
  $('[data-hook="lighthut-term"]').each((i, el) => {
    const text = $(el).text().trim()
    if (text) reviewHighlights.push(text)
  })

  // ==================== 前5条评论 ====================
  const topReviews = []
  $('[data-hook="review"]').slice(0, 5).each((i, el) => {
    let reviewText = $(el).find('[data-hook="review-body"]').text().trim().substring(0, 300)
    const reviewTitle = $(el).find('[data-hook="review-title"]').text().trim()
      .replace(/^[\d.]+\s*out of 5 stars[\s\n]*/i, '').trim()
    const reviewRating = $(el).find('.a-icon-star').text().trim()
    if (reviewText && !reviewText.includes('function()') && !reviewText.includes('P.when(')) {
      topReviews.push(`${reviewRating} - ${reviewTitle}: ${reviewText}`.slice(0, 200))
    }
  })

  // ==================== feature-bullets ====================
  const features = []
  const featureSelectors = [
    '#feature-bullets ul.a-unordered-list li:not(.aok-hidden) span.a-list-item',
    '#feature-bullets ul li:not(.aok-hidden)',
    '#featurebullets_feature_div ul li:not(.aok-hidden)',
    '[data-feature-name="featurebullets"] ul li:not(.aok-hidden)',
  ]
  for (const sel of featureSelectors) {
    $(sel).each((i, el) => {
      const text = $(el).text().trim()
      if (text && text.length > 5 && text.length < 500 && !features.includes(text)) {
        features.push(text)
      }
    })
    if (features.length > 0) break
  }

  // ==================== A+ 内容 ====================
  const aPlusItems = []
  $('#aplus_feature_div .aplus-module p, #aplus_feature_div .aplus-v2 li, #aplusBody p, #aplus p').each((i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text && text.length > 20 && text.length < 400 && !aPlusItems.includes(text)) {
      aPlusItems.push(text)
    }
  })

  // 合并
  const allFeatures = features.slice(0, 10)
  if (allFeatures.length < 5 && aPlusItems.length > 0) {
    for (const item of aPlusItems) {
      if (!allFeatures.some(f => f.toLowerCase() === item.toLowerCase())) {
        allFeatures.push(item)
        if (allFeatures.length >= 10) break
      }
    }
  }

  // ==================== 价格 ====================
  const productPrice = (
    $('.a-price .a-offscreen').first().text().trim() ||
    $('#priceblock_ourprice').text().trim() ||
    $('#priceblock_dealprice').text().trim() ||
    $('.a-price-whole').first().text().trim() ||
    $('#price_inside_buybox').text().trim() ||
    null
  )

  // ==================== 品牌 ====================
  const bylineText = $('#bylineInfo').text().trim()
  // 🔥 修复：data-brand 属性值有时带 "Brand" 前缀（如 "BrandLEVOIT"）
  const rawDataBrand = $('[data-brand]').attr('data-brand') || null
  const dataBrand = rawDataBrand ? rawDataBrand.replace(/^Brand\s*/i, '').trim() || null : null
  const rawPoBrand = $('.po-brand .a-size-base').text().trim()
  const poBrand = rawPoBrand.replace(/^Brand\s*/i, '').trim()
  console.log(`  🔍 [data-brand] raw: "${rawDataBrand || '(空)'}" → cleaned: "${dataBrand || '(空)'}"`)
  console.log(`  🔍 bylineText: "${bylineText.slice(0, 60)}"`)
  console.log(`  🔍 poBrand raw: "${rawPoBrand}" → cleaned: "${poBrand}"`)

  // ==================== 图片 ====================
  const mainImage = (
    $('#landingImage').attr('src') ||
    $('#imgTagWrapperId img').attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null
  )

  // ==================== 产品标题 ====================
  const productTitle = $('#productTitle').text().trim()

  // ==================== 分类面包屑 ====================
  const breadcrumb = $('#wayfinding-breadcrumbs_feature_div').text().replace(/\s+/g, ' ').trim()

  return {
    blocked: false,
    pageTitle,
    productName: productTitle || null,
    brandName: dataBrand || bylineText.replace(/^.*Visit the /i, '').replace(/ Store$/i, '').trim() || poBrand || null,
    productPrice,
    mainImage: mainImage ? mainImage.replace(/\._.*_\./, '.') : null,
    productCategory: breadcrumb || null,
    featureBulletsCount: features.length,
    aPlusCount: aPlusItems.length,
    aboutThisItem: allFeatures,
    features: allFeatures,
    rawAboutThisItem: allFeatures,
    productFeatures: allFeatures,
    // 🔥 评论字段
    rating,
    reviewCount,
    reviewHighlights,
    topReviews,
  }
}

function extractAmazonStore($, url) {
  const pageTitle = $('title').text().trim()
  const isBlocked = pageTitle.includes('Robot Check') || pageTitle.includes('Sorry!')
  const htmlSize = $.html().length
  console.log(`  📄 页面标题: "${pageTitle.slice(0, 80)}"`)
  console.log(`  🚫 被拦截: ${isBlocked}`)
  if (isBlocked) return { blocked: true, pageTitle }

  // 店铺名：Amazon Store 页 DOM 结构
  const storeName = (
    $('[class*="StoreName"], [class*="store-name"], [data-testid="store-name"]').first().text().trim() ||
    $('.a-store-name').first().text().trim() ||
    // 从 meta og:title 提取
    ($('meta[property="og:title"]').attr('content') || '').replace(/Amazon\.com:\s*/i, '').trim() ||
    // 从 title 提取（去掉 "Amazon.com: " 前缀）
    pageTitle.replace(/^Amazon\.com:\s*/i, '').trim() ||
    null
  )

  // 店铺描述
  const storeDescription = (
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    null
  )

  // 调试：列出页面有哪些元素
  console.log(`  🔍 HTML大小: ${(htmlSize/1024).toFixed(1)}KB`)
  console.log(`  🔍 [data-asin] 元素数: ${$('[data-asin]').length}`)
  console.log(`  🔍 script[type="application/json"] 数: ${$('script[type="application/json"]').length}`)
  console.log(`  🔍 h2 元素数: ${$('h2').length}`)

  // Amazon Store 产品列表：尝试多种选择器
  const products = []

  // 方式1：data-asin 属性（最可靠）
  $('[data-asin]').each((i, el) => {
    const asin = $(el).attr('data-asin')
    if (!asin || asin.length < 5) return
    const title = (
      $(el).find('span[class*="product-title"], .a-text-normal, h2, h3').first().text().trim() ||
      $(el).find('[data-cy="title-recipe-title"], [data-component-type="s-product-image"] + div').text().trim()
    )
    if (title && title.length > 5 && !products.some(p => p.asin === asin)) {
      products.push({ asin, title: title.slice(0, 120) })
    }
  })

  // 方式2：.s-result-item
  if (products.length === 0) {
    $('.s-result-item[data-asin], .sg-col-inner').each((i, el) => {
      const asin = $(el).attr('data-asin')
      const title = $(el).find('.a-size-medium, .a-text-normal, h2 a span').first().text().trim()
      if (asin && title && title.length > 5) {
        products.push({ asin, title: title.slice(0, 120) })
      }
    })
  }

  return {
    blocked: false,
    pageTitle,
    storeName,
    storeDescription,
    productCount: products.length,
    topProducts: products.slice(0, 5),
  }
}

async function runTest() {
  console.log('🚀 独立采集测试（不依赖 app 模块）\n')
  console.log('='.repeat(60))

  for (const testCase of TEST_URLS) {
    console.log(`\n📋 ${testCase.label}`)
    console.log(`🔗 URL: ${testCase.url}`)
    console.log('-'.repeat(60))

    const start = Date.now()
    try {
      const html = await scrapeUrl(testCase.url)
      const $ = load(html)
      const elapsed = Date.now() - start
      console.log(`  ⏱️  HTTP 耗时: ${elapsed}ms，HTML 大小: ${(html.length / 1024).toFixed(1)}KB`)

      let result
      if (testCase.type === 'product') {
        result = extractAmazonProduct($, testCase.url)
      } else {
        result = extractAmazonStore($, testCase.url)
      }

      if (result.blocked) {
        console.log(`  ❌ 页面被 Amazon 拦截，无法提取数据`)
        console.log(`  💡 建议：需要使用代理或 stealth-scraper（Playwright）`)
      } else {
        if (testCase.type === 'product') {
          console.log(`\n  📦 单品数据:`)
          console.log(`    productName:     "${(result.productName || '').slice(0, 70)}"`)
          console.log(`    brandName:       "${result.brandName || '(空)'}"`)
          console.log(`    productPrice:    "${result.productPrice || '(空)'}"`)
          console.log(`    productCategory: "${(result.productCategory || '').slice(0, 70)}"`)
          console.log(`    mainImage:       ${result.mainImage ? '✅ 有' : '❌ 无'}`)

          console.log(`\n  🔑 卖点字段 (修复后 4 个字段都写入):`)
          console.log(`    aboutThisItem:   ${result.aboutThisItem?.length || 0} 条  ✅`)
          console.log(`    features:        ${result.features?.length || 0} 条  ✅`)
          console.log(`    rawAboutThisItem:${result.rawAboutThisItem?.length || 0} 条  ✅`)
          console.log(`    productFeatures: ${result.productFeatures?.length || 0} 条  ✅`)
          console.log(`    (其中 feature-bullets: ${result.featureBulletsCount}, A+: ${result.aPlusCount})`)

          if (result.aboutThisItem?.length > 0) {
            console.log(`\n  前3条卖点:`)
            result.aboutThisItem.slice(0, 3).forEach((b, i) => {
              console.log(`    [${i + 1}] ${b.slice(0, 100)}`)
            })
          } else {
            console.log(`\n  ⚠️  未提取到任何卖点（可能被 Amazon 拦截或 DOM 结构变化）`)
          }

          console.log(`\n  ⭐ 评论数据:`)
          console.log(`    rating:          ${result.rating || '(空)'}`)
          console.log(`    reviewCount:     ${result.reviewCount || '(空)'}`)
          console.log(`    reviewHighlights:${result.reviewHighlights?.length || 0} 条`)
          if (result.reviewHighlights?.length > 0) {
            result.reviewHighlights.slice(0, 3).forEach((h, i) => console.log(`      [${i+1}] ${h}`))
          }
          console.log(`    topReviews:      ${result.topReviews?.length || 0} 条`)
          if (result.topReviews?.length > 0) {
            result.topReviews.slice(0, 2).forEach((r, i) => {
              console.log(`      [${i+1}] ${r.slice(0, 120)}`)
            })
          }
        } else {
          console.log(`\n  🏪 店铺数据:`)
          console.log(`    storeName:       "${result.storeName || '(空)'}"`)
          console.log(`    storeDescription:${result.storeDescription ? `"${result.storeDescription.slice(0, 80)}"` : '(空)'}`)
          console.log(`    产品数:           ${result.productCount}`)
          if (result.topProducts?.length > 0) {
            console.log(`    前5个产品:`)
            result.topProducts.forEach((p, i) => console.log(`      [${i + 1}] ${p.slice(0, 80)}`))
          }
        }
      }
    } catch (err) {
      const elapsed = Date.now() - start
      if (err.response) {
        console.log(`  ❌ HTTP ${err.response.status} 错误 (${elapsed}ms)`)
        console.log(`  💡 Amazon 返回了 ${err.response.status}，可能是 bot 检测`)
      } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        console.log(`  ❌ 网络连接错误: ${err.message}`)
      } else {
        console.log(`  ❌ 错误 (${elapsed}ms): ${err.message}`)
      }
    }

    console.log('='.repeat(60))
  }
  console.log('\n✅ 测试完成')
}

runTest().catch(err => {
  console.error('测试运行出错:', err)
  process.exit(1)
})
