/**
 * Crawlee框架 - Amazon Store抓取（正式实现）
 *
 * 基于Crawlee框架的高性能爬虫实现，用于SaaS多用户并发场景
 *
 * 特性：
 * - SessionPool自动Session管理和封号检测
 * - AutoscaledPool智能并发控制
 * - 智能选择器（支持多种Amazon Store页面布局）
 * - 颜色变体去重
 * - 品牌名规范化
 */

import { PlaywrightCrawler, Dataset } from '@crawlee/playwright';
import { load } from 'cheerio';
import {
  createAmazonStoreConfig,
  getCrawleeProxyConfig,
  executeWithProxyRetry,
  isProxyConnectionError,
} from './crawlee-config';
import type { AmazonStoreData } from './scraper-stealth';
import { normalizeBrandName } from './offer-utils';
import {
  CrawleeStatsMonitor,
  classifyError,
  formatErrorLog,
  type CrawleeProgressListener,
} from './crawlee-error-handler';
import { getCrawleePersistence } from './crawlee-db-persistence';

/**
 * 使用Crawlee抓取Amazon Store页面
 *
 * @param url - Amazon Store URL
 * @param userId - 用户ID（必需），用于获取用户级别的代理配置
 * @param targetCountry - 目标国家代码（默认US）
 * @param progressListener - 可选的进度监听器
 * @returns 抓取的Store数据
 */
export async function scrapeAmazonStoreWithCrawlee(
  url: string,
  userId: number,
  targetCountry: string = 'US',
  progressListener?: CrawleeProgressListener
): Promise<AmazonStoreData> {
  console.log(`📦 Crawlee抓取Amazon Store（带代理重试）: ${url}`);

  // 创建统计监控器
  const statsMonitor = new CrawleeStatsMonitor();
  if (progressListener) {
    statsMonitor.addProgressListener(progressListener);
  }
  statsMonitor.setTotalUrls(1);

  // 创建数据库持久化服务
  const dbPersistence = getCrawleePersistence();
  await dbPersistence.initializeTables(); // 确保表存在

  // 使用代理重试机制执行抓取
  return executeWithProxyRetry(
    (proxyConfig) => scrapeAmazonStoreWithCrawleeCore(url, proxyConfig, statsMonitor, dbPersistence, userId),
    userId,
    targetCountry,
    3 // 最多重试3次
  );
}

/**
 * Crawlee抓取Amazon Store核心逻辑
 */
async function scrapeAmazonStoreWithCrawleeCore(
  url: string,
  proxyConfig: string,
  statsMonitor: CrawleeStatsMonitor,
  dbPersistence: ReturnType<typeof getCrawleePersistence>,
  userId: number
): Promise<AmazonStoreData> {
  const [server] = proxyConfig.split('|');
  console.log(`🔒 Crawlee使用代理: ${server.replace('http://', '')}`);

  // 创建Amazon Store专用配置
  const config = createAmazonStoreConfig(proxyConfig);

  // 创建结果容器（匹配AmazonStoreData接口）
  let result: AmazonStoreData = {
    storeName: null,
    storeDescription: null,
    brandName: null,
    products: [],
    totalProducts: 0,
    storeUrl: url,
  };

  // 创建Crawlee爬虫
  const crawler = new PlaywrightCrawler({
    ...config,

    async requestHandler({ request, page, log, session }) {
      log.info(`🌐 Crawlee访问: ${request.url}`);

      // 📊 记录请求开始
      statsMonitor.recordRequestStart(request.url);

      try {
        // === SessionPool封号检测（Phase 2 Task 2.3）===
        // 检查页面标题判断是否被Amazon封禁
        const title = await page.title();

        if (
          title.includes('Sorry! Something went wrong!') ||
          title.includes('Robot Check') ||
          title.includes('Blocked')
        ) {
          console.log('❌ 检测到Amazon封禁，退休当前Session并跳过数据提取');
          session?.retire();
          // 不throw error，让Crawlee自动重试新Session
          return; // Early return，不提取数据
        } else if (title === '' || !title) {
          console.log('⚠️ 可能的网络错误，标记Session为不良');
          session?.markBad();
          return; // Early return
        } else {
          console.log('✅ Session正常，页面标题:', title.substring(0, 50));
          // session.markGood() 会在PlaywrightCrawler中自动调用
        }

        // === 🎯 人类行为模拟：加载后随机延迟 ===
        const postLoadDelay = Math.floor(Math.random() * 1000 + 1000); // 1000-2000ms
        console.log(`⏳ 页面加载后模拟阅读 ${postLoadDelay}ms...`);
        await page.waitForTimeout(postLoadDelay);

        // === 🎯 人类行为模拟：随机滚动 ===
        const randomScroll = Math.floor(Math.random() * 300 + 100); // 100-400px
        console.log(`📜 模拟人类浏览，随机滚动 ${randomScroll}px...`);
        await page.evaluate((scrollY) => {
          window.scrollBy(0, scrollY);
        }, randomScroll);

        // 滚动后短暂停顿
        const scrollPause = Math.floor(Math.random() * 500 + 300); // 300-800ms
        await page.waitForTimeout(scrollPause);

        // === 智能滚动逻辑（与当前实现一致）===
        console.log('🔄 Crawlee智能滚动加载产品...');
        const targetProducts = 15;
        const maxScrolls = 5;
        let scrollCount = 0;

        // 等待初始产品加载（增加等待时间确保完全渲染）
        console.log('⏳ 等待页面渲染...');
        await page.waitForTimeout(3000); // 从1500ms增加到3000ms

        while (scrollCount < maxScrolls) {
          // 检测产品数量 - 使用正确的选择器 [data-csa-c-type="item"]
          const productCount = await page.evaluate(() => {
            // 🔥 关键修复：Amazon Store页面使用 data-csa-c-type="item" 而非 data-asin
            const primarySelector = '[data-csa-c-type="item"]';
            const primaryCount = document.querySelectorAll(primarySelector).length;

            if (primaryCount > 0) {
              return primaryCount;
            }

            // Fallback选择器（用于其他类型的Store页面）
            const fallbackSelectors = [
              '[data-asin]',
              '[data-component-type="s-search-result"]',
              '.s-result-item',
            ];

            let maxCount = 0;
            fallbackSelectors.forEach((selector) => {
              const count = document.querySelectorAll(selector).length;
              if (count > maxCount) maxCount = count;
            });

            return maxCount;
          });

          console.log(
            `📊 Crawlee滚动${scrollCount + 1}次，检测到${productCount}个产品`
          );

          if (productCount >= targetProducts) {
            console.log(
              `✅ Crawlee已加载${productCount}个产品，达到目标${targetProducts}`
            );
            break;
          }

          // 🎯 优化：随机滚动距离和间隔（避免固定模式检测）
          // 🔥 修复：在page.evaluate内部计算scrollDistance，避免window is not defined
          await page.evaluate(() => {
            const scrollDistance = Math.floor(window.innerHeight * (0.6 + Math.random() * 0.4)); // 60-100%视口高度
            window.scrollBy(0, scrollDistance);
          });
          const scrollDelay = Math.floor(Math.random() * 1000 + 1000); // 1000-2000ms
          await page.waitForTimeout(scrollDelay);
          scrollCount++;
        }

        // === 数据提取（与当前实现一致）===
        const html = await page.content();
        const $ = load(html);

        // 提取Store信息
        const storeName =
          $('title').text().trim() || 'Amazon: ' + $('h1').first().text().trim();

        // 🔥 修复品牌名提取：Amazon Store使用 itemprop="name" 或从title提取
        const brandName =
          $('[itemprop="name"]').first().text().trim() || // Amazon Store品牌名
          $('h1').first().text().trim() ||
          $('[data-brand-name]').first().attr('data-brand-name') ||
          // 从title提取：格式为 "Amazon.com: BRANDNAME"
          (storeName.includes(': ') ? storeName.split(': ')[1] : '') ||
          'Unknown Brand';

        // 提取产品数据
        const products: any[] = [];

        // 辅助函数：提取单个产品数据
        const extractProductData = ($el: any) => {
          const asin =
            $el.attr('data-asin') ||
            $el.find('[data-asin]').attr('data-asin') ||
            '';
          const name =
            $el.find('h2 a span').text().trim() ||
            $el.find('h2').text().trim() ||
            $el.find('.a-link-normal').first().text().trim() ||
            $el.find('img').attr('alt') ||
            '';
          const price =
            $el.find('.a-price .a-offscreen').first().text().trim() ||
            $el.find('.a-price-whole').first().text().trim() ||
            '';
          const rating = $el
            .find('.a-icon-star-small span')
            .first()
            .text()
            .trim();
          const reviewCount = $el
            .find('.a-size-small .a-link-normal')
            .first()
            .text()
            .trim();
          const imageUrl =
            $el.find('img').first().attr('src') ||
            $el.find('img').first().attr('data-src') ||
            '';
          const promotion = $el.find('.a-badge-label').first().text().trim();
          const badge = $el.find('[data-component-type="s-coupon-component"]')
            .length
            ? 'Coupon'
            : null;
          const isPrime = $el.find('[aria-label*="Prime"]').length > 0;

          return {
            name,
            price,
            rating,
            reviewCount,
            imageUrl,
            asin,
            promotion,
            badge,
            isPrime,
          };
        };

        // 🔥 主要选择器：Amazon Store页面使用 [data-csa-c-type="item"]
        const primarySelector = '[data-csa-c-type="item"]';
        const primaryElements = $(primarySelector);

        console.log(`🔍 主选择器 ${primarySelector} 匹配: ${primaryElements.length} 个元素`);

        if (primaryElements.length > 0) {
          primaryElements.each((i, el) => {
            if (products.length >= 30) return false;

            const $el = $(el);

            // 🔥 关键修复：从 data-csa-c-item-id 属性提取ASIN
            // 格式: amzn1.asin.B0CH9MY1BM:amzn1.deal.xxx 或 amzn1.asin.B0CH9MY1BM
            const itemId = $el.attr('data-csa-c-item-id') || '';
            const asinMatch = itemId.match(/amzn1\.asin\.([A-Z0-9]{10})/);
            const asin = asinMatch ? asinMatch[1] : '';

            // 🔥 关键修复：使用 data-testid="image" 选择产品图片，排除Prime badge
            const $productImg = $el.find('img[data-testid="image"]').first();
            const name = $productImg.attr('alt')?.replace(/^Image of /, '').trim() || '';
            const imageUrl = $productImg.attr('src') || '';

            // 检测是否有Prime
            const isPrime = $el.find('img[alt="Prime"]').length > 0;

            // 尝试从父元素或相邻元素提取价格
            const $parent = $el.closest('div[class*="ImageArea"]').parent();
            const price =
              $parent.find('.a-price .a-offscreen').first().text().trim() ||
              $parent.find('[class*="price"]').first().text().trim() ||
              $el.parent().find('.a-price .a-offscreen').first().text().trim() ||
              $el.find('[class*="price"]').first().text().trim() ||
              '';

            // 只添加有名称且有ASIN的产品（避免重复）
            if (name && name.length > 5 && asin && !products.some((p) => p.asin === asin)) {
              products.push({
                name,
                price,
                rating: '',
                reviewCount: '',
                imageUrl,
                asin,
                promotion: '',
                badge: null,
                isPrime,
              });
            }
          });
        }

        // Fallback选择器（用于其他类型的Store页面）
        if (products.length < 5) {
          console.log('🔍 使用Fallback选择器...');
          const fallbackSelectors = [
            '[data-component-type="s-search-result"]',
            '.s-result-item[data-asin]',
            '[data-asin]',
          ];

          for (const selector of fallbackSelectors) {
            if (products.length >= 5) break;

            $(selector).each((i, el) => {
              if (products.length >= 30) return false;

              const $el = $(el);
              const productData = extractProductData($el);

              if (
                productData.name &&
                productData.name.length > 5 &&
                !products.some((p) => p.name === productData.name)
              ) {
                products.push(productData);
              }
            });
          }
        }

        // Enhanced fallback: Try to extract products from any visible product images
        if (products.length < 5) {
          console.log('🔍 Crawlee尝试从图片alt属性提取产品...');
          $('img[alt]').each((i, el) => {
            if (products.length >= 30) return false;

            const alt = $(el).attr('alt')?.trim() || '';
            const src = $(el).attr('src') || '';

            // 🔥 优化过滤条件：放宽限制以匹配更多Amazon Store产品图片
            const isValidProductImage =
              alt &&
              alt.length > 5 &&
              alt.length < 500 &&
              !alt
                .toLowerCase()
                .match(
                  /logo|icon|banner|button|arrow|star|prime badge/i
                ) &&
              (src.includes('images-amazon') ||
                src.includes('ssl-images-amazon') ||
                src.includes('m.media-amazon')) &&
              !products.some((p) => p.name === alt);

            if (isValidProductImage) {
              // Try to find price near the image
              const $parent = $(el).closest('div').parent();
              const nearbyPrice =
                $parent.find('.a-price .a-offscreen').first().text().trim() ||
                $parent.find('[class*="price"]').first().text().trim() ||
                $parent.find('[class*="Price"]').first().text().trim() ||
                '';

              products.push({
                name: alt,
                price: nearbyPrice,
                rating: '',
                reviewCount: '',
                imageUrl: src,
                asin: src.match(/\/([A-Z0-9]{10})[\._]/)?.[1] || '',
                promotion: '',
                badge: null,
                isPrime: false,
              });
            }
          });
        }

        // 🔥 智能去重：过滤颜色变体，只保留不同的产品
        // 提取产品基础名称（去除末尾的颜色/尺寸/变体信息）
        const getBaseName = (name: string): string => {
          // 方法：找到最后一个逗号，检查逗号后是否是颜色/尺寸变体
          // 示例："..,Royal Blue" → 去除 ",Royal Blue"
          const lastCommaIndex = name.lastIndexOf(',');
          if (lastCommaIndex === -1) return name.toLowerCase().trim();

          const suffix = name.slice(lastCommaIndex + 1).trim().toLowerCase();
          const basePart = name.slice(0, lastCommaIndex).trim().toLowerCase();

          // 检测常见的颜色/尺寸变体后缀（更全面的匹配）
          const colorPatterns = [
            // 单色词
            /^(black|white|red|blue|green|yellow|orange|purple|pink|brown|gray|grey)$/i,
            /^(silver|gold|beige|navy|rose|midnight|charcoal|cream|ivory|olive)$/i,
            /^(tan|teal|turquoise|coral|burgundy|maroon|khaki|cyan|magenta|lavender)$/i,
            /^(slate|aqua|plum|indigo|violet|peach|bronze|copper|titanium)$/i,
            // 组合颜色词（颜色+颜色 或 修饰词+颜色）
            /^(dark|light|royal|pine|slate|teal|navy|sky|baby|powder)\s*(blue|green|purple|brown|gray|grey|pink)$/i,
            /^(rose|hot|blush|dusty|salmon|coral)\s*(pink|gold|purple|red)?$/i,
            /^(army|forest|lime|mint|sage|olive)\s*(green)?$/i,
            /^(wine|cherry|ruby|blood|brick)\s*(red)?$/i,
            /^(lemon|mustard|canary)\s*(yellow)?$/i,
            /^(pink)\s*(lavender|rose|blush)?$/i,
            // 其他变体
            /\d+\s*(inch|pack|pcs|set|count|pc|ct)$/i, // 尺寸/数量变体
            /^(small|medium|large|xl|xxl|s|m|l)$/i, // 尺寸变体
          ];

          const isVariantSuffix = colorPatterns.some((p) => p.test(suffix));
          if (isVariantSuffix) {
            return basePart;
          }
          return name.toLowerCase().trim();
        };

        // 去重：基于产品基础名称（去除颜色变体）
        const seenBaseNames = new Set<string>();
        const uniqueProducts = products.filter((p) => {
          const baseName = getBaseName(p.name);
          if (seenBaseNames.has(baseName)) {
            console.log(`🔄 过滤变体: ${p.name.slice(-30)}`);
            return false; // 过滤掉颜色变体
          }
          seenBaseNames.add(baseName);
          return true;
        });

        console.log(`📊 Crawlee产品去重: ${products.length} → ${uniqueProducts.length} (过滤颜色变体)`);

        // 热销商品筛选
        const hotProducts = uniqueProducts
          .map((product) => {
            // 计算热度分数
            const rating = parseFloat(product.rating) || 0;
            const reviewCount = parseInt(
              product.reviewCount.replace(/[^0-9]/g, '')
            ) || 0;
            const hotScore = rating * Math.log10(reviewCount + 1);

            return {
              ...product,
              hotScore,
              rank: 0,
              isHot: hotScore > 2,
              hotLabel: hotScore > 2 ? '🔥 热销商品' : '',
            };
          })
          .sort((a, b) => b.hotScore - a.hotScore)
          .slice(0, 15)
          .map((product, index) => ({ ...product, rank: index + 1 }));

        console.log(
          `📊 Crawlee热销商品筛选: ${uniqueProducts.length} → ${hotProducts.length}`
        );

        if (hotProducts.length > 0) {
          const avgRating =
            hotProducts.reduce((sum, p) => sum + parseFloat(p.rating || '0'), 0) /
            hotProducts.length;
          const avgReviews =
            hotProducts.reduce(
              (sum, p) => sum + parseInt(p.reviewCount.replace(/[^0-9]/g, '') || '0'),
              0
            ) / hotProducts.length;

          console.log(
            `💡 Crawlee热销洞察: 平均评分 ${avgRating.toFixed(1)}⭐, 平均评论 ${Math.round(avgReviews)} 条`
          );
        }

        // 🔥 规范化品牌名（首字母大写）
        const normalizedBrandName = normalizeBrandName(brandName);

        // 保存结果（匹配AmazonStoreData接口）
        result = {
          storeName,
          storeDescription: null,
          brandName: normalizedBrandName,
          products: hotProducts,
          totalProducts: hotProducts.length,
          storeUrl: request.url,
          hotInsights: hotProducts.length > 0 ? {
            avgRating: hotProducts.reduce((sum, p) => sum + parseFloat(p.rating || '0'), 0) / hotProducts.length,
            avgReviews: Math.round(hotProducts.reduce((sum, p) => sum + parseInt(p.reviewCount?.replace(/[^0-9]/g, '') || '0'), 0) / hotProducts.length),
            topProductsCount: hotProducts.length,
          } : undefined,
        };

        // 保存到Dataset（Crawlee内置）
        await Dataset.pushData({
          url: request.url,
          storeName,
          brandName: normalizedBrandName,
          productCount: hotProducts.length,
          products: hotProducts,
          timestamp: new Date().toISOString(),
        });

        // 💾 保存到数据库（持久化）
        try {
          const crawlDurationMs = Date.now() - statsMonitor.getStats().startTime;
          await dbPersistence.saveSuccessResult({
            url: request.url,
            storeName,
            brandName: normalizedBrandName,
            products: hotProducts,
            crawlDurationMs,
            userId,
          });
          console.log('💾 数据已保存到数据库');
        } catch (dbError) {
          console.error('⚠️ 数据库保存失败:', dbError);
          // 不影响主流程，继续执行
        }

        // 📊 记录请求成功
        statsMonitor.recordRequestSuccess(request.url);

        console.log(`✅ Crawlee Store抓取成功: ${storeName}`);
      } catch (error) {
        const pageTitle = await page.title().catch(() => '');

        // 📊 错误分类和记录
        const errorDetail = classifyError(error as Error, {
          url: request.url,
          pageTitle,
        });

        log.error(formatErrorLog(errorDetail));
        statsMonitor.recordRequestFailure(request.url, errorDetail);

        // 💾 保存错误到数据库
        try {
          const crawlDurationMs = Date.now() - statsMonitor.getStats().startTime;
          await dbPersistence.saveErrorResult({
            url: request.url,
            errorType: errorDetail.type,
            errorMessage: errorDetail.message,
            crawlDurationMs,
            userId,
          });
          console.log('💾 错误已保存到数据库');
        } catch (dbError) {
          console.error('⚠️ 数据库保存失败:', dbError);
        }

        throw error;
      }
    },

    async failedRequestHandler({ request, error, log }) {
      const errorDetail = classifyError(error as Error, { url: request.url });
      log.error(`❌ Crawlee最终失败: ${formatErrorLog(errorDetail)}`);
    },
  });

  // 执行抓取
  await crawler.run([url]);

  // 清理资源
  await crawler.teardown();

  // 📊 完成统计并打印报告
  statsMonitor.complete();
  statsMonitor.printReport();

  return result;
}

/**
 * 批量抓取多个URL（展示Crawlee并发优势）
 *
 * @param urls - URL列表
 * @param userId - 用户ID（必需），用于获取用户级别的代理配置
 * @param targetCountry - 目标国家代码（默认US）
 * @returns 抓取结果列表
 */
export async function scrapeMultipleStoresWithCrawlee(
  urls: string[],
  userId: number,
  targetCountry: string = 'US'
): Promise<AmazonStoreData[]> {
  console.log(`📦 Crawlee批量抓取 ${urls.length} 个Store...`);

  const results: AmazonStoreData[] = [];

  // 获取代理配置（必须使用代理）
  const proxyConfig = await getCrawleeProxyConfig(userId, targetCountry);
  const [server] = proxyConfig.split('|');
  console.log(`🔒 Crawlee批量使用代理: ${server.replace('http://', '')}`);
  const config = createAmazonStoreConfig(proxyConfig);

  // 创建Crawlee爬虫（自动并发处理所有URL）
  const crawler = new PlaywrightCrawler({
    ...config,

    async requestHandler({ request, page, log, session }) {
      log.info(`🌐 Crawlee批量访问: ${request.url}`);

      // === SessionPool封号检测（Phase 2 Task 2.3）===
      const title = await page.title();

      if (
        title.includes('Sorry! Something went wrong!') ||
        title.includes('Robot Check') ||
        title.includes('Blocked')
      ) {
        console.log('❌ [批量] 检测到Amazon封禁，退休当前Session并跳过数据提取');
        session?.retire();
        return; // Early return，不throw error
      } else if (title === '' || !title) {
        console.log('⚠️ [批量] 可能的网络错误，标记Session为不良');
        session?.markBad();
        return; // Early return
      } else {
        console.log('✅ [批量] Session正常');
        // session.markGood() 会在PlaywrightCrawler中自动调用
      }

      // 使用与单URL相同的处理逻辑
      // （简化版，完整逻辑同scrapeAmazonStoreWithCrawlee）

      const html = await page.content();
      const $ = load(html);

      const storeName = $('title').text().trim();
      const brandName = $('h1').first().text().trim();

      const storeData: AmazonStoreData = {
        storeName,
        storeDescription: null,
        brandName,
        products: [],
        totalProducts: 0,
        storeUrl: request.url,
      };

      results.push(storeData);

      await Dataset.pushData({
        url: request.url,
        ...storeData,
        timestamp: new Date().toISOString(),
      });
    },
  });

  // 🚀 关键优势：Crawlee自动并发处理所有URL
  await crawler.run(urls);

  await crawler.teardown();

  console.log(`✅ Crawlee批量抓取完成: ${results.length}/${urls.length} 个Store`);

  return results;
}

// ============================================================================
// 独立站抓取（Crawlee版本）
// ============================================================================

import type { IndependentStoreData } from './scraper-stealth';

/**
 * 使用Crawlee抓取独立电商站点（带代理重试）
 *
 * @param url - 独立站URL
 * @param userId - 用户ID（必需），用于获取用户级别的代理配置
 * @param targetCountry - 目标国家代码（默认US）
 * @returns 抓取的Store数据
 */
export async function scrapeIndependentStoreWithCrawlee(
  url: string,
  userId: number,
  targetCountry: string = 'US'
): Promise<IndependentStoreData> {
  console.log(`🏪 Crawlee抓取独立站（带代理重试）: ${url}`);

  // 使用代理重试机制执行抓取
  return executeWithProxyRetry(
    (proxyConfig) => scrapeIndependentStoreWithCrawleeCore(url, proxyConfig),
    userId,
    targetCountry,
    3 // 最多重试3次
  );
}

/**
 * Crawlee抓取独立站核心逻辑
 */
async function scrapeIndependentStoreWithCrawleeCore(
  url: string,
  proxyConfig: string
): Promise<IndependentStoreData> {
  const [server] = proxyConfig.split('|');
  console.log(`🔒 Crawlee使用代理: ${server.replace('http://', '')}`);

  // 创建配置（独立站使用更宽松的并发设置）
  const config = createAmazonStoreConfig(proxyConfig);

  // 创建结果容器
  let result: IndependentStoreData = {
    storeName: null,
    storeDescription: null,
    logoUrl: null,
    products: [],
    totalProducts: 0,
    storeUrl: url,
    platform: null,
  };

  // 创建Crawlee爬虫
  const crawler = new PlaywrightCrawler({
    ...config,
    maxConcurrency: 5, // 独立站可以使用更高并发

    async requestHandler({ request, page, log, session }) {
      log.info(`🌐 Crawlee访问独立站: ${request.url}`);

      try {
        // SessionPool封号检测
        const title = await page.title();

        if (title.includes('Access Denied') || title.includes('Blocked') || title === '') {
          console.log('⚠️ 独立站访问受限，标记Session为不良');
          session?.markBad();
          return;
        }

        console.log('✅ Session正常，页面标题:', title.substring(0, 50));

        // 智能滚动加载产品
        console.log('🔄 Crawlee智能滚动加载产品...');
        const targetProducts = 15;
        const maxScrolls = 5;
        let scrollCount = 0;

        await page.waitForTimeout(2000);

        while (scrollCount < maxScrolls) {
          const productCount = await page.evaluate(() => {
            const selectors = [
              '.product-card',
              '[data-product-id]',
              '.product-item',
              'article[data-product]',
              '[itemtype*="Product"]',
              '.product',
            ];

            const products = new Set<string>();
            selectors.forEach((selector) => {
              document.querySelectorAll(selector).forEach((el) => {
                const id =
                  el.getAttribute('data-product-id') ||
                  el.getAttribute('data-id') ||
                  el.querySelector('a')?.href;
                if (id) products.add(id);
              });
            });

            return products.size;
          });

          console.log(`📊 Crawlee滚动${scrollCount + 1}次，检测到${productCount}个产品`);

          if (productCount >= targetProducts) {
            console.log(`✅ Crawlee已加载${productCount}个产品，达到目标${targetProducts}`);
            break;
          }

          // 🎯 优化：随机滚动距离和间隔（避免固定模式检测）
          // 🔥 修复：在page.evaluate内部计算scrollDistance，避免window is not defined
          await page.evaluate(() => {
            const scrollDistance = Math.floor(window.innerHeight * (0.6 + Math.random() * 0.4)); // 60-100%视口高度
            window.scrollBy(0, scrollDistance);
          });
          const scrollDelay = Math.floor(Math.random() * 1000 + 1000); // 1000-2000ms
          await page.waitForTimeout(scrollDelay);
          scrollCount++;
        }

        // 数据提取
        const html = await page.content();
        const $ = load(html);

        // 检测平台
        let platform: string | null = null;
        if ($('script[src*="cdn.shopify.com"]').length > 0 || $('[data-shopify]').length > 0) {
          platform = 'shopify';
        } else if ($('script[src*="woocommerce"]').length > 0 || $('body.woocommerce').length > 0) {
          platform = 'woocommerce';
        } else if ($('[class*="bigcommerce"]').length > 0) {
          platform = 'bigcommerce';
        }

        console.log(`🔍 检测到平台: ${platform || 'generic'}`);

        // 提取Store信息
        const storeName =
          $('meta[property="og:site_name"]').attr('content') ||
          $('meta[name="application-name"]').attr('content') ||
          $('title').text().split(/[|\-–]/).pop()?.trim() ||
          $('h1').first().text().trim() ||
          null;

        const storeDescription =
          $('meta[property="og:description"]').attr('content') ||
          $('meta[name="description"]').attr('content') ||
          null;

        const logoUrl =
          $('meta[property="og:image"]').attr('content') ||
          $('link[rel="icon"]').attr('href') ||
          $('img[class*="logo"], img[alt*="logo" i], header img').first().attr('src') ||
          null;

        // 提取产品
        const products: IndependentStoreData['products'] = [];

        const productSelectors = [
          '.product-card',
          '.product-item',
          '[class*="ProductItem"]',
          '[class*="product-grid"] > *',
          '.collection-product',
          '.product',
          '.woocommerce-LoopProduct-link',
          '[data-product-id]',
          '[data-product]',
        ];

        for (const selector of productSelectors) {
          if (products.length >= 5) break;

          $(selector).each((i, el) => {
            if (products.length >= 30) return false;

            const $el = $(el);

            const name =
              $el.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim() ||
              $el.find('a').first().text().trim() ||
              $el.find('img').first().attr('alt') ||
              '';

            const priceText = $el.find('[class*="price"], .money, [data-price]').first().text().trim();
            const price = priceText || null;

            const imageUrl =
              $el.find('img').first().attr('src') ||
              $el.find('img').first().attr('data-src') ||
              null;

            const productUrl =
              $el.find('a').first().attr('href') || $el.attr('href') || null;

            if (name && name.length > 3 && name.length < 200 && !products.some((p) => p.name === name)) {
              products.push({
                name,
                price,
                imageUrl,
                productUrl: productUrl
                  ? productUrl.startsWith('http')
                    ? productUrl
                    : new URL(productUrl, request.url).href
                  : null,
              });
            }
          });
        }

        // Fallback: 从图片提取
        if (products.length < 5) {
          console.log('🔍 Crawlee尝试从图片提取产品...');
          $('img[alt]').each((i, el) => {
            if (products.length >= 30) return false;

            const alt = $(el).attr('alt')?.trim() || '';
            const src = $(el).attr('src') || $(el).attr('data-src') || '';

            if (
              alt &&
              alt.length > 5 &&
              alt.length < 150 &&
              !alt.toLowerCase().includes('logo') &&
              !alt.toLowerCase().includes('banner') &&
              !alt.toLowerCase().includes('icon') &&
              src &&
              !products.some((p) => p.name === alt)
            ) {
              const $parent = $(el).closest('div, li, article').first();
              const nearbyPrice = $parent.find('[class*="price"], .money').first().text().trim() || null;
              const nearbyLink =
                $parent.find('a[href*="/product"], a[href*="/collections"]').first().attr('href') || null;

              products.push({
                name: alt,
                price: nearbyPrice,
                imageUrl: src.startsWith('http')
                  ? src
                  : src.startsWith('//')
                  ? `https:${src}`
                  : new URL(src, request.url).href,
                productUrl: nearbyLink
                  ? nearbyLink.startsWith('http')
                    ? nearbyLink
                    : new URL(nearbyLink, request.url).href
                  : null,
              });
            }
          });
        }

        // 保存结果
        result = {
          storeName: storeName ? normalizeBrandName(storeName) : null,
          storeDescription,
          logoUrl,
          products,
          totalProducts: products.length,
          storeUrl: request.url,
          platform,
        };

        console.log(`✅ Crawlee独立站抓取成功: ${storeName}`);
        console.log(`📊 发现 ${products.length} 个产品`);
      } catch (error) {
        log.error(`❌ Crawlee独立站抓取失败: ${error}`);
        throw error;
      }
    },

    async failedRequestHandler({ request, error, log }) {
      log.error(`❌ Crawlee请求失败: ${request.url} - ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  // 执行抓取
  await crawler.run([url]);

  // 清理资源
  await crawler.teardown();

  return result;
}

/**
 * Amazon单品数据结构（Crawlee版本）
 */
export interface AmazonProductData {
  productName: string | null;
  productDescription: string | null;
  productPrice: string | null;
  originalPrice: string | null;
  discount: string | null;
  brandName: string | null;
  features: string[];
  imageUrls: string[];
  rating: string | null;
  reviewCount: string | null;
  salesRank: string | null;
  availability: string | null;
  primeEligible: boolean;
  reviewHighlights: string[];
  topReviews: string[];
  technicalDetails: Record<string, string>;
  asin: string | null;
  category: string | null;
}

/**
 * 使用Crawlee抓取Amazon单品页面（带代理重试）
 *
 * @param url - Amazon产品URL (/dp/... 或 /gp/product/...)
 * @param userId - 用户ID（必需），用于获取用户级别的代理配置
 * @param targetCountry - 目标国家代码（默认US）
 * @returns 抓取的产品数据
 */
export async function scrapeAmazonProductWithCrawlee(
  url: string,
  userId: number,
  targetCountry: string = 'US'
): Promise<AmazonProductData> {
  console.log(`🛒 Crawlee抓取Amazon单品（带代理重试）: ${url}`);

  // 使用代理重试机制执行抓取
  return executeWithProxyRetry(
    (proxyConfig) => scrapeAmazonProductWithCrawleeCore(url, proxyConfig),
    userId,
    targetCountry,
    3 // 最多重试3次
  );
}

/**
 * Crawlee抓取Amazon单品页面核心逻辑
 *
 * @param url - Amazon产品URL
 * @param proxyConfig - 代理配置字符串
 * @returns 抓取的产品数据
 */
async function scrapeAmazonProductWithCrawleeCore(
  url: string,
  proxyConfig: string
): Promise<AmazonProductData> {
  const [server] = proxyConfig.split('|');
  console.log(`🔒 Crawlee使用代理: ${server.replace('http://', '')}`);

  // 创建配置
  const config = createAmazonStoreConfig(proxyConfig);

  // 创建结果容器
  let result: AmazonProductData = {
    productName: null,
    productDescription: null,
    productPrice: null,
    originalPrice: null,
    discount: null,
    brandName: null,
    features: [],
    imageUrls: [],
    rating: null,
    reviewCount: null,
    salesRank: null,
    availability: null,
    primeEligible: false,
    reviewHighlights: [],
    topReviews: [],
    technicalDetails: {},
    asin: null,
    category: null,
  };

  // 创建Crawlee爬虫
  const crawler = new PlaywrightCrawler({
    ...config,

    async requestHandler({ request, page, log, session }) {
      log.info(`🌐 Crawlee访问Amazon单品: ${request.url}`);

      try {
        // SessionPool封号检测
        const title = await page.title();

        if (
          title.includes('Sorry! Something went wrong!') ||
          title.includes('Robot Check') ||
          title.includes('Blocked')
        ) {
          console.log('❌ 检测到Amazon封禁，退休当前Session');
          session?.retire();
          return;
        } else if (title === '' || !title) {
          console.log('⚠️ 页面标题为空，标记Session为不良');
          session?.markBad();
          return;
        }

        console.log('✅ Session正常，页面标题:', title.substring(0, 50));

        // 🔥 关键：等待页面完全加载（与原Playwright实现一致）
        // 1. 等待网络空闲
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
          console.warn('⚠️ 网络未完全空闲，继续处理');
        });

        // 2. 等待产品标题加载（增加超时到40秒）
        const selectorFound = await page.waitForSelector('#productTitle', { timeout: 40000 }).catch(() => {
          console.warn('⚠️ 产品标题选择器未找到');
          return null;
        });

        // 🔍 调试：如果选择器未找到，输出页面关键信息
        if (!selectorFound) {
          const pageUrl = page.url();
          const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
          console.log('🔍 调试 - 当前URL:', pageUrl);
          console.log('🔍 调试 - 页面内容预览:', bodyText.replace(/\n/g, ' ').substring(0, 300));

          // 检查是否是CAPTCHA页面
          const hasCaptcha = await page.evaluate(() => {
            const text = document.body?.innerText?.toLowerCase() || '';
            return text.includes('captcha') || text.includes('robot') || text.includes('verify');
          });
          if (hasCaptcha) {
            console.log('❌ 检测到CAPTCHA/验证页面，标记Session为不良');
            session?.markBad();
          }
        }

        // 3. 模拟人类滚动行为（触发懒加载）
        await page.evaluate(() => {
          window.scrollBy(0, Math.random() * 500);
        });

        // 4. 随机延迟（1-2秒）
        const delay = Math.floor(Math.random() * 1000 + 1000);
        await new Promise(resolve => setTimeout(resolve, delay));

        // 获取页面HTML
        const html = await page.content();
        const $ = load(html);

        // 提取ASIN
        const asin =
          request.url.match(/\/dp\/([A-Z0-9]+)/)?.[1] ||
          request.url.match(/\/gp\/product\/([A-Z0-9]+)/)?.[1] ||
          ($('input[name="ASIN"]').val() as string) ||
          $('th:contains("ASIN")').next().text().trim() ||
          null;

        // 提取产品标题
        const productName = $('#productTitle').text().trim() || null;

        // 提取品牌名 - 多策略（增强版）
        let brandName: string | null = null;

        // 策略1: 从#bylineInfo提取 (Visit the XXX Store)
        const bylineInfo = $('#bylineInfo').text().trim();
        if (bylineInfo) {
          brandName = bylineInfo.replace(/Visit the\s*/i, '').replace(/\s*Store$/i, '').trim();
          if (brandName && brandName.length > 1) {
            console.log(`✅ Crawlee策略1成功: 从bylineInfo提取品牌 "${brandName}"`);
          } else {
            brandName = null;
          }
        }

        // 策略2: 从data-brand属性
        if (!brandName) {
          const dataBrand = $('[data-brand]').attr('data-brand');
          if (dataBrand && dataBrand.length > 1 && dataBrand.length < 50) {
            brandName = dataBrand;
            console.log(`✅ Crawlee策略2成功: 从data-brand属性提取 "${brandName}"`);
          }
        }

        // 策略3: 从bylineInfo的链接提取 (Brand: XXX)
        if (!brandName) {
          const bylineLink = $('#bylineInfo_feature_div a').text().trim();
          if (bylineLink && bylineLink.length > 1 && bylineLink.length < 50) {
            brandName = bylineLink.replace(/Brand:\s*/i, '').replace(/Visit the\s*/i, '').replace(/\s*Store$/i, '').trim();
            if (brandName && brandName.length > 1) {
              console.log(`✅ Crawlee策略3成功: 从bylineInfo链接提取品牌 "${brandName}"`);
            } else {
              brandName = null;
            }
          }
        }

        // 策略4: 从技术规格表的Brand行提取
        if (!brandName) {
          // 尝试多种技术规格表选择器
          const brandFromTable =
            $('th:contains("Brand")').next('td').text().trim() ||
            $('th:contains("Manufacturer")').next('td').text().trim() ||
            $('tr:contains("Brand") td').last().text().trim() ||
            $('#productDetails_techSpec_section_1 tr:contains("Brand") td').text().trim() ||
            $('#productDetails_detailBullets_sections1 tr:contains("Brand") td').text().trim();

          if (brandFromTable && brandFromTable.length > 1 && brandFromTable.length < 50) {
            brandName = brandFromTable;
            console.log(`✅ Crawlee策略4成功: 从技术规格表提取品牌 "${brandName}"`);
          }
        }

        // 策略5: 从Additional Information区域提取
        if (!brandName) {
          const additionalInfo = $('#productDetails_detailBullets_sections1 .a-span9').filter(function() {
            return $(this).prev('.a-span3').text().toLowerCase().includes('brand');
          }).text().trim();

          if (additionalInfo && additionalInfo.length > 1 && additionalInfo.length < 50) {
            brandName = additionalInfo;
            console.log(`✅ Crawlee策略5成功: 从Additional Info提取品牌 "${brandName}"`);
          }
        }

        // 策略6: 从meta标签提取
        if (!brandName) {
          const metaBrand = $('meta[name="brand"]').attr('content') ||
                           $('meta[property="og:brand"]').attr('content') ||
                           $('meta[itemprop="brand"]').attr('content');
          if (metaBrand && metaBrand.length > 1 && metaBrand.length < 50) {
            brandName = metaBrand;
            console.log(`✅ Crawlee策略6成功: 从meta标签提取品牌 "${brandName}"`);
          }
        }

        // 策略7: 从产品详情页面的dp-brand类提取
        if (!brandName) {
          const dpBrand = $('.dp-brand a, .dp-brand span, a.a-link-normal.contributorNameID').text().trim();
          if (dpBrand && dpBrand.length > 1 && dpBrand.length < 50) {
            brandName = dpBrand;
            console.log(`✅ Crawlee策略7成功: 从dp-brand提取品牌 "${brandName}"`);
          }
        }

        // 策略8: 从产品标题提取（作为兜底策略）
        if (!brandName && productName) {
          const titleParts = productName.split(/[\s-,|]+/);
          if (titleParts.length > 0) {
            const potentialBrand = titleParts[0].trim();
            // 更宽松的品牌名验证
            if (potentialBrand.length >= 2 && potentialBrand.length <= 25) {
              // 排除常见的非品牌词
              const nonBrandWords = ['the', 'a', 'an', 'new', 'best', 'top', 'hot', 'sale', 'pack', 'set', 'kit'];
              const isValidBrand =
                !nonBrandWords.includes(potentialBrand.toLowerCase()) &&
                (/^[A-Z][A-Za-z0-9&\s'-]+$/.test(potentialBrand) || /^[A-Z0-9]+$/.test(potentialBrand));
              if (isValidBrand) {
                brandName = potentialBrand;
                console.log(`✅ Crawlee策略8成功: 从产品标题提取品牌 "${brandName}"`);
              }
            }
          }
        }

        // 🔍 调试：如果所有策略都失败，输出页面关键信息帮助诊断
        if (!brandName) {
          console.log('⚠️ 所有品牌提取策略均失败，输出调试信息:');
          console.log('  - bylineInfo文本:', $('#bylineInfo').text().substring(0, 100));
          console.log('  - bylineInfo_feature_div:', $('#bylineInfo_feature_div').html()?.substring(0, 200));
          console.log('  - 产品标题:', productName?.substring(0, 80));
        }

        // 提取价格
        const currentPrice =
          $('.a-price .a-offscreen').first().text().trim() ||
          $('#priceblock_ourprice').text().trim() ||
          $('#price_inside_buybox').text().trim() ||
          null;

        const originalPrice =
          $('.a-price[data-a-strike="true"] .a-offscreen').text().trim() ||
          $('.priceBlockStrikePriceString').text().trim() ||
          null;

        const discount =
          $('.savingsPercentage').text().trim() ||
          $('[data-hook="price-above-strike"] span').text().trim() ||
          null;

        // 提取产品特点
        const features: string[] = [];
        $('#feature-bullets li').each((i, el) => {
          if (features.length >= 10) return false;
          const text = $(el).text().trim();
          if (text && text.length > 10 && !features.includes(text)) {
            features.push(text);
          }
        });

        // 提取图片
        const imageUrls: string[] = [];
        $('#altImages img, #landingImage').each((i, el) => {
          if (imageUrls.length >= 5) return false;
          const src = $(el).attr('src') || $(el).attr('data-old-hires');
          if (src && !src.includes('data:image') && !imageUrls.includes(src)) {
            imageUrls.push(src);
          }
        });

        // 提取评分
        const ratingText =
          $('#acrPopover').attr('title') ||
          $('span[data-hook="rating-out-of-text"]').text().trim() ||
          $('.a-icon-star span').first().text().trim();
        const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null;

        // 提取评论数
        const reviewCountText =
          $('#acrCustomerReviewText').text().trim() || $('span[data-hook="total-review-count"]').text().trim();
        const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null;

        // 提取销量排名
        const salesRankText =
          $('#productDetails_detailBullets_sections1 tr:contains("Best Sellers Rank")').text().trim() ||
          $('#SalesRank').text().trim();
        const salesRank = salesRankText ? salesRankText.match(/#[\d,]+/)?.[0] || null : null;

        // 提取库存状态
        const availability = $('#availability span').text().trim() || null;

        // 检查Prime
        const primeEligible =
          $('#primeEligibilityMessage').length > 0 ||
          $('.a-icon-prime').length > 0;

        // 提取分类
        const categoryParts: string[] = [];
        $('#wayfinding-breadcrumbs_feature_div li a').each((i, el) => {
          const text = $(el).text().trim();
          if (text) categoryParts.push(text);
        });
        const category = categoryParts.join(' > ') || null;

        // 提取产品描述
        const productDescription =
          $('#feature-bullets').text().trim() ||
          $('#productDescription').text().trim() ||
          null;

        // 提取技术规格
        const technicalDetails: Record<string, string> = {};
        $('#productDetails_techSpec_section_1 tr').each((i, el) => {
          const key = $(el).find('th').text().trim();
          const value = $(el).find('td').text().trim();
          if (key && value) {
            technicalDetails[key] = value;
          }
        });

        // 保存结果
        result = {
          productName,
          productDescription,
          productPrice: currentPrice,
          originalPrice,
          discount,
          brandName: brandName ? normalizeBrandName(brandName) : null,
          features,
          imageUrls: Array.from(new Set(imageUrls)).slice(0, 5),
          rating,
          reviewCount,
          salesRank,
          availability,
          primeEligible,
          reviewHighlights: [],
          topReviews: [],
          technicalDetails,
          asin,
          category,
        };

        console.log(`✅ Crawlee Amazon单品抓取成功: ${productName?.slice(0, 50)}...`);
        console.log(`⭐ 评分: ${rating || 'N/A'}, 评论数: ${reviewCount || 'N/A'}, 销量排名: ${salesRank || 'N/A'}`);
      } catch (error) {
        log.error(`❌ Crawlee Amazon单品抓取失败: ${error}`);
        throw error;
      }
    },

    async failedRequestHandler({ request, error, log }) {
      log.error(`❌ Crawlee请求失败: ${request.url} - ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  // 执行抓取
  await crawler.run([url]);

  // 清理资源
  await crawler.teardown();

  return result;
}
