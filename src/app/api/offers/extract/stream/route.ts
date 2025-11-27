/**
 * POST /api/offers/extract/stream
 * 自动提取Offer信息（SSE实时进度推送版本）
 */

import { NextRequest } from 'next/server';
import { createError, AppError } from '@/lib/errors';
import { createSSEStream, sendProgress, sendComplete, sendError } from '@/lib/sse-helper';
import { extractOffer } from '@/lib/offer-extraction-core';

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

  const { affiliate_link, target_country, skipCache = true, skipWarmup = false } = body;

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

      // ========== 步骤0-5: 调用核心提取函数（包含预热、代理、URL解析、品牌提取）==========
      const extractResult = await extractOffer({
        affiliateLink: affiliate_link,
        targetCountry: target_country,
        userId: userIdNum,
        skipCache,
        skipWarmup, // SSE版本默认不跳过预热
        progressCallback: (step, status, message, data) => {
          // 转发进度到SSE流
          sendProgress(controller, step, status, message, data);
        },
      });

      // 检查核心提取是否失败
      if (!extractResult.success || !extractResult.data) {
        sendError(controller, 'error', extractResult.error?.message || '提取失败', extractResult.error?.details);
        return;
      }

      // 提取核心数据
      const {
        finalUrl,
        finalUrlSuffix,
        brand: brandName,
        productDescription,
        targetLanguage,
        redirectCount,
        redirectChain,
        pageTitle,
        resolveMethod,
        proxyUsed,
        productCount,
        products,
        storeName,
        hotInsights,
        logoUrl,
        platform,
        productName: extractedProductName,
        price: extractedPrice,
        debug,
      } = extractResult.data;

      console.log(`✅ 核心提取完成: ${brandName || '未识别'}`);

      // ========== 步骤6: AI产品分析（SSE特有功能）==========
      sendProgress(controller, 'processing_data', 'in_progress', '正在进行AI产品分析...');

      let aiProductInfo = null;
      let aiAnalysisSuccess = false;

      try {
        // 导入AI分析函数
        const { analyzeProductPage } = await import('@/lib/ai');

        // 根据不同页面类型构造text内容
        let pageData: { title: string; description: string; text: string };
        let pageType: 'product' | 'store';

        if (debug.isAmazonStore && products) {
          // Amazon Store页面
          pageType = 'store';

          const productSummaries = products
            .slice(0, 15)
            .map((p: any, i: number) => {
              const hotMarker = i < 5 ? '🔥 ' : '✅ ';
              return `${hotMarker}${p.name} - ${p.price || 'N/A'} (Rating: ${p.rating || 'N/A'}, Reviews: ${p.reviews || 0})`;
            })
            .join('\n');

          const textContent = [
            `Store Name: ${storeName || brandName || 'Unknown'}`,
            `Total Products: ${productCount}`,
            productDescription ? `Description: ${productDescription}` : '',
            '\n=== HOT-SELLING PRODUCTS (Top 15) ===',
            productSummaries,
          ].join('\n');

          pageData = {
            title: storeName || brandName || 'Unknown Store',
            description: productDescription || '',
            text: textContent,
          };
        } else if (debug.isAmazonProductPage) {
          // Amazon产品页面
          pageType = 'product';

          const textContent = [
            `Product: ${extractedProductName || 'Unknown'}`,
            `Brand: ${brandName || 'Unknown'}`,
            `Price: ${extractedPrice || 'N/A'}`,
            productDescription ? `\nDescription:\n${productDescription}` : '',
          ]
            .filter(Boolean)
            .join('\n');

          pageData = {
            title: extractedProductName || brandName || 'Unknown Product',
            description: productDescription || '',
            text: textContent,
          };
        } else if (debug.isIndependentStore && products) {
          // 独立站店铺页面
          pageType = 'store';

          const productSummaries = products
            .slice(0, 15)
            .map((p: any, i: number) => `${i + 1}. ${p.name} - ${p.price || 'N/A'}`)
            .join('\n');

          const textContent = [
            `Store Name: ${storeName}`,
            `Platform: ${platform || 'Unknown'}`,
            `Total Products: ${productCount}`,
            productDescription ? `Description: ${productDescription}` : '',
            '\n=== PRODUCTS ===',
            productSummaries,
          ].join('\n');

          pageData = {
            title: storeName || brandName || 'Unknown Store',
            description: productDescription || '',
            text: textContent,
          };
        } else {
          // 通用产品页面（兜底）
          pageType = 'product';

          pageData = {
            title: extractedProductName || brandName || 'Unknown Product',
            description: productDescription || '',
            text: [
              extractedProductName ? `Product: ${extractedProductName}` : '',
              brandName ? `Brand: ${brandName}` : '',
              extractedPrice ? `Price: ${extractedPrice}` : '',
              productDescription ? `\nDescription:\n${productDescription}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          };
        }

        // 调用AI分析
        console.log(`🤖 开始AI产品分析 (页面类型: ${pageType})...`);
        aiProductInfo = await analyzeProductPage(
          {
            url: finalUrl,
            brand: brandName || 'Unknown',
            title: pageData.title,
            description: pageData.description,
            text: pageData.text,
            targetCountry: target_country,
            pageType,
          },
          userIdNum
        );

        aiAnalysisSuccess = true;
        console.log('✅ AI产品分析完成');
      } catch (aiError: any) {
        console.error('⚠️ AI产品分析失败（不影响流程）:', aiError.message);
      }

      sendProgress(
        controller,
        'processing_data',
        'completed',
        aiAnalysisSuccess ? 'AI产品分析完成' : '数据处理完成（AI分析失败）'
      );

      // ========== 步骤6.5: P0评论深度分析（仅Amazon产品页）==========
      let reviewAnalysis = null;
      let reviewAnalysisSuccess = false;

      if (debug.isAmazonProductPage && aiAnalysisSuccess) {
        try {
          sendProgress(controller, 'processing_data', 'in_progress', '正在抓取用户评论进行AI分析...');
          console.log('📝 开始P0评论分析...');

          const { scrapeAmazonReviews, analyzeReviewsWithAI } = await import('@/lib/review-analyzer');
          const { chromium } = await import('playwright');

          const browser = await chromium.launch({ headless: true });
          const context = await browser.newContext({
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          });

          const reviewPage = await context.newPage();

          try {
            await reviewPage.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const reviews = await scrapeAmazonReviews(reviewPage, 50);

            if (reviews.length > 0) {
              console.log(`✅ 抓取到${reviews.length}条评论，开始AI分析...`);

              reviewAnalysis = await analyzeReviewsWithAI(
                reviews,
                brandName || 'Unknown',
                target_country,
                userIdNum
              );

              reviewAnalysisSuccess = true;
              console.log('✅ P0评论分析完成');
            } else {
              console.log('⚠️ 未抓取到评论，跳过AI分析');
            }
          } finally {
            await reviewPage.close();
            await browser.close();
          }
        } catch (reviewError: any) {
          console.warn('⚠️ P0评论分析失败（不影响主流程）:', reviewError.message);
        }
      }

      // ========== 步骤6.6: P0竞品对比分析（仅Amazon产品页）==========
      let competitorAnalysis = null;
      let competitorAnalysisSuccess = false;

      if (debug.isAmazonProductPage && aiAnalysisSuccess) {
        try {
          sendProgress(controller, 'processing_data', 'in_progress', '正在抓取竞品进行对比分析...');
          console.log('🏆 开始P0竞品对比分析...');

          const { scrapeAmazonCompetitors, analyzeCompetitorsWithAI } = await import(
            '@/lib/competitor-analyzer'
          );
          const { chromium } = await import('playwright');

          const browser = await chromium.launch({ headless: true });
          const context = await browser.newContext({
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          });

          const competitorPage = await context.newPage();

          try {
            await competitorPage.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const competitors = await scrapeAmazonCompetitors(competitorPage, 10);

            if (competitors.length > 0) {
              console.log(`✅ 抓取到${competitors.length}个竞品，开始AI对比分析...`);

              const priceStr = extractedPrice;
              const priceNum = priceStr ? parseFloat(priceStr.replace(/[^0-9.]/g, '')) : null;

              // 安全提取productHighlights（可能是字符串、字符串数组或对象数组）
              const extractFeatures = (highlights: any): string[] => {
                if (!highlights) return [];
                if (typeof highlights === 'string') {
                  return highlights.split('\n').filter((f: string) => f.trim());
                }
                if (Array.isArray(highlights)) {
                  return highlights.map((item: any) => {
                    if (typeof item === 'string') return item;
                    return item?.line || item?.highlight || item?.description || String(item);
                  }).filter((f: string) => f.trim());
                }
                return [];
              };

              const ourProduct = {
                name: brandName || 'Unknown',
                price: priceNum,
                rating: null,
                reviewCount: null,
                features: extractFeatures(aiProductInfo?.productHighlights),
              };

              competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                competitors,
                target_country,
                userIdNum
              );

              competitorAnalysisSuccess = true;
              console.log('✅ P0竞品对比分析完成');
            } else {
              console.log('⚠️ 未抓取到竞品，跳过AI对比分析');
            }
          } finally {
            await competitorPage.close();
            await browser.close();
          }
        } catch (competitorError: any) {
          console.warn('⚠️ P0竞品对比分析失败（不影响主流程）:', competitorError.message);
        }
      }

      // ========== 步骤6.7: 广告元素提取（keywords, headlines, descriptions）==========
      let extractedKeywords: any[] = [];
      let extractedHeadlines: any[] = [];
      let extractedDescriptions: any[] = [];
      let extractionMetadata: any = null;
      let adExtractionSuccess = false;

      if (aiAnalysisSuccess && aiProductInfo) {
        try {
          sendProgress(controller, 'processing_data', 'in_progress', '正在提取广告元素...');
          console.log('📝 开始广告元素提取...');

          const { extractAdElements } = await import('@/lib/ad-elements-extractor');

          if ((debug.isAmazonStore || debug.isIndependentStore) && products) {
            // 店铺页面（Amazon或独立站）：使用热销产品数据
            const extractionResult = await extractAdElements(
              {
                pageType: 'store',
                storeProducts: products.slice(0, 5).map((p: any) => ({
                  name: p.name,
                  price: null,
                  rating: p.rating,
                  reviewCount: p.reviews,
                  imageUrl: null,
                  asin: null,
                  hotScore: p.hotScore,
                })),
              },
              brandName || 'Unknown',
              target_country,
              targetLanguage,
              userIdNum
            );

            extractedKeywords = extractionResult.keywords;
            extractedHeadlines = extractionResult.headlines;
            extractedDescriptions = extractionResult.descriptions;
            extractionMetadata = extractionResult.sources;

            console.log(
              `✅ 店铺广告元素提取完成: ${extractedKeywords.length}个关键词, ${extractedHeadlines.length}个标题`
            );
          } else {
            // 单品页面：使用AI分析结果
            // 安全提取productHighlights（可能是字符串、字符串数组或对象数组）
            const extractFeaturesForAd = (highlights: any): string[] => {
              if (!highlights) return [];
              if (typeof highlights === 'string') {
                return highlights.split('\n').filter((f: string) => f.trim());
              }
              if (Array.isArray(highlights)) {
                return highlights.map((item: any) => {
                  if (typeof item === 'string') return item;
                  return item?.line || item?.highlight || item?.description || String(item);
                }).filter((f: string) => f.trim());
              }
              return [];
            };

            const extractionResult = await extractAdElements(
              {
                pageType: 'product',
                product: {
                  productName: extractedProductName || brandName || 'Unknown',
                  brandName: brandName || 'Unknown',
                  features: extractFeaturesForAd(aiProductInfo.productHighlights),
                } as any,
              },
              brandName || 'Unknown',
              target_country,
              targetLanguage,
              userIdNum
            );

            extractedKeywords = extractionResult.keywords;
            extractedHeadlines = extractionResult.headlines;
            extractedDescriptions = extractionResult.descriptions;
            extractionMetadata = extractionResult.sources;

            console.log(
              `✅ 单品广告元素提取完成: ${extractedKeywords.length}个关键词, ${extractedHeadlines.length}个标题`
            );
          }

          adExtractionSuccess = true;
        } catch (adError: any) {
          console.warn('⚠️ 广告元素提取失败（不影响主流程）:', adError.message);
        }
      }

      // ========== 步骤7: 发送完成事件（包含完整分析结果）==========
      sendComplete(controller, {
        success: true,
        finalUrl,
        finalUrlSuffix: finalUrlSuffix || '',
        brand: brandName || '未识别',
        productDescription: productDescription || null,
        targetLanguage,
        redirectCount,
        redirectChain,
        pageTitle,
        resolveMethod: resolveMethod || 'sse-stream',
        productCount,
        // AI产品分析结果
        brandDescription: aiProductInfo?.brandDescription || null,
        uniqueSellingPoints: aiProductInfo?.uniqueSellingPoints || null,
        productHighlights: aiProductInfo?.productHighlights || null,
        targetAudience: aiProductInfo?.targetAudience || null,
        category: aiProductInfo?.category || null,
        aiAnalysisSuccess,
        // P0评论深度分析结果
        reviewAnalysis: reviewAnalysisSuccess ? reviewAnalysis : null,
        reviewAnalysisSuccess,
        // P0竞品对比分析结果
        competitorAnalysis: competitorAnalysisSuccess ? competitorAnalysis : null,
        competitorAnalysisSuccess,
        // 广告元素提取结果
        extractedKeywords: adExtractionSuccess ? extractedKeywords : [],
        extractedHeadlines: adExtractionSuccess ? extractedHeadlines : [],
        extractedDescriptions: adExtractionSuccess ? extractedDescriptions : [],
        extractionMetadata: adExtractionSuccess ? extractionMetadata : null,
        adExtractionSuccess,
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
