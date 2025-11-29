import { NextRequest, NextResponse } from 'next/server'
import { findOfferById, updateOfferScrapeStatus, updateOffer } from '@/lib/offers'
import { scrapeUrl } from '@/lib/scraper'
import { analyzeProductPage, ProductInfo } from '@/lib/ai'
import { getProxyUrlForCountry, isProxyEnabled } from '@/lib/settings'
import { getCachedPageData, setCachedPageData, SeoData } from '@/lib/redis'
import { getDatabase, getSQLiteDatabase } from '@/lib/db'
import { getLanguageCodeForCountry } from '@/lib/language-country-codes'

/**
 * 🎯 Phase 3持久化: 保存抓取的产品数据到数据库
 */
async function saveScrapedProducts(
  offerId: number,
  products: any[],
  source: 'amazon_store' | 'independent_store'
): Promise<void> {
  const db = getSQLiteDatabase()

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

// 使用全局统一的国家到语言代码映射
// 通过 getLanguageCodeForCountry() 函数获取，支持69个国家

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
    'yeahpromos.com',  // 🔥 添加YeahPromos推广平台
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
 * 内部函数，在同一文件中被POST方法和异步抓取复用
 */
async function performScrapeAndAnalysis(
  offerId: number,
  userId: number,
  url: string,
  brand: string
): Promise<void> {
  // 🎯 P0优化: 保存原始爬虫数据（用于后续广告创意生成）
  let rawScrapedData: any = null

  try {
    // 获取代理配置
    const offer = findOfferById(offerId, userId)
    const targetCountry = offer?.target_country || 'US'
    const useProxy = isProxyEnabled(userId)
    const proxyUrl = useProxy ? getProxyUrlForCountry(targetCountry, userId) : undefined

    // 自动检测并解析推广链接
    let actualUrl = url
    let resolvedFinalUrlSuffix: string | null = null  // 保存解析器返回的suffix
    const urlToResolve = offer?.affiliate_link || url  // 优先使用affiliate_link，否则检查url

    if (isAffiliateUrl(urlToResolve)) {
      console.log(`🔗 检测到推广链接，开始解析: ${urlToResolve}`)
      try {
        const { resolveAffiliateLinkWithPlaywright } = await import('@/lib/url-resolver-playwright')
        const resolved = await resolveAffiliateLinkWithPlaywright(
          urlToResolve,
          proxyUrl,
          5000,
          targetCountry  // 🔥 传入目标国家，使用代理池缓存
        )
        actualUrl = resolved.finalUrl
        resolvedFinalUrlSuffix = resolved.finalUrlSuffix  // 🔥 保存解析器返回的suffix
        console.log(`✅ 解析完成 - Final URL: ${actualUrl}`)
        console.log(`   Final URL Suffix: ${resolvedFinalUrlSuffix ? resolvedFinalUrlSuffix.substring(0, 100) + '...' : '(无)'}`)
        console.log(`   重定向次数: ${resolved.redirectCount}`)
        console.log(`   重定向链: ${resolved.redirectChain.join(' → ')}`)
      } catch (resolveError: any) {
        console.warn(`⚠️ 推广链接解析失败，尝试使用原始URL: ${resolveError.message}`)
        actualUrl = urlToResolve
      }
    } else {
      console.log(`📍 直接使用提供的URL（非推广链接）: ${actualUrl}`)
    }

    // ========== URL分割：提取Final URL和Final URL Suffix ==========
    // 用于Google Ads配置：Final URL配置在Ad层级，Final URL Suffix配置在Campaign层级
    // 🔧 修复：保存完整URL用于后续抓取，避免丢失推广参数
    let urlForScraping = actualUrl  // 保存完整URL用于抓取
    try {
      const urlObj = new URL(actualUrl)
      const finalUrl = `${urlObj.origin}${urlObj.pathname}` // 基础URL（不含查询参数）
      // 🔥 优先使用解析器返回的suffix，否则尝试从当前URL提取
      const finalUrlSuffix = resolvedFinalUrlSuffix || urlObj.search.substring(1)

      // 只有当存在查询参数时才更新（避免覆盖已有的suffix）
      if (finalUrlSuffix) {
        console.log(`📋 提取Final URL: ${finalUrl}`)
        console.log(`📋 提取Final URL Suffix (${finalUrlSuffix.length}字符): ${finalUrlSuffix.substring(0, 100)}${finalUrlSuffix.length > 100 ? '...' : ''}`)

        // 更新Offer中的final_url和final_url_suffix字段
        if (offer) {
          updateOffer(offerId, offer.user_id, {
            final_url: finalUrl,
            final_url_suffix: finalUrlSuffix,
            url: finalUrl  // 同时更新url为清理后的基础URL
          })
        }

        console.log(`✅ 已更新Offer ${offerId}的Final URL和Final URL Suffix`)
      } else {
        console.log(`ℹ️ URL不含查询参数，仅更新Final URL`)
        if (offer) {
          updateOffer(offerId, offer.user_id, {
            final_url: finalUrl,
            url: finalUrl
          })
        }
      }
    } catch (urlError: any) {
      console.warn(`⚠️ URL解析失败: ${urlError.message}`)
    }

    console.log(`开始抓取Offer ${offerId}:`, urlForScraping)  // 🔧 使用完整URL进行抓取

    // 获取语言代码（使用全局统一映射）
    const language = getLanguageCodeForCountry(targetCountry)
    console.log(`目标国家: ${targetCountry}, 语言: ${language}`)

    // 提前检测URL的预期页面类型（用于缓存验证）
    const urlPath = new URL(urlForScraping).pathname
    const expectedIsStorePage = urlForScraping.includes('/stores/') ||
                                urlForScraping.includes('/store/') ||
                                urlForScraping.includes('/collections') ||
                                (urlForScraping.includes('.myshopify.com') && !urlForScraping.match(/\/products\/[^/]+$/)) ||
                                urlPath === '/' || urlPath === ''
    const expectedPageType: 'product' | 'store' = expectedIsStorePage ? 'store' : 'product'
    console.log(`🎯 预期页面类型: ${expectedPageType}`)

    // ⚠️ 缓存已禁用：根据需求，取消所有网页数据缓存，避免数据污染
    // 所有抓取任务统一使用Playwright，确保数据新鲜度
    console.log(`🚫 缓存已禁用，强制使用Playwright抓取最新数据`)
    let pageData: any

    // 检测网站类型 - 🔧 修复：使用完整URL进行类型检测
    const isAmazon = urlForScraping.includes('amazon.com') || urlForScraping.includes('amazon.')
    const isStorePage = urlForScraping.includes('/stores/') || urlForScraping.includes('/store/')

    // 检测是否为独立站店铺页面（首页或产品集合页）
    // 复用之前的urlObj和urlPath
    const isShopifyDomain = urlForScraping.includes('.myshopify.com') || urlForScraping.includes('shopify')
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
              // Amazon Store页面专用抓取 - 🔧 修复：使用完整URL
              console.log('📦 检测到Amazon Store页面，使用Store抓取模式...')
              const { scrapeAmazonStore } = await import('@/lib/scraper-stealth')
              const storeData = await scrapeAmazonStore(urlForScraping, proxyUrl)

              // 🔥 优化：构建突出热销商品的文本信息供AI分析（国际化版本）
              // 🌍 国际化文本配置
              const i18nTexts: Record<string, {
                rating: string
                reviews: string
                hotScore: string
                price: string
                promotion: string
                brandStore: string
                brand: string
                storeDesc: string
                topProducts: string
                scoringCriteria: string
                legend: string
                hotInsights: string
              }> = {
                en: {
                  rating: 'Rating',
                  reviews: 'reviews',
                  hotScore: 'Hot Score',
                  price: 'Price',
                  promotion: 'Promotion',
                  brandStore: 'Brand Store',
                  brand: 'Brand',
                  storeDesc: 'Store Description',
                  topProducts: 'Hot-Selling Products Ranking (Top',
                  scoringCriteria: 'Scoring: Rating × log(Review Count + 1)',
                  legend: 'Legend: 🔥 = TOP 5 Hot-Selling | ✅ = Best-Selling',
                  hotInsights: 'Hot Insights: Top'
                },
                zh: {
                  rating: '评分',
                  reviews: '条',
                  hotScore: '热销指数',
                  price: '价格',
                  promotion: '促销',
                  brandStore: '品牌店铺',
                  brand: '品牌',
                  storeDesc: '店铺描述',
                  topProducts: '热销商品排行榜 (Top',
                  scoringCriteria: '筛选标准: 评分 × log(评论数 + 1)',
                  legend: '说明: 🔥 = 前5名热销商品 | ✅ = 畅销商品',
                  hotInsights: '热销洞察: 本店铺前'
                },
                de: {
                  rating: 'Bewertung',
                  reviews: 'Bewertungen',
                  hotScore: 'Beliebtheitsindex',
                  price: 'Preis',
                  promotion: 'Aktion',
                  brandStore: 'Marken-Shop',
                  brand: 'Marke',
                  storeDesc: 'Shop-Beschreibung',
                  topProducts: 'Bestseller-Ranking (Top',
                  scoringCriteria: 'Bewertung: Bewertung × log(Anzahl Bewertungen + 1)',
                  legend: 'Legende: 🔥 = TOP 5 Bestseller | ✅ = Bestseller',
                  hotInsights: 'Bestseller-Einblicke: Top'
                },
                fr: {
                  rating: 'Note',
                  reviews: 'avis',
                  hotScore: 'Score de popularité',
                  price: 'Prix',
                  promotion: 'Promotion',
                  brandStore: 'Boutique de marque',
                  brand: 'Marque',
                  storeDesc: 'Description de la boutique',
                  topProducts: 'Classement des meilleures ventes (Top',
                  scoringCriteria: 'Notation: Note × log(Nombre d\'avis + 1)',
                  legend: 'Légende: 🔥 = TOP 5 Meilleures ventes | ✅ = Meilleures ventes',
                  hotInsights: 'Informations sur les meilleures ventes: Top'
                },
                es: {
                  rating: 'Calificación',
                  reviews: 'reseñas',
                  hotScore: 'Índice de popularidad',
                  price: 'Precio',
                  promotion: 'Promoción',
                  brandStore: 'Tienda de marca',
                  brand: 'Marca',
                  storeDesc: 'Descripción de la tienda',
                  topProducts: 'Ranking de productos más vendidos (Top',
                  scoringCriteria: 'Puntuación: Calificación × log(Número de reseñas + 1)',
                  legend: 'Leyenda: 🔥 = TOP 5 Más vendidos | ✅ = Más vendidos',
                  hotInsights: 'Información de más vendidos: Top'
                },
                ja: {
                  rating: '評価',
                  reviews: 'レビュー',
                  hotScore: '人気スコア',
                  price: '価格',
                  promotion: 'プロモーション',
                  brandStore: 'ブランドストア',
                  brand: 'ブランド',
                  storeDesc: 'ストア説明',
                  topProducts: '人気商品ランキング (Top',
                  scoringCriteria: 'スコアリング: 評価 × log(レビュー数 + 1)',
                  legend: '凡例: 🔥 = TOP 5 人気商品 | ✅ = 人気商品',
                  hotInsights: '人気インサイト: Top'
                },
                ko: {
                  rating: '평점',
                  reviews: '리뷰',
                  hotScore: '인기 점수',
                  price: '가격',
                  promotion: '프로모션',
                  brandStore: '브랜드 스토어',
                  brand: '브랜드',
                  storeDesc: '스토어 설명',
                  topProducts: '인기 상품 순위 (Top',
                  scoringCriteria: '평가: 평점 × log(리뷰 수 + 1)',
                  legend: '범례: 🔥 = TOP 5 인기 상품 | ✅ = 인기 상품',
                  hotInsights: '인기 인사이트: Top'
                }
              }

              const t = i18nTexts[language] || i18nTexts.en

              const productSummaries = storeData.products.map(p => {
                const parts = [
                  `${p.rank}. ${p.hotLabel} - ${p.name}`,
                  `${t.rating}: ${p.rating || 'N/A'}⭐`,
                  `${p.reviewCount || 'N/A'} ${t.reviews}`,
                ]
                if (p.hotScore) parts.push(`${t.hotScore}: ${p.hotScore.toFixed(1)}`)
                if (p.price) parts.push(`${t.price}: ${p.price}`)
                // 🎯 Phase 3: 添加促销、徽章、Prime信息
                if (p.promotion) parts.push(`💰 ${t.promotion}: ${p.promotion}`)
                if (p.badge) parts.push(`🏆 ${p.badge}`)
                if (p.isPrime) parts.push(`✓ Prime`)
                return parts.join(' | ')
              }).join('\n')

              const hotInsightsText = storeData.hotInsights
                ? language === 'zh'
                  ? `\n💡 ${t.hotInsights}${storeData.hotInsights.topProductsCount}名热销商品平均评分${storeData.hotInsights.avgRating.toFixed(1)}星，平均评论${storeData.hotInsights.avgReviews}条`
                  : `\n💡 ${t.hotInsights} ${storeData.hotInsights.topProductsCount} hot-selling products have average rating ${storeData.hotInsights.avgRating.toFixed(1)}★, average ${storeData.hotInsights.avgReviews} reviews`
                : ''

              const textContent = [
                `=== ${storeData.storeName} ${t.brandStore} ===`,
                `${t.brand}: ${storeData.brandName}`,
                `${t.storeDesc}: ${storeData.storeDescription || 'N/A'}`,
                '',
                `=== ${t.topProducts} ${storeData.totalProducts}) ===`,
                `${t.scoringCriteria}`,
                `${t.legend}`,
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

              // 🎯 P0优化: 保存原始爬虫数据（Store页面）
              rawScrapedData = storeData

              // 🎯 Phase 3持久化：保存产品数据到数据库
              try {
                await saveScrapedProducts(offerId, storeData.products, 'amazon_store')
                console.log(`✅ 产品数据已保存到数据库: ${storeData.products.length}个产品`)
              } catch (saveError: any) {
                console.error('⚠️ 保存产品数据失败（不影响主流程）:', saveError.message)
              }
            } else if (isAmazon) {
              // Amazon产品页面专用抓取 - 增强版 - 🔧 修复：使用完整URL
              const { scrapeAmazonProduct } = await import('@/lib/scraper-stealth')
              const productData = await scrapeAmazonProduct(urlForScraping, proxyUrl)

              // 🎯 P0优化: 保存原始爬虫数据
              rawScrapedData = productData

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
              // 独立站店铺页面抓取 - 🔧 修复：使用完整URL
              console.log('🏪 检测到独立站店铺页面，使用店铺抓取模式...')
              const { scrapeIndependentStore } = await import('@/lib/scraper-stealth')
              const storeData = await scrapeIndependentStore(urlForScraping, proxyUrl)

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

              // 🎯 P0优化: 保存原始爬虫数据（Independent Store页面）
              rawScrapedData = storeData

              // 🎯 Phase 3持久化：保存产品数据到数据库
              try {
                await saveScrapedProducts(offerId, storeData.products, 'independent_store')
                console.log(`✅ 产品数据已保存到数据库: ${storeData.products.length}个产品`)
              } catch (saveError: any) {
                console.error('⚠️ 保存产品数据失败（不影响主流程）:', saveError.message)
              }
            } else {
              // 通用JavaScript渲染抓取 - 🔧 修复：使用完整URL
              const { scrapeUrlWithBrowser } = await import('@/lib/scraper-stealth')
              const result = await scrapeUrlWithBrowser(urlForScraping, proxyUrl, {
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
            // 🔧 修复：不降级到HTTP，直接抛出异常让外层retry机制处理
            console.error(`❌ Playwright抓取失败: ${playwrightError.message}`)
            throw playwrightError
          }
        } else {
          // 普通HTTP抓取 - 🔧 修复：使用完整URL
          console.log('📡 使用HTTP方式抓取...')
          pageData = await scrapeUrl(urlForScraping, proxyUrl, language)
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

      // ⚠️ 缓存写入已禁用：根据需求，取消所有网页数据缓存
      // await setCachedPageData(urlForScraping, language, {
      //   title: pageData.title || '',
      //   description: pageData.description || '',
      //   text: pageData.text || '',
      //   seo: seoData,
      //   pageType: expectedPageType,
      // })
      console.log(`🚫 缓存写入已禁用`)

    // 2. 使用AI分析产品信息（容错机制：失败时使用默认值）
    let productInfo: ProductInfo
    let aiAnalysisSuccess = true

    // 使用之前检测的页面类型（已在缓存验证阶段完成）
    const pageType = expectedPageType
    console.log(`🔍 页面类型: ${pageType} (${expectedIsStorePage ? '店铺页面' : '单品页面'})`)

    try {
      productInfo = await analyzeProductPage({
        url: urlForScraping,  // 🔧 修复：使用完整URL
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

    // ⚠️ 品牌名提取优先级：原始爬虫数据 > AI分析
    // 1. 优先使用原始爬虫数据中的品牌名（scraper-stealth.ts已经过多策略提取）
    let extractedBrand = brand // 默认使用传入的品牌名

    if (rawScrapedData && rawScrapedData.brandName && rawScrapedData.brandName !== 'Unknown' && rawScrapedData.brandName.trim() !== '') {
      extractedBrand = rawScrapedData.brandName
      console.log(`✅ 使用原始爬虫数据的品牌名: ${extractedBrand}`)
    } else if (productInfo.brandDescription) {
      // 2. 降级方案：从AI的brandDescription中提取品牌名
      // 支持多语言模式：英语(positions/is/offers) + 德语(positioniert/ist/bietet) + 法语/西班牙语/意大利语
      const match = productInfo.brandDescription.match(
        /^([A-Z][A-Za-z0-9\s&üöäÜÖÄß-]+?)\s+(positions|is|offers|provides|delivers|focuses|positioniert|ist|bietet|liefert|konzentriert|se\s+positionne|est|offre|se\s+posiciona|es|ofrece|posiziona)/i
      )
      if (match && match[1]) {
        extractedBrand = match[1].trim()
        console.log(`✅ 从AI分析中提取品牌名: ${extractedBrand}`)
      } else {
        console.log(`⚠️ 无法从brandDescription提取品牌名，使用原始值: ${brand}`)
      }
    }

    // 🎯 品牌名清理和标准化（去除冠词、型号、格式化）
    if (extractedBrand && extractedBrand.length > 0) {
      // 1. 去除开头的冠词 (英语: The/A/An, 德语: Der/Die/Das, 法语: Le/La/Les, 西班牙语: El/La/Los/Las)
      extractedBrand = extractedBrand.replace(/^(The|A|An|Der|Die|Das|Le|La|Les|El|Los|Las)\s+/i, '')

      // 2. 提取品牌核心名称（第一个有效单词，去除产品型号）
      // 产品型号特征：包含连续大写字母+数字+连字符的组合，如 "RLK16-1200D8-A"
      const words = extractedBrand.split(/\s+/)
      const brandCore = words.find(word => {
        // 有效品牌名：2-20字符，主要是字母（含欧洲特殊字符），可以包含&
        const isValidBrandWord = /^[A-Z][A-Za-z&üöäÜÖÄßéèêëàâáíìîïóòôõúùûñç]{1,19}$/i.test(word)
        // 排除产品型号：包含连续的字母+数字+连字符的复杂组合
        const isProductModel = /[A-Z0-9]{2,}[-][A-Z0-9]{2,}/i.test(word)
        return isValidBrandWord && !isProductModel
      })

      if (brandCore) {
        extractedBrand = brandCore
        console.log(`🔧 品牌名清理: 提取核心名称 "${extractedBrand}"`)
      }

      // 3. 标准化格式：首字母大写 + 其余小写
      extractedBrand = extractedBrand.charAt(0).toUpperCase() + extractedBrand.slice(1).toLowerCase()
      console.log(`✨ 品牌名标准化: "${extractedBrand}"`)
    }

    // 🎯 新增: 品牌名智能提取fallback - 当品牌名为"提取中..."或无效时
    const isInvalidBrand = !extractedBrand ||
                          extractedBrand === '提取中...' ||
                          extractedBrand === 'Extracting...' ||
                          extractedBrand.trim().length < 2

    if (isInvalidBrand && aiAnalysisSuccess && pageData.title) {
      console.log('🔍 尝试使用AI专门提取品牌名...')
      try {
        // 使用AI从产品标题和描述中提取品牌名
        const { extractBrandFromContent } = await import('@/lib/ai')
        const aiBrand = await extractBrandFromContent({
          title: pageData.title,
          description: pageData.description || '',
          text: pageData.text?.substring(0, 2000) || '', // 限制长度以节省token
          url: urlForScraping,
        }, userId)

        if (aiBrand && aiBrand.length >= 2 && aiBrand.length <= 30) {
          extractedBrand = aiBrand
          console.log(`✅ AI品牌提取成功: "${extractedBrand}"`)
        } else {
          console.warn(`⚠️ AI品牌提取结果无效: "${aiBrand}"`)
        }
      } catch (brandExtractionError: any) {
        console.warn(`⚠️ AI品牌提取失败: ${brandExtractionError.message}`)
      }
    }

    // 最终验证：如果还是无效品牌名，从URL中尝试提取
    if (!extractedBrand || extractedBrand === '提取中...' || extractedBrand.trim().length < 2) {
      console.log('🔍 尝试从URL提取品牌名...')

      // Amazon Store URL: /stores/BrandName/...
      let urlBrand = urlForScraping.match(/amazon\.com\/stores\/([^\/]+)/)?.[1]

      // Amazon产品URL: /dp/ASIN 无法直接提取品牌，但可以尝试从标题
      if (!urlBrand && pageData.title) {
        // 从标题开头提取（Amazon产品标题通常以品牌名开头）
        const titleBrand = pageData.title.split(/[\s-,|]/)[0]?.trim()
        if (titleBrand && titleBrand.length >= 2 && titleBrand.length <= 30) {
          const isValidBrand = /^[A-Z][A-Za-z0-9&\s-]+$/.test(titleBrand) ||
                              /^[A-Z0-9]+$/.test(titleBrand)
          if (isValidBrand) {
            urlBrand = titleBrand
          }
        }
      }

      if (urlBrand) {
        extractedBrand = decodeURIComponent(urlBrand)
          .replace(/-/g, ' ')
          .replace(/\+/g, ' ')
          .replace(/\s+(Store|Shop|Official)$/i, '')
          .trim()
        console.log(`✅ 从URL/标题提取品牌: "${extractedBrand}"`)
      } else {
        // 最后的备选方案：使用ASIN作为标识符（如果是Amazon产品页）
        if (urlForScraping.includes('amazon.com/dp/')) {
          const asin = urlForScraping.match(/\/dp\/([A-Z0-9]{10})/)?.[1]
          if (asin) {
            extractedBrand = `Product_${asin.substring(0, 6)}`
            console.log(`⚠️ 使用ASIN生成临时品牌标识: "${extractedBrand}"`)
          }
        }
      }
    }

    console.log(`📦 最终品牌名: "${extractedBrand}"`)


    // 🎯 P0优化: 用户评论深度分析（仅针对产品页，非店铺页）
    let reviewAnalysis = null
    if (pageType === 'product' && urlForScraping.includes('amazon') && aiAnalysisSuccess) {
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
          await reviewPage.goto(urlForScraping, { waitUntil: 'domcontentloaded', timeout: 30000 })

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
    } else if (!urlForScraping.includes('amazon')) {
      console.log('ℹ️ 非Amazon页面暂不支持评论分析')
    }

    // 🎯 P0优化: 竞品对比分析（仅针对产品页，非店铺页）
    let competitorAnalysis = null
    if (pageType === 'product' && urlForScraping.includes('amazon') && aiAnalysisSuccess) {
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
          await competitorPage.goto(urlForScraping, { waitUntil: 'domcontentloaded', timeout: 30000 })

          // 抓取竞品（最多10个）
          const competitors = await scrapeAmazonCompetitors(competitorPage, 10)

          if (competitors.length > 0) {
            console.log(`✅ 抓取到${competitors.length}个竞品，开始AI对比分析...`)

            // 构建我们的产品信息
            const priceStr = productInfo.pricing?.currentPrice
            const priceNum = priceStr ? parseFloat(priceStr.replace(/[^0-9.]/g, '')) : null

            const ourProduct = {
              name: extractedBrand || brand,
              price: priceNum,
              rating: productInfo.reviews?.rating || null,
              reviewCount: productInfo.reviews?.reviewCount || null,
              features: productInfo.productHighlights
                ? (Array.isArray(productInfo.productHighlights)
                    ? productInfo.productHighlights
                    : productInfo.productHighlights.split('\n')).filter((f: string) => f.trim())
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
            console.log(`   - 价格优势: ${competitorAnalysis.pricePosition?.priceAdvantage || 'unknown'}`)
            console.log(`   - 评分优势: ${competitorAnalysis.ratingPosition?.ratingAdvantage || 'unknown'}`)
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
    } else if (!urlForScraping.includes('amazon')) {
      console.log('ℹ️ 非Amazon页面暂不支持竞品对比分析')
    }

    // ❌ P1优化已下线: 视觉元素智能分析（性价比不高）
    // 用户反馈："使用统一AI入口分析5张图片"，下线图片分析功能，性价比不高
    /*
    let visualAnalysis = null
    if (pageType === 'product' && aiAnalysisSuccess) {
      try {
        console.log('📸 开始P1视觉元素智能分析...')
        const { analyzeProductVisuals } = await import('@/lib/visual-analyzer')

        // 创建临时Playwright会话进行视觉分析
        const { chromium } = await import('playwright')
        const browser = await chromium.launch({ headless: true })
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        })

        const visualPage = await context.newPage()

        try {
          // 导航到产品页面
          await visualPage.goto(urlForScraping, { waitUntil: 'domcontentloaded', timeout: 30000 })

          // 执行视觉分析
          visualAnalysis = await analyzeProductVisuals(
            visualPage,
            extractedBrand || brand,
            targetCountry,
            userId
          )

          if (visualAnalysis) {
            console.log('✅ P1视觉元素智能分析完成')
            console.log(`   - 图片总数: ${visualAnalysis.imageQuality.totalImages}`)
            console.log(`   - 高质量图片: ${visualAnalysis.imageQuality.highQualityImages}`)
            console.log(`   - 使用场景: ${visualAnalysis.identifiedScenarios.length}个`)
            console.log(`   - 视觉亮点: ${visualAnalysis.visualHighlights.length}个`)
          } else {
            console.log('⚠️ 未生成视觉分析结果')
          }
        } finally {
          await visualPage.close()
          await browser.close()
        }

      } catch (visualError: any) {
        console.warn('⚠️ P1视觉元素智能分析失败（不影响主流程）:', visualError.message)
        // 视觉分析失败不影响主流程，继续执行
      }
    } else if (pageType === 'store') {
      console.log('ℹ️ 店铺页面跳过视觉元素分析')
    }
    */

    // 如果AI分析失败，在scrape_error中记录警告信息
    const scrapeError = aiAnalysisSuccess
      ? undefined
      : '⚠️ 网页抓取成功，但AI产品分析失败。建议检查Gemini API配置和代理设置。'

    // 🎯 需求34: 提取广告投放元素（关键字、标题、描述）
    let extractedKeywords: any[] = []
    let extractedHeadlines: string[] = []
    let extractedDescriptions: string[] = []
    let extractionMetadata: any = {}
    let extractedAt: string | undefined

    try {
      console.log('🎯 开始提取广告投放元素（关键字、标题、描述）...')
      const { extractAdElements } = await import('@/lib/ad-elements-extractor')

      // 根据页面类型准备不同的输入数据
      if (pageType === 'product') {
        // 单商品场景：从AI分析结果中提取
        // productHighlights = "About this item" 产品详细描述
        // uniqueSellingPoints = 其他特性
        const aboutItems: string[] = productInfo.productHighlights
          ? (Array.isArray(productInfo.productHighlights)
              ? productInfo.productHighlights
              : productInfo.productHighlights.split('\n')).filter((f: string) => f.trim())
          : []

        const featureItems: string[] = productInfo.uniqueSellingPoints
          ? (Array.isArray(productInfo.uniqueSellingPoints)
              ? productInfo.uniqueSellingPoints
              : productInfo.uniqueSellingPoints.split('\n')).filter((f: string) => f.trim())
          : []

        const extractionResult = await extractAdElements(
          {
            pageType: 'product',
            product: {
              productName: pageData.title || extractedBrand,
              productDescription: productInfo.brandDescription || null,
              productPrice: pageData.price || null,
              originalPrice: null,
              discount: null,
              brandName: extractedBrand,
              features: featureItems,
              aboutThisItem: aboutItems,  // Amazon "About this item" 产品详细描述
              imageUrls: pageData.imageUrls || [],
              rating: productInfo.reviews?.rating?.toString() || null,
              reviewCount: productInfo.reviews?.reviewCount?.toString() || null,
              salesRank: null,
              availability: null,
              primeEligible: false,
              reviewHighlights: [],
              topReviews: [],
              technicalDetails: {},
              asin: null,
              category: productInfo.category || null
            }
          },
          extractedBrand,
          targetCountry,
          language,
          userId
        )

        extractedKeywords = extractionResult.keywords
        extractedHeadlines = extractionResult.headlines
        extractedDescriptions = extractionResult.descriptions
        extractionMetadata = extractionResult.sources
        extractedAt = new Date().toISOString()

        console.log(`✅ 单商品提取完成: ${extractedKeywords.length}个关键词, ${extractedHeadlines.length}个标题`)
      } else if (pageType === 'store') {
        // 店铺场景：从数据库读取已保存的产品数据
        const db = getSQLiteDatabase()
        const products = db.prepare(`
          SELECT name, rating, review_count, hot_score
          FROM scraped_products
          WHERE offer_id = ?
          ORDER BY hot_score DESC
          LIMIT 5
        `).all(offerId) as Array<{
          name: string
          rating: string | null
          review_count: string | null
          hot_score: number | null
        }>

        if (products.length > 0) {
          const extractionResult = await extractAdElements(
            {
              pageType: 'store',
              storeProducts: products.map(p => ({
                name: p.name,
                price: null,
                rating: p.rating,
                reviewCount: p.review_count,
                asin: null,
                hotScore: p.hot_score || undefined
              }))
            },
            extractedBrand,
            targetCountry,
            language,
            userId
          )

          extractedKeywords = extractionResult.keywords
          extractedHeadlines = extractionResult.headlines
          extractedDescriptions = extractionResult.descriptions
          extractionMetadata = extractionResult.sources
          extractedAt = new Date().toISOString()

          console.log(`✅ 店铺提取完成: ${extractedKeywords.length}个关键词, ${extractedHeadlines.length}个标题`)
        } else {
          console.warn('⚠️ 店铺页面未找到产品数据，跳过广告元素提取')
        }
      }
    } catch (extractError: any) {
      console.warn('⚠️ 广告元素提取失败（不影响主流程）:', extractError.message)
      // 提取失败不影响主流程，继续执行
    }

    // ⚠️ 品牌验证：如果品牌提取失败，标记为失败状态，避免生成无效广告
    if (extractedBrand === 'Unknown' || !extractedBrand || extractedBrand.trim() === '') {
      const brandError = '品牌名称提取失败。品牌词对于关键词生成和广告质量至关重要，无法继续创建广告。'
      console.error(`❌ ${brandError}`)
      updateOfferScrapeStatus(offerId, userId, 'failed', brandError)
      throw new Error(brandError)
    }

    updateOfferScrapeStatus(offerId, userId, 'completed', scrapeError, {
      brand: extractedBrand,        // 更新品牌名
      url: urlForScraping,               // 更新为解析后的真实URL
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
      review_analysis: reviewAnalysis ? formatFieldForDB(reviewAnalysis) : undefined,
      // 🎯 P0优化: 竞品对比分析结果
      competitor_analysis: competitorAnalysis ? formatFieldForDB(competitorAnalysis) : undefined,
      // ❌ P1优化已下线: 视觉元素智能分析（性价比不高）
      // visual_analysis: visualAnalysis ? formatFieldForDB(visualAnalysis) : undefined,
      // 🎯 需求34: 广告元素提取结果
      extracted_keywords: extractedKeywords.length > 0 ? formatFieldForDB(extractedKeywords) : undefined,
      extracted_headlines: extractedHeadlines.length > 0 ? formatFieldForDB(extractedHeadlines) : undefined,
      extracted_descriptions: extractedDescriptions.length > 0 ? formatFieldForDB(extractedDescriptions) : undefined,
      extraction_metadata: Object.keys(extractionMetadata).length > 0 ? formatFieldForDB(extractionMetadata) : undefined,
      extracted_at: extractedAt,
      // 🎯 P0优化: 原始爬虫数据（包含discount, salesRank, badge, primeEligible等字段）
      scraped_data: rawScrapedData ? formatFieldForDB(rawScrapedData) : undefined,
    })

    console.log(`Offer ${offerId} 抓取和分析完成`)
  } catch (error: any) {
    console.error(`Offer ${offerId} 抓取失败:`, error)
    throw error
  }
}
