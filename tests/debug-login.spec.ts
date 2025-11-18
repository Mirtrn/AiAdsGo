import { test } from '@playwright/test'

test('Debug login flow', async ({ page }) => {
  // Listen to all console messages
  page.on('console', msg => console.log('PAGE LOG:', msg.text()))

  // Listen to network requests
  page.on('response', response => {
    if (response.url().includes('/api/auth/login')) {
      console.log('API Response:', response.status(), response.statusText())
    }
  })

  console.log('1. Navigating to login page...')
  await page.goto('http://localhost:3001/login', { waitUntil: 'domcontentloaded' })

  console.log('2. Current URL:', page.url())

  console.log('3. Filling form...')
  await page.fill('#username', 'autoads')
  await page.fill('#password', '***REMOVED***')

  console.log('4. Submitting form...')
  const [response] = await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/api/auth/login')),
    page.click('button[type="submit"]')
  ])

  console.log('5. Login API Response Status:', response.status())
  const responseData = await response.json()
  console.log('6. Login API Response Data:', JSON.stringify(responseData, null, 2))

  await page.waitForTimeout(3000)

  console.log('7. Current URL after submit:', page.url())

  // Check for error messages on the page
  const errorElement = await page.locator('.bg-red-50, .text-red-700, .error').count()
  if (errorElement > 0) {
    const errorText = await page.locator('.bg-red-50, .text-red-700, .error').first().textContent()
    console.log('8. Error message on page:', errorText)
  } else {
    console.log('8. No error message found')
  }

  await page.screenshot({ path: 'test-results/debug-after-login.png', fullPage: true })
})
