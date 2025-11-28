#!/usr/bin/env node

/**
 * 测试Playwright+Stealth获取代理IP
 * 验证是否能绕过CloudFlare TLS指纹检测
 */

const { chromium } = require('playwright');

const PROXY_URL = 'https://api.iprocket.io/api?username=com49692430&password=Qxi9V59e3kNOW6pnRi3i&cc=IT&ips=1&type=-res-&proxyType=http&responseType=txt';

async function testProxyFetch() {
  console.log('='.repeat(80));
  console.log('测试Playwright+Stealth获取代理IP');
  console.log('='.repeat(80));
  console.log(`📍 代理URL: ${PROXY_URL}`);
  console.log('');

  let browser;
  try {
    console.log('🔧 启动Chromium浏览器 (stealth模式)...');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        '--lang=en-US,en;q=0.9',
        '--disable-dev-shm-usage',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    const page = await context.newPage();

    // 隐藏webdriver特征
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 隐藏自动化控制特征
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // 覆盖permissions
      const originalQuery = window.navigator.permissions.query;
      return window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    console.log('🌐 访问代理API...');
    console.log('⏳ 等待响应...');

    const startTime = Date.now();
    const response = await page.goto(PROXY_URL, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    const elapsed = Date.now() - startTime;
    console.log(`⏱️  响应时间: ${elapsed}ms`);
    console.log(`📊 HTTP状态码: ${response?.status() || '未知'}`);

    if (!response || response.status() !== 200) {
      console.error(`❌ 请求失败: HTTP ${response?.status()}`);
      return false;
    }

    // 获取页面内容
    const content = await page.textContent('body');
    console.log('📄 响应内容:');
    console.log(content);
    console.log('');

    // 验证代理IP格式
    const lines = content.trim().split('\n').map(line => line.trim()).filter(line => line);
    console.log(`✅ 成功获取 ${lines.length} 行数据`);

    if (lines.length > 0 && lines[0].includes(':')) {
      console.log('✅ 代理IP格式正确');
      console.log(`🔍 示例代理IP: ${lines[0]}`);
      return true;
    } else {
      console.error('❌ 代理IP格式不正确');
      return false;
    }

  } catch (error) {
    console.error('❌ 测试失败:');
    console.error(`错误类型: ${error.name}`);
    console.error(`错误消息: ${error.message}`);

    if (error.message.includes('net::ERR_CONNECTION_RESET')) {
      console.error('');
      console.error('💡 诊断: ERR_CONNECTION_RESET - 连接被重置');
      console.error('可能原因:');
      console.error('  1. CloudFlare TLS指纹检测仍然生效');
      console.error('  2. 服务器主动拒绝连接');
      console.error('  3. 网络环境问题');
    } else if (error.message.includes('timeout')) {
      console.error('');
      console.error('💡 诊断: 请求超时');
      console.error('可能原因:');
      console.error('  1. 服务器响应慢');
      console.error('  2. CloudFlare验证页面需要更多时间');
    }

    console.error('');
    console.error('堆栈跟踪:');
    console.error(error.stack);
    return false;

  } finally {
    if (browser) {
      console.log('');
      console.log('🛑 关闭浏览器...');
      await browser.close();
    }
  }
}

// 运行测试
async function main() {
  console.log('开始测试...\n');

  // 测试5次，验证稳定性
  let successCount = 0;
  const totalTests = 5;

  for (let i = 1; i <= totalTests; i++) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`第 ${i}/${totalTests} 次测试`);
    console.log('='.repeat(80));

    const success = await testProxyFetch();

    if (success) {
      successCount++;
    }

    // 间隔2秒
    if (i < totalTests) {
      console.log('\n⏳ 等待2秒后进行下次测试...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('测试结果汇总');
  console.log('='.repeat(80));
  console.log(`总测试次数: ${totalTests}`);
  console.log(`成功次数: ${successCount}`);
  console.log(`成功率: ${(successCount / totalTests * 100).toFixed(1)}%`);

  if (successCount === totalTests) {
    console.log('\n🎉 测试完全成功！Playwright+Stealth可以稳定获取代理IP');
  } else if (successCount > 0) {
    console.log(`\n⚠️  部分成功，成功率 ${(successCount / totalTests * 100).toFixed(1)}%`);
  } else {
    console.log('\n❌ 测试完全失败！Playwright+Stealth无法获取代理IP');
  }
  console.log('='.repeat(80));

  process.exit(successCount > 0 ? 0 : 1);
}

main().catch(error => {
  console.error('测试脚本错误:', error);
  process.exit(1);
});
