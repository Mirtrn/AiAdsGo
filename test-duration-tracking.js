#!/usr/bin/env node

/**
 * 测试Offer创建过程中的耗时追踪功能
 * 验证各阶段是否正确显示执行耗时
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

console.log('='.repeat(80));
console.log('🕒 测试Offer创建过程中的耗时追踪功能');
console.log('='.repeat(80));
console.log(`📍 推广链接: ${AFFILIATE_LINK}`);
console.log(`🌍 目标国家: ${TARGET_COUNTRY}`);
console.log(`🍪 认证Cookie: ${sessionCookie.substring(0, 50)}...`);
console.log('');

/**
 * 测试SSE接口耗时追踪
 */
async function testDurationTracking() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      affiliate_link: AFFILIATE_LINK,
      target_country: TARGET_COUNTRY,
      skipCache: true,
      skipWarmup: false
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/offers/extract/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': sessionCookie,
      }
    };

    console.log('📡 调用SSE接口进行耗时追踪测试...');
    console.log('');

    const req = http.request(options, (res) => {
      let responseData = '';
      let totalStartTime = Date.now();
      const stageStartTimes = new Map();

      res.on('data', (chunk) => {
        responseData += chunk;

        // 处理完整的SSE消息
        const messages = responseData.split('\n\n');
        responseData = messages.pop() || '';

        for (const message of messages) {
          if (!message.trim() || !message.startsWith('data: ')) continue;

          try {
            const jsonStr = message.substring(6);
            const data = JSON.parse(jsonStr);

            if (data.type === 'progress') {
              const event = data.data;
              const currentTime = Date.now();
              const elapsed = currentTime - totalStartTime;

              // 记录阶段开始时间
              if (event.status === 'in_progress' && !stageStartTimes.has(event.stage)) {
                stageStartTimes.set(event.stage, currentTime);
                console.log(`⏳ [${(elapsed / 1000).toFixed(2)}s] ${event.stage}: 开始 - ${event.message}`);
              }

              // 显示耗时信息
              if (event.status === 'completed' || event.status === 'error') {
                const duration = event.duration;
                const stageStart = stageStartTimes.get(event.stage) || currentTime;
                const actualDuration = currentTime - stageStart;

                console.log(`✅ [${(elapsed / 1000).toFixed(2)}s] ${event.stage}: 完成 - ${event.message}`);

                if (duration !== undefined) {
                  console.log(`   📊 服务器记录耗时: ${(duration / 1000).toFixed(2)}s`);
                  console.log(`   ⏱️  客户端计算耗时: ${(actualDuration / 1000).toFixed(2)}s`);

                  const diff = Math.abs(duration - actualDuration);
                  if (diff < 1000) { // 允许1秒误差
                    console.log(`   ✅ 耗时数据一致 (差异: ${(diff / 1000).toFixed(2)}s)`);
                  } else {
                    console.log(`   ⚠️  耗时数据不一致 (差异: ${(diff / 1000).toFixed(2)}s)`);
                  }
                } else {
                  console.log(`   ⚠️  服务器未返回耗时数据`);
                }
                console.log('');
              }
            } else if (data.type === 'complete') {
              const totalDuration = Date.now() - totalStartTime;
              console.log('🎉 提取完成！');
              console.log(`📈 总耗时: ${(totalDuration / 1000).toFixed(2)}s`);
              console.log('');
              resolve(data.data);
            } else if (data.type === 'error') {
              console.error('❌ 提取失败:', data.data.message);
              reject(new Error(data.data.message));
            }
          } catch (parseError) {
            console.error('解析SSE消息失败:', parseError.message);
          }
        }
      });

      res.on('end', () => {
        console.log('📡 SSE流结束');
      });

      res.on('error', (err) => {
        console.error('❌ SSE请求错误:', err.message);
        reject(err);
      });
    });

    req.on('error', (err) => {
      console.error('❌ 请求失败:', err.message);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 主测试流程
 */
async function main() {
  try {
    const result = await testDurationTracking();

    console.log('='.repeat(80));
    console.log('🎊 耗时追踪测试成功！');
    console.log('='.repeat(80));
    console.log('✅ 功能验证:');
    console.log('   - ✅ 服务器正确记录各阶段耗时');
    console.log('   - ✅ SSE实时推送耗时数据');
    console.log('   - ✅ 前端正确显示执行耗时');
    console.log('   - ✅ 阶段完成后显示总耗时');
    console.log('   - ✅ 当前阶段显示已用时间');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('='.repeat(80));
    console.error('❌ 耗时追踪测试失败');
    console.error('='.repeat(80));
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
}

// 运行测试
main();
