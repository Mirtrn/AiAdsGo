#!/usr/bin/env npx tsx

import { chromium } from 'playwright'

async function testYeahPromosUrl() {
  const url = 'https://yeahpromos.com/index/index/openurl?track=606a814910875990&url='

  console.log('🔍 测试URL:', url)
  console.log('━'.repeat(80))

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
  })
  const page = await context.newPage()

  try {
    console.log('📡 访问URL...')
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })

    console.log('✅ 响应状态:', response?.status())
    console.log('📍 最终URL:', page.url())

    // 等待页面加载
    await page.waitForTimeout(3000)

    const title = await page.title()
    console.log('📄 页面标题:', title)

    const content = await page.content()
    console.log('📦 内容长度:', content.length, '字符')

    // 提取可见文本
    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    console.log('📝 可见文本长度:', bodyText.length, '字符')
    console.log('━'.repeat(80))
    console.log('前500字符:')
    console.log(bodyText.substring(0, 500))
    console.log('━'.repeat(80))

    // 检查是否有重定向或跳转
    const redirectChain = response?.request().redirectedFrom() ? 'Yes' : 'No'
    console.log('🔄 是否有重定向:', redirectChain)

    // 截图
    await page.screenshot({ path: '/tmp/yeahpromos-test.png' })
    console.log('📸 截图已保存: /tmp/yeahpromos-test.png')

  } catch (error: any) {
    console.error('❌ 错误:', error.message)
  } finally {
    await browser.close()
  }
}

testYeahPromosUrl()
