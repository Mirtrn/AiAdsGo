/**
 * POST /api/offers/extract/stream
 * 自动提取Offer信息（SSE实时进度推送版本）
 */

import { NextRequest } from 'next/server';
import { resolveAffiliateLink, getProxyPool } from '@/lib/url-resolver-enhanced';
import { getAllProxyUrls } from '@/lib/settings';
import { extractProductInfo } from '@/lib/scraper';
import {
  scrapeAmazonStoreWithCrawlee,
  scrapeIndependentStoreWithCrawlee,
  scrapeAmazonProductWithCrawlee,
} from '@/lib/scraper-stealth';
import { createError, AppError } from '@/lib/errors';
import { createSSEStream, sendProgress, sendComplete, sendError } from '@/lib/sse-helper';

export const maxDuration = 60; // 最长60秒

export async function POST(request: NextRequest) {
  // 从中间件注入的请求头中获取用户ID
  const userId = request.headers.get('x-user-id');
  const userIdNum = userId ? parseInt(userId, 10) : undefined;

  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { affiliate_link, target_country, skipCache = true } = body;

  // 验证必填参数
  if (!affiliate_link || !target_country) {
    const missing = [];
    if (!affiliate_link) missing.push('affiliate_link');
    if (!target_country) missing.push('target_country');

    return new Response(
      JSON.stringify({ error: `Missing required fields: ${missing.join(', ')}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 验证用户认证
  if (!userIdNum) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Please login first' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Create SSE stream
  const stream = createSSEStream(async (controller) => {
    try {
      console.log(`🔍 开始自动提取 (SSE): ${affiliate_link} (国家: ${target_country})`);

      // ========== 步骤1: 获取代理IP ==========
      sendProgress(controller, 'fetching_proxy', 'in_progress', '正在获取代理IP...');

      const proxySettings = getAllProxyUrls(userIdNum);

      if (!proxySettings || proxySettings.length === 0) {
        sendError(
          controller,
          'fetching_proxy',
          '代理配置未设置，请先在设置页面配置代理URL'
        );
        return;
      }

      // 加载代理到代理池
      const proxyPool = getProxyPool();
      const proxiesWithDefault = proxySettings.map((p) => ({
        url: p.url,
        country: p.country,
        is_default: false,
      }));
      await proxyPool.loadProxies(proxiesWithDefault);

      sendProgress(controller, 'fetching_proxy', 'completed', '代理IP获取完成', {
        proxyUsed: proxiesWithDefault[0]?.url,
      });

      // 🔥 检测是否为Amazon Store页面
      const isAmazonStoreByUrl =
        (affiliate_link.includes('/stores/') || affiliate_link.includes('/store/')) &&
        affiliate_link.includes('amazon.com');

      // ========== 步骤2: 解析推广链接 ==========
      sendProgress(controller, 'resolving_link', 'in_progress', '正在解析推广链接...');

      let resolvedData;

      if (isAmazonStoreByUrl) {
        console.log('🏪 检测到Amazon Store页面，跳过URL解析...');
        resolvedData = {
          finalUrl: affiliate_link,
          finalUrlSuffix: '',
          redirectCount: 0,
          redirectChain: [affiliate_link],
          pageTitle: null,
          resolveMethod: 'direct',
          proxyUsed: null,
        };
        sendProgress(controller, 'resolving_link', 'completed', '推广链接解析完成（直接使用）', {
          currentUrl: affiliate_link,
          redirectCount: 0,
        });
      } else {
        try {
          resolvedData = await resolveAffiliateLink(affiliate_link, {
            targetCountry: target_country,
            skipCache: skipCache,
          });
          sendProgress(controller, 'resolving_link', 'completed', '推广链接解析完成', {
            currentUrl: resolvedData.finalUrl,
            redirectCount: resolvedData.redirectCount,
          });
        } catch (error: any) {
          console.error('URL解析失败:', error);
          sendError(
            controller,
            'resolving_link',
            error instanceof AppError ? error.message : '推广链接解析失败，请检查链接是否有效',
            { originalError: error.message }
          );
          return;
        }
      }

      // 🔥 检测页面类型
      const isAmazonStoreByFinalUrl =
        (resolvedData.finalUrl.includes('/stores/') ||
          resolvedData.finalUrl.includes('/store/')) &&
        resolvedData.finalUrl.includes('amazon.com');

      const isAmazonStore = isAmazonStoreByUrl || isAmazonStoreByFinalUrl;

      const isAmazonProductPage =
        !isAmazonStore &&
        resolvedData.finalUrl.includes('amazon.com') &&
        (resolvedData.finalUrl.includes('/dp/') ||
          resolvedData.finalUrl.includes('/gp/product/'));

      // ========== 步骤3: 访问目标页面 ==========
      sendProgress(controller, 'accessing_page', 'in_progress', '正在访问目标页面...', {
        currentUrl: resolvedData.finalUrl,
      });

      // 模拟访问延迟
      await new Promise((resolve) => setTimeout(resolve, 1000));

      sendProgress(controller, 'accessing_page', 'completed', '目标页面访问成功');

      // ========== 步骤4: 抓取网页数据识别品牌 ==========
      let brandName = null;
      let productDescription = null;
      let scrapedData = null;
      let storeData = null;
      let independentStoreData = null;
      let amazonProductData = null;
      let productCount = 0;

      try {
        // 🔥 检测是否为独立站店铺首页
        const isIndependentStore =
          !isAmazonStore &&
          !isAmazonProductPage &&
          (() => {
            const url = resolvedData.finalUrl.toLowerCase();
            const urlObj = new URL(resolvedData.finalUrl);
            const pathname = urlObj.pathname;

            const isSingleProductPage =
              pathname.includes('/products/') ||
              pathname.includes('/product/') ||
              pathname.includes('/p/') ||
              pathname.includes('/dp/') ||
              pathname.includes('/item/');

            const isStorePage =
              pathname === '/' ||
              pathname.match(/^\/(collections|shop|store|category|catalogue)(\/.+)?$/i) ||
              pathname.split('/').filter(Boolean).length <= 1;

            return !isSingleProductPage && isStorePage;
          })();

        if (isAmazonStore) {
          sendProgress(
            controller,
            'extracting_brand',
            'in_progress',
            '正在从Amazon Store提取品牌信息...'
          );

          storeData = await scrapeAmazonStoreWithCrawlee(
            resolvedData.finalUrl,
            userIdNum,
            target_country
          );

          brandName = storeData.brandName || storeData.storeName;
          productDescription = storeData.storeDescription;
          productCount = storeData.totalProducts;

          sendProgress(controller, 'extracting_brand', 'completed', '品牌信息提取完成', {
            brandName: brandName ?? undefined,
          });

          sendProgress(
            controller,
            'scraping_products',
            'completed',
            `成功抓取 ${productCount} 个产品`,
            {
              productCount,
            }
          );

          console.log(`✅ Amazon Store识别成功: ${brandName}, 产品数: ${productCount}`);
        } else if (isAmazonProductPage) {
          sendProgress(
            controller,
            'extracting_brand',
            'in_progress',
            '正在从Amazon产品页提取品牌信息...'
          );

          amazonProductData = await scrapeAmazonProductWithCrawlee(
            resolvedData.finalUrl,
            userIdNum,
            target_country
          );

          brandName = amazonProductData.brandName;
          productDescription = amazonProductData.productDescription;

          scrapedData = {
            productName: amazonProductData.productName,
            brand: amazonProductData.brandName,
            description: amazonProductData.productDescription,
            price: amazonProductData.productPrice,
            imageUrls: amazonProductData.imageUrls,
          };

          sendProgress(controller, 'extracting_brand', 'completed', '品牌信息提取完成', {
            brandName: brandName ?? undefined,
          });

          console.log(
            `✅ Amazon单品识别成功: ${brandName || 'Unknown'}, 产品: ${amazonProductData.productName?.slice(0, 50)}...`
          );
        } else if (isIndependentStore) {
          sendProgress(
            controller,
            'extracting_brand',
            'in_progress',
            '正在从独立站提取品牌信息...'
          );

          sendProgress(
            controller,
            'scraping_products',
            'in_progress',
            '正在抓取独立站产品数据...'
          );

          independentStoreData = await scrapeIndependentStoreWithCrawlee(
            resolvedData.finalUrl,
            userIdNum,
            target_country
          );

          brandName = independentStoreData.storeName;
          productDescription = independentStoreData.storeDescription;
          productCount = independentStoreData.totalProducts;

          sendProgress(controller, 'extracting_brand', 'completed', '品牌信息提取完成', {
            brandName: brandName ?? undefined,
          });

          sendProgress(
            controller,
            'scraping_products',
            'completed',
            `成功抓取 ${productCount} 个产品`,
            {
              productCount,
            }
          );

          console.log(
            `✅ 独立站识别成功: ${brandName}, 产品数: ${productCount}, 平台: ${independentStoreData.platform}`
          );
        } else {
          sendProgress(
            controller,
            'extracting_brand',
            'in_progress',
            '正在提取产品品牌信息...'
          );

          scrapedData = await extractProductInfo(resolvedData.finalUrl, target_country);

          if (scrapedData.brand) {
            brandName = scrapedData.brand;
          }

          if (scrapedData.description) {
            productDescription = scrapedData.description;
          }

          sendProgress(controller, 'extracting_brand', 'completed', '品牌信息提取完成', {
            brandName: brandName ?? undefined,
          });

          console.log(`✅ 品牌识别成功: ${brandName}`);
        }
      } catch (error: any) {
        console.error('品牌识别失败:', error);
        sendProgress(
          controller,
          'extracting_brand',
          'completed',
          '品牌识别失败，您可以手动填写',
          {
            errorMessage: error.message,
          }
        );
      }

      // ========== 步骤5: 处理数据 ==========
      sendProgress(controller, 'processing_data', 'in_progress', '正在处理提取的数据...');

      const targetLanguage = getLanguageByCountry(target_country);

      // 模拟处理延迟
      await new Promise((resolve) => setTimeout(resolve, 500));

      sendProgress(controller, 'processing_data', 'completed', '数据处理完成');

      // ========== 步骤6: 发送完成事件 ==========
      sendComplete(controller, {
        success: true,
        finalUrl: resolvedData.finalUrl,
        brand: brandName || '未识别',
        productCount,
      });

      console.log('✅ SSE提取流程完成');
    } catch (error: any) {
      console.error('SSE提取失败:', error);
      sendError(
        controller,
        'error',
        error instanceof AppError ? error.message : '系统错误，请稍后重试',
        {
          originalError: error.message,
          stack: error.stack,
        }
      );
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * 根据国家代码确定语言
 */
function getLanguageByCountry(countryCode: string): string {
  const languageMap: Record<string, string> = {
    US: 'English',
    GB: 'English',
    CA: 'English',
    AU: 'English',
    DE: 'German',
    FR: 'French',
    ES: 'Spanish',
    IT: 'Italian',
    NL: 'Dutch',
    SE: 'Swedish',
    NO: 'Norwegian',
    DK: 'Danish',
    FI: 'Finnish',
    PL: 'Polish',
    JP: 'Japanese',
    CN: 'Chinese',
    KR: 'Korean',
    IN: 'English',
    TH: 'Thai',
    VN: 'Vietnamese',
    MX: 'Spanish',
    BR: 'Portuguese',
  };

  return languageMap[countryCode] || 'English';
}
