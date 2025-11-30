/**
 * POST /api/offers/extract/stream
 * 自动提取Offer信息（SSE实时进度推送版本）
 */

import { NextRequest } from 'next/server';
import { createError, AppError } from '@/lib/errors';
import { createSSEStream, sendProgress, sendComplete, sendError } from '@/lib/sse-helper';
import { extractOffer } from '@/lib/offer-extraction-core';
import { isCompetitorCompressionEnabled, isCompetitorCacheEnabled, FEATURE_FLAGS, logFeatureFlag } from '@/lib/feature-flags';

export const maxDuration = 60; // 最长60秒

// ========== 数据融合辅助函数 ==========

/**
 * 融合关键词：Enhanced关键词 + 原始关键词，按搜索量排序去重
 */
function mergeKeywords(
  original: Array<{ keyword: string; searchVolume?: number; [key: string]: any }>,
  enhanced: Array<{ keyword: string; searchVolume?: number; priority?: string; [key: string]: any }>
): Array<{ keyword: string; searchVolume?: number; [key: string]: any }> {
  const keywordMap = new Map<string, any>();

  // 先添加Enhanced关键词（优先级更高）
  for (const kw of enhanced) {
    const normalizedKeyword = kw.keyword.toLowerCase().trim();
    if (normalizedKeyword && !keywordMap.has(normalizedKeyword)) {
      keywordMap.set(normalizedKeyword, {
        ...kw,
        source: 'enhanced',
        // 根据priority设置排序权重
        sortWeight: kw.priority === 'core' ? 100 : kw.priority === 'high' ? 80 : kw.priority === 'medium' ? 60 : 40,
      });
    }
  }

  // 再添加原始关键词（如果不重复）
  for (const kw of original) {
    const normalizedKeyword = kw.keyword.toLowerCase().trim();
    if (normalizedKeyword && !keywordMap.has(normalizedKeyword)) {
      keywordMap.set(normalizedKeyword, {
        ...kw,
        source: 'original',
        sortWeight: 30, // 原始关键词权重较低
      });
    }
  }

  // 按搜索量和权重排序
  const merged = Array.from(keywordMap.values())
    .sort((a, b) => {
      // 先按搜索量排序（高到低）
      const volA = a.searchVolume || 0;
      const volB = b.searchVolume || 0;
      if (volB !== volA) return volB - volA;
      // 再按权重排序
      return (b.sortWeight || 0) - (a.sortWeight || 0);
    });

  return merged;
}

/**
 * 融合标题/描述：Enhanced + 原始，去重并按质量评分排序
 */
function mergeHeadlinesOrDescriptions(
  original: Array<{ text: string; [key: string]: any }>,
  enhanced: Array<{ text: string; relevance?: number; confidence?: number; [key: string]: any }>
): Array<{ text: string; [key: string]: any }> {
  const textMap = new Map<string, any>();

  // 先添加Enhanced内容（质量更高）
  for (const item of enhanced) {
    const normalizedText = item.text?.toLowerCase().trim();
    if (normalizedText && normalizedText.length > 0 && !textMap.has(normalizedText)) {
      textMap.set(normalizedText, {
        ...item,
        source: 'enhanced',
        // 计算综合质量分数
        qualityScore: ((item.relevance || 0.5) + (item.confidence || 0.5)) / 2,
      });
    }
  }

  // 再添加原始内容（如果不重复）
  for (const item of original) {
    const normalizedText = item.text?.toLowerCase().trim();
    if (normalizedText && normalizedText.length > 0 && !textMap.has(normalizedText)) {
      textMap.set(normalizedText, {
        ...item,
        source: 'original',
        qualityScore: 0.3, // 原始内容默认质量分
      });
    }
  }

  // 按质量评分排序
  const merged = Array.from(textMap.values())
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

  return merged;
}

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
        progressCallback: (step, status, message, data, duration) => {
          // 转发进度到SSE流
          sendProgress(controller, step, status, message, data, duration);
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
      const aiAnalysisStartTime = Date.now();
      sendProgress(controller, 'ai_analysis', 'in_progress', '正在进行AI产品分析...');

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

      // ========== 步骤6.5: P0评论深度分析（仅Amazon产品页）==========
      let reviewAnalysis = null;
      let reviewAnalysisSuccess = false;

      if (debug.isAmazonProductPage && aiAnalysisSuccess) {
        try {
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在抓取用户评论进行AI分析...');
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
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在抓取竞品进行对比分析...');
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

              // 🆕 Token优化：竞品压缩灰度发布（10%）
              const enableCompression = isCompetitorCompressionEnabled(userIdNum, FEATURE_FLAGS.competitorCompression.rolloutPercentage);
              const enableCache = isCompetitorCacheEnabled(userIdNum, FEATURE_FLAGS.competitorCache.rolloutPercentage);
              logFeatureFlag('competitorCompression', userIdNum, enableCompression);
              logFeatureFlag('competitorCache', userIdNum, enableCache);

              competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                competitors,
                target_country,
                userIdNum,
                { enableCompression, enableCache }
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
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在提取广告元素...');
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

      // ========== 步骤6.8: Enhanced优化模块 ==========
      // 【P0优化】增强的关键词提取
      let enhancedKeywords: any[] = [];
      let enhancedProductInfo: any = null;
      let enhancedReviewAnalysis: any = null;
      // 【P1优化】增强的标题和描述
      let enhancedHeadlines: any[] = [];
      let enhancedDescriptions: any[] = [];
      // 【P2优化】竞品分析和本地化
      let enhancedCompetitorAnalysis: any = null;
      let enhancedLocalization: any = null;
      // 【P3优化】品牌识别
      let enhancedBrandAnalysis: any = null;

      if (aiAnalysisSuccess && aiProductInfo) {
        // 【P0】增强关键词提取
        try {
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在进行增强关键词提取...');
          console.log('🔍 开始增强关键词提取...');

          const { extractKeywordsEnhanced } = await import('@/lib/enhanced-keyword-extractor');
          enhancedKeywords = await extractKeywordsEnhanced({
            productName: extractedProductName || brandName || 'Unknown',
            brandName: brandName || 'Unknown',
            category: aiProductInfo?.category || 'General',
            description: productDescription || '',
            features: aiProductInfo?.productHighlights?.split?.(',')?.map((f: string) => f.trim()) || [],
            useCases: [],
            targetAudience: aiProductInfo?.targetAudience || '',
            competitors: [],
            targetCountry: target_country,
            targetLanguage,
          }, userIdNum);
          console.log(`✅ 增强关键词提取完成: ${enhancedKeywords?.length || 0}个关键词`);
        } catch (err: any) {
          console.warn('⚠️ 增强关键词提取失败:', err.message);
        }

        // 【P0】增强产品信息提取
        try {
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在进行增强产品信息提取...');
          console.log('📦 开始增强产品信息提取...');

          const { extractProductInfoEnhanced } = await import('@/lib/enhanced-product-info-extractor');
          enhancedProductInfo = await extractProductInfoEnhanced({
            url: finalUrl,
            pageTitle: pageTitle || '',
            pageDescription: productDescription || '',
            pageText: productDescription || '',
            pageData: extractResult.data,
            targetCountry: target_country,
            targetLanguage,
          }, userIdNum);
          console.log('✅ 增强产品信息提取完成');
        } catch (err: any) {
          console.warn('⚠️ 增强产品信息提取失败:', err.message);
        }

        // 【P1】增强标题和描述提取
        try {
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在生成增强广告文案...');
          console.log('✍️ 开始增强标题和描述提取...');

          const { extractHeadlinesAndDescriptionsEnhanced } = await import('@/lib/enhanced-headline-description-extractor');
          const { headlines, descriptions } = await extractHeadlinesAndDescriptionsEnhanced({
            productName: extractedProductName || brandName || 'Unknown',
            brandName: brandName || 'Unknown',
            category: aiProductInfo?.category || 'General',
            description: productDescription || '',
            features: aiProductInfo?.productHighlights?.split?.(',')?.map((f: string) => f.trim()) || [],
            useCases: [],
            targetAudience: aiProductInfo?.targetAudience || '',
            pricing: { current: 99.99 },
            reviews: [],
            competitors: [],
            targetLanguage,
          }, userIdNum);
          enhancedHeadlines = headlines;
          enhancedDescriptions = descriptions;
          console.log(`✅ 增强标题和描述提取完成: ${headlines.length}个标题, ${descriptions.length}个描述`);
        } catch (err: any) {
          console.warn('⚠️ 增强标题和描述提取失败:', err.message);
        }

        // 【P2】增强竞品分析
        try {
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在进行增强竞品分析...');
          console.log('🏆 开始增强竞品分析...');

          const { analyzeCompetitorsEnhanced } = await import('@/lib/enhanced-competitor-analyzer');
          enhancedCompetitorAnalysis = await analyzeCompetitorsEnhanced({
            productName: extractedProductName || brandName || 'Unknown',
            brandName: brandName || 'Unknown',
            category: aiProductInfo?.category || 'General',
            description: productDescription || '',
            features: aiProductInfo?.productHighlights?.split?.(',')?.map((f: string) => f.trim()) || [],
            pricing: { current: 99.99 },
            rating: 4.5,
            reviewCount: 1000,
            targetCountry: target_country,
            targetLanguage,
          }, userIdNum);
          console.log('✅ 增强竞品分析完成');
        } catch (err: any) {
          console.warn('⚠️ 增强竞品分析失败:', err.message);
        }

        // 【P2】本地化适配
        try {
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在进行本地化适配...');
          console.log('🌍 开始本地化适配...');

          const { adaptForLanguageAndRegionEnhanced } = await import('@/lib/enhanced-localization-adapter');
          enhancedLocalization = await adaptForLanguageAndRegionEnhanced({
            productName: extractedProductName || brandName || 'Unknown',
            brandName: brandName || 'Unknown',
            category: aiProductInfo?.category || 'General',
            description: productDescription || '',
            keywords: enhancedKeywords.map((k: any) => k.keyword || k),
            basePrice: 99.99,
            targetCountry: target_country,
            targetLanguage,
          }, userIdNum);
          console.log('✅ 本地化适配完成');
        } catch (err: any) {
          console.warn('⚠️ 本地化适配失败:', err.message);
        }

        // 【P3】增强品牌识别
        try {
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在进行增强品牌识别...');
          console.log('🏷️ 开始增强品牌识别...');

          const { identifyBrandEnhanced } = await import('@/lib/enhanced-brand-identifier');
          enhancedBrandAnalysis = await identifyBrandEnhanced({
            brandName: brandName || 'Unknown',
            website: finalUrl,
            description: productDescription || '',
            products: [extractedProductName || 'Unknown'],
            targetAudience: aiProductInfo?.targetAudience || '',
            competitors: [],
            marketPosition: aiProductInfo?.category || 'General',
            targetCountry: target_country,
            targetLanguage,
          }, userIdNum);
          console.log('✅ 增强品牌识别完成');
        } catch (err: any) {
          console.warn('⚠️ 增强品牌识别失败:', err.message);
        }
      }

      // 发送AI分析阶段完成事件
      const aiAnalysisDuration = Date.now() - aiAnalysisStartTime;
      sendProgress(
        controller,
        'ai_analysis',
        'completed',
        aiAnalysisSuccess ? 'AI智能分析完成' : 'AI分析失败，使用基础数据',
        undefined,
        aiAnalysisDuration
      );

      // ========== 步骤6.9: 数据融合 - Enhanced数据合并到extracted_*字段 ==========
      // 融合关键词：Enhanced关键词 + 原始提取关键词，去重并按优先级排序
      const mergedKeywords = mergeKeywords(extractedKeywords, enhancedKeywords);

      // 融合标题：Enhanced标题 + 原始提取标题，去重
      const mergedHeadlines = mergeHeadlinesOrDescriptions(extractedHeadlines, enhancedHeadlines);

      // 融合描述：Enhanced描述 + 原始提取描述，去重
      const mergedDescriptions = mergeHeadlinesOrDescriptions(extractedDescriptions, enhancedDescriptions);

      // 融合元数据：包含Enhanced模块信息
      const mergedMetadata = {
        ...extractionMetadata,
        enhanced: {
          keywordsCount: enhancedKeywords.length,
          headlinesCount: enhancedHeadlines.length,
          descriptionsCount: enhancedDescriptions.length,
          productInfo: enhancedProductInfo ? true : false,
          competitorAnalysis: enhancedCompetitorAnalysis ? true : false,
          localization: enhancedLocalization ? true : false,
          brandAnalysis: enhancedBrandAnalysis ? true : false,
        }
      };

      console.log(`📊 数据融合完成: ${mergedKeywords.length}个关键词, ${mergedHeadlines.length}个标题, ${mergedDescriptions.length}个描述`);

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
        // 融合后的广告元素（包含Enhanced优化数据）
        extractedKeywords: mergedKeywords,
        extractedHeadlines: mergedHeadlines,
        extractedDescriptions: mergedDescriptions,
        extractionMetadata: mergedMetadata,
        adExtractionSuccess: adExtractionSuccess || enhancedKeywords.length > 0,
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
