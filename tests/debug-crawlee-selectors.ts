/**
 * 调试Crawlee选择器问题 - 保存HTML离线分析
 */
import { PlaywrightCrawler, Dataset } from '@crawlee/playwright';
import { getCrawleeProxyConfig, createAmazonStoreConfig } from '../src/lib/crawlee-config';
import fs from 'fs/promises';
import { load } from 'cheerio';

const TEST_URL = 'https://www.amazon.com/stores/page/EDE8B424-1294-40E6-837A-D9E47936AB02';
const TEST_USER_ID = 1;

async function main() {
  console.log('🔍 调试Crawlee选择器问题...\n');

  const proxyConfig = await getCrawleeProxyConfig(TEST_USER_ID);
  const config = createAmazonStoreConfig(proxyConfig);

  const crawler = new PlaywrightCrawler({
    ...config,

    async requestHandler({ request, page, log }) {
      log.info(`访问: ${request.url}`);

      // 等待页面渲染
      console.log('⏳ 等待3秒...');
      await page.waitForTimeout(3000);

      // 保存完整HTML
      const html = await page.content();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `storage/debug-crawlee-${timestamp}.html`;
      await fs.writeFile(filename, html);
      console.log(`📄 HTML已保存: ${filename}`);

      // 在浏览器中测试选择器
      const selectorTests = await page.evaluate(() => {
        const selectors = [
          '[class*="ProductCard"]',
          '[class*="product-card"]',
          '[data-csa-c-item-type="product"]',
          '[data-csa-c-type="item"]',
          'div[class*="sfkrT"]',
          'div[class*="ImageArea"]',
          '[data-component-type="s-search-result"]',
          '.s-result-item[data-asin]',
          '.stores-widget-item',
          '[data-asin]',
        ];

        const results: Record<string, number> = {};
        selectors.forEach((selector) => {
          results[selector] = document.querySelectorAll(selector).length;
        });

        return results;
      });

      console.log('\n📊 浏览器中的选择器测试结果:');
      Object.entries(selectorTests).forEach(([selector, count]) => {
        console.log(`  ${selector}: ${count}`);
      });

      // 用cheerio测试选择器
      const $ = load(html);
      console.log('\n📊 Cheerio中的选择器测试结果:');
      const cheerioSelectors = [
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        '[data-csa-c-item-type="product"]',
        '[data-csa-c-type="item"]',
        'div[class*="sfkrT"]',
        'div[class*="ImageArea"]',
        '[data-component-type="s-search-result"]',
        '.s-result-item[data-asin]',
        '.stores-widget-item',
        '[data-asin]',
      ];

      cheerioSelectors.forEach((selector) => {
        console.log(`  ${selector}: ${$(selector).length}`);
      });

      // 测试图片alt提取
      let imgCount = 0;
      $('img[alt]').each((i, el) => {
        const alt = $(el).attr('alt');
        const src = $(el).attr('src') || '';
        if (
          alt &&
          alt.length > 5 &&
          (src.includes('images-amazon') ||
            src.includes('ssl-images-amazon') ||
            src.includes('m.media-amazon'))
        ) {
          imgCount++;
        }
      });
      console.log(`\n📷 图片alt匹配: ${imgCount}`);

      // 测试a标签
      const links = $('a[href*="/dp/"]').length;
      console.log(`🔗 产品链接(/dp/): ${links}`);

      await Dataset.pushData({
        url: request.url,
        browserSelectorTests: selectorTests,
        timestamp: new Date().toISOString(),
      });
    },
  });

  await crawler.run([TEST_URL]);
  await crawler.teardown();

  console.log('\n✅ 调试完成，请查看保存的HTML文件进行离线分析');
}

main().catch(console.error);
