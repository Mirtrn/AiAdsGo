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
  })

  it('lists logs with excerpt and grouped stats', async () => {
    const longText = 'A'.repeat(510)
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
