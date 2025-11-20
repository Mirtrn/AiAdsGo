import { NextRequest, NextResponse } from 'next/server'
import { findOfferById, updateOfferScrapeStatus } from '@/lib/offers'
import { scrapeUrl } from '@/lib/scraper'
import { analyzeProductPage, ProductInfo } from '@/lib/ai'
import { getProxyUrlForCountry, isProxyEnabled } from '@/lib/settings'
import { getCachedPageData, setCachedPageData, SeoData } from '@/lib/redis'
import { getDatabase } from '@/lib/db'

/**
 * 🎯 Phase 3持久化: 保存抓取的产品数据到数据库
 */
async function saveScrapedProducts(
  offerId: number,
  products: any[],
  source: 'amazon_store' | 'independent_store'
): Promise<void> {
  const db = getDatabase()

  // 删除该Offer之前的产品数据（更新场景）
  const deleteStmt = db.prepare('DELETE FROM scraped_products WHERE offer_id = ?')
  deleteStmt.run(offerId)

  // 批量插入新的产品数据
  const insertStmt = db.prepare(`
    INSERT INTO scraped_products (
      offer_id, name, asin, price, rating, review_count, image_url,
      promotion, badge, is_prime,
      hot_score, rank, is_hot, hot_label,
      scrape_source, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, datetime('now'), datetime('now')
    )
  `)

  const insertMany = db.transaction((products: any[]) => {
    for (const product of products) {
      insertStmt.run(
        offerId,
        product.name,
        product.asin || null,
        product.price || null,
        product.rating || null,
        product.reviewCount || null,
        product.imageUrl || null,
        // Phase 3 fields
        product.promotion || null,
        product.badge || null,
        product.isPrime ? 1 : 0,
        // Phase 2 fields
        product.hotScore || null,
        product.rank || null,
        product.isHot ? 1 : 0,
        product.hotLabel || null,
        source
      )
    }
  })

  insertMany(products)

  console.log(`📊 Phase 3持久化: 已保存${products.length}个产品到数据库`)
}

/**
 * 从HTML中提取SEO信息
 */
async function extractSeoData(html: string): Promise<SeoData> {
  if (!html) {
    return {
      metaTitle: '',
      metaDescription: '',
      metaKeywords: '',
      ogTitle: '',
      ogDescription: '',
      ogImage: '',
      canonicalUrl: '',
      h1: [],
      imageAlts: [],
    }
  }

  const { load } = await import('cheerio')
  const $ = load(html)

  // 提取所有h1标签文本
  const h1: string[] = []
  $('h1').each((_, el) => {
    const text = $(el).text().trim()
    if (text && text.length > 0) {
      h1.push(text)
    }
  })

  // 提取图片alt文本（限制数量避免数据过大）
  const imageAlts: string[] = []
  $('img[alt]').each((_, el) => {
    const alt = $(el).attr('alt')?.trim()
    if (alt && alt.length > 3 && imageAlts.length < 20) {
      imageAlts.push(alt)
    }
  })

  return {
    metaTitle: $('title').text().trim(),
    metaDescription: $('meta[name="description"]').attr('content') || '',
    metaKeywords: $('meta[name="keywords"]').attr('content') || '',
    ogTitle: $('meta[property="og:title"]').attr('content') || '',
    ogDescription: $('meta[property="og:description"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    canonicalUrl: $('link[rel="canonical"]').attr('href') || '',
    h1,
    imageAlts,
  }
}

// 国家代码到语言代码的映射
const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  US: 'en',
  UK: 'en',
  CA: 'en',
  AU: 'en',
  CN: 'zh',
  TW: 'zh',
  HK: 'zh',
  JP: 'ja',
  KR: 'ko',
  DE: 'de',
  FR: 'fr',
  ES: 'es',
  IT: 'it',
  PT: 'pt',
  BR: 'pt',
}

/**
 * POST /api/offers/:id/scrape
 * 触发产品信息抓取和AI分析
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const offer = findOfferById(parseInt(id, 10), parseInt(userId, 10))

    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 更新状态为抓取中
    updateOfferScrapeStatus(offer.id, parseInt(userId, 10), 'in_progress')

    // 启动后台抓取任务（不等待完成）
    performScrapeAndAnalysis(offer.id, parseInt(userId, 10), offer.url, offer.brand)
      .catch(error => {
        console.error('后台抓取任务失败:', error)
        updateOfferScrapeStatus(
          offer.id,
          parseInt(userId, 10),
          'failed',
          error.message
        )
      })

    return NextResponse.json({
      success: true,
      message: '抓取任务已启动，请稍后查看结果',
    })
  } catch (error: any) {
    console.error('触发抓取失败:', error)

    return NextResponse.json(
      {
        error: error.message || '触发抓取失败',
      },
      { status: 500 }
    )
  }
}

/**
 * 检测URL是否为推广链接（需要解析重定向）
 */
function isAffiliateUrl(url: string): boolean {
  const affiliateDomains = [
    'pboost.me',
    'bit.ly',
    'geni.us',
    'amzn.to',
    'go.redirectingat.com',
    'click.linksynergy.com',
    'shareasale.com',
    'dpbolvw.net',
    'jdoqocy.com',
    'tkqlhce.com',
    'anrdoezrs.net',
    'kqzyfj.com',
  ]

  try {
    const domain = new URL(url).hostname.toLowerCase()
    return affiliateDomains.some(affiliate => domain.includes(affiliate))
  } catch {
    return false
  }
}

/**
 * 后台执行抓取和AI分析任务
 */
async function performScrapeAndAnalysis(
  offerId: number,
  userId: number,
  url: string,
  brand: string
): Promise<void> {
  try {
    // 获取代理配置
    const offer = findOfferById(offerId, userId)
    const targetCountry = offer?.target_country || 'US'
    const useProxy = isProxyEnabled(userId)
    const proxyUrl = useProxy ? getProxyUrlForCountry(targetCountry, userId) : undefined

    // 自动检测并解析推广链接
    let actualUrl = url
    const urlToResolve = offer?.affiliate_link || url  // 优先使用affiliate_link，否则检查url

    if (isAffiliateUrl(urlToResolve)) {
      console.log(`🔗 检测到推广链接，开始解析: ${urlToResolve}`)
      try {
        const { resolveAffiliateLinkWithPlaywright } = await import('@/lib/url-resolver-playwright')
        const resolved = await resolveAffiliateLinkWithPlaywright(
          urlToResolve,
          proxyUrl,
          5000
        )
        actualUrl = resolved.finalUrl
        console.log(`✅ 解析完成 - Final URL: ${actualUrl}`)
        console.log(`   重定向次数: ${resolved.redirectCount}`)
        console.log(`   重定向链: ${resolved.redirectChain.join(' → ')}`)
      } catch (resolveError: any) {
        console.warn(`⚠️ 推广链接解析失败，尝试使用原始URL: ${resolveError.message}`)
        actualUrl = urlToResolve
      }
    } else {
      console.log(`📍 直接使用提供的URL（非推广链接）: ${actualUrl}`)
    }

    console.log(`开始抓取Offer ${offerId}:`, actualUrl)

    // 获取语言代码
    const language = COUNTRY_TO_LANGUAGE[targetCountry] || 'en'
    console.log(`目标国家: ${targetCountry}, 语言: ${language}`)

    // 提前检测URL的预期页面类型（用于缓存验证）
    const urlPath = new URL(actualUrl).pathname
    const expectedIsStorePage = actualUrl.includes('/stores/') ||
                                actualUrl.includes('/store/') ||
                                actualUrl.includes('/collections') ||
                                (actualUrl.includes('.myshopify.com') && !actualUrl.match(/\/products\/[^/]+$/)) ||
                                urlPath === '/' || urlPath === ''
    const expectedPageType: 'product' | 'store' = expectedIsStorePage ? 'store' : 'product'
    console.log(`🎯 预期页面类型: ${expectedPageType}`)

    // 检查Redis缓存
    let cachedData = await getCachedPageData(actualUrl, language)
    let pageData: any

    // 缓存验证：检查缓存数据的页面类型是否匹配预期
    if (cachedData) {
      // 从缓存文本中检测实际页面类型
      const cachedText = cachedData.text.toLowerCase()
      const cachedIsStorePage = cachedText.includes('store:') ||
                                cachedText.includes('店铺:') ||
                                cachedText.includes('产品列表') ||
                                cachedText.includes('product list') ||
                                (cachedText.includes('产品数量:') && !cachedText.includes('产品名称:'))
      const cachedPageType: 'product' | 'store' = cachedIsStorePage ? 'store' : 'product'

      // 页面类型不匹配：缓存数据无效，强制重新抓取
      if (cachedPageType !== expectedPageType) {
        console.warn(`⚠️ 缓存页面类型不匹配！预期: ${expectedPageType}, 缓存: ${cachedPageType}`)
        console.warn(`   强制重新抓取以获取正确页面类型...`)
        cachedData = null  // 清空缓存引用，触发重新抓取
      } else {
        console.log(`✅ 缓存验证通过: ${cachedPageType} 页面 (缓存时间: ${cachedData.cachedAt})`)
      }
    }

    if (cachedData) {
      console.log(`✅ 使用缓存数据`)

      // 将SEO数据整合到text中，为AI分析提供更丰富的信息
      let enrichedText = cachedData.text
      if (cachedData.seo) {
        const seoInfo = []
        if (cachedData.seo.metaDescription) {
          seoInfo.push(`Meta Description: ${cachedData.seo.metaDescription}`)
        }
        if (cachedData.seo.ogDescription) {
          seoInfo.push(`OG Description: ${cachedData.seo.ogDescription}`)
        }
        if (cachedData.seo.h1 && cachedData.seo.h1.length > 0) {
          seoInfo.push(`H1 Tags: ${cachedData.seo.h1.join(', ')}`)
        }
        if (cachedData.seo.imageAlts && cachedData.seo.imageAlts.length > 0) {
          seoInfo.push(`Image Descriptions: ${cachedData.seo.imageAlts.slice(0, 10).join(', ')}`)
        }
        if (seoInfo.length > 0) {
          enrichedText = `${enrichedText}\n\n--- SEO Information ---\n${seoInfo.join('\n')}`
        }
      }

      pageData = {
        title: cachedData.title,
        description: cachedData.description || cachedData.seo?.metaDescription || '',
        text: enrichedText,
        html: '', // 缓存中不存储HTML，AI分析不需要
      }
    } else {
      // 检测网站类型
      const isAmazon = actualUrl.includes('amazon.com') || actualUrl.includes('amazon.')
      const isStorePage = actualUrl.includes('/stores/') || actualUrl.includes('/store/')

      // 检测是否为独立站店铺页面（首页或产品集合页）
      const urlObj = new URL(actualUrl)
      const urlPath = urlObj.pathname
      const isShopifyDomain = actualUrl.includes('.myshopify.com') || actualUrl.includes('shopify')
      const isIndependentStore = !isAmazon && (
        // 首页（根路径）
        urlPath === '/' || urlPath === '' ||
        // Shopify集合页
        urlPath.includes('/collections') ||
        // 产品列表页（但不是单个产品页）
        (urlPath.includes('/products') && !urlPath.match(/\/products\/[^/]+$/)) ||
        // Shopify域名
        isShopifyDomain
      )

      const needsJavaScript = isAmazon || isShopifyDomain || isIndependentStore

      // 1. 抓取网页内容
      if (needsJavaScript) {
        console.log('🎭 使用Playwright Stealth模式抓取...')

        try {
            if (isAmazon && isStorePage) {
              // Amazon Store页面专用抓取
              console.log('📦 检测到Amazon Store页面，使用Store抓取模式...')
              const { scrapeAmazonStore } = await import('@/lib/scraper-stealth')
              const storeData = await scrapeAmazonStore(actualUrl, proxyUrl)

              // 🔥 优化：构建突出热销商品的文本信息供AI分析
              const productSummaries = storeData.products.map(p => {
                const parts = [
                  `${p.rank}. ${p.hotLabel} - ${p.name}`,
                  `评分: ${p.rating || 'N/A'}⭐`,
                  `评论: ${p.reviewCount || 'N/A'}条`,
                ]
                if (p.hotScore) parts.push(`热销指数: ${p.hotScore.toFixed(1)}`)
                if (p.price) parts.push(`价格: ${p.price}`)
                // 🎯 Phase 3: 添加促销、徽章、Prime信息
                if (p.promotion) parts.push(`💰 促销: ${p.promotion}`)
                if (p.badge) parts.push(`🏆 ${p.badge}`)
                if (p.isPrime) parts.push(`✓ Prime`)
                return parts.join(' | ')
              }).join('\n')

              const hotInsightsText = storeData.hotInsights
                ? `\n💡 热销洞察: 本店铺前${storeData.hotInsights.topProductsCount}名热销商品平均评分${storeData.hotInsights.avgRating.toFixed(1)}星，平均评论${storeData.hotInsights.avgReviews}条`
                : ''

              const textContent = [
                `=== ${storeData.storeName} 品牌店铺 ===`,
                `品牌: ${storeData.brandName}`,
                `店铺描述: ${storeData.storeDescription || 'N/A'}`,
                '',
                `=== 热销商品排行榜 (Top ${storeData.totalProducts}) ===`,
                `筛选标准: 评分 × log(评论数 + 1)`,
                `说明: 🔥 = 前5名热销商品 | ✅ = 畅销商品`,
                '',
                productSummaries,
                hotInsightsText,
              ].join('\n')

              pageData = {
                title: storeData.storeName || brand,
                description: storeData.storeDescription || '',
                text: textContent,
                html: '',
              }

              console.log(`✅ Amazon Store抓取完成: ${storeData.storeName}, ${storeData.totalProducts}个产品`)

              // 🎯 Phase 3持久化：保存产品数据到数据库
              try {
                await saveScrapedProducts(offerId, storeData.products, 'amazon_store')
                console.log(`✅ 产品数据已保存到数据库: ${storeData.products.length}个产品`)
              } catch (saveError: any) {
                console.error('⚠️ 保存产品数据失败（不影响主流程）:', saveError.message)
              }
            } else if (isAmazon) {
              // Amazon产品页面专用抓取 - 增强版
              const { scrapeAmazonProduct } = await import('@/lib/scraper-stealth')
              const productData = await scrapeAmazonProduct(actualUrl, proxyUrl)

              // 构建全面的文本信息供AI创意生成
              const textParts = [
                `=== 产品信息 ===`,
                `产品名称: ${productData.productName}`,
                `品牌: ${productData.brandName}`,
                `ASIN: ${productData.asin}`,
                `类目: ${productData.category}`,
                '',
                `=== 价格信息 ===`,
                `当前价格: ${productData.productPrice}`,
                productData.originalPrice ? `原价: ${productData.originalPrice}` : '',
                productData.discount ? `折扣: ${productData.discount}` : '',
                productData.primeEligible ? '✓ Prime会员可享' : '',
                productData.availability || '',
                '',
                `=== 销量与评价 ===`,
                `评分: ${productData.rating || 'N/A'}⭐`,
                `评论数: ${productData.reviewCount || 'N/A'}`,
                `销量排名: ${productData.salesRank || 'N/A'}`,
                '',
                `=== 产品特点 ===`,
                productData.features.join('\n'),
                '',
              ]

              // 添加评论摘要
              if (productData.reviewHighlights.length > 0) {
                textParts.push(`=== 用户评价摘要 ===`)
                textParts.push(productData.reviewHighlights.join('\n'))
                textParts.push('')
              }

              // 添加热门评论
              if (productData.topReviews.length > 0) {
                textParts.push(`=== 热门评论 ===`)
                textParts.push(productData.topReviews.join('\n\n'))
                textParts.push('')
              }

              // 添加技术规格
              if (Object.keys(productData.technicalDetails).length > 0) {
                textParts.push(`=== 技术规格 ===`)
                for (const [key, value] of Object.entries(productData.technicalDetails)) {
                  textParts.push(`${key}: ${value}`)
                }
              }

              pageData = {
                title: productData.productName || '',
                description: productData.productDescription || '',
                text: textParts.filter(Boolean).join('\n'),
                html: '',
              }

              console.log(`✅ Amazon产品抓取完成: ${productData.productName}`)
            } else if (isIndependentStore) {
              // 独立站店铺页面抓取
              console.log('🏪 检测到独立站店铺页面，使用店铺抓取模式...')
              const { scrapeIndependentStore } = await import('@/lib/scraper-stealth')
              const storeData = await scrapeIndependentStore(actualUrl, proxyUrl)

              // 构建丰富的文本信息供AI分析
              const productSummaries = storeData.products.slice(0, 20).map((p, i) => {
                const parts = [`${i + 1}. ${p.name}`]
                if (p.price) parts.push(`价格: ${p.price}`)
                return parts.join(' | ')
              }).join('\n')

              const textContent = [
                `=== 独立站店铺: ${storeData.storeName} ===`,
                `品牌: ${storeData.storeName}`,
                `店铺描述: ${storeData.storeDescription || 'N/A'}`,
                `平台: ${storeData.platform || 'generic'}`,
                `产品数量: ${storeData.totalProducts}`,
                '',
                '=== 产品列表 ===',
                productSummaries,
              ].join('\n')

              pageData = {
                title: storeData.storeName || brand,
                description: storeData.storeDescription || '',
                text: textContent,
                html: '',
              }

              console.log(`✅ 独立站店铺抓取完成: ${storeData.storeName}, ${storeData.totalProducts}个产品`)
            } else {
              // 通用JavaScript渲染抓取
              const { scrapeUrlWithBrowser } = await import('@/lib/scraper-stealth')
              const result = await scrapeUrlWithBrowser(actualUrl, proxyUrl, {
                waitForTimeout: 30000,
              })

              pageData = {
                title: result.title,
                description: '',
                text: result.html.substring(0, 10000),
                html: result.html,
              }

              console.log(`✅ 页面抓取完成: ${result.title}`)
            }
          } catch (playwrightError: any) {
            console.warn(`⚠️ Playwright抓取失败，尝试降级到HTTP: ${playwrightError.message}`)
            // 降级到HTTP方式
            pageData = await scrapeUrl(actualUrl, proxyUrl, language)
          }
        } else {
          // 普通HTTP抓取
          console.log('📡 使用HTTP方式抓取...')
          pageData = await scrapeUrl(actualUrl, proxyUrl, language)
        }

      console.log(`抓取完成，页面标题:`, pageData.title)

      // 提取SEO数据
      const seoData = await extractSeoData(pageData.html || '')
      console.log(`📊 SEO数据提取完成:`, {
        metaTitle: seoData.metaTitle ? `${seoData.metaTitle.length}字符` : '无',
        metaDesc: seoData.metaDescription ? `${seoData.metaDescription.length}字符` : '无',
        h1Count: seoData.h1.length,
        altCount: seoData.imageAlts.length,
      })

      // 保存到Redis缓存（包含文本内容和SEO信息）
      await setCachedPageData(actualUrl, language, {
        title: pageData.title || '',
        description: pageData.description || '',
        text: pageData.text || '',
        seo: seoData,
      })
    }

    // 2. 使用AI分析产品信息（容错机制：失败时使用默认值）
    let productInfo: ProductInfo
    let aiAnalysisSuccess = true

    // 使用之前检测的页面类型（已在缓存验证阶段完成）
    const pageType = expectedPageType
    console.log(`🔍 页面类型: ${pageType} (${expectedIsStorePage ? '店铺页面' : '单品页面'})`)

    try {
      productInfo = await analyzeProductPage({
        url: actualUrl,
        brand,
        title: pageData.title,
        description: pageData.description,
        text: pageData.text,
        targetCountry,
        pageType,  // 传递页面类型
      }, userId)  // 传递 userId 以使用用户级别的 AI 配置（优先 Vertex AI）
      console.log(`✅ AI分析完成:`, productInfo)
    } catch (aiError: any) {
      // AI分析失败时，使用默认值并记录警告（不中断抓取流程）
      aiAnalysisSuccess = false
      console.warn(`⚠️ AI分析失败（将使用默认值）:`, aiError.message)

      productInfo = {
        brandDescription: `${brand} - 品牌描述待补充（AI分析失败）`,
        uniqueSellingPoints: `产品卖点待补充（AI分析失败）`,
        productHighlights: `产品亮点待补充（AI分析失败）`,
        targetAudience: `目标受众待补充（AI分析失败）`,
        category: '未分类',
      }
    }

    // 3. 更新数据库 - 将数组/对象转为JSON字符串存储
    const formatFieldForDB = (field: unknown): string => {
      if (typeof field === 'string') return field
      if (Array.isArray(field)) return JSON.stringify(field)
      if (field && typeof field === 'object') return JSON.stringify(field)
      return ''
    }

    // 从AI的brandDescription中提取品牌名
    let extractedBrand = brand // 默认使用原始品牌名
    if (productInfo.brandDescription) {
      const match = productInfo.brandDescription.match(/^([A-Z][A-Za-z0-9\s&-]+?)\s+(positions|is|offers|provides|delivers|focuses)/i)
      if (match && match[1]) {
        extractedBrand = match[1].trim()
        console.log(`✅ 从AI分析中提取品牌名: ${extractedBrand}`)
      } else {
        console.log(`⚠️ 无法从brandDescription提取品牌名，使用原始值: ${brand}`)
      }
    }

    // 🎯 P0优化: 用户评论深度分析（仅针对产品页，非店铺页）
    let reviewAnalysis = null
    if (pageType === 'product' && actualUrl.includes('amazon') && aiAnalysisSuccess) {
      try {
        console.log('📝 开始P0评论分析...')
        const { scrapeAmazonReviews, analyzeReviewsWithAI } = await import('@/lib/review-analyzer')

        // 创建临时Playwright会话抓取评论
        const { chromium } = await import('playwright')
        const browser = await chromium.launch({ headless: true })
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        })

        const reviewPage = await context.newPage()

        try {
          // 导航到产品页面
          await reviewPage.goto(actualUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

          // 抓取评论（最多50条）
          const reviews = await scrapeAmazonReviews(reviewPage, 50)

          if (reviews.length > 0) {
            console.log(`✅ 抓取到${reviews.length}条评论，开始AI分析...`)

            // AI分析评论
            reviewAnalysis = await analyzeReviewsWithAI(
              reviews,
              extractedBrand || brand,
              targetCountry,
              userId
            )

            console.log('✅ P0评论分析完成')
            console.log(`   - 情感分布: 正面${reviewAnalysis.sentimentDistribution.positive}% 中性${reviewAnalysis.sentimentDistribution.neutral}% 负面${reviewAnalysis.sentimentDistribution.negative}%`)
            console.log(`   - 正面关键词: ${reviewAnalysis.topPositiveKeywords.length}个`)
            console.log(`   - 使用场景: ${reviewAnalysis.realUseCases.length}个`)
            console.log(`   - 痛点: ${reviewAnalysis.commonPainPoints.length}个`)
          } else {
            console.log('⚠️ 未抓取到评论，跳过AI分析')
          }
        } finally {
          await reviewPage.close()
          await browser.close()
        }

      } catch (reviewError: any) {
        console.warn('⚠️ P0评论分析失败（不影响主流程）:', reviewError.message)
        // 评论分析失败不影响主流程，继续执行
      }
    } else if (pageType === 'store') {
      console.log('ℹ️ 店铺页面跳过评论分析')
    } else if (!actualUrl.includes('amazon')) {
      console.log('ℹ️ 非Amazon页面暂不支持评论分析')
    }

    // 🎯 P0优化: 竞品对比分析（仅针对产品页，非店铺页）
    let competitorAnalysis = null
    if (pageType === 'product' && actualUrl.includes('amazon') && aiAnalysisSuccess) {
      try {
        console.log('🏆 开始P0竞品对比分析...')
        const { scrapeAmazonCompetitors, analyzeCompetitorsWithAI } = await import('@/lib/competitor-analyzer')

        // 创建临时Playwright会话抓取竞品
        const { chromium } = await import('playwright')
        const browser = await chromium.launch({ headless: true })
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        })

        const competitorPage = await context.newPage()

        try {
          // 导航到产品页面
          await competitorPage.goto(actualUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

          // 抓取竞品（最多10个）
          const competitors = await scrapeAmazonCompetitors(competitorPage, 10)

          if (competitors.length > 0) {
            console.log(`✅ 抓取到${competitors.length}个竞品，开始AI对比分析...`)

            // 构建我们的产品信息
            const ourProduct = {
              name: extractedBrand || brand,
              price: productInfo.pricing?.currentPrice || null,
              rating: productInfo.reviews?.averageRating || null,
              reviewCount: productInfo.reviews?.totalCount || null,
              features: productInfo.productHighlights
                ? productInfo.productHighlights.split('\n').filter((f: string) => f.trim())
                : []
            }

            // AI分析竞品对比
            competitorAnalysis = await analyzeCompetitorsWithAI(
              ourProduct,
              competitors,
              targetCountry,
              userId
            )

            console.log('✅ P0竞品对比分析完成')
            console.log(`   - 竞品数量: ${competitorAnalysis.totalCompetitors}`)
            console.log(`   - 价格优势: ${competitorAnalysis.pricePosition?.advantage || 'unknown'}`)
            console.log(`   - 评分优势: ${competitorAnalysis.ratingPosition?.advantage || 'unknown'}`)
            console.log(`   - 独特卖点: ${competitorAnalysis.uniqueSellingPoints.length}个`)
            console.log(`   - 竞品优势: ${competitorAnalysis.competitorAdvantages.length}个`)
            console.log(`   - 整体竞争力: ${competitorAnalysis.overallCompetitiveness}/100`)
          } else {
            console.log('⚠️ 未抓取到竞品，跳过AI对比分析')
          }
        } finally {
          await competitorPage.close()
          await browser.close()
        }

      } catch (competitorError: any) {
        console.warn('⚠️ P0竞品对比分析失败（不影响主流程）:', competitorError.message)
        // 竞品分析失败不影响主流程，继续执行
      }
    } else if (pageType === 'store') {
      console.log('ℹ️ 店铺页面跳过竞品对比分析')
    } else if (!actualUrl.includes('amazon')) {
      console.log('ℹ️ 非Amazon页面暂不支持竞品对比分析')
    }

    // 如果AI分析失败，在scrape_error中记录警告信息
    const scrapeError = aiAnalysisSuccess
      ? undefined
      : '⚠️ 网页抓取成功，但AI产品分析失败。建议检查Gemini API配置和代理设置。'

    updateOfferScrapeStatus(offerId, userId, 'completed', scrapeError, {
      brand: extractedBrand,        // 更新品牌名
      url: actualUrl,               // 更新为解析后的真实URL
      brand_description: formatFieldForDB(productInfo.brandDescription),
      unique_selling_points: formatFieldForDB(productInfo.uniqueSellingPoints),
      product_highlights: formatFieldForDB(productInfo.productHighlights),
      target_audience: formatFieldForDB(productInfo.targetAudience),
      category: productInfo.category || '',
      // 增强数据字段
      pricing: formatFieldForDB(productInfo.pricing),
      reviews: formatFieldForDB(productInfo.reviews),
      promotions: formatFieldForDB(productInfo.promotions),
      competitive_edges: formatFieldForDB(productInfo.competitiveEdges),
      // 🎯 P0优化: 用户评论深度分析结果
      review_analysis: reviewAnalysis ? formatFieldForDB(reviewAnalysis) : null,
      // 🎯 P0优化: 竞品对比分析结果
      competitor_analysis: competitorAnalysis ? formatFieldForDB(competitorAnalysis) : null,
    })

    console.log(`Offer ${offerId} 抓取和分析完成`)
  } catch (error: any) {
    console.error(`Offer ${offerId} 抓取失败:`, error)
    throw error
  }
}
