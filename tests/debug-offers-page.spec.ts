import { test, expect } from '@playwright/test'

test.describe('Debug Offers Page Data Issue', () => {
  test.setTimeout(120000)

  test('Debug why Offers page shows no data', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()))
    page.on('pageerror', error => console.log('BROWSER ERROR:', error.message))

    console.log('\n========== Step 1: Login ==========')
    await page.goto('http://localhost:3000/login')
    await page.fill('input[type="email"]', 'admin@autoads.local')
    await page.fill('input[type="password"]', '***REMOVED***')

    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(dashboard|offers)/, { timeout: 10000 })

    console.log('✅ Login successful')

    // Check if auth_token is stored
    const authToken = await page.evaluate(() => localStorage.getItem('auth_token'))
    console.log('Auth token in localStorage:', authToken ? 'EXISTS' : 'MISSING')

    console.log('\n========== Step 2: Navigate to Offers Page ==========')

    // Listen to network requests
    page.on('request', request => {
      if (request.url().includes('/api/offers')) {
        console.log('API REQUEST:', request.method(), request.url())
        console.log('Request headers:', request.headers())
      }
    })

    page.on('response', async response => {
      if (response.url().includes('/api/offers')) {
        console.log('API RESPONSE:', response.status(), response.url())
        try {
          const body = await response.json()
          console.log('Response body:', JSON.stringify(body, null, 2))
        } catch (e) {
          console.log('Could not parse response as JSON')
        }
      }
    })

    await page.goto('http://localhost:3000/offers')
    await page.waitForTimeout(3000) // Wait for API calls

    console.log('\n========== Step 3: Check Page Content ==========')

    // Take screenshot
    await page.screenshot({ path: '/tmp/offers-page-debug.png', fullPage: true })
    console.log('Screenshot saved to /tmp/offers-page-debug.png')

    // Check table existence
    const hasTable = await page.locator('table').count() > 0
    console.log('Has table element:', hasTable)

    // Check tbody rows
    const rowCount = await page.locator('table tbody tr').count()
    console.log('Table row count:', rowCount)

    // Get page HTML for debugging
    const bodyHTML = await page.locator('body').innerHTML()
    console.log('Page contains "Offer":', bodyHTML.includes('Offer'))
    console.log('Page contains "没有数据" or "暂无":',
      bodyHTML.includes('没有数据') || bodyHTML.includes('暂无'))

    // Check for loading state
    const isLoading = await page.locator('text=/加载|Loading/i').count() > 0
    console.log('Page showing loading state:', isLoading)

    // Check for error messages
    const hasError = await page.locator('text=/错误|Error|失败/i').count() > 0
    console.log('Page showing error:', hasError)

    console.log('\n========== Step 4: Manual API Test ==========')

    // Try fetching data directly with JavaScript
    const apiResult = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token')
      try {
        const response = await fetch('/api/offers', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        const data = await response.json()
        return {
          status: response.status,
          data: data
        }
      } catch (error) {
        return {
          error: error.message
        }
      }
    })

    console.log('Direct API fetch result:', JSON.stringify(apiResult, null, 2))

    console.log('\n========== Analysis Complete ==========')
  })
})
