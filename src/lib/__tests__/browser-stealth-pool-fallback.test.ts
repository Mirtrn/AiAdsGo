import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  launch: vi.fn(),
  getProxyIp: vi.fn(),
}))

vi.mock('@/lib/playwright-pool', () => ({
  getPlaywrightPool: () => ({
    acquire: mocks.acquire,
  }),
}))

vi.mock('@/lib/proxy/fetch-proxy-ip', () => ({
  getProxyIp: mocks.getProxyIp,
}))

vi.mock('playwright', () => ({
  chromium: {
    launch: mocks.launch,
  },
}))

describe('createStealthBrowser pool saturation behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProxyIp.mockResolvedValue({
      host: '127.0.0.1',
      port: 8080,
      username: 'user',
      password: 'pass',
    })
    mocks.launch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    })
  })

  it('does not bypass the Playwright pool by launching an unbounded standalone browser', async () => {
    mocks.acquire.mockRejectedValue(new Error('获取Playwright实例超时 (180000ms)'))

    const { createStealthBrowser } = await import('@/lib/stealth-scraper/browser-stealth')

    await expect(createStealthBrowser('https://proxy.example/api')).rejects.toThrow(
      'Playwright连接池获取失败'
    )
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.getProxyIp).not.toHaveBeenCalled()
  })
})
