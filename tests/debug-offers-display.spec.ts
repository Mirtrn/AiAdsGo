import { test, expect } from '@playwright/test'

test.describe('Debug Offers Display Issue', () => {
  test.setTimeout(60000)

  test('Detailed debugging of Offers page', async ({ page }) => {
    // Enable console and error logging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[BROWSER ${msg.type().toUpperCase()}]:`, msg.text())
      }
    })
    page.on('pageerror', error => {
      console.log('[PAGE ERROR]:', error.message)
    })

    // Monitor network requests
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`[REQUEST] ${request.method()} ${request.url()}`)
      }
    })

    page.on('response', async response => {
      if (response.url().includes('/api/')) {
        console.log(`[RESPONSE] ${response.status()} ${response.url()}`)
        if (response.url().includes('/api/offers')) {
          try {
            const body = await response.text()
            console.log('[OFFERS API RESPONSE]:', body)
          } catch (e) {
            console.log('[Could not read response body]')
          }
        }
      }
    })

    console.log('\n========== Step 1: Login ==========')
    await page.goto('http://localhost:3000/login')
    await page.waitForLoadState('networkidle')

    await page.fill('input[name="username"]', 'autoads')
    await page.fill('input[name="password"]', '***REMOVED***')
    await page.click('button[type="submit"]')

    await page.waitForURL(/\/(dashboard|offers)/, { timeout: 10000 })
    console.log('✅ Login successful')

    // Check localStorage token
    const token = await page.evaluate(() => localStorage.getItem('auth_token'))
    console.log('Auth token exists:', token ? 'YES' : 'NO')

    console.log('\n========== Step 2: Navigate to Offers ==========')
    await page.goto('http://localhost:3000/offers')
    await page.waitForLoadState('networkidle')

    // Wait for React to render
    await page.waitForTimeout(2000)

    console.log('\n========== Step 3: Check Page State ==========')

    // Check loading state
    const loadingVisible = await page.locator('text=加载中').isVisible().catch(() => false)
    console.log('Loading indicator visible:', loadingVisible)

    // Check error messages
    const errorVisible = await page.locator('text=/错误|失败/').isVisible().catch(() => false)
    console.log('Error message visible:', errorVisible)

    // Check table structure
    const hasTable = await page.locator('table').count()
    console.log('Table elements found:', hasTable)

    const hasThead = await page.locator('table thead').count()
    console.log('Table head elements:', hasThead)

    const hasTbody = await page.locator('table tbody').count()
    console.log('Table body elements:', hasTbody)

    const rowCount = await page.locator('table tbody tr').count()
    console.log('Table rows found:', rowCount)

    // Check if "no data" message
    const noDataVisible = await page.locator('text=/暂无|没有|No data/i').isVisible().catch(() => false)
    console.log('No data message visible:', noDataVisible)

    // Take screenshot
    await page.screenshot({ path: '/tmp/offers-page-state.png', fullPage: true })
    console.log('📸 Screenshot saved to /tmp/offers-page-state.png')

    // Get page HTML
    const bodyHTML = await page.locator('body').innerHTML()
    const hasOfferText = bodyHTML.includes('Reolink')
    console.log('Page HTML contains "Reolink":', hasOfferText)

    console.log('\n========== Step 4: Direct API Call ==========')

    // Call API directly from browser
    const apiResult = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token')
      const response = await fetch('/api/offers', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      return {
        status: response.status,
        ok: response.ok,
        data: data
      }
    })

    console.log('Direct API call result:')
    console.log('  Status:', apiResult.status)
    console.log('  OK:', apiResult.ok)
    console.log('  Data:', JSON.stringify(apiResult.data, null, 2))

    console.log('\n========== Analysis Complete ==========')
  })
})
