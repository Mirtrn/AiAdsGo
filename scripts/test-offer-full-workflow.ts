#!/usr/bin/env tsx
/**
 * 完整Offer创建流程测试
 * 测试内容:
 * 1. 用户登录认证
 * 2. 手动创建单个Offer
 * 3. 批量导入Offers
 * 4. 代理URL解析和匹配
 * 5. 品牌名提取
 * 6. Final URL/Suffix提取
 * 7. 反爬机制和网页抓取
 * 8. 性能分析
 */

import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'

const BASE_URL = 'http://localhost:3000'
const TEST_OFFERS = [
  { url: 'https://pboost.me/UKTs4I6', country: 'US', name: 'Reolink Store US' },
  { url: 'https://pboost.me/xEAgQ8ec', country: 'DE', name: 'Test Store DE' },
  { url: 'https://pboost.me/RKWwEZR9', country: 'US', name: 'Test Store US 2' },
  { url: 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=', country: 'US', name: 'YeahPromos' }
]

interface TestResult {
  testName: string
  success: boolean
  duration: number
  error?: string
  data?: any
}

const results: TestResult[] = []
let authCookie: string = ''

function logSection(title: string) {
  console.log('\n' + '━'.repeat(80))
  console.log(`📋 ${title}`)
  console.log('━'.repeat(80) + '\n')
}

function logSuccess(message: string) {
  console.log(`✅ ${message}`)
}

function logError(message: string) {
  console.log(`❌ ${message}`)
}

function logInfo(message: string) {
  console.log(`ℹ️  ${message}`)
}

async function testLogin(): Promise<boolean> {
  logSection('步骤1: 测试用户登录认证')
  const startTime = Date.now()

  try {
    logInfo('发送登录请求...')
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'autoads',
        password: '123456'  // 使用明文密码
      })
    })

    const setCookie = response.headers.get('set-cookie')
    if (setCookie) {
      authCookie = setCookie.split(';')[0]
      logInfo(`认证Cookie: ${authCookie.substring(0, 50)}...`)
    }

    const data: any = await response.json()
    const duration = Date.now() - startTime

    if (response.ok && data.success) {
      logSuccess(`登录成功: ${data.user?.username}`)
      logInfo(`用户ID: ${data.user?.id}`)
      logInfo(`用户角色: ${data.user?.role}`)
      logInfo(`耗时: ${duration}ms`)

      results.push({
        testName: '用户登录',
        success: true,
        duration,
        data: { userId: data.user?.id, username: data.user?.username }
      })
      return true
    } else {
      throw new Error(data.error || '登录失败')
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    logError(`登录失败: ${error.message}`)
    results.push({
      testName: '用户登录',
      success: false,
      duration,
      error: error.message
    })
    return false
  }
}

async function testCreateSingleOffer(offerData: typeof TEST_OFFERS[0]): Promise<string | null> {
  logSection(`步骤2: 手动创建单个Offer - ${offerData.name}`)
  const startTime = Date.now()

  try {
    logInfo(`推广链接: ${offerData.url}`)
    logInfo(`目标国家: ${offerData.country}`)

    // 步骤2.1: 提取Offer信息
    logInfo('\n🔍 步骤2.1: 提取Offer信息...')
    const extractStart = Date.now()
    const extractResponse = await fetch(`${BASE_URL}/api/offers/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': authCookie
      },
      body: JSON.stringify({
        affiliate_link: offerData.url,  // 🔥 修正：API期望的字段名
        target_country: offerData.country,  // 🔥 修正：API期望的字段名
        skipCache: true,
        batchMode: false
      })
    })

    if (!extractResponse.ok) {
      const errorData = await extractResponse.json()
      // 🔥 改进：输出完整错误信息
      console.error('提取API错误响应:', JSON.stringify(errorData, null, 2))
      throw new Error(`提取失败: ${errorData.message || errorData.error || extractResponse.statusText}`)
    }

    const extractData: any = await extractResponse.json()
    const extractDuration = Date.now() - extractStart

    // 🔥 调试：输出完整响应
    console.log('完整提取响应:', JSON.stringify(extractData, null, 2))

    logSuccess(`信息提取完成 (耗时: ${extractDuration}ms)`)
    logInfo(`  - 品牌名: ${extractData.data?.brand || 'undefined'}`)
    logInfo(`  - Final URL: ${extractData.data?.finalUrl || 'undefined'}`)
    logInfo(`  - URL Suffix: ${extractData.data?.finalUrlSuffix ? '✅ 已提取' : '❌ 未提取'}`)
    logInfo(`  - 产品数量: ${extractData.data?.productCount || 0}`)

    // 步骤2.2: 创建Offer记录
    logInfo('\n📝 步骤2.2: 创建Offer记录...')
    const createStart = Date.now()
    const createResponse = await fetch(`${BASE_URL}/api/offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': authCookie
      },
      body: JSON.stringify({
        // 🔥 修正：使用API期望的字段名
        url: extractData.data?.finalUrl || offerData.url,  // 必填：推广链接(优先使用解析后的Final URL)
        target_country: offerData.country,  // 必填：推广国家
        brand: extractData.data?.brand,  // 可选：品牌名称
        affiliate_link: offerData.url,  // 可选：原始推广链接
        target_language: 'en',  // 可选：目标语言
        final_url: extractData.data?.finalUrl,  // 可选：Final URL
        final_url_suffix: extractData.data?.finalUrlSuffix,  // 可选：Final URL Suffix
        product_price: '',  // 可选：产品价格
        commission_payout: ''  // 可选：佣金比例
      })
    })

    if (!createResponse.ok) {
      const errorData = await createResponse.json()
      throw new Error(`创建失败: ${errorData.error || createResponse.statusText}`)
    }

    const createData: any = await createResponse.json()
    const createDuration = Date.now() - createStart
    const totalDuration = Date.now() - startTime

    logSuccess(`Offer创建成功 (耗时: ${createDuration}ms)`)
    logInfo(`  - Offer ID: ${createData.id}`)
    logInfo(`  - 总耗时: ${totalDuration}ms`)

    results.push({
      testName: `创建Offer: ${offerData.name}`,
      success: true,
      duration: totalDuration,
      data: {
        offerId: createData.id,
        brand: extractData.brand,
        extractTime: extractDuration,
        createTime: createDuration,
        productCount: extractData.productCount
      }
    })

    return createData.id
  } catch (error: any) {
    const duration = Date.now() - startTime
    logError(`创建Offer失败: ${error.message}`)
    results.push({
      testName: `创建Offer: ${offerData.name}`,
      success: false,
      duration,
      error: error.message
    })
    return null
  }
}

async function testBatchImport(): Promise<void> {
  logSection('步骤3: 测试批量导入Offers')
  const startTime = Date.now()

  try {
    logInfo('准备批量导入数据...')
    // 🔥 修正：使用API期望的字段名
    const batchData = TEST_OFFERS.map(offer => ({
      affiliate_link: offer.url,
      target_country: offer.country,
      product_price: '',  // 可选字段
      commission_payout: ''  // 可选字段
    }))

    logInfo(`批量导入 ${batchData.length} 个Offers`)

    const response = await fetch(`${BASE_URL}/api/offers/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': authCookie
      },
      body: JSON.stringify({ offers: batchData })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`批量导入失败: ${errorData.error || response.statusText}`)
    }

    const data: any = await response.json()
    const duration = Date.now() - startTime

    logSuccess(`批量导入完成 (耗时: ${duration}ms)`)
    logInfo(`  - 总数: ${data.summary?.total || 0}`)
    logInfo(`  - 成功: ${data.summary?.success || 0}`)
    logInfo(`  - 失败: ${data.summary?.failed || 0}`)

    // 🔥 修正：API返回的是results数组，每项包含success, row, offer/error
    if (data.results && Array.isArray(data.results)) {
      const successfulResults = data.results.filter((r: any) => r.success)
      const failedResults = data.results.filter((r: any) => !r.success)

      if (successfulResults.length > 0) {
        logInfo('\n✅ 成功创建的Offers:')
        successfulResults.forEach((result: any) => {
          logInfo(`  ${result.row}. ID=${result.offer?.id}, 国家=${result.offer?.target_country}`)
        })
      }

      if (failedResults.length > 0) {
        logInfo('\n❌ 失败的Offers:')
        failedResults.forEach((result: any) => {
          logError(`  ${result.row}. ${result.error}`)
        })
      }
    }

    results.push({
      testName: '批量导入Offers',
      success: true,
      duration,
      data: {
        total: data.summary?.total || 0,
        successCount: data.summary?.success || 0,
        failedCount: data.summary?.failed || 0
      }
    })
  } catch (error: any) {
    const duration = Date.now() - startTime
    logError(`批量导入失败: ${error.message}`)
    results.push({
      testName: '批量导入Offers',
      success: false,
      duration,
      error: error.message
    })
  }
}

async function testProxyAndUrlResolution(offerId: string): Promise<void> {
  logSection(`步骤4: 测试代理解析和URL重定向 (Offer: ${offerId})`)
  const startTime = Date.now()

  try {
    logInfo('发送URL解析请求...')
    const response = await fetch(`${BASE_URL}/api/offers/${offerId}/resolve-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': authCookie
      }
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`URL解析失败: ${errorData.error || response.statusText}`)
    }

    const data: any = await response.json()
    const duration = Date.now() - startTime

    logSuccess(`URL解析完成 (耗时: ${duration}ms)`)
    logInfo(`  - Final URL: ${data.finalUrl}`)
    logInfo(`  - URL Suffix: ${data.finalUrlSuffix ? '✅' : '❌'}`)
    logInfo(`  - 重定向次数: ${data.redirectCount || 0}`)
    logInfo(`  - 使用代理: ${data.proxyUsed || 'N/A'}`)

    results.push({
      testName: `URL解析 (Offer ${offerId})`,
      success: true,
      duration,
      data: {
        finalUrl: data.finalUrl,
        hasSuffix: !!data.finalUrlSuffix,
        redirectCount: data.redirectCount
      }
    })
  } catch (error: any) {
    const duration = Date.now() - startTime
    logError(`URL解析失败: ${error.message}`)
    results.push({
      testName: `URL解析 (Offer ${offerId})`,
      success: false,
      duration,
      error: error.message
    })
  }
}

async function testDataScraping(offerId: string): Promise<void> {
  logSection(`步骤5: 测试网页数据抓取 (Offer: ${offerId})`)
  const startTime = Date.now()

  try {
    logInfo('发送数据抓取请求...')
    const response = await fetch(`${BASE_URL}/api/offers/${offerId}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': authCookie
      }
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`数据抓取失败: ${errorData.error || response.statusText}`)
    }

    const data: any = await response.json()
    const duration = Date.now() - startTime

    logSuccess(`数据抓取完成 (耗时: ${duration}ms)`)
    logInfo(`  - 品牌名: ${data.brand}`)
    logInfo(`  - 产品数量: ${data.productCount || 0}`)
    logInfo(`  - Store名称: ${data.storeName || 'N/A'}`)

    if (data.products && data.products.length > 0) {
      logInfo(`\n  前3个热销商品:`)
      data.products.slice(0, 3).forEach((p: any, i: number) => {
        logInfo(`    ${i + 1}. ${p.name?.substring(0, 60)}...`)
        logInfo(`       价格: ${p.price}, 评分: ${p.rating}⭐ (${p.reviewCount} 评论)`)
      })
    }

    results.push({
      testName: `数据抓取 (Offer ${offerId})`,
      success: true,
      duration,
      data: {
        brand: data.brand,
        productCount: data.productCount,
        storeName: data.storeName
      }
    })
  } catch (error: any) {
    const duration = Date.now() - startTime
    logError(`数据抓取失败: ${error.message}`)
    results.push({
      testName: `数据抓取 (Offer ${offerId})`,
      success: false,
      duration,
      error: error.message
    })
  }
}

function generatePerformanceReport(): void {
  logSection('性能分析报告')

  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`📊 测试总结:`)
  console.log(`  - 总测试数: ${results.length}`)
  console.log(`  - 成功: ${successful.length} ✅`)
  console.log(`  - 失败: ${failed.length} ❌`)
  console.log(`  - 成功率: ${((successful.length / results.length) * 100).toFixed(1)}%`)

  if (successful.length > 0) {
    const totalDuration = successful.reduce((sum, r) => sum + r.duration, 0)
    const avgDuration = totalDuration / successful.length
    const maxDuration = Math.max(...successful.map(r => r.duration))
    const minDuration = Math.min(...successful.map(r => r.duration))

    console.log(`\n⏱️  性能指标:`)
    console.log(`  - 总耗时: ${(totalDuration / 1000).toFixed(2)}秒`)
    console.log(`  - 平均耗时: ${(avgDuration / 1000).toFixed(2)}秒`)
    console.log(`  - 最长耗时: ${(maxDuration / 1000).toFixed(2)}秒`)
    console.log(`  - 最短耗时: ${(minDuration / 1000).toFixed(2)}秒`)
  }

  console.log(`\n📋 详细结果:`)
  results.forEach((result, index) => {
    const icon = result.success ? '✅' : '❌'
    console.log(`  ${index + 1}. ${icon} ${result.testName} (${(result.duration / 1000).toFixed(2)}s)`)
    if (result.error) {
      console.log(`     错误: ${result.error}`)
    }
  })

  console.log(`\n🔍 优化建议:`)

  // 分析URL解析性能
  const urlResolveTests = results.filter(r => r.testName.includes('URL解析'))
  if (urlResolveTests.length > 0) {
    const avgResolveTime = urlResolveTests.reduce((sum, r) => sum + r.duration, 0) / urlResolveTests.length
    if (avgResolveTime > 30000) {
      console.log(`  ⚠️  URL解析平均耗时 ${(avgResolveTime / 1000).toFixed(1)}秒，建议:`)
      console.log(`     - 优化代理IP质量和响应速度`)
      console.log(`     - 实现智能代理选择算法`)
      console.log(`     - 增加URL解析缓存机制`)
    }
  }

  // 分析数据抓取性能
  const scrapeTests = results.filter(r => r.testName.includes('数据抓取'))
  if (scrapeTests.length > 0) {
    const avgScrapeTime = scrapeTests.reduce((sum, r) => sum + r.duration, 0) / scrapeTests.length
    if (avgScrapeTime > 60000) {
      console.log(`  ⚠️  数据抓取平均耗时 ${(avgScrapeTime / 1000).toFixed(1)}秒，建议:`)
      console.log(`     - 优化Playwright等待策略`)
      console.log(`     - 减少不必要的DOM操作`)
      console.log(`     - 实现分阶段加载策略`)
    }
  }

  // 分析批量处理性能
  const batchTests = results.filter(r => r.testName.includes('批量'))
  if (batchTests.length > 0 && batchTests[0].data) {
    const successCount = batchTests[0].data.successCount
    const duration = batchTests[0].duration
    const perOfferTime = duration / successCount

    if (perOfferTime > 30000) {
      console.log(`  ⚠️  批量处理单个Offer平均耗时 ${(perOfferTime / 1000).toFixed(1)}秒，建议:`)
      console.log(`     - 实现真正的并发处理（当前可能是串行）`)
      console.log(`     - 使用Promise.all进行批量并发`)
      console.log(`     - 限制并发数量避免资源耗尽`)
    }
  }

  console.log(`\n💡 通用优化建议:`)
  console.log(`  1. 代理池优化: 增加高质量代理，实现智能路由`)
  console.log(`  2. 缓存机制: URL解析结果缓存，减少重复请求`)
  console.log(`  3. 并发控制: 实现可配置的并发数量和限流`)
  console.log(`  4. 错误处理: 增加重试机制和降级策略`)
  console.log(`  5. 监控告警: 实时监控性能指标和异常情况`)
}

async function main() {
  console.log('🚀 开始完整Offer创建流程测试')
  console.log(`测试时间: ${new Date().toLocaleString('zh-CN')}`)
  console.log(`服务地址: ${BASE_URL}`)
  console.log(`测试Offer数量: ${TEST_OFFERS.length}`)

  try {
    // 步骤1: 登录
    const loginSuccess = await testLogin()
    if (!loginSuccess) {
      throw new Error('登录失败，终止测试')
    }

    // 步骤2: 创建单个Offer
    const firstOfferId = await testCreateSingleOffer(TEST_OFFERS[0])

    // 步骤3: 批量导入
    await testBatchImport()

    // 步骤4: 测试代理和URL解析
    if (firstOfferId) {
      await testProxyAndUrlResolution(firstOfferId)

      // 步骤5: 测试数据抓取
      await testDataScraping(firstOfferId)
    }

    // 生成性能报告
    generatePerformanceReport()

    // 保存测试结果
    const reportPath = path.join(process.cwd(), 'storage', `test-report-${Date.now()}.json`)
    fs.writeFileSync(reportPath, JSON.stringify({
      testTime: new Date().toISOString(),
      summary: {
        total: results.length,
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      },
      results
    }, null, 2))

    logSuccess(`\n测试报告已保存: ${reportPath}`)

  } catch (error: any) {
    logError(`\n测试过程出错: ${error.message}`)
    process.exit(1)
  }
}

// 运行测试
main().catch(error => {
  console.error('测试脚本执行失败:', error)
  process.exit(1)
})
