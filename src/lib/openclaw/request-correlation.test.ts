import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const dbHelperFns = vi.hoisted(() => ({
  datetimeMinusHours: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/db-helpers', () => ({
  datetimeMinusHours: dbHelperFns.datetimeMinusHours,
}))

import {
  resolveOpenclawParentRequestId,
  resolveOpenclawParentRequestIdFromHeaders,
} from '@/lib/openclaw/request-correlation'

describe('openclaw request correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbHelperFns.datetimeMinusHours.mockImplementation((hours: number, dbType: string) => {
      if (dbType === 'postgres') {
        return `CURRENT_TIMESTAMP - INTERVAL '${hours} hours'`
      }
      return `datetime('now', '-${hours} hours')`
    })
  })

  it('resolves parent request id from headers with expected priority', () => {
    const withMessage = resolveOpenclawParentRequestIdFromHeaders({
      get: (name: string) => (name === 'x-openclaw-message-id' ? 'om_1' : null),
    })
    expect(withMessage).toEqual({
      parentRequestId: 'om_1',
      source: 'message_id',
    })

    const withInbound = resolveOpenclawParentRequestIdFromHeaders({
      get: (name: string) => (name === 'x-openclaw-inbound-message-id' ? 'om_2' : null),
    })
    expect(withInbound).toEqual({
      parentRequestId: 'om_2',
      source: 'inbound_message_id',
    })

    const withRequest = resolveOpenclawParentRequestIdFromHeaders({
      get: (name: string) => (name === 'x-request-id' ? 'uuid-1' : null),
    })
    expect(withRequest).toEqual({
      parentRequestId: 'uuid-1',
      source: 'request_id',
    })

    const empty = resolveOpenclawParentRequestIdFromHeaders({
      get: () => null,
    })
    expect(empty).toEqual({
      source: 'none',
    })
  })

  it('keeps explicit non-request-id parent request id without DB fallback', async () => {
    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query: vi.fn().mockResolvedValue([]),
    })

    const resolved = await resolveOpenclawParentRequestId({
      explicitParentRequestId: 'om_direct',
      explicitSource: 'message_id',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
    })

    expect(resolved).toBe('om_direct')
    expect(dbFns.getDatabase).not.toHaveBeenCalled()
  })

  it('replaces request_id with recent feishu message id by sender correlation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'))

    const query = vi.fn().mockResolvedValue([
      {
        message_id: 'om_recent',
        created_at: '2026-02-13 11:52:00',
      },
    ])
    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
    })

    const resolved = await resolveOpenclawParentRequestId({
      explicitParentRequestId: 'uuid-1',
      explicitSource: 'request_id',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
      accountId: 'user-7',
    })

    expect(resolved).toBe('om_recent')
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM openclaw_feishu_chat_health_logs'),
      [7, 'user-7', 'ou_1', 'ou_1', 'ou_1', 'ou_1']
    )

    vi.useRealTimers()
  })

  it('falls back to explicit request_id when no recent correlated message exists', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'))

    const query = vi.fn().mockResolvedValue([
      {
        message_id: 'om_old',
        created_at: '2026-02-13 10:00:00',
      },
    ])
    dbFns.getDatabase.mockResolvedValue({
      type: 'sqlite',
      query,
    })

    const resolved = await resolveOpenclawParentRequestId({
      explicitParentRequestId: 'uuid-2',
      explicitSource: 'request_id',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
    })

    expect(resolved).toBe('uuid-2')

    vi.useRealTimers()
  })
})
