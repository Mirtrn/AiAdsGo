#!/usr/bin/env npx tsx

import { chromium } from 'playwright'
import fetch from 'node-fetch'

// 获取代理IP
async function getProxyIp() {
  const proxyUrl = 'https://api.iprocket.io/api?username=com49692430&password=Qxi9V59e3kNOW6pnRi3i&cc=US&ips=1&type=-res-&proxyType=http&responseType=txt'

  const response = await fetch(proxyUrl)
  const text = await response.text()

  // 解析格式: host:port:username:password
  const [host, port, username, password] = text.trim().split(':')

  return {
    server: `http://${host}:${port}`,
    username,
    password
  }
}

async function testYeahPromosWithProxy() {
  const url = 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url='

  console.log('🔍 测试URL:', url)
  console.log('━'.repeat(80))

  console.log('📡 获取代理IP...')
  const proxy = await getProxyIp()
  console.log('✅ 代理:', proxy.server)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    proxy: proxy
  })

  const page = await context.newPage()

  try {
    console.log('🌐 通过代理访问URL...')

    // 记录所有请求
    const redirects: string[] = [url]
    page.on('response', async (response) => {
      const currentUrl = response.url()
      if (!redirects.includes(currentUrl)) {
        redirects.push(currentUrl)
      }
    })

    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    })

    console.log('✅ 响应状态:', response?.status())
    console.log('📍 最终URL:', page.url())
    console.log('🔄 重定向链:', redirects.join(' → '))

    const title = await page.title()
    console.log('📄 页面标题:', title)

    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    console.log('📝 可见文本长度:', bodyText.length, '字符')
    console.log('━'.repeat(80))
    console.log('前1000字符:')
    console.log(bodyText.substring(0, 1000))
    console.log('━'.repeat(80))

    // 尝试提取品牌信息
    const brandCandidates = await page.evaluate(() => {
      const candidates: string[] = []

      // 尝试从标题提取
      const title = document.title
      if (title) candidates.push(`Title: ${title}`)

      // 尝试从meta标签提取
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
      if (ogTitle) candidates.push(`OG:Title: ${ogTitle}`)

      const metaTitle = document.querySelector('meta[name="title"]')?.getAttribute('content')
      if (metaTitle) candidates.push(`Meta:Title: ${metaTitle}`)

      // 尝试从h1提取
      const h1 = document.querySelector('h1')?.textContent?.trim()
      if (h1) candidates.push(`H1: ${h1}`)

      return candidates
    })

    console.log('🔍 品牌候选信息:')
    brandCandidates.forEach(c => console.log('  -', c))

    // 截图
    await page.screenshot({ path: '/tmp/yeahpromos-proxy-test.png', fullPage: true })
    console.log('📸 完整截图已保存: /tmp/yeahpromos-proxy-test.png')

  } catch (error: any) {
    console.error('❌ 错误:', error.message)
  } finally {
    await browser.close()
  }
}

testYeahPromosWithProxy()
