#!/usr/bin/env node

/**
 * Offer创建完整流程测试
 * 测试推广链接：https://pboost.me/UMg8ds7
 * 国家：IT (意大利)
 */

const https = require('https');
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const AFFILIATE_LINK = 'https://pboost.me/UMg8ds7';
const TARGET_COUNTRY = 'IT';

// 读取cookie
const fs = require('fs');
let sessionCookie = '';
try {
  const cookieFile = fs.readFileSync('/tmp/cookies.txt', 'utf8');
  const match = cookieFile.match(/auth_token\s+([^\s]+)/);
  if (match) {
    sessionCookie = `auth_token=${match[1]}`;
  }
} catch (err) {
  console.error('❌ 无法读取cookie文件:', err.message);
  process.exit(1);
}

console.log('🔵 开始Offer创建完整流程测试');
console.log('='.repeat(80));
console.log(`📍 推广链接: ${AFFILIATE_LINK}`);
console.log(`🌍 目标国家: ${TARGET_COUNTRY}`);
console.log(`🍪 认证Cookie: ${sessionCookie.substring(0, 50)}...`);
console.log('='.repeat(80));
console.log('');

/**
 * Step 1: 调用SSE接口提取推广链接信息
 */
async function extractAffiliateLinkInfo() {
  console.log('📡 Step 1: 调用POST /api/offers/extract提取推广链接信息');
  console.log('-'.repeat(80));

  const payload = {
    affiliate_link: AFFILIATE_LINK,
    target_country: TARGET_COUNTRY,
    skipCache: true,
    batchMode: false
  };

  console.log('📤 请求payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/offers/extract',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': sessionCookie,
      }
    };

    console.log('⏳ 发送POST请求...\n');

    const req = http.request(options, (res) => {
      console.log(`📊 HTTP状态码: ${res.statusCode}`);
      console.log(`📋 响应头: ${JSON.stringify(res.headers, null, 2)}\n`);

      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => {
          console.error(`❌ 请求失败: ${errorData}`);
          reject(new Error(`HTTP ${res.statusCode}: ${errorData}`));
        });
        return;
      }

      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        console.log('📥 响应数据:');
        console.log(responseData);
        console.log('');

        try {
          const result = JSON.parse(responseData);
          console.log('✅ 推广链接解析成功');
          console.log('-'.repeat(80));
          resolve(result);
        } catch (e) {
          reject(new Error(`解析响应失败: ${responseData}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`❌ 请求失败: ${err.message}`);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Step 2: 创建Offer
 */
async function createOffer(extractedData) {
  console.log('\n📡 Step 2: 调用POST /api/offers创建Offer');
  console.log('-'.repeat(80));

  // 使用extract返回的完整数据构建payload
  const payload = {
    affiliate_link: AFFILIATE_LINK,
    brand: extractedData.brand,
    target_country: TARGET_COUNTRY,
    url: extractedData.finalUrl,
    final_url: extractedData.finalUrl,
    target_language: extractedData.targetLanguage,
  };

  // 只有当字段有值时才添加
  if (extractedData.finalUrlSuffix) {
    payload.final_url_suffix = extractedData.finalUrlSuffix;
  }
  if (extractedData.price) {
    payload.product_price = extractedData.price;
  }
  if (extractedData.productDescription) {
    payload.brand_description = extractedData.productDescription;
  }

  console.log('📤 请求payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/offers',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': sessionCookie,
      }
    };

    const req = http.request(options, (res) => {
      console.log(`📊 HTTP状态码: ${res.statusCode}`);

      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        console.log('📥 响应数据:');
        console.log(responseData);
        console.log('');

        try {
          const result = JSON.parse(responseData);
          if (res.statusCode === 201 || res.statusCode === 200) {
            console.log('✅ Offer创建成功');
            console.log('-'.repeat(80));
            resolve(result);
          } else {
            console.error('❌ Offer创建失败');
            console.log('-'.repeat(80));
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${responseData}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`❌ 请求失败: ${err.message}`);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Step 3: 验证Offer状态
 */
async function verifyOffer(offerId) {
  console.log('\n📡 Step 3: 验证Offer创建结果');
  console.log('-'.repeat(80));

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/offers/${offerId}`,
      method: 'GET',
      headers: {
        'Cookie': sessionCookie,
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          console.log('📦 Offer详情:');
          console.log(JSON.stringify(response, null, 2));
          console.log('');

          // 修复：正确从response中提取offer对象
          const offer = response.offer || response;
          console.log(`🏷️  Offer ID: ${offer.id}`);
          console.log(`🎯 品牌: ${offer.brand}`);
          console.log(`🌐 Final URL: ${offer.final_url}`);
          console.log(`📊 抓取状态: ${offer.scrape_status}`);
          console.log(`⏰ 创建时间: ${offer.created_at}`);
          console.log('-'.repeat(80));
          resolve(offer);
        } catch (e) {
          reject(new Error(`解析响应失败: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * 主流程
 */
async function main() {
  try {
    // Step 1: 提取推广链接信息
    const extractResult = await extractAffiliateLinkInfo();
    const extractedData = extractResult.data; // 使用.data字段

    // 等待2秒
    console.log('\n⏳ 等待2秒后创建Offer...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: 创建Offer
    const createResult = await createOffer(extractedData);
    const offerId = createResult.offer?.id || createResult.id;

    if (!offerId) {
      throw new Error('未获取到Offer ID');
    }

    // 等待2秒
    console.log('\n⏳ 等待2秒后验证Offer...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: 验证Offer
    const offer = await verifyOffer(offerId);

    // 最终结果
    console.log('\n' + '='.repeat(80));
    console.log('🎉 测试完成！');
    console.log('='.repeat(80));
    console.log(`✅ Offer ID: ${offer.id}`);
    console.log(`✅ 品牌: ${offer.brand}`);
    console.log(`✅ Final URL: ${offer.final_url || '(空)'}`);
    console.log(`✅ 抓取状态: ${offer.scrape_status}`);

    if (offer.scrape_status === 'completed') {
      console.log('\n🎊 测试成功！Offer创建流程正常！');
    } else if (offer.scrape_status === 'pending') {
      console.log('\n⚠️  注意：Offer状态为pending，可能需要后台抓取');
    } else {
      console.log('\n❌ 警告：Offer状态异常');
    }
    console.log('='.repeat(80));

    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ 测试失败');
    console.error('='.repeat(80));
    console.error(`错误: ${error.message}`);
    console.error(error.stack);
    console.error('='.repeat(80));
    process.exit(1);
  }
}

// 运行
main();
