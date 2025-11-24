/**
 * Crawlee性能对比测试
 *
 * 对比当前实现 vs Crawlee实现的性能差异
 * 测试场景：
 * 1. 单URL抓取（验证基础性能）
 * 2. 多URL并发抓取（验证并发优势）
 */

import { scrapeAmazonStoreWithCrawlee, scrapeMultipleStoresWithCrawlee } from '../src/lib/crawlee-scraper';
import { scrapeAmazonStore } from '../src/lib/scraper-stealth';

// 测试URL
const TEST_URL = 'https://www.amazon.com/stores/page/EDE8B424-1294-40E6-837A-D9E47936AB02';

// 测试用户ID（autoads用户）
const TEST_USER_ID = 1;

/**
 * 性能测试辅助函数
 */
async function measurePerformance<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  console.log(`\n⏱️  ${name} 开始...`);
  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    console.log(`✅ ${name} 完成: ${duration}ms`);
    return { result, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ ${name} 失败: ${error}`);
    console.error(`耗时: ${duration}ms`);
    throw error;
  }
}

/**
 * 测试1: 单URL性能对比
 */
async function testSingleUrlPerformance() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 测试1: 单URL性能对比');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`测试URL: ${TEST_URL}`);

  // 测试当前实现
  const currentImpl = await measurePerformance('当前实现', async () => {
    return await scrapeAmazonStore(TEST_URL);
  });

  console.log('\n⏳ 等待5秒后测试Crawlee实现...\n');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 测试Crawlee实现
  const crawleeImpl = await measurePerformance('Crawlee实现', async () => {
    return await scrapeAmazonStoreWithCrawlee(TEST_URL, TEST_USER_ID);
  });

  // 性能对比
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 单URL性能对比结果');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const improvement =
    ((currentImpl.duration - crawleeImpl.duration) / currentImpl.duration) * 100;

  console.log(`当前实现: ${currentImpl.duration}ms`);
  console.log(`Crawlee实现: ${crawleeImpl.duration}ms`);
  console.log(
    `性能提升: ${improvement > 0 ? '-' : '+'}${Math.abs(improvement).toFixed(1)}%`
  );

  // 数据质量对比
  console.log('\n📊 数据质量对比:');
  console.log(
    `当前实现产品数: ${currentImpl.result.productCount} (${currentImpl.result.products.length})`
  );
  console.log(
    `Crawlee产品数: ${crawleeImpl.result.productCount} (${crawleeImpl.result.products.length})`
  );

  // 判断性能是否达到预期
  if (improvement >= 20) {
    console.log('\n✅ 性能测试通过：Crawlee性能提升≥20%');
  } else if (improvement >= 10) {
    console.log('\n⚠️  性能测试部分通过：Crawlee性能提升10-20%');
  } else {
    console.log('\n❌ 性能测试未通过：Crawlee性能提升<10%');
  }

  return {
    currentDuration: currentImpl.duration,
    crawleeDuration: crawleeImpl.duration,
    improvement,
  };
}

/**
 * 测试2: 多URL并发性能对比（展示Crawlee核心优势）
 */
async function testConcurrencyPerformance() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 测试2: 多URL并发性能对比');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const testUrls = [
    TEST_URL,
    TEST_URL,
    TEST_URL,
    TEST_URL,
    TEST_URL,
  ];

  console.log(`测试URL数量: ${testUrls.length}`);

  // 当前实现：串行处理
  const currentImpl = await measurePerformance('当前实现（串行）', async () => {
    const results = [];
    for (const url of testUrls) {
      const result = await scrapeAmazonStore(url);
      results.push(result);
    }
    return results;
  });

  console.log('\n⏳ 等待5秒后测试Crawlee实现...\n');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Crawlee实现：并发处理
  const crawleeImpl = await measurePerformance('Crawlee实现（并发）', async () => {
    return await scrapeMultipleStoresWithCrawlee(testUrls, TEST_USER_ID);
  });

  // 性能对比
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 多URL并发性能对比结果');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const improvement =
    ((currentImpl.duration - crawleeImpl.duration) / currentImpl.duration) * 100;

  console.log(`当前实现（串行）: ${currentImpl.duration}ms`);
  console.log(`Crawlee实现（并发）: ${crawleeImpl.duration}ms`);
  console.log(
    `性能提升: ${improvement > 0 ? '-' : '+'}${Math.abs(improvement).toFixed(1)}%`
  );

  // 判断性能是否达到预期（并发场景应有显著提升）
  if (improvement >= 70) {
    console.log('\n✅ 并发性能测试通过：Crawlee性能提升≥70%');
  } else if (improvement >= 50) {
    console.log('\n⚠️  并发性能测试部分通过：Crawlee性能提升50-70%');
  } else {
    console.log('\n❌ 并发性能测试未通过：Crawlee性能提升<50%');
  }

  return {
    currentDuration: currentImpl.duration,
    crawleeDuration: crawleeImpl.duration,
    improvement,
  };
}

/**
 * 主测试函数
 */
async function main() {
  console.log('🚀 Crawlee性能对比测试');
  console.log('============================================================');
  console.log('目标：验证Crawlee在SaaS多用户并发场景的性能优势');
  console.log('预期：单URL 20-40%提升，多URL并发 70-88%提升');
  console.log('============================================================\n');

  try {
    // 执行测试1：单URL性能对比
    const test1Result = await testSingleUrlPerformance();

    // 执行测试2：多URL并发性能对比
    const test2Result = await testConcurrencyPerformance();

    // 总结
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 测试总结');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`单URL性能提升: ${test1Result.improvement.toFixed(1)}%`);
    console.log(`多URL并发性能提升: ${test2Result.improvement.toFixed(1)}%`);

    if (test1Result.improvement >= 20 && test2Result.improvement >= 70) {
      console.log('\n✅ 所有测试通过！Crawlee迁移值得执行');
    } else {
      console.log('\n⚠️  部分测试未达预期，需要进一步优化');
    }
  } catch (error) {
    console.error('\n❌ 测试执行失败:', error);
    process.exit(1);
  }
}

// 执行测试
main();
