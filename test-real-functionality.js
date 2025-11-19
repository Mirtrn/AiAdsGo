/**
 * 真实功能测试 - 使用.env中的真实API密钥
 * 测试需求11、12、15的实际功能
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { HttpsProxyAgent } = require('https-proxy-agent');

console.log('🧪 开始真实功能测试...\n');
console.log('=' .repeat(60));

// ============================================
// 代理配置辅助函数
// ============================================
async function setupProxyForGemini() {
  const proxyEnabled = process.env.PROXY_ENABLED === 'true';
  const proxyUrl = process.env.PROXY_URL;

  if (!proxyEnabled || !proxyUrl) {
    console.log('ℹ️ 代理未启用，使用直连模式');
    return null;
  }

  try {
    console.log('🔧 配置代理...');

    // 获取代理IP
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`获取代理失败: ${response.status}`);
    }

    const text = await response.text();
    const firstLine = text.trim().split('\n')[0].trim();
    const [host, port, username, password] = firstLine.split(':');

    if (!host || !port || !username || !password) {
      throw new Error(`代理格式错误: ${firstLine}`);
    }

    console.log(`✓ 代理IP: ${host}:${port}`);

    // 创建代理Agent
    const proxyAgent = new HttpsProxyAgent(
      `http://${username}:${password}@${host}:${port}`
    );

    // 覆盖全局fetch使用代理
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      return originalFetch(url, {
        ...options,
        agent: proxyAgent
      });
    };

    console.log('✓ 代理配置成功\n');

    // 返回恢复函数
    return () => {
      global.fetch = originalFetch;
    };
  } catch (error) {
    console.log(`⚠️ 代理配置失败: ${error.message}`);
    console.log('使用直连模式\n');
    return null;
  }
}

// ============================================
// 测试1: 需求12 - Gemini 2.5模型调用
// ============================================
async function testGemini25() {
  console.log('\n📋 测试1: 需求12 - Gemini 2.5 Pro模型');
  console.log('-'.repeat(60));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('❌ 缺少GEMINI_API_KEY');
    return false;
  }

  console.log(`✓ API Key: ${apiKey.substring(0, 10)}...`);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // 测试使用2.5模型（正确的实验版模型名称）
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    console.log('✓ 已初始化 gemini-2.5-pro 模型（稳定版）');
    console.log('🔄 发送测试请求...');

    const result = await model.generateContent('请用一句话介绍Google Gemini 2.5的主要特点');
    const response = await result.response;
    const text = response.text();

    console.log('✅ Gemini 2.5 API调用成功！');
    console.log(`📝 响应: ${text.substring(0, 150)}...`);
    return true;
  } catch (error) {
    console.log(`❌ Gemini 2.5测试失败: ${error.message}`);
    return false;
  }
}

// ============================================
// 测试2: 需求15 - AI创意生成（Callout/Sitelink）
// ============================================
async function testCreativeGeneration() {
  console.log('\n📋 测试2: 需求15 - AI创意生成（Callout/Sitelink）');
  console.log('-'.repeat(60));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('❌ 缺少GEMINI_API_KEY');
    return false;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const brandInfo = {
      brand: 'Reolink',
      brandDescription: 'Reolink is a leading provider of innovative security camera solutions, offering high-quality surveillance systems for home and business protection with advanced features like 4K resolution, night vision, and smart detection.',
      uniqueSellingPoints: '4K Ultra HD Resolution, Smart Person/Vehicle Detection, 24/7 Recording, Remote Viewing, Night Vision up to 100ft',
      productHighlights: 'Premium Quality Cameras, Advanced AI Detection, Cloud and Local Storage Options, Mobile App Control, Two-Way Audio',
      targetAudience: 'Homeowners and business owners looking for reliable security camera systems',
      targetCountry: 'US'
    };

    const prompt = `你是一个专业的Google Ads广告文案撰写专家。请根据以下产品信息，生成高质量的Google搜索广告文案。

品牌名称: ${brandInfo.brand}
品牌描述: ${brandInfo.brandDescription}
独特卖点: ${brandInfo.uniqueSellingPoints}
产品亮点: ${brandInfo.productHighlights}
目标受众: ${brandInfo.targetAudience}
目标国家: ${brandInfo.targetCountry}

请以JSON格式返回完整的广告创意元素（仅包含callouts和sitelinks）：
{
  "callouts": [
    "宣传信息1（最多25个字符，基于真实品牌信息）",
    "宣传信息2",
    "宣传信息3",
    "宣传信息4"
  ],
  "sitelinks": [
    { "title": "链接文字1（最多25个字符，基于真实信息）", "description": "链接描述1（最多35个字符）" },
    { "title": "链接文字2", "description": "链接描述2" },
    { "title": "链接文字3", "description": "链接描述3" },
    { "title": "链接文字4", "description": "链接描述4" }
  ]
}

要求：
1. Callouts必须基于品牌描述和产品亮点中的真实信息
2. Sitelinks必须基于真实的产品类别、服务或特性
3. 不要编造不存在的服务或承诺
4. 只返回JSON，不要其他文字`;

    console.log('🔄 生成广告创意...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('⚠️ AI返回格式异常');
      return false;
    }

    const creative = JSON.parse(jsonMatch[0]);

    console.log('✅ AI创意生成成功！\n');
    console.log('📌 Callouts (基于真实品牌信息):');
    creative.callouts.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c} (${c.length}字符)`);
    });

    console.log('\n🔗 Sitelinks (基于真实产品特性):');
    creative.sitelinks.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.title} - ${s.description}`);
    });

    // 验证是否真实
    const hasNightVision = creative.callouts.some(c => c.toLowerCase().includes('night'));
    const has4K = creative.callouts.some(c => c.includes('4K') || c.includes('HD'));

    console.log('\n🔍 真实性验证:');
    console.log(`   ${hasNightVision ? '✅' : '⚠️'} 包含夜视相关信息`);
    console.log(`   ${has4K ? '✅' : '⚠️'} 包含4K/HD相关信息`);

    return true;
  } catch (error) {
    console.log(`❌ 创意生成测试失败: ${error.message}`);
    return false;
  }
}

// ============================================
// 测试3: 需求11 - Google搜索下拉词
// ============================================
async function testGoogleSuggestions() {
  console.log('\n📋 测试3: 需求11 - Google搜索下拉词提取');
  console.log('-'.repeat(60));

  try {
    const brand = 'Reolink';
    const country = 'US';
    const language = 'en';

    // 测试Google Suggest API
    const query = encodeURIComponent(brand);
    const apiUrl = `https://suggestqueries.google.com/complete/search?client=firefox&q=${query}&gl=${country.toLowerCase()}&hl=${language}`;

    console.log(`🔍 查询品牌: ${brand}`);
    console.log(`🌍 目标国家: ${country}`);
    console.log(`📡 API URL: ${apiUrl}`);
    console.log('🔄 发送请求...');

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      console.log(`⚠️ API返回状态: ${response.status}`);
      return false;
    }

    const data = await response.json();
    const suggestions = data[1] || [];

    console.log(`✅ 获取到 ${suggestions.length} 个搜索建议:\n`);
    suggestions.slice(0, 10).forEach((s, i) => {
      console.log(`   ${i + 1}. ${s}`);
    });

    // 测试购买意图过滤
    console.log('\n🎯 购买意图过滤测试:');
    const lowIntentPatterns = [
      /\b(setup|install|how to|free|review|vs\b|alternative|problem)\b/i
    ];

    const filtered = suggestions.filter(keyword => {
      const isLowIntent = lowIntentPatterns.some(pattern => pattern.test(keyword));
      return !isLowIntent;
    });

    console.log(`   原始关键词: ${suggestions.length}个`);
    console.log(`   过滤后: ${filtered.length}个 (过滤掉${suggestions.length - filtered.length}个低意图词)`);

    const removedExamples = suggestions.filter(s => !filtered.includes(s)).slice(0, 3);
    if (removedExamples.length > 0) {
      console.log(`   被过滤示例: ${removedExamples.join(', ')}`);
    }

    return suggestions.length > 0;
  } catch (error) {
    console.log(`❌ Google下拉词测试失败: ${error.message}`);
    return false;
  }
}

// ============================================
// 执行所有测试
// ============================================
async function runAllTests() {
  console.log('🚀 使用.env中的真实API密钥进行测试\n');

  // 设置代理（如果启用）
  const restoreProxy = await setupProxyForGemini();

  const results = {
    gemini25: false,
    creative: false,
    suggestions: false
  };

  try {
    results.gemini25 = await testGemini25();
    results.creative = await testCreativeGeneration();
    results.suggestions = await testGoogleSuggestions();
  } finally {
    // 恢复原始fetch
    if (restoreProxy) {
      restoreProxy();
      console.log('\n✓ 已恢复原始fetch配置');
    }
  }

  // 总结
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果总结');
  console.log('='.repeat(60));
  console.log(`需求12 - Gemini 2.5模型: ${results.gemini25 ? '✅ 通过' : '❌ 失败'}`);
  console.log(`需求15 - AI创意生成: ${results.creative ? '✅ 通过' : '❌ 失败'}`);
  console.log(`需求11 - Google下拉词: ${results.suggestions ? '✅ 通过' : '❌ 失败'}`);

  const passCount = Object.values(results).filter(r => r).length;
  const total = Object.values(results).length;

  console.log('\n' + '='.repeat(60));
  console.log(`✅ 通过率: ${passCount}/${total} (${Math.round(passCount / total * 100)}%)`);
  console.log('='.repeat(60));
}

// 运行测试
runAllTests().catch(console.error);
