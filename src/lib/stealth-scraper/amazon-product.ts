/**
 * Amazon Product Scraping
 *
 * Single Amazon product page scraping with comprehensive data extraction
 */

import { normalizeBrandName } from '../offer-utils'
import { parsePrice } from '../pricing-utils'  // 🔥 新增：统一价格解析函数
import { getPlaywrightPool } from '../playwright-pool'
import { isProxyConnectionError } from './proxy-utils'
import { createStealthBrowser, releaseBrowser, configureStealthPage, randomDelay } from './browser-stealth'
import { scrapeUrlWithBrowser } from './core'
import { smartWaitForLoad } from '../smart-wait-strategy'
import type { BrowserContext, Page } from 'playwright'
import type { AmazonProductData } from './types'

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * 🔥 KISS优化：清理ASIN格式
 * Amazon页面数据中ASIN可能包含deal后缀如 "B0DCFNZF32:amzn1.deal.xxx"
 * 只保留标准10位ASIN部分
 */
function cleanAsin(asin: string | null | undefined): string | null {
  if (!asin) return null
  // 移除冒号及其后的所有内容（deal后缀）
  const cleaned = asin.split(':')[0]
  // 验证是否为有效的10位ASIN格式
  if (/^[A-Z0-9]{10}$/.test(cleaned)) {
    return cleaned
  }
  return null
}

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

        // 🔥 2025-12-11优化: 增加重试次数，a-no-js失败最多重试2次（使用不同代理IP）
        const maxNoJsRetries = 2
        for (let noJsRetry = 1; noJsRetry <= maxNoJsRetries; noJsRetry++) {
          console.warn(`🔄 a-no-js重试 ${noJsRetry}/${maxNoJsRetries}，清理代理缓存并使用新IP...`)

          // 清理代理IP缓存，强制获取新IP
          const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
          clearProxyCache(effectiveProxyUrl)
          console.log(`🧹 已清理代理IP缓存，下次将获取新IP`)

          // 清理连接池实例（确保不复用被标记的浏览器实例）
          const pool = getPlaywrightPool()
          await pool.clearIdleInstances()

          // 🔥 2025-12-11优化: 增加重试间隔，避免触发频率限制
          // 第一次重试等待3-5秒，第二次等待5-8秒
          const retryDelay = noJsRetry === 1
            ? 3000 + Math.random() * 2000
            : 5000 + Math.random() * 3000
          console.log(`⏰ 等待${Math.round(retryDelay)}ms后使用新代理IP重试...`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))

          // 重新抓取（会自动获取新的代理IP）
          result = await scrapeUrlWithBrowser(url, effectiveProxyUrl, {
            waitForSelector: '#productTitle',
            waitForTimeout: quickTimeout,
            targetCountry,
          })

          // 检查重试结果
          const retryHtmlTagMatch = result.html?.match(/<html[^>]*class="([^"]*)"/)
          const retryHtmlClasses = retryHtmlTagMatch ? retryHtmlTagMatch[1] : ''
          const retryHasNoJs = retryHtmlClasses.includes('a-no-js') && !retryHtmlClasses.includes('a-js')

          if (!retryHasNoJs) {
            console.log(`✅ a-no-js重试${noJsRetry}成功，<html>标签已正确包含a-js类`)
            break  // 成功，退出重试循环
          } else if (noJsRetry < maxNoJsRetries) {
            console.warn(`⚠️ a-no-js重试${noJsRetry}失败，继续重试...`)
            console.warn(`🔍 重试${noJsRetry}后classes: ${retryHtmlClasses.substring(0, 100)}...`)
          } else {
            // 最后一次重试也失败
            console.error(`🚨 a-no-js重试${maxNoJsRetries}次后仍失败，Amazon反爬虫可能升级`)
            console.error(`🔍 最终classes: ${retryHtmlClasses.substring(0, 100)}...`)
            console.error(`💡 建议: 检查代理IP质量，或稍后重试`)
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
 * 🔥 2025-12-12 内存优化: 复用已有BrowserContext抓取产品
 *
 * 用于深度抓取场景，避免每个商品都创建新浏览器实例
 * 内存节省: 从6个浏览器/Offer降低到1个浏览器/Offer
 *
 * @param context - 已有的BrowserContext（由调用方管理生命周期）
 * @param url - 产品URL
 * @param targetCountry - 目标国家
 * @param skipCompetitorExtraction - 是否跳过竞品提取
 */
export async function scrapeAmazonProductWithContext(
  context: BrowserContext,
  url: string,
  targetCountry?: string,
  skipCompetitorExtraction: boolean = true
): Promise<AmazonProductData> {
  console.log(`🛒 [复用Context] 抓取Amazon产品: ${url}`)

  const page = await context.newPage()

  try {
    // 配置stealth页面
    await configureStealthPage(page, targetCountry)

    // 导航前随机延迟（模拟人类行为）
    await randomDelay(300, 800)

    // 导航到产品页面
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // 等待关键元素
    const productSelectors = [
      '#productTitle',
      'span[id="productTitle"]',
      '#title_feature_div h1',
      '#dp-container',
    ]

    let selectorFound = false
    for (const selector of productSelectors) {
      const found = await page.waitForSelector(selector, {
        timeout: 5000,
        state: 'visible'
      }).then(() => true).catch(() => false)

      if (found) {
        selectorFound = true
        break
      }
    }

    if (!selectorFound) {
      console.warn(`⚠️ [复用Context] 产品选择器未找到，继续尝试解析`)
    }

    // 智能等待页面加载
    await smartWaitForLoad(page, url, { maxWaitTime: 8000 }).catch(() => {})

    // 模拟人类滚动
    await page.evaluate(() => window.scrollBy(0, Math.random() * 300 + 100)).catch(() => {})
    await randomDelay(500, 1000)

    // 获取HTML并解析
    const html = await page.content()
    const { load } = await import('cheerio')
    const $ = load(html)

    // 解析产品数据
    const productData = parseAmazonProductHtml($, url, skipCompetitorExtraction)

    console.log(`✅ [复用Context] 抓取成功: ${productData.productName?.substring(0, 50) || 'Unknown'}...`)

    return productData

  } finally {
    // 🔥 关键：确保Page在finally中关闭，防止内存泄漏
    await page.close().catch((e) => {
      console.warn(`⚠️ [复用Context] Page关闭失败: ${e.message}`)
    })
  }
}

/**
 * 🔥 P1优化: 从JSON-LD结构化数据提取产品信息（最稳定的数据源）
 * Amazon页面通常包含Schema.org格式的JSON-LD数据，比DOM选择器更稳定
 */
interface JsonLdProductData {
  name?: string
  brand?: string
  description?: string
  price?: string
  currency?: string
  rating?: string
  reviewCount?: string
  sku?: string  // ASIN
  image?: string[]
  availability?: string
  category?: string
}

function extractJsonLdData($: any): JsonLdProductData | null {
  const result: JsonLdProductData = {}
  let foundProduct = false

  try {
    // 遍历所有JSON-LD脚本标签
    $('script[type="application/ld+json"]').each((_i: number, el: any) => {
      try {
        const jsonText = $(el).html()
        if (!jsonText) return

        const data = JSON.parse(jsonText)

        // 处理数组格式（Amazon有时用@graph数组）
        const items = Array.isArray(data) ? data : (data['@graph'] || [data])

        for (const item of items) {
          // 检查是否是Product类型
          const itemType = item['@type']
          if (itemType === 'Product' || (Array.isArray(itemType) && itemType.includes('Product'))) {
            foundProduct = true

            // 提取产品名称
            if (item.name && !result.name) {
              result.name = item.name
            }

            // 提取品牌
            if (item.brand && !result.brand) {
              if (typeof item.brand === 'string') {
                result.brand = item.brand
              } else if (item.brand.name) {
                result.brand = item.brand.name
              }
            }

            // 提取描述
            if (item.description && !result.description) {
              result.description = item.description
            }

            // 提取SKU/ASIN
            if (item.sku && !result.sku) {
              result.sku = item.sku
            }
            if (item.productID && !result.sku) {
              result.sku = item.productID
            }

            // 提取图片
            if (item.image && !result.image) {
              if (Array.isArray(item.image)) {
                result.image = item.image.slice(0, 5)
              } else if (typeof item.image === 'string') {
                result.image = [item.image]
              }
            }

            // 提取类别
            if (item.category && !result.category) {
              result.category = item.category
            }

            // 提取价格（Offers结构）
            if (item.offers && !result.price) {
              const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers
              if (offers.price) {
                result.price = String(offers.price)
                result.currency = offers.priceCurrency || 'USD'
              }
              if (offers.availability) {
                // 简化availability URL为可读状态
                const availUrl = offers.availability
                if (availUrl.includes('InStock')) {
                  result.availability = 'In Stock'
                } else if (availUrl.includes('OutOfStock')) {
                  result.availability = 'Out of Stock'
                } else if (availUrl.includes('LimitedAvailability')) {
                  result.availability = 'Limited Availability'
                } else {
                  result.availability = availUrl.split('/').pop() || 'Unknown'
                }
              }
            }

            // 提取评分（AggregateRating结构）
            if (item.aggregateRating && !result.rating) {
              const aggRating = item.aggregateRating
              if (aggRating.ratingValue) {
                result.rating = String(aggRating.ratingValue)
              }
              if (aggRating.reviewCount) {
                result.reviewCount = String(aggRating.reviewCount)
              } else if (aggRating.ratingCount) {
                result.reviewCount = String(aggRating.ratingCount)
              }
            }
          }
        }
      } catch (parseError) {
        // 单个JSON-LD解析失败，继续处理其他标签
        console.warn(`⚠️ JSON-LD解析警告: ${(parseError as Error).message?.substring(0, 50)}`)
      }
    })

    if (foundProduct) {
      console.log(`✅ JSON-LD提取成功: ${result.name?.substring(0, 50) || 'Unknown'}...`)
      console.log(`   品牌: ${result.brand || 'N/A'}, 价格: ${result.price || 'N/A'} ${result.currency || ''}`)
      console.log(`   评分: ${result.rating || 'N/A'}, 评论数: ${result.reviewCount || 'N/A'}`)
      return result
    }
  } catch (error) {
    console.warn(`⚠️ JSON-LD整体提取失败: ${(error as Error).message?.substring(0, 100)}`)
  }

  return null
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

  // 🔥 P1优化: 首先提取JSON-LD结构化数据作为可靠的备份数据源
  const jsonLdData = extractJsonLdData($)

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

  // Extract rating and review count - 支持桌面版和移动版
  const ratingText = $('#acrPopover').attr('title') ||
                     $('span[data-hook="rating-out-of-text"]').text().trim() ||
                     $('.a-icon-star span').first().text().trim() ||
                     // === 移动版选择器 (a-m-* 页面) ===
                     $('[data-hook="cr-state-object"]').attr('data-state')?.match(/"averageStarRating":([\d.]+)/)?.[1] ||
                     $('.a-icon-alt').first().text().trim() ||
                     $('i.a-icon-star-medium + span').text().trim()
  const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

  const reviewCountText = $('#acrCustomerReviewText').text().trim() ||
                          $('span[data-hook="total-review-count"]').text().trim() ||
                          // === 移动版选择器 (a-m-* 页面) ===
                          $('[data-hook="cr-state-object"]').attr('data-state')?.match(/"totalReviewCount":(\d+)/)?.[1] ||
                          $('a[href*="customerReviews"]').text().trim() ||
                          $('.a-link-normal[href*="reviews"]').first().text().trim()
  const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

  // Extract sales rank
  const salesRankText = $('#productDetails_detailBullets_sections1 tr:contains("Best Sellers Rank")').text().trim() ||
                        $('#SalesRank').text().trim() ||
                        $('th:contains("Best Sellers Rank")').next().text().trim()
  const salesRank = salesRankText ? salesRankText.match(/#[\d,]+/)?.[0] || null : null

  // 🎯 P3优化: Extract badge (Amazon's Choice, Best Seller, etc.) - 支持桌面版和移动版
  let badge: string | null = null

  // Strategy 1: Amazon's Choice badge (最常见)
  const amazonChoiceBadge = $('.ac-badge-wrapper .ac-badge-text-primary').text().trim() ||
                            $('span.a-badge-text:contains("Amazon\'s Choice")').text().trim() ||
                            $('[data-a-badge-color="sx-gulfstream"] span.a-badge-text').text().trim() ||
                            // === 移动版选择器 (a-m-* 页面) ===
                            $('[data-feature-name="acBadge"] .a-badge-text').text().trim() ||
                            $('i.a-icon-ac').parent().text().trim()

  // Strategy 2: Best Seller badge (从多个位置检测)
  const bestSellerBadge = $('#zeitgeist-module .a-badge-text').text().trim() ||
                          $('.badge-wrapper .badge-text:contains("Best Seller")').text().trim() ||
                          $('span:contains("#1 Best Seller")').first().text().trim() ||
                          // === 移动版选择器 (a-m-* 页面) ===
                          $('[data-feature-name="zeitgeist"] .a-badge-text').text().trim() ||
                          $('i.a-icon-bestseller').parent().text().trim()

  // Strategy 3: Generic badge detection (捕获其他badge)
  const genericBadge = $('.a-badge-text').first().text().trim() ||
                       $('i.a-icon-addon-badge').parent().text().trim() ||
                       // === 移动版选择器 (a-m-* 页面) ===
                       $('[data-component-type="badge"]').text().trim()

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

  // Extract availability - 支持桌面版和移动版
  // 🔥 2025-12-10优化：避免#availability包含JavaScript代码污染的问题
  // 优先使用更精确的选择器，按可靠性顺序排列
  const availability = (() => {
    // 策略1: 使用颜色类选择器（最可靠，避免JS代码）
    const colorPrice = $('#availability .a-color-price').first().text().trim()
    if (colorPrice && colorPrice.length < 200) return colorPrice

    const colorSuccess = $('#availability .a-color-success').first().text().trim()
    if (colorSuccess && colorSuccess.length < 200) return colorSuccess

    const colorState = $('#availability .a-color-state').first().text().trim()
    if (colorState && colorState.length < 200) return colorState

    // 策略2: #outOfStock 区域（缺货商品）
    const outOfStock = $('#outOfStock').first().text().trim()
    if (outOfStock && outOfStock.length > 5 && outOfStock.length < 200) {
      // 清理多余空白和换行
      return outOfStock.replace(/\s+/g, ' ').split('Deliver to')[0].trim()
    }

    // 策略3: 直接子span（过滤掉script标签的文本）
    const directSpan = $('#availability > span').first().text().trim()
    if (directSpan && directSpan.length > 5 && directSpan.length < 200 && !directSpan.includes('function')) {
      return directSpan
    }

    // === 移动版选择器 (a-m-* 页面) ===
    const deliveryMsg = $('#deliveryMessage_feature_div').text().trim()
    if (deliveryMsg && deliveryMsg.length < 200) return deliveryMsg

    const deliveryPrice = $('[data-csa-c-delivery-price]').text().trim()
    if (deliveryPrice && deliveryPrice.length < 200) return deliveryPrice

    const mirLayout = $('#mir-layout-DELIVERY_BLOCK').text().trim()
    if (mirLayout && mirLayout.length < 200) return mirLayout

    return null
  })()

  // Check Prime eligibility - 支持桌面版和移动版
  const primeEligible = $('#primeEligibilityMessage').length > 0 ||
                        $('.a-icon-prime').length > 0 ||
                        $('[data-feature-name="primeEligible"]').length > 0 ||
                        // === 移动版选择器 (a-m-* 页面) ===
                        $('i.a-icon-prime-m').length > 0 ||
                        $('[data-action="show-prime-delivery"]').length > 0 ||
                        $('span:contains("FREE Prime")').length > 0

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

  // 🔥 P2优化: 提取评论关键词/主题（Amazon Review Topics，用于广告创意）
  const reviewKeywords: string[] = []

  // 策略1: 从"Read reviews that mention"部分提取
  $('[data-hook="lighthut-term"], .cr-lighthouse-term, [data-hook="review-filter-tag"]').each((_i: number, el: any) => {
    const keyword = $(el).text().trim().toLowerCase()
    if (keyword && keyword.length >= 2 && keyword.length <= 30 && !reviewKeywords.includes(keyword)) {
      reviewKeywords.push(keyword)
    }
  })

  // 策略2: 从评论标签/过滤器提取
  if (reviewKeywords.length === 0) {
    $('.cr-vote-buttons + span, [data-hook="review-filter"], .a-declarative[data-action="reviews:filter"]').each((_i: number, el: any) => {
      const keyword = $(el).text().trim().toLowerCase()
      if (keyword && keyword.length >= 2 && keyword.length <= 30 && !reviewKeywords.includes(keyword)) {
        reviewKeywords.push(keyword)
      }
    })
  }

  // 策略3: 从AI评论摘要中提取关键特征（如果有）
  const aiSummary = $('[data-hook="cr-product-feedback"], #cr-product-feedback').text().trim()
  if (aiSummary && aiSummary.length > 20) {
    // 提取常见的产品属性关键词
    const attributePatterns = [
      /quality/gi, /value/gi, /price/gi, /easy to use/gi, /setup/gi,
      /durable/gi, /performance/gi, /design/gi, /size/gi, /comfort/gi,
      /noise/gi, /battery/gi, /speed/gi, /material/gi, /sturdy/gi,
    ]
    for (const pattern of attributePatterns) {
      if (pattern.test(aiSummary)) {
        const keyword = pattern.source.replace(/\\s/g, ' ').toLowerCase()
        if (!reviewKeywords.includes(keyword)) {
          reviewKeywords.push(keyword)
        }
      }
    }
  }

  if (reviewKeywords.length > 0) {
    console.log(`🏷️ 评论关键词: ${reviewKeywords.slice(0, 5).join(', ')}${reviewKeywords.length > 5 ? '...' : ''}`)
  }

  // Extract technical details - 支持桌面版和移动版
  const technicalDetails: Record<string, string> = {}
  // === 桌面版选择器 ===
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
  // === 移动版选择器 (a-m-* 页面) ===
  $('#productDetails_feature_div tr, #tech-specs-desktop tr').each((i: number, el: any) => {
    const key = $(el).find('th, .a-text-bold').first().text().trim()
    const value = $(el).find('td, .a-text-normal').last().text().trim()
    if (key && value && !technicalDetails[key]) {
      technicalDetails[key] = value
    }
  })
  // 🔥 2025-12-10优化：Product Overview表格提取（包含带图标的属性）
  // 使用.a-text-bold和.po-break-word精确分离label和value
  $('#productOverview_feature_div tr, #poExpander tr').each((i: number, el: any) => {
    // 跳过嵌套表格的父行（cellCount > 2 表示是包含嵌套表格的容器行）
    const directCells = $(el).children('td')
    if (directCells.length > 2) return  // 跳过容器行，让内部的tr处理

    // 使用.first()确保只获取第一个匹配元素
    const keyEl = $(el).find('.a-text-bold').first()
    const valueEl = $(el).find('.po-break-word').first()

    const key = keyEl.text().trim()
    const value = valueEl.text().trim()

    // 验证key和value是有效的（避免重复和空值）
    if (key && value && key !== value && !technicalDetails[key] && key.length < 50) {
      technicalDetails[key] = value
    }
  })

  // Extract ASIN - 使用cleanAsin确保格式正确
  const rawAsin = url.match(/\/dp\/([A-Z0-9]+)/)?.[1] ||
               $('input[name="ASIN"]').val()?.toString() ||
               $('th:contains("ASIN")').next().text().trim() ||
               null
  const asin = cleanAsin(rawAsin)

  // Extract category/breadcrumb - 支持桌面版和移动版
  const categoryParts: string[] = []
  // === 桌面版选择器 ===
  $('#wayfinding-breadcrumbs_feature_div li a').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text) categoryParts.push(text)
  })
  // === 移动版选择器 (a-m-* 页面) ===
  if (categoryParts.length === 0) {
    $('[data-feature-name="wayfinding-breadcrumbs"] a, .a-breadcrumb a').each((i: number, el: any) => {
      const text = $(el).text().trim()
      if (text) categoryParts.push(text)
    })
  }
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
    // 🔥 2025-12-12优化：精确竞品提取策略
    // 核心原则：只提取真正的竞品，排除配件/耗材/经常一起购买
    console.log(`🔍 开始精确竞品ASIN提取...`)

    // ========== 🎯 优先级0（最高）: A+内容比较表格 ==========
    // 品牌官方的竞品对比，最具参考价值
    const aplusCompetitors: string[] = []
    $('#aplus table [data-asin], #aplus [data-csa-c-item-id]').each((_i: number, el: any) => {
      if (aplusCompetitors.length >= 5) return false
      const dataAsin = $(el).attr('data-asin')
      const csaItemId = $(el).attr('data-csa-c-item-id')
      let competitorAsin: string | null = null

      // 使用cleanAsin确保ASIN格式正确（防止deal后缀等问题）
      if (dataAsin) {
        competitorAsin = cleanAsin(dataAsin)
      } else if (csaItemId && csaItemId.startsWith('amzn1.asin.')) {
        competitorAsin = cleanAsin(csaItemId.replace('amzn1.asin.', ''))
      }

      if (competitorAsin && competitorAsin !== asin && !aplusCompetitors.includes(competitorAsin)) {
        aplusCompetitors.push(competitorAsin)
        console.log(`  📊 A+比较表格竞品: ${competitorAsin}`)
      }
    })
    relatedAsins.push(...aplusCompetitors)
    if (aplusCompetitors.length > 0) {
      console.log(`✅ A+比较表格: 找到 ${aplusCompetitors.length} 个官方竞品`)
    }

    // ========== 🎯 优先级1: "Compare with similar items" 官方对比表格 ==========
    if (relatedAsins.length < 10) {
      $('#HLCXComparisonTable [data-asin], [data-feature-name="comparison"] [data-asin]').each((_i: number, el: any) => {
        if (relatedAsins.length >= 10) return false
        const dataAsin = $(el).attr('data-asin')
        const cleanedAsin = cleanAsin(dataAsin)
        if (cleanedAsin && cleanedAsin !== asin && !relatedAsins.includes(cleanedAsin)) {
          relatedAsins.push(cleanedAsin)
        }
      })
    }

    // ========== 🎯 优先级2: "Products related to this item" ==========
    if (relatedAsins.length < 10) {
      const relatedSelectors = [
        '#sp_detail .a-carousel-card a[href*="/dp/"]',
        '[data-component-type="sp_detail"] .a-carousel-card a[href*="/dp/"]',
        '#similarities_feature_div a[href*="/dp/"]',
        '[data-feature-name="similarities"] a[href*="/dp/"]',
      ]
      for (const selector of relatedSelectors) {
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
    }

    // ========== 🎯 优先级3: "Customers who viewed this item also viewed" ==========
    if (relatedAsins.length < 10) {
      const viewedSelectors = [
        '#sims-simsContainer_feature_div_01 a[href*="/dp/"]',
        '[data-csa-c-slot-id="sims_viewed"] a[href*="/dp/"]',
        '#sims-simsContainer_feature_div_11 a[href*="/dp/"]',
      ]
      for (const selector of viewedSelectors) {
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
    }

    // ========== 🚫 排除非竞品区域 ==========
    // 不从以下区域提取：配件、耗材、经常一起购买
    const excludedContainers = [
      '#sims-fbt',                    // "Frequently bought together" - 配件/耗材
      '#purchase-sims-feature',        // "Customers who bought this also bought" - 可能是配件
      '#session-sims-feature',
      '[data-component-type="sp_accessory"]',  // 配件推荐
      '#warranties_and_support',       // 保修服务
      '#addon-selector',               // 加购选项
    ]

    // ========== 🔄 Fallback: data-asin全局搜索（排除非竞品区域）==========
    if (relatedAsins.length < 5) {
      console.log(`🔄 精确提取不足（${relatedAsins.length}个），启用Fallback策略...`)

      // 构建排除选择器
      const excludeSelector = excludedContainers.join(', ')
      const excludeElements = $(excludeSelector).find('[data-asin]')
      const excludedAsins = new Set<string>()
      excludeElements.each((_i: number, el: any) => {
        const exAsin = $(el).attr('data-asin')
        if (exAsin) excludedAsins.add(exAsin)
      })

      // 从推荐区域提取（排除核心商品区域和非竞品区域）
      const coreProductSelectors = '#ppd, #dp-container, #centerCol, #rightCol, #buybox'
      $('[data-asin]')
        .not($(coreProductSelectors).find('[data-asin]'))
        .not($(excludeSelector).find('[data-asin]'))
        .each((_i: number, el: any) => {
          if (relatedAsins.length >= 10) return false
          const dataAsin = $(el).attr('data-asin')
          const cleanedAsin = cleanAsin(dataAsin)
          if (cleanedAsin && cleanedAsin !== asin && !relatedAsins.includes(cleanedAsin) && !excludedAsins.has(dataAsin || '')) {
            relatedAsins.push(cleanedAsin)
          }
        })
    }

    console.log(`🔥 精确竞品提取完成: ${relatedAsins.length} 个候选（A+:${aplusCompetitors.length}）`)
  }

  // Extract prices - 支持桌面版和移动版
  const currentPrice = $('.a-price .a-offscreen').first().text().trim() ||
                       $('#priceblock_ourprice').text().trim() ||
                       $('#price_inside_buybox').text().trim() ||
                       // === 移动版选择器 (a-m-* 页面) ===
                       $('#corePrice_feature_div .a-price .a-offscreen').first().text().trim() ||
                       $('[data-a-color="price"] .a-offscreen').first().text().trim() ||
                       $('.priceToPay .a-offscreen').first().text().trim() ||
                       $('#apex_offerDisplay_mobile .a-offscreen').first().text().trim() ||
                       null

  const originalPrice = $('.a-price[data-a-strike="true"] .a-offscreen').text().trim() ||
                        $('.priceBlockStrikePriceString').text().trim() ||
                        // === 移动版选择器 (a-m-* 页面) ===
                        $('.basisPrice .a-offscreen').text().trim() ||
                        $('[data-a-strike="true"] .a-offscreen').first().text().trim() ||
                        null

  const discount = $('.savingsPercentage').text().trim() ||
                   $('[data-hook="price-above-strike"] span').text().trim() ||
                   // === 移动版选择器 (a-m-* 页面) ===
                   $('.savingPriceOverride').text().trim() ||
                   $('[data-a-color="price"] .a-text-price').text().trim() ||
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

  // 🔥 P1优化: 使用JSON-LD数据作为备份（当DOM选择器失败时）
  const finalProductName = productName || jsonLdData?.name || null
  const finalBrandName = brandName || jsonLdData?.brand || null
  const finalRating = rating || jsonLdData?.rating || null
  const finalReviewCount = reviewCount || jsonLdData?.reviewCount || null
  const finalAvailability = availability || jsonLdData?.availability || null
  const finalCategory = category || jsonLdData?.category || null
  const finalAsin = asin || jsonLdData?.sku || null

  // 价格备份：如果DOM价格为空但JSON-LD有价格
  const finalPrice = currentPrice || (jsonLdData?.price
    ? (jsonLdData.currency ? `${jsonLdData.currency} ${jsonLdData.price}` : jsonLdData.price)
    : null)

  // 记录JSON-LD备份使用情况
  const jsonLdFallbacks: string[] = []
  if (!productName && jsonLdData?.name) jsonLdFallbacks.push('name')
  if (!brandName && jsonLdData?.brand) jsonLdFallbacks.push('brand')
  if (!rating && jsonLdData?.rating) jsonLdFallbacks.push('rating')
  if (!reviewCount && jsonLdData?.reviewCount) jsonLdFallbacks.push('reviewCount')
  if (!availability && jsonLdData?.availability) jsonLdFallbacks.push('availability')
  if (!currentPrice && jsonLdData?.price) jsonLdFallbacks.push('price')

  if (jsonLdFallbacks.length > 0) {
    console.log(`📋 JSON-LD备份字段: ${jsonLdFallbacks.join(', ')}`)
  }

  const productData: AmazonProductData = {
    productName: finalProductName,
    productDescription,
    productPrice: finalPrice,
    originalPrice,
    discount,
    brandName: finalBrandName ? normalizeBrandName(finalBrandName) : null,
    features,
    aboutThisItem: features,  // Amazon #feature-bullets 就是 "About this item"
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 5),
    rating: finalRating,
    reviewCount: finalReviewCount,
    salesRank,
    badge,  // 🎯 P3优化: Amazon trust badge
    availability: finalAvailability,
    primeEligible,
    reviewHighlights: reviewHighlights.slice(0, 10),
    topReviews: topReviews.slice(0, 5),
    technicalDetails,
    asin: finalAsin,
    category: finalCategory,
    relatedAsins,  // 🔥 新增：竞品ASIN列表
    // 🔥 P2优化: 评论关键词（用于广告创意）
    reviewKeywords: reviewKeywords.slice(0, 15),  // 最多15个关键词
  }

  console.log(`✅ 抓取成功: ${productData.productName || 'Unknown'}`)
  console.log(`⭐ 评分: ${finalRating || 'N/A'}, 评论数: ${finalReviewCount || 'N/A'}, 销量排名: ${salesRank || 'N/A'}`)
  console.log(`🎯 P3 Badge: ${badge || 'None'}`)  // P3优化: 显示badge提取结果

  return productData
}

/**
 * Extract brand name using multiple strategies with cross-validation
 * 🔥 2025-12-12重构：多渠道交叉验证，提高品牌提取准确性
 */
function extractBrandName(
  $: any,
  url: string,
  productName: string | null,
  technicalDetails: Record<string, string>
): string | null {
  // 🔥 多渠道收集品牌名候选
  interface BrandCandidate {
    value: string
    source: string
    confidence: number  // 1-5, 5 = 最高置信度
  }
  const candidates: BrandCandidate[] = []

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

  // ========== 渠道1: Product Overview表格 (置信度: 5) ==========
  $('#productOverview_feature_div tr, #poExpander tr').each((i: number, el: any) => {
    const label = $(el).find('td.a-span3, td:first-child').text().trim().toLowerCase()
    if (label === 'brand' || label.includes('brand')) {
      const value = $(el).find('td.a-span9, td:last-child').text().trim()
      if (value && value.length > 1 && value.length < 50) {
        candidates.push({ value, source: 'product-overview', confidence: 5 })
      }
    }
  })

  // 直接查找包含Brand的表格行
  $('tr').each((i: number, el: any) => {
    const labelText = $(el).find('td:first-child, th').text().trim().toLowerCase()
    if (labelText === 'brand') {
      const value = $(el).find('td:last-child').text().trim()
      if (value && value.length > 1 && value.length < 50 && !isInRecommendationArea(el)) {
        candidates.push({ value, source: 'table-row', confidence: 5 })
      }
    }
  })

  // ========== 渠道2: bylineInfo品牌链接 (置信度: 4) ==========
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
      brand = cleanBrandText(brand)
      if (brand && brand.length > 1 && brand.length < 50) {
        candidates.push({ value: brand, source: 'bylineInfo', confidence: 4 })
        break
      }
    }
  }

  // ========== 渠道3: data-brand属性 (置信度: 5) ==========
  const dataBrand = $('[data-brand]').attr('data-brand')
  if (dataBrand && dataBrand.length > 1 && dataBrand.length < 50) {
    candidates.push({ value: dataBrand, source: 'data-brand', confidence: 5 })
  }

  // ========== 渠道4: technicalDetails.Brand (置信度: 5) ==========
  if (technicalDetails.Brand) {
    const techBrand = technicalDetails.Brand.toString().trim()
      .replace(/^‎/, '')
      .replace(/^Brand:\s*/i, '')
    if (techBrand && techBrand.length > 1 && techBrand.length < 50) {
      candidates.push({ value: techBrand, source: 'technical-details', confidence: 5 })
    }
  }

  // ========== 渠道5: 产品标题首单词 (置信度: 2) ==========
  if (productName) {
    const titleParts = productName.split(/[\s-,|]+/)
    if (titleParts.length > 0) {
      const potentialBrand = titleParts[0].trim()
      if (potentialBrand.length >= 2 && potentialBrand.length <= 20) {
        const isValidBrand = /^[A-Za-z][A-Za-z0-9&\s-]*$/.test(potentialBrand) ||
                            /^[A-Z0-9]+$/.test(potentialBrand)
        if (isValidBrand) {
          candidates.push({ value: potentialBrand, source: 'product-title', confidence: 2 })
        }
      }
    }
  }

  // ========== 渠道6: URL中的品牌 (置信度: 3) ==========
  const urlBrandMatch = url.match(/amazon\.[a-z.]+\/stores\/([^\/]+)/) ||
                        url.match(/amazon\.[a-z.]+\/([A-Z][A-Za-z0-9-]+)\/s\?/)
  if (urlBrandMatch && urlBrandMatch[1]) {
    const urlBrand = decodeURIComponent(urlBrandMatch[1])
      .replace(/-/g, ' ')
      .replace(/\+/g, ' ')
      .trim()
    if (urlBrand.length >= 2 && urlBrand.length <= 30 && !urlBrand.includes('page')) {
      candidates.push({ value: urlBrand, source: 'url', confidence: 3 })
    }
  }

  // ========== 渠道7: meta标签 (置信度: 4) ==========
  const metaBrand = $('meta[property="og:brand"]').attr('content') ||
                   $('meta[name="brand"]').attr('content')
  if (metaBrand && metaBrand.length > 1 && metaBrand.length < 50) {
    candidates.push({ value: metaBrand, source: 'meta-tag', confidence: 4 })
  }

  // ========== 交叉验证逻辑 ==========
  if (candidates.length === 0) {
    console.warn('⚠️ 所有品牌提取渠道均无结果')
    return null
  }

  // 规范化函数：统一大小写，去除后缀
  const normalizeBrand = (brand: string): string => {
    return brand
      .toLowerCase()
      .replace(/\s+(official|store|shop|brand)$/i, '')
      .replace(/-(shop|store)$/i, '')
      .trim()
  }

  // 计算每个规范化品牌的总分（置信度 × 出现次数）
  const brandScores = new Map<string, { originalValue: string, totalScore: number, sources: string[] }>()

  for (const candidate of candidates) {
    const normalized = normalizeBrand(candidate.value)
    const existing = brandScores.get(normalized)

    if (existing) {
      existing.totalScore += candidate.confidence
      existing.sources.push(candidate.source)
      // 保留原始值中最长的（通常更完整）
      if (candidate.value.length > existing.originalValue.length) {
        existing.originalValue = candidate.value
      }
    } else {
      brandScores.set(normalized, {
        originalValue: candidate.value,
        totalScore: candidate.confidence,
        sources: [candidate.source]
      })
    }
  }

  // 选择得分最高的品牌
  let bestBrand: { normalized: string, data: { originalValue: string, totalScore: number, sources: string[] } } | null = null
  for (const [normalized, data] of brandScores) {
    if (!bestBrand || data.totalScore > bestBrand.data.totalScore) {
      bestBrand = { normalized, data }
    }
  }

  if (!bestBrand) {
    console.warn('⚠️ 品牌交叉验证失败')
    return null
  }

  // 输出交叉验证结果
  const verificationStatus = bestBrand.data.sources.length >= 2 ? '✅ 多渠道验证' : '⚠️ 单渠道'
  console.log(`${verificationStatus} 品牌名: "${bestBrand.data.originalValue}" (得分: ${bestBrand.data.totalScore}, 来源: ${bestBrand.data.sources.join(', ')})`)

  // 最终清洗
  let finalBrand = bestBrand.data.originalValue
    .replace(/\s+(Official|Store|Shop|Brand)$/i, '')
    .trim()

  return finalBrand
}

/**
 * Clean brand text by removing store visit prefixes in multiple languages
 * 🔥 2025-12-10优化：增强意大利站和欧洲站的品牌清洗
 */
function cleanBrandText(brand: string): string {
  // English (US, CA, AU, GB, IN, SG): "Visit the Brand Store"
  brand = brand.replace(/^Visit\s+the\s+/i, '').replace(/\s+Store$/i, '')

  // Italian (IT): 多种格式
  // - "Visita lo Store di Brand"
  // - "Visita il Brand Store"
  // - "Visita lo store Brand"
  // - "Brand Store" (简化版)
  brand = brand.replace(/^Visita\s+(lo|il|la|le|i|gli)\s+/i, '')
  brand = brand.replace(/^(Store|Negozio)\s+(di\s+)?/i, '')
  brand = brand.replace(/\s+(Store|Negozio)$/i, '')  // 🔥 新增：末尾的Store/Negozio
  brand = brand.replace(/\s+di\s+$/i, '')  // 🔥 新增：末尾的"di"

  // French (FR, BE, CA-FR): "Visitez la boutique de Brand"
  brand = brand.replace(/^Visitez\s+(la|le|les)\s+/i, '')
  brand = brand.replace(/^Boutique\s+(de\s+)?/i, '')
  brand = brand.replace(/\s+Boutique$/i, '')  // 🔥 新增

  // German (DE, AT, CH):
  // - 正式形式: "Besuchen Sie den Brand-Shop"
  // - 非正式形式: "Besuche den roborock-Store" 🔥 2025-12-12新增
  brand = brand.replace(/^Besuchen\s+Sie\s+(den|die|das)\s+/i, '')
  brand = brand.replace(/^Besuche\s+(den|die|das)\s+/i, '')  // 🔥 非正式形式
  brand = brand.replace(/-(Shop|Store)$/i, '')  // 🔥 合并处理 -Shop 和 -Store
  brand = brand.replace(/\s+(Shop|Store)$/i, '')  // 末尾的 Shop/Store

  // Spanish (ES, MX, AR, CL, CO, PE): "Visita la tienda de Brand"
  brand = brand.replace(/^Visita\s+(la|el)\s+/i, '')
  brand = brand.replace(/^Tienda\s+(de\s+)?/i, '')
  brand = brand.replace(/\s+Tienda$/i, '')  // 🔥 新增

  // Portuguese (BR, PT): "Visite a loja da Brand"
  brand = brand.replace(/^Visite\s+a\s+/i, '')
  brand = brand.replace(/^Loja\s+(da\s+)?/i, '')
  brand = brand.replace(/\s+Loja$/i, '')  // 🔥 新增

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
