import { describe, expect, it } from 'vitest'

import { ProxyPoolManager } from './url-resolver-enhanced'

describe('ProxyPoolManager failure classification', () => {
  it('treats HTTP status code errors as temporary failures', async () => {
    const pool = new ProxyPoolManager()
    const proxyUrl = 'https://proxy-provider.example/api?cc=US'

    await pool.loadProxies([
      {
        country: 'US',
        url: proxyUrl,
        is_default: true,
      },
    ])

    pool.recordFailure(proxyUrl, 'HTTP请求失败: 状态码 503')

    const info = pool.getProxyInfo('US')
    expect(info.proxy?.temporaryFailureCount).toBe(1)
    expect(info.proxy?.permanentFailureCount).toBe(0)
  })
})

