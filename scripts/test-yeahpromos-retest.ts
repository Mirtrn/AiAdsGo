#!/usr/bin/env npx tsx

const API_BASE = 'http://localhost:3000'
let authCookie = ''

async function login() {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'autoads',
      password: 'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk='
    })
  })

  const setCookieHeader = response.headers.get('set-cookie')
  const match = setCookieHeader?.match(/auth_token=([^;]+)/)
  if (match) {
    authCookie = `auth_token=${match[1]}`
  }

  console.log('✅ 登录成功\n')
}

async function createOffer(url: string, country: string) {
  console.log(`📝 创建Offer: ${url} (${country})`)

  const response = await fetch(`${API_BASE}/api/offers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': authCookie
    },
    body: JSON.stringify({
      url,
      target_country: country
    })
  })

  const data = await response.json() as any
  const offerId = data.id || data.offer?.id

  console.log(`✅ Offer已创建 (ID: ${offerId})\n`)

  return offerId
}

async function monitorOffer(offerId: number) {
  console.log(`🕷️  监控Offer #${offerId} 的抓取进度`)
  console.log('='.repeat(80))

  const startTime = Date.now()
  const pollInterval = 3000

  while (true) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)

    if (elapsed > 120) {
      console.log('⏱️  超时')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/api/offers/${offerId}`, {
        headers: { 'Cookie': authCookie }
      })

      const data = await response.json() as any

      const status = data.scrape_status || data.scrapeStatus || 'unknown'
      const brand = data.brand || 'Unknown'

      const statusEmoji = status === 'completed' ? '✅' : status === 'failed' ? '❌' : status === 'in_progress' ? '🔄' : '⏳'
      console.log(`[${elapsed}s] ${statusEmoji} ${status} | 品牌: ${brand}`)

      if (status === 'completed' || status === 'failed') {
        console.log('\n' + '='.repeat(80))
        console.log('📊 最终结果:')
        console.log(`   品牌: ${data.brand || 'Unknown'}`)
        console.log(`   Final URL: ${(data.final_url || data.finalUrl || '').substring(0, 80)}`)
        console.log(`   分类: ${data.category || 'N/A'}`)
        console.log(`   描述: ${(data.brand_description || data.brandDescription || '').substring(0, 200)}...`)
        console.log('='.repeat(80))
        return
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))

    } catch (error: any) {
      console.log(`⚠️  查询异常: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
  }
}

async function main() {
  console.log('🚀 重新测试YeahPromos URL')
  console.log('='.repeat(80))
  console.log('')

  await login()

  const offerId = await createOffer(
    'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url=',
    'US'
  )

  await monitorOffer(offerId)
}

main()
