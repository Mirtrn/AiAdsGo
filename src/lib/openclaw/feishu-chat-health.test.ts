import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const dbHelperFns = vi.hoisted(() => ({
  datetimeMinusHours: vi.fn(),
  nowFunc: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/db-helpers', () => ({
  datetimeMinusHours: dbHelperFns.datetimeMinusHours,
  nowFunc: dbHelperFns.nowFunc,
}))

import {
  backfillFeishuChatHealthRunLinks,
  listFeishuChatHealthLogs,
  recordFeishuChatHealthLog,
} from '@/lib/openclaw/feishu-chat-health'

describe('feishu chat health lib', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbHelperFns.datetimeMinusHours.mockImplementation((hours: number, dbType: string) => {
      if (dbType === 'postgres') {
        return `CURRENT_TIMESTAMP - INTERVAL '${hours} hours'`
      }
      return `datetime('now', '-${hours} hours')`
    })
    dbHelperFns.nowFunc.mockImplementation((dbType: string) => {
      return dbType === 'postgres' ? 'NOW()' : "datetime('now')"
    })
  })

  it('lists logs with excerpt and grouped stats', async () => {
    const longText = 'A'.repeat(510)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))
    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 1,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_1',
            chat_id: 'oc_1',
            chat_type: 'group',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'blocked',
            reason_code: 'group_require_mention',
            reason_message: 'group requires @mention',
            message_text: longText,
            message_text_length: 510,
            metadata_json: '{"k":"v"}',
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 2 },
          { decision: 'blocked', total: 3 },
          { decision: 'error', total: 1 },
        ]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].messageExcerpt.length).toBe(501)
    expect(result.rows[0].messageExcerpt.endsWith('…')).toBe(true)

    expect(result.stats).toEqual({
      total: 6,
      allowed: 2,
      blocked: 3,
      error: 1,
      execution: {
        linked: 0,
        completed: 0,
        inProgress: 0,
        waiting: 0,
        missing: 0,
        failed: 0,
        notApplicable: 1,
        unknown: 0,
      },
    })

    expect(db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM openclaw_feishu_chat_health_logs'),
      [7, 100]
    )
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('GROUP BY decision'),
      [7]
    )
    const rowsSql = String(db.query.mock.calls[0]?.[0] || '')
    const statsSql = String(db.query.mock.calls[1]?.[0] || '')
    expect(rowsSql).toContain("reason_code")
    expect(rowsSql).toContain("duplicate_message")
    expect(statsSql).toContain("reason_code")
    expect(statsSql).toContain("duplicate_message")
    expect(db.query).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('marks allowed rows as missing when dispatch exceeded threshold without run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 2,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_missing',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'allowed',
            reason_code: 'reply_dispatched',
            reason_message: 'message passed access checks and entered reply pipeline',
            message_text: 'hello',
            message_text_length: 5,
            metadata_json: null,
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 1 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionState).toBe('missing')
    expect(result.rows[0].executionRunCount).toBe(0)
    expect(result.rows[0].executionDetail).toContain('仍无命令执行记录')
    expect(result.stats.execution.missing).toBe(1)
    expect(result.stats.execution.waiting).toBe(0)

    expect(db.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('FROM openclaw_command_runs'),
      [7, 'om_missing']
    )
    expect(db.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('FROM openclaw_command_runs'),
      [7, 'ou_1']
    )

    vi.useRealTimers()
  })

  it('links allowed rows to runs via sender/time when parent_request_id does not match', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 3,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_1',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'allowed',
            reason_code: 'reply_dispatched',
            reason_message: 'message passed access checks and entered reply pipeline',
            message_text: 'do something',
            message_text_length: 12,
            metadata_json: null,
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 1 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'run-1',
            parent_request_id: 'uuid-1',
            channel: 'feishu',
            sender_id: 'ou_1',
            status: 'completed',
            created_at: '2026-02-10 02:59:50',
          },
        ]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionRunCount).toBe(1)
    expect(result.rows[0].executionRunId).toBe('run-1')
    expect(result.rows[0].executionState).toBe('completed')
    expect(result.rows[0].executionDetail).toContain('sender/time')
    expect(result.stats.execution.linked).toBe(1)
    expect(result.stats.execution.completed).toBe(1)

    vi.useRealTimers()
  })

  it('does not link sender/time fallback to runs already bound to other message ids', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T03:20:00.000Z'))

    const db = {
      type: 'sqlite',
      query: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 4,
            user_id: 7,
            account_id: 'user-7',
            message_id: 'om_target',
            chat_id: 'oc_1',
            chat_type: 'p2p',
            message_type: 'text',
            sender_primary_id: 'ou_1',
            sender_open_id: 'ou_1',
            sender_union_id: null,
            sender_user_id: null,
            sender_candidates_json: '["ou_1"]',
            decision: 'allowed',
            reason_code: 'reply_dispatched',
            reason_message: 'message passed access checks and entered reply pipeline',
            message_text: 'do something',
            message_text_length: 12,
            metadata_json: null,
            created_at: '2026-02-10 03:00:00',
          },
        ])
        .mockResolvedValueOnce([
          { decision: 'allowed', total: 1 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'run-bound-other',
            parent_request_id: 'om_other_message',
            channel: 'feishu',
            sender_id: 'ou_1',
            status: 'failed',
            created_at: '2026-02-10 03:00:10',
          },
        ]),
      exec: vi.fn().mockResolvedValue({ changes: 0 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await listFeishuChatHealthLogs({ userId: 7, withinHours: 1, limit: 100 })

    expect(result.rows[0].executionRunCount).toBe(0)
    expect(result.rows[0].executionRunId).toBeNull()
    expect(result.rows[0].executionState).toBe('missing')
    expect(result.stats.execution.missing).toBe(1)
    expect(result.stats.execution.failed).toBe(0)

    vi.useRealTimers()
  })

  it('backfills long-running feishu runs without crossing previous allowed message boundary', async () => {
    const db = {
      type: 'sqlite',
      queryOne: vi
        .fn()
        .mockResolvedValueOnce({
          created_at: '2026-02-10 03:11:17',
        })
        .mockResolvedValueOnce({
          created_at: '2026-02-10 02:59:59',
        }),
      query: vi.fn().mockResolvedValueOnce([
        {
          id: 'run-late',
          parent_request_id: 'uuid-late',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'completed',
          created_at: '2026-02-10 03:17:00',
        },
        {
          id: 'run-2',
          parent_request_id: null,
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'completed',
          created_at: '2026-02-10 03:10:00',
        },
        {
          id: 'run-bound-other',
          parent_request_id: 'om_other_message',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'failed',
          created_at: '2026-02-10 03:09:00',
        },
        {
          id: 'run-1',
          parent_request_id: 'uuid-1',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'queued',
          created_at: '2026-02-10 03:01:00',
        },
        {
          id: 'run-prev-boundary',
          parent_request_id: 'uuid-prev',
          channel: 'feishu',
          sender_id: 'ou_1',
          status: 'completed',
          created_at: '2026-02-10 02:59:59',
        },
      ]),
      exec: vi.fn().mockResolvedValue({ changes: 2 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    const result = await backfillFeishuChatHealthRunLinks({
      userId: 7,
      messageId: 'om_target',
      senderIds: ['ou_1', 'ou_1'],
    })

    expect(result).toEqual({ updatedRuns: 2 })
    expect(db.exec).toHaveBeenCalledTimes(1)

    const execArgs = db.exec.mock.calls[0]?.[1] as any[]
    expect(execArgs[0]).toBe('om_target')
    expect(execArgs[1]).toBe(7)
    expect(execArgs.slice(2)).toHaveLength(2)
    expect(execArgs.slice(2)).toEqual(expect.arrayContaining(['run-1', 'run-2']))
  })

  it('records logs with deduplicated sender candidates', async () => {
    const longText = 'x'.repeat(21_000)
    const db = {
      type: 'sqlite',
      query: vi.fn().mockResolvedValue([]),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }

    dbFns.getDatabase.mockResolvedValue(db)

    await recordFeishuChatHealthLog({
      userId: 7,
      accountId: 'user-7',
      messageId: 'om_1',
      chatId: 'oc_1',
      chatType: 'group',
      messageType: 'text',
      senderPrimaryId: 'ou_1',
      senderOpenId: 'ou_1',
      senderUnionId: 'on_1',
      senderUserId: null,
      senderCandidates: ['ou_1', 'ou_1', 'on_1', ''],
      decision: 'blocked',
      reasonCode: 'group_require_mention',
      reasonMessage: 'group requires @mention',
      messageText: longText,
      metadata: { source: 'test' },
    })

    expect(db.exec).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO openclaw_feishu_chat_health_logs'),
      expect.any(Array)
    )

    const insertedArgs = db.exec.mock.calls[0][1] as any[]
    expect(JSON.parse(insertedArgs[10])).toEqual(['ou_1', 'on_1'])
    expect(insertedArgs[11]).toBe('blocked')
    expect(String(insertedArgs[14]).length).toBe(20_000)
    expect(insertedArgs[15]).toBe(20_000)
  })
})
