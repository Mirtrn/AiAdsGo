/**
 * 测试单个Offer的完整抓取流程
 */

import fetch from 'node-fetch'

const API_BASE = 'http://localhost:3000'
let authCookie: string = ''

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

  const setCookieHeader = response.headers.get('set-cookie')
  if (setCookieHeader) {
    const match = setCookieHeader.match(/auth_token=([^;]+)/)
    if (match) {
      authCookie = `auth_token=${match[1]}`
      console.log('✅ 登录成功\n')
      return true
    }
  }
  return false
}

async function createOffer(url: string, country: string) {
  console.log(`📝 创建Offer: ${url} (${country})`)
  const startTime = Date.now()

  const response = await fetch(`${API_BASE}/api/offers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': authCookie
    },
    body: JSON.stringify({ url, target_country: country })
  })

  const data = await response.json() as any
  const duration = Date.now() - startTime

  if (!response.ok) {
    console.error(`❌ 创建失败: ${data.error}`)
    return null
  }

  const offerId = data.offer?.id || data.id
  console.log(`✅ Offer已创建 (ID: ${offerId}, 耗时: ${duration}ms)`)
  console.log(`   URL: ${data.offer?.url || data.url}`)
  console.log(`   状态: ${data.offer?.scrapeStatus || data.offer?.scrape_status || 'pending'}`)
  console.log('')
  return offerId
}

async function monitorScraping(offerId: number, maxWaitSec: number = 120) {
  console.log(`🕷️  监控Offer #${offerId} 的抓取进度 (最多等待${maxWaitSec}秒)`)
  console.log('=' .repeat(80))

  const startTime = Date.now()
  let attempts = 0
  const pollInterval = 3000 // 3秒轮询一次

  while (true) {
    attempts++
    const elapsed = Math.floor((Date.now() - startTime) / 1000)

    if (elapsed > maxWaitSec) {
      console.log(`\n⏱️  超时: 等待了${elapsed}秒`)
      return false
    }

    try {
      const response = await fetch(`${API_BASE}/api/offers/${offerId}`, {
        headers: { 'Cookie': authCookie }
      })

      const data = await response.json() as any

      if (!response.ok) {
        console.log(`❌ 查询失败: ${data.error}`)
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
        continue
      }

      const status = data.scrape_status || data.scrapeStatus || 'unknown'
      const brand = data.brand_name || data.brand || 'Unknown'
      const finalUrl = data.final_url || data.finalUrl || ''
      const error = data.scrape_error || data.scrapeError || ''

      // 显示进度
      const statusEmoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : status === 'in_progress' ? '🔄' : '⏳'
      console.log(`[${String(attempts).padStart(3)}] ${statusEmoji} ${String(status).padEnd(12)} | 品牌: ${String(brand).padEnd(15)} | 耗时: ${elapsed}s`)

      // 完成状态
      if (status === 'completed') {
        console.log('\n' + '='.repeat(80))
        console.log('✅ 抓取完成！')
        console.log('')
        console.log('📊 抓取结果:')
        console.log(`   品牌名称: ${data.brand_name || data.brand}`)
        console.log(`   目标国家: ${data.target_country || data.targetCountry}`)
        console.log(`   Final URL: ${(finalUrl || '').substring(0, 80)}${(finalUrl || '').length > 80 ? '...' : ''}`)
        console.log(`   Final URL Suffix: ${(data.final_url_suffix || data.finalUrlSuffix || '').substring(0, 60)}${(data.final_url_suffix || data.finalUrlSuffix || '').length > 60 ? '...' : ''}`)
        console.log(`   描述: ${(data.description || '').substring(0, 100)}${(data.description || '').length > 100 ? '...' : ''}`)
        console.log(`   抓取时间: ${data.scraped_at || data.scrapedAt || '未知'}`)
        console.log(`   总耗时: ${elapsed}秒`)
        console.log('=' .repeat(80))
        return true
      }

      // 失败状态
      if (status === 'failed') {
        console.log('\n' + '='.repeat(80))
        console.log('❌ 抓取失败！')
        console.log(`   错误信息: ${error || '未知错误'}`)
        console.log(`   总耗时: ${elapsed}秒`)
        console.log('='.repeat(80))
        return false
      }

      // 继续等待
      await new Promise((resolve) => setTimeout(resolve, pollInterval))

    } catch (error: any) {
      console.log(`❌ 查询异常: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
  }
}

async function main() {
  console.log('🚀 开始测试Offer抓取流程')
  console.log('测试时间:', new Date().toISOString())
  console.log('='.repeat(80))
  console.log('')

  // 1. 登录
  if (!await login()) {
    console.error('登录失败，终止测试')
    return
  }

  // 2. 创建Offer
  const offerId = await createOffer('https://pboost.me/xEAgQ8ec', 'DE')
  if (!offerId) {
    console.error('创建Offer失败，终止测试')
    return
  }

  // 3. 监控抓取
  const success = await monitorScraping(offerId, 120)

  if (success) {
    console.log('\n✅ 测试完成 - 抓取成功')
  } else {
    console.log('\n❌ 测试完成 - 抓取失败或超时')
  }
}

main().catch((error) => {
  console.error('❌ 测试失败:', error)
  process.exit(1)
})
