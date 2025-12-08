/**
 * Offer提取核心逻辑（统一真相来源）
 * 🔥 KISS优化：单一提取函数，支持SSE进度推送和批量处理
 *
 * 使用场景：
 * 1. 手动创建Offer（非SSE）：/api/offers/extract → extractOffer()
 * 2. 手动创建Offer（SSE）：/api/offers/extract/stream → extractOffer({progressCallback})
 * 3. 批量创建Offer（Worker）：batch-worker → extractOffer({batchMode: true})
 */

import { resolveAffiliateLink, BATCH_MODE_RETRY_CONFIG, getProxyPool } from '@/lib/url-resolver-enhanced'
import { extractProductInfo } from '@/lib/scraper'
import {
  scrapeAmazonStoreDeep,
  scrapeIndependentStoreDeep,  // 🔥 修改：使用深度抓取版本，与Amazon Store保持一致
  scrapeAmazonProduct,
} from '@/lib/stealth-scraper'
import { createError, AppError } from '@/lib/errors'
import {
  detectPageType,
  initializeProxyPool,
  getTargetLanguage,
  PageTypeResult,
} from '@/lib/offer-utils'
import { warmupAffiliateLink } from '@/lib/proxy-warmup'
import { getProxyUrlForCountry } from '@/lib/settings'
import type { ProgressStage } from '@/types/progress'

/**
 * 提取选项
 */
export interface ExtractOfferOptions {
  /** 推广链接 */
  affiliateLink: string
  /** 目标国家 */
  targetCountry: string
  /** 用户ID */
  userId: number
  /** 是否跳过缓存（默认true，确保获取最新URL重定向数据） */
  skipCache?: boolean
  /** 是否批量处理模式（启用快速失败策略） */
  batchMode?: boolean
  /** 是否跳过推广链接预热（默认false，启用预热以触发联盟追踪） */
  skipWarmup?: boolean
  /** SSE进度回调函数（可选） */
  progressCallback?: ProgressCallback
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (
  step: ProgressStage,
  status: 'in_progress' | 'completed' | 'error',
  message: string,
  data?: any,
  duration?: number // 执行耗时（毫秒）
) => void

/**
 * 提取结果
 */
export interface ExtractOfferResult {
  success: boolean
  data?: {
    // 自动提取的数据
    finalUrl: string
    finalUrlSuffix: string
    brand: string | null
    productDescription: string | null
    targetLanguage: string

    // 单品页数据（可选）
    productName?: string
    price?: string

    // Amazon单品页详细数据（可选）
    // 注意：rating/reviewCount 存储为字符串，保持与 AmazonProductData 一致
    rating?: string | null
    reviewCount?: string | null
    reviewHighlights?: string[]
    // topReviews 存储为字符串数组，格式："4.5 stars - Title: Review text..."
    topReviews?: string[]
    features?: string[]
    aboutThisItem?: string[]
    technicalDetails?: Record<string, string>
    imageUrls?: string[]
    originalPrice?: string | null
    discount?: string | null
    salesRank?: string | null
    availability?: string | null
    primeEligible?: boolean
    asin?: string | null
    category?: string | null

    // Amazon Store专属数据（可选）
    productCount?: number
    products?: any[]
    storeName?: string
    storeDescription?: string
    hotInsights?: {
      avgRating: number
      avgReviews: number
      topProductsCount: number
    }
    // 店铺分类数据（店铺维度增强）
    productCategories?: {
      primaryCategories: Array<{
        name: string
        count: number
        url?: string
      }>
      categoryTree?: Record<string, string[]>
      totalCategories: number
    }
    // 深度抓取结果（热销商品详情页数据）
    deepScrapeResults?: {
      topProducts: Array<{
        asin: string
        productData: any
        reviews: string[]
        competitorAsins: string[]
        scrapeStatus: 'success' | 'failed' | 'skipped'
        error?: string
      }>
      totalScraped: number
      successCount: number
      failedCount: number
    }

    // 独立站专属数据（可选）
    logoUrl?: string
    platform?: string

    // 元数据
    redirectCount: number
    redirectChain: string[]
    pageTitle: string | null
    resolveMethod: string
    proxyUsed: string | null

    // 调试信息
    debug: {
      scrapedDataAvailable: boolean
      brandAutoDetected: boolean
      isAmazonStore: boolean
      isAmazonProductPage: boolean
      isIndependentStore: boolean
      productsExtracted: number
      scrapeMethod: string
      scrapingError?: string
      amazonProductDataExtracted?: boolean
      storeDataExtracted?: boolean
      independentStoreDataExtracted?: boolean
    }
  }
  error?: {
    code: string
    message: string
    details?: any
  }
}

/**
 * 记录阶段耗时的辅助函数
 */
function trackStageProgress(
  progressCallback: ProgressCallback | undefined,
  startTime: number,
  step: ProgressStage,
  status: 'in_progress' | 'completed' | 'error',
  message: string,
  data?: any
) {
  const duration = Date.now() - startTime
  progressCallback?.(step, status, message, data, duration)
}

/**
 * Offer提取核心函数
 *
 * @param options - 提取选项
 * @returns 提取结果
 */
export async function extractOffer(options: ExtractOfferOptions): Promise<ExtractOfferResult> {
  const {
    affiliateLink,
    targetCountry,
    userId,
    skipCache = true,
    batchMode = false,
    skipWarmup = false,
    progressCallback,
  } = options

  try {
    // ========== 步骤0: 初始化代理池（必须在预热之前） ==========
    const fetchingProxyStartTime = Date.now()
    progressCallback?.('fetching_proxy', 'in_progress', '正在初始化代理池...', undefined, 0)

    try {
      await initializeProxyPool(userId, targetCountry)

      // 🔥 检查代理国家是否匹配目标国家
      const proxyPool = getProxyPool()
      const proxyInfo = proxyPool.getProxyInfo(targetCountry)

      const proxyCountryMismatch = proxyInfo.proxy && !proxyInfo.isTargetCountryMatch
      const completedMessage = proxyCountryMismatch
        ? `代理池初始化完成（使用${proxyInfo.usedCountry}代理）`
        : '代理池初始化完成'

      trackStageProgress(
        progressCallback,
        fetchingProxyStartTime,
        'fetching_proxy',
        'completed',
        completedMessage,
        proxyCountryMismatch ? {
          proxyCountryMismatch: true,
          targetCountry: targetCountry,
          usedProxyCountry: proxyInfo.usedCountry || undefined,
        } : undefined
      )
    } catch (error: any) {
      const errorMessage = error instanceof AppError ? error.message : (error.message || '代理池初始化失败')
      const errorCode = error.code || (error instanceof AppError ? error.code : 'PROXY_POOL_INIT_FAILED')
      trackStageProgress(progressCallback, fetchingProxyStartTime, 'fetching_proxy', 'error', errorMessage)

      return {
        success: false,
        error: {
          code: errorCode,
          message: errorMessage,
          details: error.details,
        },
      }
    }

    // ========== 步骤1: 推广链接预热（可选） ==========
    const proxyWarmupStartTime = Date.now()
    if (!skipWarmup) {
      progressCallback?.('proxy_warmup', 'in_progress', '正在进行推广链接预热...', undefined, 0)

      try {
        const targetProxyUrl = await getProxyUrlForCountry(targetCountry, userId)

        if (!targetProxyUrl) {
          console.warn('⚠️ 未配置代理URL，跳过预热步骤')
          trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', '未配置代理URL，跳过预热')
        } else {
          const warmupSuccess = await warmupAffiliateLink(targetProxyUrl, affiliateLink)

          if (!warmupSuccess) {
            // 预热失败不中断流程，只记录警告
            console.warn('⚠️ 推广链接预热失败，继续后续流程')
            trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', '推广链接预热失败，继续后续流程')
          } else {
            console.log('✅ 推广链接预热已触发（12个代理IP访问中）')
            trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', '推广链接预热已触发')
          }
        }
      } catch (error: any) {
        // 预热异常不中断流程，只记录警告
        console.warn('⚠️ 推广链接预热异常:', error.message)
        trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', `推广链接预热异常: ${error.message}`)
      }
    } else {
      console.log('⏩ 跳过推广链接预热（skipWarmup=true）')
    }

    // ========== 步骤2: 检测页面类型（URL解析前） ==========
    const pageTypeByUrl = detectPageType(affiliateLink)
    const isAmazonStoreByUrl = pageTypeByUrl.isAmazonStore

    // ========== 步骤3: 解析推广链接 ==========
    const resolvingLinkStartTime = Date.now()
    progressCallback?.('resolving_link', 'in_progress', '正在解析推广链接...', undefined, 0)

    let resolvedData

    // 如果是Amazon Store页面，跳过URL解析，直接使用原始链接
    if (isAmazonStoreByUrl) {
      console.log('🏪 检测到Amazon Store页面，跳过URL解析...')
      resolvedData = {
        finalUrl: affiliateLink,
        finalUrlSuffix: '',
        redirectCount: 0,
        redirectChain: [affiliateLink],
        pageTitle: null,
        resolveMethod: 'direct',
        proxyUsed: null,
      }
      trackStageProgress(progressCallback, resolvingLinkStartTime, 'resolving_link', 'completed', '推广链接解析完成（直接使用）', {
        currentUrl: affiliateLink,
        redirectCount: 0,
      })
    } else {
      try {
        resolvedData = await resolveAffiliateLink(affiliateLink, {
          targetCountry: targetCountry,
          skipCache: skipCache,
          // 批量处理模式：使用快速失败策略
          ...(batchMode ? {
            retryConfig: BATCH_MODE_RETRY_CONFIG,  // 减少重试次数（1次）
            timeout: 3000                           // 减少超时时间（3秒）
          } : {}),
        })

        trackStageProgress(progressCallback, resolvingLinkStartTime, 'resolving_link', 'completed', '推广链接解析完成', {
          currentUrl: resolvedData.finalUrl,
          redirectCount: resolvedData.redirectCount,
        })
      } catch (error: any) {
        console.error('URL解析失败:', error)
        const errorMessage = error instanceof AppError ? error.message : '推广链接解析失败'
        trackStageProgress(progressCallback, resolvingLinkStartTime, 'resolving_link', 'error', errorMessage)

        return {
          success: false,
          error: {
            code: error instanceof AppError ? error.code : 'URL_RESOLVE_FAILED',
            message: errorMessage,
            details: { originalError: error.message },
          },
        }
      }
    }

    // ========== 步骤4: 检测页面类型（URL解析后） ==========
    const pageTypeByFinalUrl = detectPageType(resolvedData.finalUrl)

    // 🔥 修复：优先使用finalUrl的页面类型检测结果
    // 因为推广链接可能通过多次重定向，finalUrl才是真正的目标页面
    const isAmazonStore = pageTypeByFinalUrl.isAmazonStore
    const isAmazonProductPage = pageTypeByFinalUrl.isAmazonProductPage

    console.log('🔍 页面类型检测:')
    console.log('  - finalUrl:', resolvedData.finalUrl)
    console.log('  - 页面类型:', pageTypeByFinalUrl.pageType)
    console.log('  - isAmazonStore:', isAmazonStore)
    console.log('  - isAmazonProductPage:', isAmazonProductPage)

    // ========== 步骤5: 访问目标页面 ==========
    const accessingPageStartTime = Date.now()
    progressCallback?.('accessing_page', 'in_progress', '正在访问目标页面...', {
      currentUrl: resolvedData.finalUrl,
    }, 0)

    let brandName = null
    let productDescription = null
    let scrapedData = null
    let storeData = null
    let independentStoreData = null
    let amazonProductData = null
    let productCount = 0
    let scrapingError: string | null = null  // 🔥 新增：记录抓取错误

    try {
      // 🔥 验证finalUrl有效性
      if (!resolvedData.finalUrl || resolvedData.finalUrl === 'null/' || resolvedData.finalUrl === 'null') {
        throw new Error('Invalid finalUrl: URL解析返回了无效的URL')
      }

      // 检测是否为独立站店铺首页
      const isIndependentStore = !isAmazonStore && !isAmazonProductPage && (() => {
        try {
          const urlObj = new URL(resolvedData.finalUrl)
          const pathname = urlObj.pathname

        // 排除明确的单品页面路径
        const isSingleProductPage =
          pathname.includes('/products/') ||
          pathname.includes('/product/') ||
          pathname.includes('/p/') ||
          pathname.includes('/dp/') ||
          pathname.includes('/item/')

        // 店铺首页特征：根路径、collections、shop等
        const isStorePage =
          pathname === '/' ||
          pathname.match(/^\/(collections|shop|store|category|catalogue)(\/.+)?$/i) ||
          pathname.split('/').filter(Boolean).length <= 1

        return !isSingleProductPage && isStorePage
        } catch (urlError) {
          console.warn('⚠️ URL解析失败，默认判断为非独立站:', urlError)
          return false
        }
      })()

      // 获取用户代理配置
      const proxyApiUrl = await getProxyUrlForCountry(targetCountry, userId)
      if (!proxyApiUrl) {
        trackStageProgress(progressCallback, accessingPageStartTime, 'accessing_page', 'error', `用户 ${userId} 未配置${targetCountry}国家的代理URL`)
        throw new Error(`用户 ${userId} 未配置${targetCountry}国家的代理URL`)
      }

      // 🔥 修复：拼接完整URL（包含追踪参数），避免Amazon 404拦截
      const fullTargetUrl = resolvedData.finalUrlSuffix
        ? `${resolvedData.finalUrl}?${resolvedData.finalUrlSuffix}`
        : resolvedData.finalUrl

      console.log('🔗 完整目标URL:', fullTargetUrl)
      console.log('  - Final URL:', resolvedData.finalUrl)
      console.log('  - URL Suffix:', resolvedData.finalUrlSuffix || '(无)')

      // 访问目标页面完成
      trackStageProgress(progressCallback, accessingPageStartTime, 'accessing_page', 'completed', '目标页面访问成功', {
        currentUrl: fullTargetUrl,
        pageType: isAmazonStore ? 'Amazon Store' : isAmazonProductPage ? 'Amazon Product' : isIndependentStore ? '独立站首页' : '单品页面',
      })

      // ========== 步骤6: 抓取产品数据 ==========
      const scrapingProductsStartTime = Date.now()
      progressCallback?.('scraping_products', 'in_progress', '正在抓取产品数据...', undefined, 0)

      if (isAmazonStore) {
        console.log('🏪 检测到Amazon Store页面，使用深度抓取模式（包含热销商品详情）...')
        // 🔥 方案A：前置深度抓取
        // 进入前5个热销商品详情页，获取详细评论和竞品数据
        storeData = await scrapeAmazonStoreDeep(
          fullTargetUrl,
          5,  // 抓取前5个热销商品的详情页
          proxyApiUrl,
          targetCountry,
          3   // 并发数：最多同时抓取3个商品
        )
        brandName = storeData.brandName || storeData.storeName
        productDescription = storeData.storeDescription
        productCount = storeData.totalProducts
        console.log(`✅ Amazon Store深度识别成功: ${brandName}, 产品数: ${productCount}, 深度抓取: ${storeData.deepScrapeResults?.successCount || 0}/${storeData.deepScrapeResults?.totalScraped || 0}`)
      } else if (isAmazonProductPage) {
        console.log('📦 检测到Amazon单品页面，使用非Crawlee方案抓取...')
        amazonProductData = await scrapeAmazonProduct(fullTargetUrl, proxyApiUrl, targetCountry)
        brandName = amazonProductData.brandName
        productDescription = amazonProductData.productDescription
        scrapedData = {
          productName: amazonProductData.productName,
          brand: amazonProductData.brandName,
          description: amazonProductData.productDescription,
          price: amazonProductData.productPrice,
        }
        console.log(`✅ Amazon单品识别成功: ${brandName || 'Unknown'}`)
      } else if (isIndependentStore) {
        console.log('🏬 检测到独立站首页，使用深度抓取模式（包含热销商品详情）...')
        // 🔥 修改（2025-12-08）：使用深度抓取版本，与Amazon Store保持一致
        // 进入前5个热销商品详情页，获取详细评论和竞品数据
        independentStoreData = await scrapeIndependentStoreDeep(
          fullTargetUrl,
          5,  // 抓取前5个热销商品的详情页
          proxyApiUrl,
          targetCountry,
          3   // 并发数：最多同时抓取3个商品
        )
        brandName = independentStoreData.storeName
        productDescription = independentStoreData.storeDescription
        productCount = independentStoreData.totalProducts
        console.log(`✅ 独立站深度识别成功: ${brandName}, 产品数: ${productCount}, 深度抓取: ${independentStoreData.deepScrapeResults?.successCount || 0}/${independentStoreData.deepScrapeResults?.totalScraped || 0}`)
      } else {
        // 使用普通scraper抓取单个产品页面（非Amazon站点）
        scrapedData = await extractProductInfo(resolvedData.finalUrl, targetCountry)
        if (scrapedData.brand) {
          brandName = scrapedData.brand
        }
        if (scrapedData.description) {
          productDescription = scrapedData.description
        }
        console.log(`✅ 品牌识别成功: ${brandName}`)
      }

      // 抓取产品数据完成
      trackStageProgress(progressCallback, scrapingProductsStartTime, 'scraping_products', 'completed', '产品数据抓取完成', {
        productCount: productCount || (scrapedData ? 1 : 0),
      })

      // ========== 步骤7: 提取品牌信息 ==========
      const extractingBrandStartTime = Date.now()
      progressCallback?.('extracting_brand', 'in_progress', '正在提取品牌信息...', undefined, 0)

      trackStageProgress(progressCallback, extractingBrandStartTime, 'extracting_brand', 'completed', '品牌信息提取完成', {
        brandName: brandName ?? undefined,
      })
    } catch (error: any) {
      // 🔥 改进：详细记录错误信息，方便诊断
      scrapingError = `${error?.constructor?.name || 'Error'}: ${error?.message || String(error)}`  // 保存错误信息

      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.error('❌ [Playwright] 品牌识别失败')
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.error('错误类型:', error?.constructor?.name || 'Unknown')
      console.error('错误消息:', error?.message || String(error))
      console.error('Final URL:', resolvedData?.finalUrl)
      console.error('页面类型:', {
        isAmazonStore,
        isAmazonProductPage,
        isIndependentStore: !isAmazonStore && !isAmazonProductPage
      })
      console.error('堆栈跟踪:', error?.stack)
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      // 品牌识别失败不中断流程，用户可以手动填写
      // 标记当前阶段为完成（即使有错误）
      const errorTime = Date.now()
      trackStageProgress(progressCallback, accessingPageStartTime, 'accessing_page', 'completed', '目标页面访问完成')
      progressCallback?.('scraping_products', 'completed', `产品数据抓取失败: ${error?.message || '未知错误'}`, undefined, errorTime - accessingPageStartTime)
      progressCallback?.('extracting_brand', 'completed', `品牌信息提取失败: ${error?.message || '未知错误'}`, undefined, 0)
    }

    // ========== 步骤8: 处理数据 ==========
    const processingDataStartTime = Date.now()
    progressCallback?.('processing_data', 'in_progress', '正在处理数据...', undefined, 0)

    // ========== 步骤9: 确定推广语言 ==========
    const targetLanguage = getTargetLanguage(targetCountry)

    trackStageProgress(progressCallback, processingDataStartTime, 'processing_data', 'completed', '数据处理完成')

    // ========== 步骤10: 返回提取结果 ==========
    return {
      success: true,
      data: {
        // 自动提取的数据
        finalUrl: resolvedData.finalUrl,
        finalUrlSuffix: resolvedData.finalUrlSuffix || '',
        brand: brandName,
        productDescription,
        targetLanguage,

        // 单品页数据（可选）
        ...(scrapedData && {
          productName: scrapedData.productName,
          price: scrapedData.price,
        }),

        // Amazon单品页评论数据（复用已抓取数据，避免重复请求）
        ...(amazonProductData && {
          rating: amazonProductData.rating,
          reviewCount: amazonProductData.reviewCount,
          reviewHighlights: amazonProductData.reviewHighlights,
          topReviews: amazonProductData.topReviews,
          // 🆕 补充缺失的重要字段
          features: amazonProductData.features,
          aboutThisItem: amazonProductData.aboutThisItem,
          technicalDetails: amazonProductData.technicalDetails,
          imageUrls: amazonProductData.imageUrls,
          originalPrice: amazonProductData.originalPrice,
          discount: amazonProductData.discount,
          salesRank: amazonProductData.salesRank,
          availability: amazonProductData.availability,
          primeEligible: amazonProductData.primeEligible,
          asin: amazonProductData.asin,
          category: amazonProductData.category,
          relatedAsins: amazonProductData.relatedAsins,  // 🔥 新增：竞品ASIN列表（已过滤同品牌产品）
        }),

        // Amazon Store专属数据（可选）
        ...(storeData && {
          productCount,
          products: storeData.products,
          storeName: storeData.storeName,
          storeDescription: storeData.storeDescription,
          hotInsights: storeData.hotInsights,
          productCategories: storeData.productCategories,
          deepScrapeResults: storeData.deepScrapeResults,
        }),

        // 独立站专属数据（可选）
        // 🔥 修改（2025-12-08）：添加hotInsights和deepScrapeResults，与Amazon Store保持一致
        ...(independentStoreData && {
          productCount,
          products: independentStoreData.products,
          storeName: independentStoreData.storeName,
          storeDescription: independentStoreData.storeDescription,
          logoUrl: independentStoreData.logoUrl,
          platform: independentStoreData.platform,
          hotInsights: independentStoreData.hotInsights,  // 🔥 新增：热销洞察
          deepScrapeResults: independentStoreData.deepScrapeResults,  // 🔥 新增：深度抓取结果
        }),

        // 元数据
        redirectCount: resolvedData.redirectCount,
        redirectChain: resolvedData.redirectChain,
        pageTitle: resolvedData.pageTitle,
        resolveMethod: resolvedData.resolveMethod || 'unknown',
        proxyUsed: resolvedData.proxyUsed || null,

        // 调试信息
        debug: {
          scrapedDataAvailable: !!scrapedData,
          brandAutoDetected: !!brandName,
          isAmazonStore: pageTypeByFinalUrl.isAmazonStore,  // ✅ 修复：基于URL模式判断
          isAmazonProductPage: pageTypeByFinalUrl.isAmazonProductPage,  // ✅ 修复：基于URL模式判断
          isIndependentStore: !pageTypeByFinalUrl.isAmazonStore && !pageTypeByFinalUrl.isAmazonProductPage,  // ✅ 修复：基于URL模式判断
          productsExtracted: productCount,
          scrapeMethod: isAmazonStore ? 'playwright-store' :
                        amazonProductData ? 'playwright-product' :
                        independentStoreData ? 'playwright-independent' : 'axios-cheerio',
          scrapingError: scrapingError || undefined,  // 🔥 新增：包含抓取错误信息
          // 🆕 新增：数据抓取成功标志（用于诊断）
          amazonProductDataExtracted: !!amazonProductData,
          storeDataExtracted: !!storeData,
          independentStoreDataExtracted: !!independentStoreData,
        },
      } as ExtractOfferResult['data'],
    }
  } catch (error: any) {
    console.error('Offer提取失败:', error)

    return {
      success: false,
      error: {
        code: error instanceof AppError ? error.code : 'EXTRACTION_FAILED',
        message: error instanceof AppError ? error.message : '系统内部错误',
        details: { originalError: error.message },
      },
    }
  }
}
