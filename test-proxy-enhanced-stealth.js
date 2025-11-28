#!/usr/bin/env node

/**
 * 增强版Playwright+Stealth获取代理IP
 * 添加更多CloudFlare绕过技术
 */

const { chromium } = require('playwright');

const PROXY_URL = 'https://api.iprocket.io/api?username=com49692430&password=Qxi9V59e3kNOW6pnRi3i&cc=IT&ips=1&type=-res-&proxyType=http&responseType=txt';

async function testEnhancedStealth() {
  console.log('='.repeat(80));
  console.log('测试增强版Playwright+Stealth获取代理IP');
  console.log('='.repeat(80));
  console.log(`📍 代理URL: ${PROXY_URL}`);
  console.log('');

  let browser;
  try {
    console.log('🔧 启动Chromium浏览器 (增强stealth模式)...');

    // 关键：使用真实Chrome（而非headless），更难被检测
    browser = await chromium.launch({
      headless: true,  // 保持headless，但使用完整Chrome
      args: [
        // 基础安全参数
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',

        // 反检测参数
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
        '--disable-ipc-flooding-protection',

        // User-Agent和语言
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',

        // 性能优化
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=ScriptStreaming',
        '--disable-v8-idle-tasks',

        // WebGL和Canvas指纹防护
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'light',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-Ch-Ua': '"Google Chrome";v="130", "Chromium";v="130", "Not?A_Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
    });

    const page = await context.newPage();

    // ========== 核心Stealth脚本 ==========
    await page.addInitScript(() => {
      // 1. 移除webdriver特征
      delete Object.getPrototypeOf(navigator).webdriver;

      // 2. 修改navigator信息
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 3. 修改plugins（显示为真实Chrome）
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5].map((_, i) => ({
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
        })),
      });

      // 4. 修改languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // 5. 修改permissions（通知权限）
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // 6. 修改Chrome运行时信息
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        onConnect: null,
        onMessage: null,
      };

      // 7. 移除automation属性
      Object.defineProperty(navigator, 'automation', {
        get: () => undefined,
      });

      // 8. 修改屏幕信息
      Object.defineProperty(screen, 'availWidth', {
        get: () => 1920,
      });
      Object.defineProperty(screen, 'availHeight', {
        get: () => 1080,
      });

      // 9. 覆盖toString方法
      window.navigator.toString = function() {
        return '[object Navigator]';
      };

      // 10. 修改内部属性
      try {
        const proto = window.navigator.__proto__;
        delete proto.webdriver;
      } catch (e) {}
    });

    // 额外：页面加载前等待
    console.log('⏳ 等待页面稳定...');
    await page.waitForTimeout(500);

    console.log('🌐 访问代理API...');
    console.log('⏳ 等待响应...');

    const startTime = Date.now();

    // 使用 'domcontentloaded' 而不是 'networkidle'，减少等待时间
    const response = await page.goto(PROXY_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const elapsed = Date.now() - startTime;
    console.log(`⏱️  响应时间: ${elapsed}ms`);
    console.log(`📊 HTTP状态码: ${response?.status() || '未知'}`);

    if (!response || response.status() !== 200) {
      console.error(`❌ 请求失败: HTTP ${response?.status()}`);
      return false;
    }

    // 等待内容加载
    await page.waitForTimeout(1000);

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
      console.error('💡 诊断: ERR_CONNECTION_RESET仍然出现');
      console.error('可能原因:');
      console.error('  1. CloudFlare使用更高级的指纹检测');
      console.error('  2. 需要使用真实浏览器（而非headless）');
      console.error('  3. IPRocket对自动化流量有限制');
    }

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
  console.log('开始增强版测试...\n');

  const success = await testEnhancedStealth();

  console.log('\n' + '='.repeat(80));
  if (success) {
    console.log('🎉 增强版Stealth测试成功！');
    console.log('');
    console.log('✅ 解决方案：将此Stealth配置应用到代码中');
  } else {
    console.log('❌ 增强版Stealth测试失败');
    console.log('');
    console.log('💡 建议:');
    console.log('  1. 使用真实Chrome浏览器（headless: false）');
    console.log('  2. 添加随机延迟和鼠标移动');
    console.error('  3. 考虑更换代理服务商（IPRocket对自动化不友好）');
  }
  console.log('='.repeat(80));

  process.exit(success ? 0 : 1);
}

main().catch(error => {
  console.error('测试脚本错误:', error);
  process.exit(1);
});
