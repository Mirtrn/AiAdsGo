function normalizeCookieHeader(cookies) {
  const map = new Map()

  for (const cookie of cookies || []) {
    const name = String(cookie?.name || '').trim()
    if (!name || map.has(name)) continue
    map.set(name, String(cookie?.value || ''))
  }

  return Array.from(map.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

async function getYeahPromosCookieHeader() {
  const cookies = await chrome.cookies.getAll({ domain: 'yeahpromos.com' })
  const header = normalizeCookieHeader(cookies)
  if (!header) {
    throw new Error('未读取到 YeahPromos Cookie，请先在 yeahpromos.com 完成登录。')
  }
  return header
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs?.[0]
  if (!tab?.id) {
    throw new Error('未检测到当前标签页，请切换到 AutoAds /products 页面。')
  }
  return tab.id
}

async function executeCaptureOnActiveTab(tabId, cookieHeader) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    args: [cookieHeader],
    func: async (capturedCookie) => {
      const ensureJson = async (response) => {
        try {
          return await response.json()
        } catch {
          return {}
        }
      }

      try {
        const probe = await fetch('/api/products/yeahpromos/session/status', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })
        if (probe.status === 401) {
          return {
            success: false,
            error: '请先在当前 AutoAds 页面完成登录后再执行扩展回传。',
          }
        }
        if (probe.status === 404) {
          return {
            success: false,
            error: '当前页面不是 AutoAds 系统页，请切换到 /products 后重试。',
          }
        }

        const captureResponse = await fetch('/api/products/yeahpromos/session/capture-extension', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cookie: capturedCookie }),
        })
        const captureData = await ensureJson(captureResponse)

        if (!captureResponse.ok || !captureData?.success) {
          return {
            success: false,
            error: captureData?.error || '回传接口调用失败。',
          }
        }

        return {
          success: true,
          session: captureData.session || null,
        }
      } catch (error) {
        return {
          success: false,
          error: error?.message || '扩展回传失败。',
        }
      }
    },
  })

  return result?.[0]?.result || { success: false, error: '扩展执行失败。' }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'capture_yp_session') {
    return false
  }

  ;(async () => {
    try {
      const cookieHeader = await getYeahPromosCookieHeader()
      const tabId = await getActiveTabId()
      const captureResult = await executeCaptureOnActiveTab(tabId, cookieHeader)
      sendResponse(captureResult)
    } catch (error) {
      sendResponse({
        success: false,
        error: error?.message || '扩展回传失败。',
      })
    }
  })()

  return true
})
