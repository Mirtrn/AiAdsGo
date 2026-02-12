import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDatabaseMock, expireStaleCommandConfirmationsMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  expireStaleCommandConfirmationsMock: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('../openclaw/commands/confirm-service', () => ({
  expireStaleCommandConfirmations: expireStaleCommandConfirmationsMock,
}))

import { listOpenclawCommandRuns } from '../openclaw/commands/runs-service'

describe('openclaw runs service', () => {
  beforeEach(() => {
    getDatabaseMock.mockReset()
    expireStaleCommandConfirmationsMock.mockReset()
    expireStaleCommandConfirmationsMock.mockResolvedValue(0)
  })

  it('lists runs with user-level filter and merges confirm status', async () => {
    const queryOne = vi.fn().mockResolvedValue({ total: 2 })
    const query = vi.fn()
      .mockResolvedValueOnce([
        {
          id: 'run-1',
          intent: 'offers.list',
          request_method: 'GET',
          request_path: '/api/offers',
          risk_level: 'low',
          status: 'completed',
          confirm_required: 0,
          confirm_expires_at: null,
          queue_task_id: 'task-1',
          response_status: 200,
          error_message: null,
          created_at: '2026-02-07T00:00:00.000Z',
          updated_at: '2026-02-07T00:00:01.000Z',
          started_at: '2026-02-07T00:00:00.500Z',
          completed_at: '2026-02-07T00:00:01.000Z',
        },
        {
          id: 'run-2',
          intent: 'offers.delete',
          request_method: 'DELETE',
          request_path: '/api/offers/2/delete',
          risk_level: 'high',
          status: 'pending_confirm',
          confirm_required: 1,
          confirm_expires_at: '2026-02-07T01:00:00.000Z',
          queue_task_id: null,
          response_status: null,
          error_message: null,
          created_at: '2026-02-07T00:10:00.000Z',
          updated_at: '2026-02-07T00:10:01.000Z',
          started_at: null,
          completed_at: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          run_id: 'run-2',
          status: 'pending',
          expires_at: '2026-02-07T01:00:00.000Z',
          callback_event_id: null,
          updated_at: '2026-02-07T00:10:01.000Z',
        },
      ])

    getDatabaseMock.mockResolvedValue({ queryOne, query })

    const result = await listOpenclawCommandRuns({
      userId: 99,
      page: 1,
      limit: 20,
      status: 'all',
      riskLevel: 'all',
    })

    expect(expireStaleCommandConfirmationsMock).toHaveBeenCalledTimes(1)
    expect(expireStaleCommandConfirmationsMock).toHaveBeenCalledWith({ userId: 99 })

    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(queryOne.mock.calls[0]?.[1]).toEqual([99])

    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0]?.[1]).toEqual([99, 20, 0])
    expect(query.mock.calls[1]?.[1]).toEqual(['run-1', 'run-2'])

    expect(result.pagination.total).toBe(2)
    expect(result.items[0].runId).toBe('run-1')
    expect(result.items[1].runId).toBe('run-2')
    expect(result.items[1].confirmRequired).toBe(true)
    expect(result.items[1].confirmStatus).toBe('pending')
  })
})
