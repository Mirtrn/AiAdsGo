/**
 * Offer提取核心逻辑（统一真相来源）
 * 🔥 KISS优化：单一提取函数，支持SSE进度推送和批量处理
 *
 * 使用场景：
 * 1. 手动创建Offer（非SSE）：/api/offers/extract → extractOffer()
 * 2. 手动创建Offer（SSE）：/api/offers/extract/stream → extractOffer({progressCallback})
 * 3. 批量创建Offer（Worker）：batch-worker → extractOffer({batchMode: true})
 */

import { resolveAffiliateLink, BATCH_MODE_RETRY_CONFIG } from '@/lib/url-resolver-enhanced'
import { extractProductInfo } from '@/lib/scraper'
import {
  scrapeAmazonStore,
  scrapeIndependentStore,
  scrapeAmazonProduct,
} from '@/lib/scraper-stealth'
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
  data?: any
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
    imageUrls?: string[]

    // Amazon Store专属数据（可选）
    productCount?: number
    products?: any[]
    storeName?: string
    hotInsights?: string

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
    }
  }
  error?: {
    code: string
    message: string
    details?: any
  }
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
    // ========== 步骤0: 推广链接预热（可选） ==========
    if (!skipWarmup) {
      progressCallback?.('proxy_warmup', 'in_progress', '正在进行推广链接预热...')

      try {
        const targetProxyUrl = getProxyUrlForCountry(targetCountry, userId)

        if (!targetProxyUrl) {
          console.warn('⚠️ 未配置代理URL，跳过预热步骤')
          progressCallback?.('proxy_warmup', 'completed', '未配置代理URL，跳过预热')
        } else {
          const warmupSuccess = await warmupAffiliateLink(targetProxyUrl, affiliateLink)

          if (!warmupSuccess) {
            // 预热失败不中断流程，只记录警告
            console.warn('⚠️ 推广链接预热失败，继续后续流程')
            progressCallback?.('proxy_warmup', 'completed', '推广链接预热失败，继续后续流程')
          } else {
            console.log('✅ 推广链接预热已触发（12个代理IP访问中）')
            progressCallback?.('proxy_warmup', 'completed', '推广链接预热已触发')
          }
        }
      } catch (error: any) {
        // 预热异常不中断流程，只记录警告
        console.warn('⚠️ 推广链接预热异常:', error.message)
        progressCallback?.('proxy_warmup', 'completed', `推广链接预热异常: ${error.message}`)
      }
    } else {
      console.log('⏩ 跳过推广链接预热（skipWarmup=true）')
    }

    // ========== 步骤1: 加载代理池配置 ==========
    progressCallback?.('fetching_proxy', 'in_progress', '正在获取代理IP...')

    try {
      await initializeProxyPool(userId, targetCountry)
      progressCallback?.('fetching_proxy', 'completed', '代理IP获取完成')
    } catch (error: any) {
      const errorMessage = error instanceof AppError ? error.message : '代理配置未设置'
      progressCallback?.('fetching_proxy', 'error', errorMessage)

      return {
        success: false,
        error: {
          code: error instanceof AppError ? error.code : 'PROXY_NOT_CONFIGURED',
          message: errorMessage,
          details: error.details,
        },
      }
    }

    // ========== 步骤2: 检测页面类型（URL解析前） ==========
    const pageTypeByUrl = detectPageType(affiliateLink)
    const isAmazonStoreByUrl = pageTypeByUrl.isAmazonStore

    // ========== 步骤3: 解析推广链接 ==========
    progressCallback?.('resolving_link', 'in_progress', '正在解析推广链接...')

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
      progressCallback?.('resolving_link', 'completed', '推广链接解析完成（直接使用）', {
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

        progressCallback?.('resolving_link', 'completed', '推广链接解析完成', {
          currentUrl: resolvedData.finalUrl,
          redirectCount: resolvedData.redirectCount,
        })
      } catch (error: any) {
        console.error('URL解析失败:', error)
        const errorMessage = error instanceof AppError ? error.message : '推广链接解析失败'
        progressCallback?.('resolving_link', 'error', errorMessage)

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

    // ========== 步骤5: 抓取网页数据识别品牌 ==========
    progressCallback?.('extracting_brand', 'in_progress', '正在提取品牌信息...')

    let brandName = null
    let productDescription = null
    let scrapedData = null
    let storeData = null
    let independentStoreData = null
    let amazonProductData = null
    let productCount = 0
    let scrapingError: string | null = null  // 🔥 新增：记录抓取错误

    try {
      // 检测是否为独立站店铺首页
      const isIndependentStore = !isAmazonStore && !isAmazonProductPage && (() => {
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
      })()

      // 获取用户代理配置
      const proxyApiUrl = getProxyUrlForCountry(targetCountry, userId)
      if (!proxyApiUrl) {
        throw new Error(`用户 ${userId} 未配置${targetCountry}国家的代理URL`)
      }

      // 🔥 修复：拼接完整URL（包含追踪参数），避免Amazon 404拦截
      const fullTargetUrl = resolvedData.finalUrlSuffix
        ? `${resolvedData.finalUrl}?${resolvedData.finalUrlSuffix}`
        : resolvedData.finalUrl

      console.log('🔗 完整目标URL:', fullTargetUrl)
      console.log('  - Final URL:', resolvedData.finalUrl)
      console.log('  - URL Suffix:', resolvedData.finalUrlSuffix || '(无)')

      if (isAmazonStore) {
        console.log('🏪 检测到Amazon Store页面，使用非Crawlee方案抓取...')
        storeData = await scrapeAmazonStore(fullTargetUrl, proxyApiUrl)
        brandName = storeData.brandName || storeData.storeName
        productDescription = storeData.storeDescription
        productCount = storeData.totalProducts
        console.log(`✅ Amazon Store识别成功: ${brandName}, 产品数: ${productCount}`)
      } else if (isAmazonProductPage) {
        console.log('📦 检测到Amazon单品页面，使用非Crawlee方案抓取...')
        amazonProductData = await scrapeAmazonProduct(fullTargetUrl, proxyApiUrl)
        brandName = amazonProductData.brandName
        productDescription = amazonProductData.productDescription
        scrapedData = {
          productName: amazonProductData.productName,
          brand: amazonProductData.brandName,
          description: amazonProductData.productDescription,
          price: amazonProductData.productPrice,
          imageUrls: amazonProductData.imageUrls,
        }
        console.log(`✅ Amazon单品识别成功: ${brandName || 'Unknown'}`)
      } else if (isIndependentStore) {
        console.log('🏬 检测到独立站首页，使用非Crawlee方案抓取...')
        independentStoreData = await scrapeIndependentStore(fullTargetUrl, proxyApiUrl)
        brandName = independentStoreData.storeName
        productDescription = independentStoreData.storeDescription
        productCount = independentStoreData.totalProducts
        console.log(`✅ 独立站识别成功: ${brandName}, 产品数: ${productCount}`)
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

      progressCallback?.('extracting_brand', 'completed', '品牌信息提取完成', {
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
      progressCallback?.('extracting_brand', 'completed', `品牌信息提取失败: ${error?.message || '未知错误'}`)
    }

    // ========== 步骤6: 确定推广语言 ==========
    const targetLanguage = getTargetLanguage(targetCountry)

    // ========== 步骤7: 返回提取结果 ==========
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
          imageUrls: scrapedData.imageUrls,
        }),

        // Amazon Store专属数据（可选）
        ...(storeData && {
          productCount,
          products: storeData.products,
          storeName: storeData.storeName,
          hotInsights: storeData.hotInsights,
        }),

        // 独立站专属数据（可选）
        ...(independentStoreData && {
          productCount,
          products: independentStoreData.products,
          storeName: independentStoreData.storeName,
          logoUrl: independentStoreData.logoUrl,
          platform: independentStoreData.platform,
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
          isAmazonStore: !!storeData,
          isAmazonProductPage: !!amazonProductData,
          isIndependentStore: !!independentStoreData,
          productsExtracted: productCount,
          scrapeMethod: isAmazonStore ? 'playwright-store' :
                        amazonProductData ? 'playwright-product' :
                        independentStoreData ? 'playwright-independent' : 'axios-cheerio',
          scrapingError: scrapingError || undefined,  // 🔥 新增：包含抓取错误信息
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
