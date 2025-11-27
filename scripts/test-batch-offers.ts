#!/usr/bin/env npx tsx

/**
 * 批量测试4个Offer URLs的完整抓取流程
 * 测试目标：
 * 1. 批量创建4个Offers
 * 2. 监控每个Offer的抓取进度
 * 3. 记录性能指标
 * 4. 生成测试报告
 */

const API_BASE = 'http://localhost:3000'

// 测试URLs
const TEST_OFFERS = [
  { url: 'https://pboost.me/UKTs4I6', country: 'US', brand: 'Unknown' },
  { url: 'https://pboost.me/xEAgQ8ec', country: 'DE', brand: 'Unknown' },
  { url: 'https://pboost.me/RKWwEZR9', country: 'US', brand: 'Unknown' },
  { url: 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=', country: 'US', brand: 'Unknown' }
]

let authCookie = ''

interface OfferResult {
  id: number
  url: string
  country: string
  createTime: number
  scrapeTime: number | null
  status: string
  brand: string
  finalUrl: string
  error: string | null
}

async function login() {
  console.log('🔐 登录系统...')
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'autoads',
      password: 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk='
    })
  })

  if (!response.ok) {
    throw new Error('登录失败')
  }

  const setCookieHeader = response.headers.get('set-cookie')
  const match = setCookieHeader?.match(/auth_token=([^;]+)/)
  if (match) {
    authCookie = `auth_token=${match[1]}`
  }

  console.log('✅ 登录成功\n')
}

async function createOffer(offer: typeof TEST_OFFERS[0]): Promise<{ id: number, createTime: number }> {
  const startTime = Date.now()

  const response = await fetch(`${API_BASE}/api/offers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': authCookie
    },
    body: JSON.stringify({
      url: offer.url,
      target_country: offer.country
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`创建失败: ${JSON.stringify(error)}`)
  }

  const data = await response.json() as any
  const createTime = Date.now() - startTime

  return {
    id: data.id || data.offer?.id,
    createTime
  }
}

async function monitorOffer(offerId: number, maxWaitSec: number = 180): Promise<OfferResult | null> {
  const startTime = Date.now()
  const pollInterval = 3000

  let lastStatus = ''

  while (true) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)

    if (elapsed > maxWaitSec) {
      return null // 超时
    }

    try {
      const response = await fetch(`${API_BASE}/api/offers/${offerId}`, {
        headers: { 'Cookie': authCookie }
      })

      const data = await response.json() as any

      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
        continue
      }

      const status = data.scrape_status || data.scrapeStatus || 'unknown'
      const brand = data.brand_name || data.brand || 'Unknown'

      // 只在状态变化时输出
      if (status !== lastStatus) {
        const statusEmoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : status === 'in_progress' ? '🔄' : '⏳'
        console.log(`  [Offer #${offerId}] ${statusEmoji} ${status} | 品牌: ${brand} | ${elapsed}s`)
        lastStatus = status
      }

      // 完成或失败
      if (status === 'completed' || status === 'failed') {
        return {
          id: offerId,
          url: data.url,
          country: data.target_country || data.targetCountry,
          createTime: 0, // 稍后填充
          scrapeTime: elapsed,
          status,
          brand: data.brand || 'Unknown',
          finalUrl: data.final_url || data.finalUrl || '',
          error: data.scrape_error || data.scrapeError || null
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))

    } catch (error: any) {
      console.log(`  ⚠️  查询异常: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
  }
}

async function main() {
  console.log('🚀 批量测试Offer抓取流程')
  console.log(`测试时间: ${new Date().toISOString()}`)
  console.log(`测试数量: ${TEST_OFFERS.length} 个Offers`)
  console.log('='.repeat(80))
  console.log('')

  try {
    await login()

    const results: OfferResult[] = []

    // 批量创建Offers
    console.log('📝 批量创建Offers...\n')
    const createPromises = TEST_OFFERS.map(async (offer, index) => {
      try {
        console.log(`  [${index + 1}/${TEST_OFFERS.length}] 创建: ${offer.url} (${offer.country})`)
        const { id, createTime } = await createOffer(offer)
        console.log(`  ✅ Offer #${id} 创建完成 (${createTime}ms)\n`)
        return { id, createTime, offer }
      } catch (error: any) {
        console.log(`  ❌ 创建失败: ${error.message}\n`)
        return null
      }
    })

    const createResults = await Promise.all(createPromises)
    const validResults = createResults.filter(r => r !== null) as Array<{ id: number, createTime: number, offer: typeof TEST_OFFERS[0] }>

    if (validResults.length === 0) {
      console.log('❌ 没有成功创建任何Offer')
      return
    }

    console.log('')
    console.log('🕷️  开始监控抓取进度...')
    console.log('='.repeat(80))
    console.log('')

    // 并行监控所有Offers
    const monitorPromises = validResults.map(async ({ id, createTime, offer }) => {
      const result = await monitorOffer(id, 180)
      if (result) {
        result.createTime = createTime
        return result
      } else {
        return {
          id,
          url: offer.url,
          country: offer.country,
          createTime,
          scrapeTime: null,
          status: 'timeout',
          brand: 'Unknown',
          finalUrl: '',
          error: '超时未完成'
        }
      }
    })

    const finalResults = await Promise.all(monitorPromises)

    // 生成报告
    console.log('')
    console.log('='.repeat(80))
    console.log('📊 测试完成 - 结果汇总')
    console.log('='.repeat(80))
    console.log('')

    let successCount = 0
    let failedCount = 0
    let timeoutCount = 0
    let totalCreateTime = 0
    let totalScrapeTime = 0

    finalResults.forEach((result, index) => {
      console.log(`${index + 1}. Offer #${result.id} [${result.country}]`)
      console.log(`   URL: ${result.url}`)
      console.log(`   状态: ${result.status === 'completed' ? '✅ 成功' : result.status === 'failed' ? '❌ 失败' : '⏱️  超时'}`)
      console.log(`   品牌: ${result.brand}`)
      if (result.finalUrl) {
        console.log(`   Final URL: ${result.finalUrl.substring(0, 60)}${result.finalUrl.length > 60 ? '...' : ''}`)
      }
      console.log(`   创建耗时: ${result.createTime}ms`)
      if (result.scrapeTime !== null) {
        console.log(`   抓取耗时: ${result.scrapeTime}s`)
      }
      if (result.error) {
        console.log(`   错误: ${result.error.substring(0, 100)}`)
      }
      console.log('')

      if (result.status === 'completed') {
        successCount++
        totalScrapeTime += result.scrapeTime || 0
      } else if (result.status === 'failed') {
        failedCount++
      } else {
        timeoutCount++
      }

      totalCreateTime += result.createTime
    })

    console.log('='.repeat(80))
    console.log('📈 性能统计')
    console.log('='.repeat(80))
    console.log(`成功: ${successCount}/${finalResults.length}`)
    console.log(`失败: ${failedCount}/${finalResults.length}`)
    console.log(`超时: ${timeoutCount}/${finalResults.length}`)
    console.log(`平均创建时间: ${Math.round(totalCreateTime / finalResults.length)}ms`)
    if (successCount > 0) {
      console.log(`平均抓取时间: ${Math.round(totalScrapeTime / successCount)}s`)
    }
    console.log('='.repeat(80))

    // 保存结果到JSON
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        total: finalResults.length,
        success: successCount,
        failed: failedCount,
        timeout: timeoutCount,
        avgCreateTime: Math.round(totalCreateTime / finalResults.length),
        avgScrapeTime: successCount > 0 ? Math.round(totalScrapeTime / successCount) : null
      },
      results: finalResults
    }

    const fs = await import('fs/promises')
    const reportPath = `/Users/jason/Documents/Kiro/autobb/storage/batch-test-report-${Date.now()}.json`
    await fs.writeFile(reportPath, JSON.stringify(reportData, null, 2))
    console.log(`📄 详细报告已保存: ${reportPath}`)

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

main()
