/**
 * POST /api/offers/extract/stream
 * 自动提取Offer信息（SSE实时进度推送版本）
 */

import { NextRequest } from 'next/server';
import { createError, AppError } from '@/lib/errors';
import { createSSEStream, sendProgress, sendComplete, sendError } from '@/lib/sse-helper';
import { extractOffer } from '@/lib/offer-extraction-core';
import { isCompetitorCompressionEnabled, isCompetitorCacheEnabled, FEATURE_FLAGS, logFeatureFlag } from '@/lib/feature-flags';
import { parsePrice } from '@/lib/pricing-utils';

export const maxDuration = 120; // 最长120秒（从60秒增加，适应复杂页面抓取）

// ========== 数据融合辅助函数 ==========

/**
 * 融合关键词：Enhanced关键词 + 原始关键词，按搜索量排序去重
 */
function mergeKeywords(
  original: Array<{ keyword?: string; searchVolume?: number; [key: string]: any }>,
  enhanced: Array<{ keyword?: string; searchVolume?: number; priority?: string; [key: string]: any }>
): Array<{ keyword: string; searchVolume?: number; [key: string]: any }> {
  const keywordMap = new Map<string, any>();

  // 安全处理增强关键词（优先级更高）
  if (Array.isArray(enhanced)) {
    for (const kw of enhanced) {
      // 严格检查：kw存在且有有效的keyword属性
      if (!kw || typeof kw.keyword !== 'string') continue;

      const normalizedKeyword = kw.keyword.toLowerCase().trim();
      if (normalizedKeyword.length > 0 && !keywordMap.has(normalizedKeyword)) {
        keywordMap.set(normalizedKeyword, {
          ...kw,
          keyword: kw.keyword, // 保留原始大小写
          source: 'enhanced',
          // 根据priority设置排序权重
          sortWeight: kw.priority === 'core' ? 100 : kw.priority === 'high' ? 80 : kw.priority === 'medium' ? 60 : 40,
        });
      }
    }
  }

  // 安全处理原始关键词（如果不重复）
  if (Array.isArray(original)) {
    for (const kw of original) {
      // 严格检查：kw存在且有有效的keyword属性
      if (!kw || typeof kw.keyword !== 'string') continue;

      const normalizedKeyword = kw.keyword.toLowerCase().trim();
      if (normalizedKeyword.length > 0 && !keywordMap.has(normalizedKeyword)) {
        keywordMap.set(normalizedKeyword, {
          ...kw,
          keyword: kw.keyword, // 保留原始大小写
          source: 'original',
          sortWeight: 30, // 原始关键词权重较低
        });
      }
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
  original: Array<{ text?: string; [key: string]: any }>,
  enhanced: Array<{ text?: string; relevance?: number; confidence?: number; [key: string]: any }>
): Array<{ text: string; [key: string]: any }> {
  const textMap = new Map<string, any>();

  // 安全处理增强内容（质量更高）
  if (Array.isArray(enhanced)) {
    for (const item of enhanced) {
      // 严格检查：item存在且有有效的text属性
      if (!item || typeof item.text !== 'string') continue;

      const normalizedText = item.text.toLowerCase().trim();
      if (normalizedText.length > 0 && !textMap.has(normalizedText)) {
        textMap.set(normalizedText, {
          ...item,
          text: item.text, // 保留原始大小写
          source: 'enhanced',
          // 计算综合质量分数
          qualityScore: ((item.relevance || 0.5) + (item.confidence || 0.5)) / 2,
        });
      }
    }
  }

  // 安全处理原始内容（如果不重复）
  if (Array.isArray(original)) {
    for (const item of original) {
      // 严格检查：item存在且有有效的text属性
      if (!item || typeof item.text !== 'string') continue;

      const normalizedText = item.text.toLowerCase().trim();
      if (normalizedText.length > 0 && !textMap.has(normalizedText)) {
        textMap.set(normalizedText, {
          ...item,
          text: item.text, // 保留原始大小写
          source: 'original',
          qualityScore: 0.3, // 原始内容默认质量分
        });
      }
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
        // 🆕 复用已抓取的评论数据（避免重复请求）
        rating: extractedRating,
        reviewCount: extractedReviewCount,
        reviewHighlights: extractedReviewHighlights,
        topReviews: extractedTopReviews,
        // 🆕 补充的产品详情字段
        features: extractedFeatures,
        aboutThisItem: extractedAboutThisItem,
        technicalDetails: extractedTechnicalDetails,
        imageUrls: extractedImageUrls,
        originalPrice: extractedOriginalPrice,
        discount: extractedDiscount,
        salesRank: extractedSalesRank,
        availability: extractedAvailability,
        primeEligible: extractedPrimeEligible,
        asin: extractedAsin,
        category: extractedCategory,
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

          // ✅ 增强：补充 hotInsights、logoUrl、platform 等数据
          const textContent = [
            `Store Name: ${storeName || brandName || 'Unknown'}`,
            `Total Products: ${productCount}`,
            productDescription ? `Description: ${productDescription}` : '',
            hotInsights ? `\n=== HOT INSIGHTS ===\n${hotInsights}` : '',  // 🆕 新增热销洞察
            logoUrl ? `Logo: ${logoUrl}` : '',  // 🆕 新增店铺logo（独立站）
            platform ? `Platform: ${platform}` : '',  // 🆕 新增平台信息（独立站）
            '\n=== HOT-SELLING PRODUCTS (Top 15) ===',
            productSummaries,
          ].filter(Boolean).join('\n');

          console.log(`   📊 Store页面AI分析数据增强:`);
          console.log(`      - 热销洞察: ${hotInsights ? '有' : '无'}`);
          console.log(`      - Logo URL: ${logoUrl ? '有' : '无'}`);
          console.log(`      - 平台信息: ${platform || 'N/A'}`);

          pageData = {
            title: storeName || brandName || 'Unknown Store',
            description: productDescription || '',
            text: textContent,
          };
        } else if (debug.isAmazonProductPage) {
          // Amazon产品页面
          pageType = 'product';

          // 🆕 增强AI分析数据：使用所有已抓取的产品详情
          const featuresText = extractedFeatures && extractedFeatures.length > 0
            ? `\n=== PRODUCT FEATURES ===\n${extractedFeatures.join('\n')}`
            : '';

          const aboutText = extractedAboutThisItem && extractedAboutThisItem.length > 0
            ? `\n=== ABOUT THIS ITEM ===\n${extractedAboutThisItem.join('\n')}`
            : '';

          const technicalText = extractedTechnicalDetails && Object.keys(extractedTechnicalDetails).length > 0
            ? `\n=== TECHNICAL DETAILS ===\n${Object.entries(extractedTechnicalDetails).map(([k, v]) => `${k}: ${v}`).join('\n')}`
            : '';

          const priceInfo = [
            extractedPrice ? `Current Price: ${extractedPrice}` : '',
            extractedOriginalPrice ? `Original Price: ${extractedOriginalPrice}` : '',
            extractedDiscount ? `Discount: ${extractedDiscount}` : '',
          ].filter(Boolean).join(' | ');

          const textContent = [
            `Product: ${extractedProductName || 'Unknown'}`,
            `Brand: ${brandName || 'Unknown'}`,
            priceInfo || `Price: N/A`,
            extractedRating ? `Rating: ${extractedRating} stars (${extractedReviewCount || 0} reviews)` : '',
            extractedSalesRank ? `Sales Rank: ${extractedSalesRank}` : '',
            extractedAvailability ? `Availability: ${extractedAvailability}` : '',
            extractedPrimeEligible ? `Prime Eligible: Yes` : '',
            extractedCategory ? `Category: ${extractedCategory}` : '',
            extractedAsin ? `ASIN: ${extractedAsin}` : '',
            productDescription ? `\nDescription:\n${productDescription}` : '',
            featuresText,
            aboutText,
            technicalText,
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
          sendProgress(controller, 'ai_analysis', 'in_progress', '正在分析用户评论...');
          console.log('📝 开始P0评论分析...');

          const { analyzeReviewsWithAI } = await import('@/lib/review-analyzer');
          // 从 review-analyzer 导入类型
          type RawReview = {
            rating: string | null;
            title: string | null;
            body: string | null;
            helpful: string | null;
            verified: boolean;
            date?: string | null;
            author?: string | null;
          };

          // 🔧 方案B优化：优先复用核心提取已抓取的评论数据，避免重复请求
          let reviews: RawReview[] = [];

          // 检查是否有已抓取的评论数据
          if (extractedTopReviews && extractedTopReviews.length > 0) {
            console.log(`♻️ 复用核心提取的${extractedTopReviews.length}条评论数据（避免重复请求）`);

            // 转换已有评论为 RawReview 格式（供AI分析）
            reviews = extractedTopReviews.map((reviewStr: string) => {
              // 解析格式: "4.5 out of 5 stars - Title: Review text..."
              const ratingMatch = reviewStr.match(/^([\d.]+)\s*(out of \d+\s*)?(stars?)/i);
              const rating = ratingMatch ? `${ratingMatch[1]} out of 5 stars` : null;

              // 尝试分离标题和正文
              const titleMatch = reviewStr.match(/[-–]\s*([^:]+?):\s*(.+)/);
              const title = titleMatch ? titleMatch[1].trim() : null;
              const body = titleMatch ? titleMatch[2].trim() : reviewStr;

              return { rating, title, body, helpful: null, verified: false };
            });

            // 如果有reviewHighlights，也加入分析
            if (extractedReviewHighlights && extractedReviewHighlights.length > 0) {
              console.log(`♻️ 补充${extractedReviewHighlights.length}条评论摘要`);
              extractedReviewHighlights.forEach((highlight: string) => {
                if (highlight && highlight.length > 10) {
                  reviews.push({ rating: '4.0 out of 5 stars', title: 'Highlight', body: highlight, helpful: null, verified: false });
                }
              });
            }
          } else {
            // 🔄 降级方案：如果核心提取没有评论数据，才重新请求
            console.log('⚠️ 核心提取无评论数据，尝试重新抓取...');

            const { scrapeAmazonReviews } = await import('@/lib/review-analyzer');
            const { chromium } = await import('playwright');
            const { getProxyUrlForCountry } = await import('@/lib/settings');
            const { getProxyIp } = await import('@/lib/proxy/fetch-proxy-ip');

            const proxyUrl = await getProxyUrlForCountry(target_country, userIdNum);
            let browserOptions: any = { headless: true };

            if (proxyUrl) {
              try {
                const proxyCredentials = await getProxyIp(proxyUrl);
                browserOptions.proxy = {
                  server: `http://${proxyCredentials.host}:${proxyCredentials.port}`,
                  username: proxyCredentials.username,
                  password: proxyCredentials.password,
                };
                console.log(`🔒 P0评论分析使用代理: ${proxyCredentials.host}:${proxyCredentials.port}`);
              } catch (proxyError: any) {
                console.warn(`⚠️ 获取代理失败，尝试直连: ${proxyError.message}`);
              }
            }

            const browser = await chromium.launch(browserOptions);
            const context = await browser.newContext({
              userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            });

            const reviewPage = await context.newPage();

            try {
              await reviewPage.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
              reviews = await scrapeAmazonReviews(reviewPage, 50);
              console.log(`✅ 降级方案抓取到${reviews.length}条评论`);
            } finally {
              await reviewPage.close();
              await browser.close();
            }
          }

          // AI分析评论
          if (reviews.length > 0) {
            console.log(`✅ 共${reviews.length}条评论，开始AI分析...`);

            reviewAnalysis = await analyzeReviewsWithAI(
              reviews,
              brandName || 'Unknown',
              target_country,
              userIdNum
            );

            reviewAnalysisSuccess = true;
            console.log('✅ P0评论分析完成');
          } else {
            console.log('⚠️ 无评论数据，跳过AI分析');
          }
        } catch (reviewError: any) {
          console.warn('⚠️ P0评论分析失败（不影响主流程）:', reviewError.message);
        }
      }

      // ========== 步骤6.6: P0竞品对比分析（Amazon产品页 + 店铺页 + 独立站）==========
      let competitorAnalysis = null;
      let competitorAnalysisSuccess = false;

      // ✅ 扩展：支持Amazon产品页 + 店铺页 + 独立站
      const shouldRunCompetitorAnalysis = debug.isAmazonProductPage || debug.isAmazonStore || debug.isIndependentStore;

      if (shouldRunCompetitorAnalysis && aiAnalysisSuccess) {
        try {
          const pageTypeLabel = debug.isIndependentStore ? '独立站' :
                                debug.isAmazonStore ? 'Amazon店铺页' : 'Amazon产品页';
          sendProgress(controller, 'ai_analysis', 'in_progress', `正在分析${pageTypeLabel}竞品对比...`);
          console.log(`🏆 开始竞品对比分析 (${pageTypeLabel})...`);

          const { inferCompetitorKeywords, searchCompetitorsOnAmazon, scrapeAmazonCompetitors, analyzeCompetitorsWithAI } = await import(
            '@/lib/competitor-analyzer'
          );

          let competitors: any[] = [];

          // 🆕 统一策略：AI推断关键词 + Amazon搜索验证（适用所有页面类型）
          console.log('🤖 使用AI推断竞品搜索关键词...');

          // 构建产品信息用于AI推断（🔧 增强版：传递完整产品上下文）
          const productInfoForAI = {
            // 基础信息
            name: extractedProductName || pageTitle || brandName || 'Unknown Product',
            brand: brandName || 'Unknown',  // ✅ 修复：确保brand不为null
            category: aiProductInfo?.category || extractedCategory || 'Unknown',
            price: parsePrice(extractedPrice),
            targetCountry: target_country,
            // 🆕 增强信息：帮助AI更准确地推断竞品搜索词
            features: extractedFeatures || [],
            aboutThisItem: extractedAboutThisItem || [],
            // ✅ 修复：使用uniqueSellingPoints字段,并转换为数组格式
            sellingPoints: aiProductInfo?.uniqueSellingPoints
              ? aiProductInfo.uniqueSellingPoints.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean)
              : [],
            productDescription: productDescription || aiProductInfo?.brandDescription || '',
            // 🆕 补充：当基础字段为空时，从pageTitle提取关键信息
            pageTitle: pageTitle || ''
          };

          // 🔍 日志：输出传递给AI的产品信息摘要
          console.log(`   产品名称: ${productInfoForAI.name}`);
          console.log(`   品牌: ${productInfoForAI.brand || 'Unknown'}`);
          console.log(`   品类: ${productInfoForAI.category}`);
          console.log(`   特性数量: ${productInfoForAI.features.length + productInfoForAI.aboutThisItem.length}`);
          console.log(`   描述长度: ${productInfoForAI.productDescription.length}字符`);

          try {
            // Step 1: AI推断竞品搜索词
            const searchTerms = await inferCompetitorKeywords(productInfoForAI, userIdNum);

            if (searchTerms.length === 0) {
              console.log('⚠️ AI未推断出有效搜索词，跳过竞品分析');
            } else {
              // Step 2: 使用Playwright在Amazon搜索验证竞品
              const { chromium } = await import('playwright');
              const browser = await chromium.launch({ headless: true });
              const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
              });
              const competitorPage = await context.newPage();

              try {
                // 搜索验证竞品（真实Amazon搜索结果）
                competitors = await searchCompetitorsOnAmazon(
                  searchTerms,
                  competitorPage,
                  target_country,
                  2  // 每个搜索词提取2个产品
                );

                // 🔄 补充策略：如果AI搜索结果不足，尝试页面抓取补充（仅Amazon页面）
                if (competitors.length < 5 && !debug.isIndependentStore) {
                  console.log(`⚠️ AI搜索仅找到${competitors.length}个竞品，尝试页面抓取补充...`);

                  try {
                    await competitorPage.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    const pageCompetitors = await scrapeAmazonCompetitors(competitorPage, 10 - competitors.length);

                    if (pageCompetitors.length > 0) {
                      console.log(`   ✅ 页面抓取补充了${pageCompetitors.length}个竞品`);
                      competitors.push(...pageCompetitors);
                    }
                  } catch (scrapeError: any) {
                    console.warn(`   ⚠️ 页面抓取失败: ${scrapeError.message}`);
                  }
                }

                // Step 3: AI对比分析
                if (competitors.length > 0) {
                  console.log(`✅ 找到${competitors.length}个竞品，开始AI对比分析...`);

                  const priceNum = parsePrice(extractedPrice);

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

                  // ✅ 修复：构建完整的 ourProduct 对象（传递所有可用数据）
                  const ourProduct = {
                    name: extractedProductName || brandName || 'Unknown',
                    brand: brandName || null,
                    price: priceNum,
                    // ✅ 修复：传递实际的评分和评论数（不再是 null）
                    rating: extractedRating ? parseFloat(extractedRating.replace(/[^\d.]/g, '')) : null,
                    reviewCount: extractedReviewCount ? parseInt(extractedReviewCount.replace(/[^\d]/g, '')) : null,
                    features: extractFeatures(aiProductInfo?.productHighlights),
                    // ✅ 修复：传递卖点信息
                    sellingPoints: aiProductInfo?.uniqueSellingPoints || '',
                  };

                  // 🔍 日志：输出传递给竞品分析的产品信息
                  console.log(`   我们的产品: ${ourProduct.name}`);
                  console.log(`   品牌: ${ourProduct.brand || 'Unknown'}`);
                  console.log(`   价格: $${ourProduct.price?.toFixed(2) || 'N/A'}`);
                  console.log(`   评分: ${ourProduct.rating || 'N/A'} (${ourProduct.reviewCount || 0} 评论)`);
                  console.log(`   特性数量: ${ourProduct.features.length}`);
                  console.log(`   卖点: ${ourProduct.sellingPoints ? '有' : '无'}`);

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
                  console.log(`✅ ${pageTypeLabel}竞品对比分析完成`);
                } else {
                  console.log(`⚠️ ${pageTypeLabel}未找到竞品，跳过AI对比分析`);
                }

              } finally {
                await competitorPage.close();
                await browser.close();
              }
            }
          } catch (aiError: any) {
            console.error('❌ AI推断竞品失败:', aiError.message);
          }
        } catch (competitorError: any) {
          console.warn('⚠️ 竞品对比分析失败（不影响主流程）:', competitorError.message);
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

            // ✅ 修复：传递更完整的产品数据（增加 price、rating、description 等）
            const extractionResult = await extractAdElements(
              {
                pageType: 'product',
                product: {
                  productName: extractedProductName || brandName || 'Unknown',
                  productDescription: productDescription || aiProductInfo?.brandDescription || null,
                  productPrice: extractedPrice || null,
                  brandName: brandName || 'Unknown',
                  // 优先使用抓取的 features，fallback 到 AI 分析的 productHighlights
                  features: (extractedFeatures && extractedFeatures.length > 0) ? extractedFeatures : extractFeaturesForAd(aiProductInfo.productHighlights),
                  aboutThisItem: extractedAboutThisItem || [],
                  rating: extractedRating || null,
                  reviewCount: extractedReviewCount || null,
                  imageUrls: extractedImageUrls || [],
                } as any,
              },
              brandName || 'Unknown',
              target_country,
              targetLanguage,
              userIdNum
            );

            console.log(`   📦 传递给广告元素提取的产品数据:`);
            console.log(`      - 产品名: ${extractedProductName || brandName}`);
            console.log(`      - 价格: ${extractedPrice || 'N/A'}`);
            console.log(`      - 评分: ${extractedRating || 'N/A'}`);
            console.log(`      - 特性: ${extractedFeatures?.length || 0} 个`);
            console.log(`      - 描述: ${productDescription ? '有' : '无'}`);


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

      // ========== 步骤6.8: Enhanced优化模块（串行执行，确保Controller生命周期安全）==========
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
        // 【P0】增强关键词提取（✅ 修复：串行await，确保Controller不被提前关闭）
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

        // 【P0】增强产品信息提取（✅ 修复：串行await）
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

        // 【P1】增强标题和描述提取（✅ 修复：串行await）
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

        // 【P2】增强竞品分析（✅ 修复：串行await）
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

        // 【P2】本地化适配（✅ 修复：串行await）
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

        // 【P3】增强品牌识别（✅ 修复：串行await，最后一个任务）
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
