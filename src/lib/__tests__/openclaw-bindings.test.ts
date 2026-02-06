import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDatabaseMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

import { resolveOpenclawUserFromBinding } from '../openclaw/bindings'

describe('openclaw bindings isolation', () => {
  beforeEach(() => {
    getDatabaseMock.mockReset()
  })

  it('returns user id directly from feishu accountId', async () => {
    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      accountId: 'user-42',
    })

    expect(result).toBe(42)
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('requires tenant key for feishu sender binding', async () => {
    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      tenantKey: '   ',
    })

    expect(result).toBeNull()
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('resolves feishu user only from tenant-scoped binding', async () => {
    const queryOne = vi.fn().mockResolvedValue({ user_id: 7 })
    getDatabaseMock.mockResolvedValue({ queryOne })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      tenantKey: 'tenant-abc',
    })

    expect(result).toBe(7)
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(queryOne.mock.calls[0]?.[1]).toEqual(['feishu', 'tenant-abc', 'ou_xxx', 'ou_xxx'])
  })

  it('keeps non-feishu fallback lookup when scoped binding misses', async () => {
    const queryOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_id: 9 })
    getDatabaseMock.mockResolvedValue({ queryOne })

    const result = await resolveOpenclawUserFromBinding('slack', 'u_123', {
      tenantKey: 'tenant-xyz',
    })

    expect(result).toBe(9)
    expect(queryOne).toHaveBeenCalledTimes(2)
  })
})
