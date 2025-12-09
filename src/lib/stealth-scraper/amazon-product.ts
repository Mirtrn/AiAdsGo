/**
 * Amazon Product Scraping
 *
 * Single Amazon product page scraping with comprehensive data extraction
 */

import { normalizeBrandName } from '../offer-utils'
import { parsePrice } from '../pricing-utils'  // 🔥 新增：统一价格解析函数
import { getPlaywrightPool } from '../playwright-pool'
import { isProxyConnectionError } from './proxy-utils'
import { createStealthBrowser, releaseBrowser, configureStealthPage } from './browser-stealth'
import { scrapeUrlWithBrowser } from './core'
import type { AmazonProductData } from './types'

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * Scrape Amazon product page with enhanced anti-bot bypass
 * Extracts comprehensive data for AI creative generation
 * 🔥 P1优化：代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeAmazonProduct(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,  // 🌍 目标国家参数
  maxProxyRetries: number = 2,  // 代理失败最多重试2次
  skipCompetitorExtraction: boolean = false  // 🔥 修复：跳过竞品ASIN提取（用于竞品详情页抓取，避免二级循环）
): Promise<AmazonProductData> {
  console.log(`🛒 抓取Amazon产品: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        // 🔥 关键优化：清理连接池实例，避免复用已被Amazon标记的代理IP
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 🔥 清理代理IP缓存，强制获取新IP
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        console.log(`🧹 已清理代理IP缓存: ${effectiveProxyUrl}`)
        // 🔥 额外等待，确保新代理IP被分配
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      // 🔥 P1优化：使用更短的超时进行快速失败检测
      const quickTimeout = 30000  // 30秒快速检测，如果失败立即换代理
      let result = await scrapeUrlWithBrowser(url, effectiveProxyUrl, {
        waitForSelector: '#productTitle',
        waitForTimeout: quickTimeout,  // 🔥 优先快速失败，避免等120秒
        targetCountry,  // 🌍 传入目标国家
      })

      // ✅ 方案4修复: 如果检测到a-no-js失败，清理池并重试一次
      // 🔥 Bug修复: 使用正则表达式精确匹配<html>标签中的class属性，避免匹配JS/CSS中的字符串
      const htmlTagMatch = result.html?.match(/<html[^>]*class="([^"]*)"/)
      const htmlClasses = htmlTagMatch ? htmlTagMatch[1] : ''
      const hasRealNoJs = htmlClasses.includes('a-no-js') && !htmlClasses.includes('a-js')

      if (result.html && hasRealNoJs) {
        console.warn(`⚠️ 检测到<html>标签中有a-no-js类，页面JavaScript未正常执行`)
        console.warn(`🔍 <html>标签classes: ${htmlClasses.substring(0, 100)}...`)

        // 只在第一次尝试时重试（避免无限循环）
        if (proxyAttempt === 0) {
          console.warn(`🔄 清理连接池并立即重试（a-no-js修复）...`)
          const pool = getPlaywrightPool()
          await pool.clearIdleInstances()

          // 等待5-10秒再重试（给系统重置时间）
          const retryDelay = 5000 + Math.random() * 5000
          console.log(`⏰ 等待${Math.round(retryDelay)}ms后重试...`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))

          // 重新抓取
          result = await scrapeUrlWithBrowser(url, effectiveProxyUrl, {
            waitForSelector: '#productTitle',
            waitForTimeout: quickTimeout,
            targetCountry,
          })

          // 🔥 Bug修复: 重试后同样使用正则精确匹配<html>标签中的class
          const retryHtmlTagMatch = result.html?.match(/<html[^>]*class="([^"]*)"/)
          const retryHtmlClasses = retryHtmlTagMatch ? retryHtmlTagMatch[1] : ''
          const retryHasNoJs = retryHtmlClasses.includes('a-no-js') && !retryHtmlClasses.includes('a-js')

          // 如果重试后仍然有a-no-js，记录但继续执行
          if (result.html && retryHasNoJs) {
            console.error(`🚨 重试后<html>标签仍有a-no-js类，Amazon反爬虫可能升级，继续尝试解析...`)
            console.error(`🔍 重试后<html>标签classes: ${retryHtmlClasses.substring(0, 100)}...`)
          } else {
            console.log(`✅ 重试成功，<html>标签已正确包含a-js类`)
          }
        }
      }

      // Parse HTML with cheerio
      const { load } = await import('cheerio')
      const $ = load(result.html)

      // Parse and return product data
      return parseAmazonProductHtml($, url, skipCompetitorExtraction)

    } catch (error: any) {
      lastError = error
      console.error(`❌ 抓取尝试 ${proxyAttempt + 1}/${maxProxyRetries + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error)) {
        if (proxyAttempt < maxProxyRetries) {
          console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
          // 短暂延迟后重试
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue  // ✅ 进入下一次代理重试循环
        } else {
          console.error(`❌ 已用尽所有代理重试次数 (${maxProxyRetries + 1}次)`)
          // ❌ 不要在这里throw，让循环自然结束，在外面统一抛出lastError
        }
      } else {
        // 🔥 非代理错误：立即失败，不继续重试
        console.error(`❌ 非代理错误，停止重试: ${error.message?.substring(0, 100)}`)
        throw error
      }
    }
  }

  // 所有代理重试都失败
  throw lastError || new Error('Amazon产品抓取失败：已用尽所有代理重试')
}

/**
 * Parse Amazon product HTML and extract data
 * @param skipCompetitorExtraction 跳过竞品ASIN提取（用于竞品详情页抓取，避免二级循环）
 */
function parseAmazonProductHtml($: any, url: string, skipCompetitorExtraction: boolean = false): AmazonProductData {
  // 🎯 核心优化：限定选择器范围到核心产品区域，避免抓取推荐商品
  // 推荐商品区域关键词
  const recommendationKeywords = [
    'also bought', 'also viewed', 'frequently bought together',
    'customers who bought', 'related products', 'similar items',
    'sponsored products', 'customers also shopped for', 'compare with similar',
    'recommended for you', 'more items to explore'
  ]

  // 检查元素是否在推荐区域
  const isInRecommendationArea = (el: any): boolean => {
    const $el = $(el)
    const parents = $el.parents().toArray()

    for (const parent of parents) {
      const $parent = $(parent)
      const text = $parent.text().toLowerCase()
      const id = ($parent.attr('id') || '').toLowerCase()
      const className = ($parent.attr('class') || '').toLowerCase()

      // 检查文本内容
      if (recommendationKeywords.some(keyword => text.includes(keyword))) {
        return true
      }

      // 检查ID和类名
      if (id.includes('sims') || id.includes('related') || id.includes('sponsored') ||
          className.includes('sims') || className.includes('related') || className.includes('sponsored')) {
        return true
      }
    }
    return false
  }

  // Extract product features - 限定在核心产品区域
  const features: string[] = []
  const featureSelectors = [
    '#ppd #feature-bullets li',
    '#centerCol #feature-bullets li',
    '#dp-container #feature-bullets li',
    '#feature-bullets li:not([id*="sims"]):not([class*="sims"])',  // 排除sims相关
    '#featurebullets_feature_div li'
  ]

  for (const selector of featureSelectors) {
    if (features.length >= 10) break  // 限制最多10个特点

    $(selector).each((i: number, el: any) => {
      if (features.length >= 10) return false
      if (isInRecommendationArea(el)) return  // 跳过推荐区域

      const text = $(el).text().trim()
      if (text && text.length > 10 && !features.includes(text)) {
        features.push(text)
      }
    })
  }

  // ========== 图片提取已移除 ==========
  // 📝 说明：Google Search Ads仅显示文本（标题、描述、链接、附加信息），不展示图片
  // 因此移除了imageUrls提取逻辑，降低抓取复杂度和数据冗余
  const imageUrls: string[] = [] // 保留空数组以维持接口兼容性

  // Extract rating and review count
  const ratingText = $('#acrPopover').attr('title') ||
                     $('span[data-hook="rating-out-of-text"]').text().trim() ||
                     $('.a-icon-star span').first().text().trim()
  const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

  const reviewCountText = $('#acrCustomerReviewText').text().trim() ||
                          $('span[data-hook="total-review-count"]').text().trim()
  const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

  // Extract sales rank
  const salesRankText = $('#productDetails_detailBullets_sections1 tr:contains("Best Sellers Rank")').text().trim() ||
                        $('#SalesRank').text().trim() ||
                        $('th:contains("Best Sellers Rank")').next().text().trim()
  const salesRank = salesRankText ? salesRankText.match(/#[\d,]+/)?.[0] || null : null

  // 🎯 P3优化: Extract badge (Amazon's Choice, Best Seller, etc.)
  let badge: string | null = null

  // Strategy 1: Amazon's Choice badge (最常见)
  const amazonChoiceBadge = $('.ac-badge-wrapper .ac-badge-text-primary').text().trim() ||
                            $('span.a-badge-text:contains("Amazon\'s Choice")').text().trim() ||
                            $('[data-a-badge-color="sx-gulfstream"] span.a-badge-text').text().trim()

  // Strategy 2: Best Seller badge (从多个位置检测)
  const bestSellerBadge = $('#zeitgeist-module .a-badge-text').text().trim() ||
                          $('.badge-wrapper .badge-text:contains("Best Seller")').text().trim() ||
                          $('span:contains("#1 Best Seller")').first().text().trim()

  // Strategy 3: Generic badge detection (捕获其他badge)
  const genericBadge = $('.a-badge-text').first().text().trim() ||
                       $('i.a-icon-addon-badge').parent().text().trim()

  // 优先级: Amazon's Choice > Best Seller > Generic
  if (amazonChoiceBadge) {
    badge = amazonChoiceBadge.includes("Amazon's Choice") ? "Amazon's Choice" : amazonChoiceBadge
  } else if (bestSellerBadge) {
    // 规范化Best Seller badge文本
    if (bestSellerBadge.match(/#\d+\s+Best Seller/i)) {
      const match = bestSellerBadge.match(/(#\d+\s+Best Seller)/i)
      badge = match ? match[1] : "Best Seller"
    } else if (bestSellerBadge.toLowerCase().includes('best seller')) {
      badge = "Best Seller"
    }
  } else if (genericBadge && genericBadge.length > 0 && genericBadge.length <= 25) {
    // Generic badge限制长度≤25字符（符合Google Ads Callouts要求）
    badge = genericBadge
  }

  // 验证badge质量（移除噪音）
  if (badge) {
    badge = badge.trim()
    // 移除category信息（如"Amazon's Choice for security cameras" → "Amazon's Choice"）
    if (badge.includes(' for ') || badge.includes(' in ')) {
      badge = badge.split(' for ')[0].split(' in ')[0].trim()
    }
    // 最终长度验证
    if (badge.length > 25 || badge.length === 0) {
      badge = null
    }
  }

  // Extract availability
  const availability = $('#availability span').text().trim() ||
                       $('#outOfStock span').text().trim() ||
                       null

  // Check Prime eligibility
  const primeEligible = $('#primeEligibilityMessage').length > 0 ||
                        $('.a-icon-prime').length > 0 ||
                        $('[data-feature-name="primeEligible"]').length > 0

  // Extract review highlights
  const reviewHighlights: string[] = []
  $('[data-hook="lighthut-term"]').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text) reviewHighlights.push(text)
  })
  // Also try to get from review summary
  $('p[data-hook="review-collapsed"], span[data-hook="review-body"]').slice(0, 3).each((i: number, el: any) => {
    const text = $(el).text().trim().substring(0, 200)
    if (text && text.length > 20) reviewHighlights.push(text)
  })

  // Extract top reviews
  const topReviews: string[] = []
  $('[data-hook="review"]').slice(0, 5).each((i: number, el: any) => {
    const reviewText = $(el).find('[data-hook="review-body"]').text().trim().substring(0, 300)
    const reviewTitle = $(el).find('[data-hook="review-title"]').text().trim()
    const reviewRating = $(el).find('.a-icon-star').text().trim()
    if (reviewText) {
      topReviews.push(`${reviewRating} - ${reviewTitle}: ${reviewText}`)
    }
  })

  // Extract technical details
  const technicalDetails: Record<string, string> = {}
  $('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr').each((i: number, el: any) => {
    const key = $(el).find('th').text().trim()
    const value = $(el).find('td').text().trim()
    if (key && value && key !== 'Customer Reviews' && key !== 'Best Sellers Rank') {
      technicalDetails[key] = value
    }
  })
  // Also try detail bullets format
  $('#detailBullets_feature_div li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    const match = text.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      technicalDetails[match[1].trim()] = match[2].trim()
    }
  })

  // Extract ASIN
  const asin = url.match(/\/dp\/([A-Z0-9]+)/)?.[1] ||
               $('input[name="ASIN"]').val()?.toString() ||
               $('th:contains("ASIN")').next().text().trim() ||
               null

  // Extract category/breadcrumb
  const categoryParts: string[] = []
  $('#wayfinding-breadcrumbs_feature_div li a').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text) categoryParts.push(text)
  })
  const category = categoryParts.join(' > ') || null

  // 🎯 优化品牌名提取 - 多源策略应对反爬虫（提前提取用于竞品过滤）
  let brandName: string | null = extractBrandName($, url, null, technicalDetails)

  // 🔥 KISS优化（2025-12-09）：只提取候选ASIN，品牌过滤移到详情页抓取后进行
  // 原因：列表页的品牌提取不可靠（颜色/尺寸词被误识别为品牌）
  const relatedAsins: string[] = []

  // 🛡️ 如果是竞品详情页抓取，跳过竞品ASIN提取（避免"竞品的竞品"循环）
  if (skipCompetitorExtraction) {
    console.log(`⏭️ 跳过竞品ASIN提取（skipCompetitorExtraction=true）`)
  } else {
    // Amazon推荐区域选择器（2024-2025版本）
    const relatedAsinSelectors = [
      // Frequently bought together
      '#sims-fbt a[href*="/dp/"]',
      '#sims-fbt-content a[href*="/dp/"]',
      '[data-csa-c-slot-id="sims-fbt"] a[href*="/dp/"]',
      // Customers also viewed/bought
      '[data-csa-c-slot-id="sims_purchase"] a[href*="/dp/"]',
      '[data-csa-c-slot-id="sims_viewed"] a[href*="/dp/"]',
      '[data-csa-c-slot-id="sims_considered"] a[href*="/dp/"]',
      // Compare with similar items
      '#similarities_feature_div a[href*="/dp/"]',
      '[data-feature-name="similarities"] a[href*="/dp/"]',
      // Sponsored products
      '#sp_detail a[href*="/dp/"]',
      '#sp_detail2 a[href*="/dp/"]',
      // Carousel containers
      '.a-carousel-card a[href*="/dp/"]',
      '[data-a-carousel-options] a[href*="/dp/"]',
    ]

    console.log(`🔍 开始竞品候选ASIN提取...`)

    // 策略1：从链接提取ASIN
    for (const selector of relatedAsinSelectors) {
      $(selector).each((_i: number, el: any) => {
        if (relatedAsins.length >= 10) return false
        const href = $(el).attr('href') || ''
        const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
        if (asinMatch && asinMatch[1] !== asin && !relatedAsins.includes(asinMatch[1])) {
          relatedAsins.push(asinMatch[1])
        }
      })
      if (relatedAsins.length >= 10) break
    }

    // 策略2：从data-asin属性提取（Fallback）
    if (relatedAsins.length < 5) {
      const recommendationContainers = [
        '#sims-fbt', '#sims-fbt-content', '[data-csa-c-slot-id*="sims"]',
        '#similarities_feature_div', '.a-carousel-container'
      ]
      for (const containerSelector of recommendationContainers) {
        $(containerSelector).find('[data-asin]').each((_i: number, el: any) => {
          if (relatedAsins.length >= 10) return false
          const dataAsin = $(el).attr('data-asin')
          if (dataAsin && dataAsin.length === 10 && /^[A-Z0-9]+$/.test(dataAsin) &&
              dataAsin !== asin && !relatedAsins.includes(dataAsin)) {
            relatedAsins.push(dataAsin)
          }
        })
        if (relatedAsins.length >= 10) break
      }
    }

    console.log(`🔥 竞品候选ASIN提取完成: 找到 ${relatedAsins.length} 个候选（品牌过滤将在详情页抓取后进行）`)
  }

  // Extract prices
  const currentPrice = $('.a-price .a-offscreen').first().text().trim() ||
                       $('#priceblock_ourprice').text().trim() ||
                       $('#price_inside_buybox').text().trim() ||
                       null

  const originalPrice = $('.a-price[data-a-strike="true"] .a-offscreen').text().trim() ||
                        $('.priceBlockStrikePriceString').text().trim() ||
                        null

  const discount = $('.savingsPercentage').text().trim() ||
                   $('[data-hook="price-above-strike"] span').text().trim() ||
                   null

  // 🎯 优化产品名称提取 - 按优先级尝试核心产品区域（包含桌面版和移动版）
  const titleSelectors = [
    // === 桌面版选择器 ===
    '#ppd #productTitle',
    '#centerCol #productTitle',
    '#dp-container #productTitle',
    '#productTitle',
    // === 移动版选择器 (a-m-us页面) ===
    '#title_feature_div h1 span',
    '#title_feature_div span.a-text-bold',
    '#title span.a-text-bold',
    '#title',
    '[data-hook="product-title"]',
    '.a-size-large.a-text-bold',
  ]
  let productName: string | null = null
  for (const selector of titleSelectors) {
    const title = $(selector).text().trim()
    if (title && title.length > 5) {
      productName = title
      break
    }
  }

  // 🎯 优化产品描述提取 - 限定在核心产品区域（包含桌面版和移动版）
  const descriptionSelectors = [
    // === 桌面版选择器 ===
    '#ppd #feature-bullets',
    '#centerCol #feature-bullets',
    '#dp-container #feature-bullets',
    '#feature-bullets',
    '#productDescription',
    '[data-feature-name="featurebullets"]',
    // === 移动版选择器 (a-m-us页面) ===
    '#featurebullets_feature_div',
    '[data-hook="product-description"]',
    '.a-expander-content',
    '#aplus_feature_div',
  ]
  let productDescription: string | null = null
  for (const selector of descriptionSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      const desc = $el.text().trim()
      if (desc && desc.length > 20) {
        productDescription = desc
        break
      }
    }
  }

  // 品牌名已在前面提取（用于竞品过滤），这里可以使用productName进一步验证
  if (!brandName) {
    brandName = extractBrandName($, url, productName, technicalDetails)
  }

  const productData: AmazonProductData = {
    productName,
    productDescription,
    productPrice: currentPrice,
    originalPrice,
    discount,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    features,
    aboutThisItem: features,  // Amazon #feature-bullets 就是 "About this item"
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 5),
    rating,
    reviewCount,
    salesRank,
    badge,  // 🎯 P3优化: Amazon trust badge
    availability,
    primeEligible,
    reviewHighlights: reviewHighlights.slice(0, 10),
    topReviews: topReviews.slice(0, 5),
    technicalDetails,
    asin,
    category,
    relatedAsins,  // 🔥 新增：竞品ASIN列表
  }

  console.log(`✅ 抓取成功: ${productData.productName || 'Unknown'}`)
  console.log(`⭐ 评分: ${rating || 'N/A'}, 评论数: ${reviewCount || 'N/A'}, 销量排名: ${salesRank || 'N/A'}`)
  console.log(`🎯 P3 Badge: ${badge || 'None'}`)  // P3优化: 显示badge提取结果

  return productData
}

/**
 * Extract brand name using multiple strategies
 */
function extractBrandName(
  $: any,
  url: string,
  productName: string | null,
  technicalDetails: Record<string, string>
): string | null {
  let brandName: string | null = null

  // 检查元素是否在推荐区域
  const recommendationKeywords = [
    'also bought', 'also viewed', 'frequently bought together',
    'customers who bought', 'related products', 'similar items',
    'sponsored products', 'customers also shopped for', 'compare with similar',
    'recommended for you', 'more items to explore'
  ]

  const isInRecommendationArea = (el: any): boolean => {
    const $el = $(el)
    const parents = $el.parents().toArray()

    for (const parent of parents) {
      const $parent = $(parent)
      const text = $parent.text().toLowerCase()
      const id = ($parent.attr('id') || '').toLowerCase()
      const className = ($parent.attr('class') || '').toLowerCase()

      if (recommendationKeywords.some(keyword => text.includes(keyword))) {
        return true
      }

      if (id.includes('sims') || id.includes('related') || id.includes('sponsored') ||
          className.includes('sims') || className.includes('related') || className.includes('sponsored')) {
        return true
      }
    }
    return false
  }

  // 策略1: 从核心产品区域的品牌链接提取（主要方法）
  const brandSelectors = [
    '#ppd #bylineInfo',
    '#centerCol #bylineInfo',
    '#dp-container #bylineInfo',
    '#bylineInfo',
    'a#bylineInfo',
    '[data-feature-name="bylineInfo"]',
  ]

  for (const selector of brandSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      let brand = $el.text().trim()

      // 🌍 多语言品牌店铺文本清理
      brand = cleanBrandText(brand)

      if (brand && brand.length > 1 && brand.length < 50) {
        brandName = brand
        console.log(`✅ 策略1成功: 从选择器${selector}提取品牌 "${brandName}"`)
        break
      }
    }
  }

  // 🔥 策略1.5: 从Product Overview表格提取Brand（截图中的"Brand: Coziley"格式）
  if (!brandName) {
    // 方法1: 遍历productOverview表格行
    $('#productOverview_feature_div tr, #poExpander tr').each((i: number, el: any) => {
      if (brandName) return false // 已找到则停止
      const label = $(el).find('td.a-span3, td:first-child').text().trim().toLowerCase()
      if (label === 'brand' || label.includes('brand')) {
        const value = $(el).find('td.a-span9, td:last-child').text().trim()
        if (value && value.length > 1 && value.length < 50) {
          brandName = value
          console.log(`✅ 策略1.5成功: 从Product Overview表格提取品牌 "${brandName}"`)
        }
      }
    })

    // 方法2: 直接查找包含Brand的行
    if (!brandName) {
      $('tr').each((i: number, el: any) => {
        if (brandName) return false
        const labelText = $(el).find('td:first-child, th').text().trim().toLowerCase()
        if (labelText === 'brand') {
          const value = $(el).find('td:last-child').text().trim()
          if (value && value.length > 1 && value.length < 50 && !isInRecommendationArea(el)) {
            brandName = value
            console.log(`✅ 策略1.5b成功: 从表格行提取品牌 "${brandName}"`)
          }
        }
      })
    }
  }

  // 策略2: 从data属性获取
  if (!brandName) {
    const dataBrand = $('[data-brand]').attr('data-brand')
    if (dataBrand && dataBrand.length > 1 && dataBrand.length < 50) {
      brandName = dataBrand
      console.log(`✅ 策略2成功: 从data-brand属性提取 "${brandName}"`)
    }
  }

  // 策略2.5: 从technicalDetails.Brand提取
  if (!brandName && technicalDetails.Brand) {
    const techBrand = technicalDetails.Brand.toString().trim()
      .replace(/^‎/, '') // 移除Unicode左到右标记
      .replace(/^Brand:\s*/i, '')
    if (techBrand && techBrand.length > 1 && techBrand.length < 50) {
      brandName = techBrand
      console.log(`✅ 策略2.5成功: 从technicalDetails.Brand提取 "${brandName}"`)
    }
  }

  // 策略3: 从产品标题智能提取
  if (!brandName && productName) {
    const titleParts = productName.split(/[\s-,|]+/)
    if (titleParts.length > 0) {
      const potentialBrand = titleParts[0].trim()
      if (potentialBrand.length >= 2 && potentialBrand.length <= 20) {
        const isValidBrand = /^[A-Za-z][A-Za-z0-9&\s-]*$/.test(potentialBrand) ||
                            /^[A-Z0-9]+$/.test(potentialBrand)
        if (isValidBrand) {
          brandName = potentialBrand
          console.log(`✅ 策略3成功: 从产品标题提取品牌 "${brandName}"`)
        }
      }
    }
  }

  // 策略4: 从Amazon URL中提取
  if (!brandName) {
    const urlBrandMatch = url.match(/amazon\.com\/stores\/([^\/]+)/) ||
                          url.match(/amazon\.com\/([A-Z][A-Za-z0-9-]+)\/s\?/)
    if (urlBrandMatch && urlBrandMatch[1]) {
      const urlBrand = decodeURIComponent(urlBrandMatch[1])
        .replace(/-/g, ' ')
        .replace(/\+/g, ' ')
        .trim()
      if (urlBrand.length >= 2 && urlBrand.length <= 30 && !urlBrand.includes('page')) {
        brandName = urlBrand
        console.log(`✅ 策略4成功: 从URL提取品牌 "${brandName}"`)
      }
    }
  }

  // 策略5: 从meta标签提取
  if (!brandName) {
    const metaBrand = $('meta[property="og:brand"]').attr('content') ||
                     $('meta[name="brand"]').attr('content')
    if (metaBrand && metaBrand.length > 1 && metaBrand.length < 50) {
      brandName = metaBrand
      console.log(`✅ 策略5成功: 从meta标签提取品牌 "${brandName}"`)
    }
  }

  // 最后清洗：去除常见后缀
  if (brandName) {
    brandName = brandName
      .replace(/\s+(Official|Store|Shop|Brand)$/i, '')
      .trim()
  }

  if (!brandName) {
    console.warn('⚠️ 所有品牌提取策略均失败，返回null')
  }

  return brandName
}

/**
 * Clean brand text by removing store visit prefixes in multiple languages
 */
function cleanBrandText(brand: string): string {
  // English (US, CA, AU, GB, IN, SG): "Visit the Brand Store"
  brand = brand.replace(/^Visit\s+the\s+/i, '').replace(/\s+Store$/i, '')

  // Italian (IT): "Visita lo Store di Brand", "Visita il/la/le/i/gli Brand"
  brand = brand.replace(/^Visita\s+(lo|il|la|le|i|gli)\s+/i, '')
  brand = brand.replace(/^(Store|Negozio)\s+(di\s+)?/i, '')

  // French (FR, BE, CA-FR): "Visitez la boutique de Brand"
  brand = brand.replace(/^Visitez\s+(la|le|les)\s+/i, '')
  brand = brand.replace(/^Boutique\s+(de\s+)?/i, '')

  // German (DE, AT, CH): "Besuchen Sie den Brand-Shop"
  brand = brand.replace(/^Besuchen\s+Sie\s+(den|die|das)\s+/i, '').replace(/-Shop$/i, '')

  // Spanish (ES, MX, AR, CL, CO, PE): "Visita la tienda de Brand"
  brand = brand.replace(/^Visita\s+(la|el)\s+/i, '')
  brand = brand.replace(/^Tienda\s+(de\s+)?/i, '')

  // Portuguese (BR, PT): "Visite a loja da Brand"
  brand = brand.replace(/^Visite\s+a\s+/i, '')
  brand = brand.replace(/^Loja\s+(da\s+)?/i, '')

  // Japanese (JP): "ブランド 出品者のストアにアクセス"
  brand = brand.replace(/\s*出品者のストアにアクセス$/i, '')
  brand = brand.replace(/のストアを表示$/i, '')

  // Dutch (NL, BE-NL): "Bezoek de Brand-winkel"
  brand = brand.replace(/^Bezoek\s+de\s+/i, '').replace(/-winkel$/i, '')

  // Polish (PL): "Odwiedź sklep Brand"
  brand = brand.replace(/^Odwiedź\s+/i, '')
  brand = brand.replace(/^Sklep\s+/i, '')

  // Turkish (TR): "Brand Mağazasını ziyaret edin"
  brand = brand.replace(/\s+Mağazasını\s+ziyaret\s+edin$/i, '')

  // Swedish (SE): "Besök Brand-butiken"
  brand = brand.replace(/^Besök\s+/i, '').replace(/-butiken$/i, '')

  // Arabic (AE, SA, EG): RTL text patterns
  brand = brand.replace(/زيارة\s+متجر\s+/i, '')
  brand = brand.replace(/\s+متجر$/i, '')

  // Chinese (CN): "访问 Brand 店铺"
  brand = brand.replace(/^访问\s+/i, '').replace(/\s+店铺$/i, '')
  brand = brand.replace(/^查看\s+/i, '').replace(/\s+品牌店$/i, '')

  // Korean (KR): "Brand 스토어 방문하기"
  brand = brand.replace(/\s+스토어\s+방문하기$/i, '')

  // Hindi (IN): "Brand स्टोर पर जाएं"
  brand = brand.replace(/\s+स्टोर\s+पर\s+जाएं$/i, '')

  // General cleanup for "Brand:" labels in multiple languages
  brand = brand.replace(/^Brand:\s*/i, '')
    .replace(/^品牌:\s*/i, '')
    .replace(/^Marca:\s*/i, '')
    .replace(/^Marque:\s*/i, '')
    .replace(/^Marke:\s*/i, '')
    .replace(/^Merk:\s*/i, '')
    .replace(/^Marka:\s*/i, '')
    .replace(/^Märke:\s*/i, '')
    .replace(/^ブランド:\s*/i, '')
    .replace(/^브랜드:\s*/i, '')
    .replace(/^العلامة التجارية:\s*/i, '')

  return brand
}
