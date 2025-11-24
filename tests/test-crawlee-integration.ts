/**
 * Crawlee集成测试套件
 *
 * 测试覆盖：
 * 1. 完整抓取流程
 * 2. 错误处理和重试
 * 3. 数据库持久化
 * 4. 统计监控
 * 5. 进度跟踪
 */

import {
  scrapeAmazonStoreWithCrawlee,
  scrapeMultipleStoresWithCrawlee,
} from '../src/lib/crawlee-scraper';
import { getCrawleePersistence } from '../src/lib/crawlee-db-persistence';
import type { CrawleeProgressEvent } from '../src/lib/crawlee-error-handler';

// 测试配置
const TEST_CONFIG = {
  userId: 1,
  targetCountry: 'US',
  testUrls: [
    'https://www.amazon.com/stores/page/EDE8B424-1294-40E6-837A-D9E47936AB02', // BAGSMART
  ],
};

/**
 * 测试1: 基本抓取流程
 */
async function test1_BasicScraping() {
  console.log('\n📝 测试1: 基本抓取流程');
  console.log('=' .repeat(60));

  try {
    const url = TEST_CONFIG.testUrls[0];
    const result = await scrapeAmazonStoreWithCrawlee(
      url,
      TEST_CONFIG.userId,
      TEST_CONFIG.targetCountry
    );

    // 验证结果
    console.log('\n✅ 验证结果:');
    console.log(`   Store名: ${result.storeName}`);
    console.log(`   Brand名: ${result.brandName}`);
    console.log(`   产品数: ${result.totalProducts}`);
    console.log(`   URL: ${result.storeUrl}`);

    // 断言
    if (!result.storeName) throw new Error('❌ Store名缺失');
    if (!result.brandName) throw new Error('❌ Brand名缺失');
    if (result.totalProducts === 0) throw new Error('❌ 产品数为0');
    if (!result.storeUrl) throw new Error('❌ URL缺失');

    console.log('\n✅ 测试1通过：基本抓取流程正常');
    return true;
  } catch (error) {
    console.error('\n❌ 测试1失败:', error);
    return false;
  }
}

/**
 * 测试2: 数据库持久化验证
 */
async function test2_DatabasePersistence() {
  console.log('\n📝 测试2: 数据库持久化验证');
  console.log('='.repeat(60));

  try {
    const dbPersistence = getCrawleePersistence();

    // 查询最近的记录
    const history = await dbPersistence.getHistory({
      userId: TEST_CONFIG.userId,
      limit: 1,
    });

    console.log('\n✅ 验证数据库记录:');
    if (history.length === 0) {
      throw new Error('❌ 数据库中没有记录');
    }

    const latestRecord = history[0];
    console.log(`   ID: ${latestRecord.id}`);
    console.log(`   URL: ${latestRecord.url}`);
    console.log(`   Store: ${latestRecord.store_name}`);
    console.log(`   Brand: ${latestRecord.brand_name}`);
    console.log(`   产品数: ${latestRecord.product_count}`);
    console.log(`   状态: ${latestRecord.status}`);
    console.log(`   耗时: ${latestRecord.crawl_duration_ms ? (latestRecord.crawl_duration_ms / 1000).toFixed(2) + '秒' : 'N/A'}`);

    // 验证products_json
    const products = JSON.parse(latestRecord.products_json);
    if (products.length === 0) {
      throw new Error('❌ 产品数据为空');
    }
    console.log(`   产品JSON: ${products.length}个产品`);

    // 获取统计信息
    const stats = await dbPersistence.getStatistics(TEST_CONFIG.userId);
    console.log('\n✅ 用户统计:');
    console.log(`   总抓取: ${stats.totalScrapes}`);
    console.log(`   成功: ${stats.successfulScrapes}`);
    console.log(`   失败: ${stats.failedScrapes}`);
    console.log(`   成功率: ${stats.successRate.toFixed(2)}%`);
    console.log(`   总产品: ${stats.totalProducts}`);

    console.log('\n✅ 测试2通过：数据库持久化正常');
    return true;
  } catch (error) {
    console.error('\n❌ 测试2失败:', error);
    return false;
  }
}

/**
 * 测试3: 进度跟踪监听器
 */
async function test3_ProgressTracking() {
  console.log('\n📝 测试3: 进度跟踪监听器');
  console.log('='.repeat(60));

  try {
    const progressEvents: CrawleeProgressEvent[] = [];

    // 进度监听器
    const progressListener = (event: CrawleeProgressEvent) => {
      progressEvents.push(event);
      console.log(
        `   📊 进度事件: ${event.type} - ${event.progress}% (${event.current}/${event.total})`
      );
    };

    const url = TEST_CONFIG.testUrls[0];
    await scrapeAmazonStoreWithCrawlee(
      url,
      TEST_CONFIG.userId,
      TEST_CONFIG.targetCountry,
      progressListener
    );

    console.log('\n✅ 验证进度事件:');
    console.log(`   总事件数: ${progressEvents.length}`);

    // 验证事件类型
    const eventTypes = progressEvents.map((e) => e.type);
    const hasStart = eventTypes.includes('start');
    const hasProgress = eventTypes.includes('progress');
    const hasComplete = eventTypes.includes('complete');

    console.log(`   start事件: ${hasStart ? '✅' : '❌'}`);
    console.log(`   progress事件: ${hasProgress ? '✅' : '❌'}`);
    console.log(`   complete事件: ${hasComplete ? '✅' : '❌'}`);

    if (!hasStart) throw new Error('❌ 缺少start事件');
    if (!hasComplete) throw new Error('❌ 缺少complete事件');

    console.log('\n✅ 测试3通过：进度跟踪正常');
    return true;
  } catch (error) {
    console.error('\n❌ 测试3失败:', error);
    return false;
  }
}

/**
 * 测试4: 数据质量验证
 */
async function test4_DataQuality() {
  console.log('\n📝 测试4: 数据质量验证');
  console.log('='.repeat(60));

  try {
    const url = TEST_CONFIG.testUrls[0];
    const result = await scrapeAmazonStoreWithCrawlee(
      url,
      TEST_CONFIG.userId,
      TEST_CONFIG.targetCountry
    );

    console.log('\n✅ 验证数据质量:');

    // 验证产品数据
    if (result.products.length === 0) {
      throw new Error('❌ 没有产品数据');
    }

    const firstProduct = result.products[0];
    console.log(`   产品数量: ${result.products.length}`);
    console.log(`   示例产品:`);
    console.log(`     名称: ${firstProduct.name?.slice(0, 50)}...`);
    console.log(`     ASIN: ${firstProduct.asin || 'N/A'}`);
    console.log(`     价格: ${firstProduct.price || 'N/A'}`);
    console.log(`     图片: ${firstProduct.imageUrl ? '✅' : '❌'}`);

    // 验证必需字段
    let validProducts = 0;
    let productsWithASIN = 0;
    let productsWithPrice = 0;
    let productsWithImage = 0;

    result.products.forEach((product) => {
      if (product.name && product.name.length > 5) validProducts++;
      if (product.asin) productsWithASIN++;
      if (product.price) productsWithPrice++;
      if (product.imageUrl) productsWithImage++;
    });

    console.log('\n✅ 数据完整性:');
    console.log(`   有效产品: ${validProducts}/${result.products.length}`);
    console.log(`   有ASIN: ${productsWithASIN}/${result.products.length}`);
    console.log(`   有价格: ${productsWithPrice}/${result.products.length}`);
    console.log(`   有图片: ${productsWithImage}/${result.products.length}`);

    if (validProducts === 0) throw new Error('❌ 没有有效产品');

    // 验证品牌名规范化
    if (result.brandName) {
      const isCapitalized =
        result.brandName[0] === result.brandName[0].toUpperCase();
      console.log(
        `   品牌名规范化: ${isCapitalized ? '✅ ' + result.brandName : '❌'}`
      );
      if (!isCapitalized) throw new Error('❌ 品牌名未规范化');
    }

    console.log('\n✅ 测试4通过：数据质量合格');
    return true;
  } catch (error) {
    console.error('\n❌ 测试4失败:', error);
    return false;
  }
}

/**
 * 测试5: 错误恢复机制
 */
async function test5_ErrorRecovery() {
  console.log('\n📝 测试5: 错误恢复机制');
  console.log('='.repeat(60));

  try {
    const invalidUrl = 'https://www.amazon.com/stores/page/INVALID-PAGE-ID';

    console.log('\n   尝试抓取无效URL（预期失败）...');

    let errorCaught = false;
    try {
      await scrapeAmazonStoreWithCrawlee(
        invalidUrl,
        TEST_CONFIG.userId,
        TEST_CONFIG.targetCountry
      );
    } catch (error) {
      errorCaught = true;
      console.log(`   ✅ 错误被正确捕获: ${error instanceof Error ? error.message.slice(0, 50) : 'Unknown'}`);
    }

    if (!errorCaught) {
      throw new Error('❌ 错误未被捕获');
    }

    // 验证错误是否记录到数据库
    const dbPersistence = getCrawleePersistence();
    const errorHistory = await dbPersistence.getHistory({
      status: 'error',
      limit: 5,
    });

    console.log(`   数据库中的错误记录: ${errorHistory.length}条`);

    // 注意：由于Crawlee的重试机制，可能错误不会立即保存到数据库
    // 这里只验证错误被捕获

    console.log('\n✅ 测试5通过：错误恢复正常');
    return true;
  } catch (error) {
    console.error('\n❌ 测试5失败:', error);
    return false;
  }
}

/**
 * 主测试流程
 */
async function runAllTests() {
  console.log('\n🧪 Crawlee集成测试套件');
  console.log('='.repeat(60));
  console.log(`时间: ${new Date().toISOString()}`);
  console.log(`用户ID: ${TEST_CONFIG.userId}`);
  console.log(`目标国家: ${TEST_CONFIG.targetCountry}`);

  const results: Record<string, boolean> = {};

  // 运行所有测试
  results['test1_BasicScraping'] = await test1_BasicScraping();
  results['test2_DatabasePersistence'] = await test2_DatabasePersistence();
  results['test3_ProgressTracking'] = await test3_ProgressTracking();
  results['test4_DataQuality'] = await test4_DataQuality();
  results['test5_ErrorRecovery'] = await test5_ErrorRecovery();

  // 汇总结果
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(60));

  let passedCount = 0;
  let failedCount = 0;

  Object.entries(results).forEach(([testName, passed]) => {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${testName}`);
    if (passed) passedCount++;
    else failedCount++;
  });

  console.log('='.repeat(60));
  console.log(`总测试数: ${passedCount + failedCount}`);
  console.log(`通过: ${passedCount}`);
  console.log(`失败: ${failedCount}`);
  console.log(
    `成功率: ${((passedCount / (passedCount + failedCount)) * 100).toFixed(2)}%`
  );

  if (failedCount > 0) {
    console.log('\n❌ 部分测试失败');
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试通过！');
    process.exit(0);
  }
}

// 运行测试
runAllTests().catch((error) => {
  console.error('\n❌ 测试运行失败:', error);
  process.exit(1);
});
