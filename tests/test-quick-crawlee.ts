/**
 * 快速测试Crawlee数据提取修复
 */
import { scrapeAmazonStoreWithCrawlee } from '../src/lib/crawlee-scraper';

const TEST_URL = 'https://www.amazon.com/stores/page/EDE8B424-1294-40E6-837A-D9E47936AB02';
const TEST_USER_ID = 1; // autoads用户

async function main() {
  console.log('🧪 测试修复后的Crawlee数据提取...\n');

  const startTime = Date.now();
  const result = await scrapeAmazonStoreWithCrawlee(TEST_URL, TEST_USER_ID);
  const duration = Date.now() - startTime;

  console.log('\n✅ 测试结果:');
  console.log('耗时:', duration + 'ms');
  console.log('产品数量:', result.totalProducts);
  console.log('Store名:', result.storeName);
  console.log('Brand名:', result.brandName);

  if (result.products && result.products.length > 0) {
    console.log('\n前5个产品:');
    result.products.slice(0, 5).forEach((p, idx) => {
      console.log(`${idx + 1}. ${p.name} (${p.asin || 'no ASIN'})`);
    });

    const avgRating = result.products.reduce((sum, p) => sum + parseFloat(p.rating || '0'), 0) / result.products.length;
    console.log(`\n💡 平均评分: ${avgRating.toFixed(1)}⭐`);
  } else {
    console.log('❌ 未找到任何产品');
  }
}

main().catch(console.error);
