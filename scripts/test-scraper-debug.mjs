/**
 * 调试版 - 打印原始 HTML 诊断 Amazon 返回内容
 */
import axios from 'axios'
import { load } from 'cheerio'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

async function fetchHtml(url) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      maxRedirects: 10,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
    })
    return { html: response.data, status: response.status, finalUrl: response.request?.res?.responseUrl || url }
  } catch (err) {
    if (err.response) {
      return { html: err.response.data, status: err.response.status, finalUrl: url, error: err.message }
    }
    throw err
  }
}

async function run() {
  // 1. 测试单品页
  console.log('=' .repeat(70))
  console.log('🔍 诊断：Amazon 单品页')
  const productUrl = 'https://www.amazon.com/DREO-Tower-Fan-Oscillating-Bladeless/dp/B0BNQ9ZFHX'
  console.log('URL:', productUrl)
  
  try {
    const { html, status, finalUrl } = await fetchHtml(productUrl)
    const $ = load(html)
    const title = $('title').text().trim()
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()

    console.log(`HTTP 状态: ${status}`)
    console.log(`最终 URL: ${finalUrl}`)
    console.log(`HTML 大小: ${(html.length / 1024).toFixed(1)}KB`)
    console.log(`页面标题: "${title}"`)
    console.log()
    console.log('--- HTML 前 2000 字符 ---')
    console.log(html.slice(0, 2000))
    console.log()
    console.log('--- body 文本前 500 字符 ---')
    console.log(bodyText.slice(0, 500))
    console.log()
    
    // 检查关键元素
    console.log('关键元素检查:')
    console.log('  #productTitle 存在:', $('#productTitle').length > 0)
    console.log('  #feature-bullets 存在:', $('#feature-bullets').length > 0)
    console.log('  #landingImage 存在:', $('#landingImage').length > 0)
    console.log('  #bylineInfo 存在:', $('#bylineInfo').length > 0)
    console.log('  .a-price 存在:', $('.a-price').length > 0)
    console.log('  是否含 "captcha":', html.toLowerCase().includes('captcha'))
    console.log('  是否含 "robot":', html.toLowerCase().includes('robot'))
    console.log('  是否含 "verify":', html.toLowerCase().includes('verify'))
  } catch (err) {
    console.error('❌ 请求失败:', err.message)
  }
}

run()
