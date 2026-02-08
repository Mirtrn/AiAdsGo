import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDatabaseMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
}))

const { collectUserFeishuAccountsMock } = vi.hoisted(() => ({
  collectUserFeishuAccountsMock: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('../openclaw/feishu-accounts', () => ({
  parseFeishuAccountUserId: (accountId?: string | null) => {
    if (!accountId) return null
    const normalized = accountId.trim()
    if (!normalized.startsWith('user-')) return null
    const parsed = Number(normalized.slice('user-'.length))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  },
  collectUserFeishuAccounts: collectUserFeishuAccountsMock,
}))

import { resolveOpenclawUserFromBinding } from '../openclaw/bindings'

describe('openclaw bindings isolation', () => {
  beforeEach(() => {
    getDatabaseMock.mockReset()
    collectUserFeishuAccountsMock.mockReset()
    collectUserFeishuAccountsMock.mockResolvedValue({})
  })

  it('returns user id directly from feishu accountId', async () => {
    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      accountId: 'user-42',
    })

    expect(result).toBe(42)
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('requires tenant key for feishu sender binding', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({})

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      tenantKey: '   ',
    })

    expect(result).toBeNull()
    expect(getDatabaseMock).not.toHaveBeenCalled()
    expect(collectUserFeishuAccountsMock).toHaveBeenCalledTimes(1)
  })

  it('resolves feishu user only from tenant-scoped binding', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({})

    const queryOne = vi.fn().mockResolvedValue({ user_id: 7 })
    getDatabaseMock.mockResolvedValue({ queryOne })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_xxx', {
      tenantKey: 'tenant-abc',
    })

    expect(result).toBe(7)
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(queryOne.mock.calls[0]?.[1]).toEqual(['feishu', 'tenant-abc', 'ou_xxx', 'ou_xxx'])
    expect(collectUserFeishuAccountsMock).not.toHaveBeenCalled()
  })

  it('falls back to unique feishu allowlist match without tenant key', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { allowFrom: ['ou_abc'] },
      'user-9': { allowFrom: ['ou_other'] },
    })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_abc', {
      tenantKey: '   ',
    })

    expect(result).toBe(7)
    expect(getDatabaseMock).not.toHaveBeenCalled()
    expect(collectUserFeishuAccountsMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to unique feishu allowlist match when tenant-scoped binding misses', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-11': { allowFrom: ['feishu:ou_fallback'] },
    })

    const queryOne = vi.fn().mockResolvedValue(null)
    getDatabaseMock.mockResolvedValue({ queryOne })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_fallback', {
      tenantKey: 'tenant-abc',
    })

    expect(result).toBe(11)
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(collectUserFeishuAccountsMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when feishu allowlist matches multiple users', async () => {
    collectUserFeishuAccountsMock.mockResolvedValue({
      'user-7': { allowFrom: ['ou_dup'] },
      'user-8': { allowFrom: ['ou_dup'] },
    })

    const result = await resolveOpenclawUserFromBinding('feishu', 'ou_dup', {
      tenantKey: null,
    })

    expect(result).toBeNull()
    expect(getDatabaseMock).not.toHaveBeenCalled()
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
