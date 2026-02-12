import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  fetchAutoadsAsUser: vi.fn(),
  recordOpenclawAction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: mocks.getDatabase,
}))

vi.mock('@/lib/openclaw/autoads-client', () => ({
  fetchAutoadsAsUser: mocks.fetchAutoadsAsUser,
}))

vi.mock('@/lib/openclaw/action-logs', () => ({
  recordOpenclawAction: mocks.recordOpenclawAction,
}))

import { executeOpenclawCommandTask } from '../openclaw-command-executor'

function createTask(runId: string) {
  return {
    id: `task-${runId}`,
    type: 'openclaw-command',
    userId: 1,
    status: 'pending',
    priority: 'normal',
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 0,
    data: {
      runId,
      userId: 1,
      trigger: 'direct',
    },
  } as any
}

describe('openclaw command executor click-farm guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks click-farm task when offer has no available campaign or recent successful publish', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-cf-1',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/click-farm/tasks',
            request_query_json: null,
            request_body_json: JSON.stringify({
              offer_id: 3343,
              daily_click_count: 50,
              start_time: '06:00',
              end_time: '24:00',
              duration_days: -1,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('FROM campaigns')) {
          return null
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)

    await expect(executeOpenclawCommandTask(createTask('run-cf-1'))).rejects.toThrow(
      '补点击前置校验失败：Offer 3343 缺少可用Campaign，请先成功发布广告'
    )

    expect(mocks.fetchAutoadsAsUser).not.toHaveBeenCalled()
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        action: 'POST /api/click-farm/tasks',
      })
    )
  })

  it('allows click-farm task when same offer has recent successful publish record', async () => {
    const db = {
      type: 'postgres',
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs')) {
          return [
            {
              request_body_json: JSON.stringify({ offerId: 3343, adCreativeId: 4331 }),
              completed_at: new Date().toISOString(),
            },
          ]
        }
        return []
      }),
      queryOne: vi.fn(async (sql: string) => {
        if (sql.includes('FROM openclaw_command_runs') && sql.includes('LIMIT 1')) {
          return {
            id: 'run-cf-2',
            user_id: 1,
            channel: 'feishu',
            sender_id: 'ou_test',
            request_method: 'POST',
            request_path: '/api/click-farm/tasks',
            request_query_json: null,
            request_body_json: JSON.stringify({
              offer_id: 3343,
              daily_click_count: 50,
              start_time: '06:00',
              end_time: '24:00',
              duration_days: -1,
            }),
            risk_level: 'medium',
            status: 'queued',
            confirm_required: false,
          }
        }

        if (sql.includes('FROM openclaw_command_confirms')) {
          return { status: 'not_required' }
        }

        if (sql.includes('FROM campaigns')) {
          return null
        }

        return null
      }),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.fetchAutoadsAsUser.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const result = await executeOpenclawCommandTask(createTask('run-cf-2'))

    expect(result.success).toBe(true)
    expect(mocks.fetchAutoadsAsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        path: '/api/click-farm/tasks',
        method: 'POST',
      })
    )
    expect(mocks.recordOpenclawAction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        action: 'POST /api/click-farm/tasks',
      })
    )
  })
})
