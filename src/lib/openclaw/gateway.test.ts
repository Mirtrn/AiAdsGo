import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSetting: getSettingMock,
}))

vi.mock('@/lib/openclaw/auth', () => ({
  getOpenclawGatewayToken: vi.fn(),
}))

import { resolveOpenclawGatewayBaseUrl } from './gateway'

describe('openclaw gateway base url', () => {
  beforeEach(() => {
    getSettingMock.mockReset()
    delete process.env.OPENCLAW_GATEWAY_URL
  })

  it('uses environment override first', async () => {
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com/'

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('https://gateway.example.com')
    expect(getSettingMock).not.toHaveBeenCalled()
  })

  it('falls back to default port when setting is blank', async () => {
    getSettingMock.mockImplementation(async (_category: string, key: string) => {
      if (key === 'gateway_port') {
        return { value: '   ' }
      }
      return { value: 'loopback' }
    })

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('http://127.0.0.1:18789')
    expect(getSettingMock).toHaveBeenCalledWith('openclaw', 'gateway_port')
    expect(getSettingMock).toHaveBeenCalledWith('openclaw', 'gateway_bind')
  })

  it('falls back to default port when setting is invalid', async () => {
    getSettingMock.mockImplementation(async (_category: string, key: string) => {
      if (key === 'gateway_port') {
        return { value: '0' }
      }
      return { value: 'loopback' }
    })

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('http://127.0.0.1:18789')
  })

  it('uses configured port when setting is valid', async () => {
    getSettingMock.mockImplementation(async (_category: string, key: string) => {
      if (key === 'gateway_port') {
        return { value: '19001' }
      }
      return { value: 'loopback' }
    })

    const url = await resolveOpenclawGatewayBaseUrl()

    expect(url).toBe('http://127.0.0.1:19001')
  })
})
