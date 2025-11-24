/**
 * 测试Crawlee数据库持久化功能
 */

import { getCrawleePersistence } from '../src/lib/crawlee-db-persistence';
import { scrapeAmazonStoreWithCrawlee } from '../src/lib/crawlee-scraper';

async function main() {
  console.log('🧪 测试Crawlee数据库持久化\n');

  try {
    // 1. 初始化数据库表
    console.log('1️⃣ 初始化数据库表...');
    const dbPersistence = getCrawleePersistence();
    await dbPersistence.initializeTables();

    // 2. 运行Crawlee抓取（会自动保存到数据库）
    console.log('\n2️⃣ 运行Crawlee抓取（自动保存到数据库）...');
    const testUrl = 'https://www.amazon.com/stores/page/EDE8B424-1294-40E6-837A-D9E47936AB02';
    const userId = 1;

    await scrapeAmazonStoreWithCrawlee(testUrl, userId, 'US');

    // 3. 查询数据库统计
    console.log('\n3️⃣ 查询数据库统计...');
    const stats = await dbPersistence.getStatistics();
    console.log('📊 数据库统计:');
    console.log(`   总抓取次数: ${stats.totalScrapes}`);
    console.log(`   成功次数: ${stats.successfulScrapes}`);
    console.log(`   失败次数: ${stats.failedScrapes}`);
    console.log(`   总产品数: ${stats.totalProducts}`);
    console.log(`   成功率: ${stats.successRate.toFixed(2)}%`);

    // 4. 查询最近的抓取记录
    console.log('\n4️⃣ 查询最近的抓取记录...');
    const history = await dbPersistence.getHistory({
      limit: 5,
      status: 'success',
    });

    console.log(`\n📝 最近${history.length}条成功记录:`);
    history.forEach((record, index) => {
      console.log(`\n${index + 1}. ${record.store_name || 'Unknown Store'}`);
      console.log(`   URL: ${record.url}`);
      console.log(`   品牌: ${record.brand_name}`);
      console.log(`   产品数: ${record.product_count}`);
      console.log(`   耗时: ${record.crawl_duration_ms ? (record.crawl_duration_ms / 1000).toFixed(2) + '秒' : 'N/A'}`);
      console.log(`   时间: ${record.created_at}`);
    });

    // 5. 查询用户级别统计
    console.log('\n5️⃣ 查询用户级别统计...');
    const userStats = await dbPersistence.getStatistics(userId);
    console.log(`\n👤 用户 ${userId} 统计:`);
    console.log(`   总抓取次数: ${userStats.totalScrapes}`);
    console.log(`   成功次数: ${userStats.successfulScrapes}`);
    console.log(`   总产品数: ${userStats.totalProducts}`);

    console.log('\n✅ 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

main();
