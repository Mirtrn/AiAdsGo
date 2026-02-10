import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDatabaseMock,
  getQueueManagerForTaskTypeMock,
  createOrRefreshCommandConfirmationMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  getQueueManagerForTaskTypeMock: vi.fn(),
  createOrRefreshCommandConfirmationMock: vi.fn(),
}))

vi.mock('../db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('../queue/queue-routing', () => ({
  getQueueManagerForTaskType: getQueueManagerForTaskTypeMock,
}))

vi.mock('../openclaw/commands/confirm-service', () => ({
  createOrRefreshCommandConfirmation: createOrRefreshCommandConfirmationMock,
  consumeCommandConfirmation: vi.fn(),
  recordOpenclawCallbackEvent: vi.fn(),
}))

import { executeOpenclawCommand } from '../openclaw/commands/command-service'

describe('openclaw command service confirmation guard', () => {
  let db: {
    type: 'sqlite'
    queryOne: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
  }
  let queueManager: {
    enqueue: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    db = {
      type: 'sqlite',
      queryOne: vi.fn().mockResolvedValue(null),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }

    queueManager = {
      enqueue: vi.fn().mockResolvedValue('task-1'),
    }

    getDatabaseMock.mockReset()
    getDatabaseMock.mockResolvedValue(db)

    getQueueManagerForTaskTypeMock.mockReset()
    getQueueManagerForTaskTypeMock.mockReturnValue(queueManager)

    createOrRefreshCommandConfirmationMock.mockReset()
    createOrRefreshCommandConfirmationMock.mockResolvedValue({
      confirmToken: 'occf_test',
      expiresAt: '2026-02-11T00:00:00.000Z',
    })

  })

  it.each([
    ['PUT', '/api/settings'],
    ['POST', '/api/sync/trigger'],
    ['POST', '/api/google-ads/credentials'],
  ])('returns pending_confirm for high-risk path %s %s', async (method, path) => {
    const result = await executeOpenclawCommand({
      userId: 1001,
      authType: 'session',
      method,
      path,
      body: { sample: true },
      channel: 'feishu',
      senderId: 'ou_test',
    })

    expect(result).toMatchObject({
      status: 'pending_confirm',
      riskLevel: 'high',
      confirmToken: 'occf_test',
    })

    expect(createOrRefreshCommandConfirmationMock).toHaveBeenCalledTimes(1)
    expect(createOrRefreshCommandConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1001 })
    )

    expect(getQueueManagerForTaskTypeMock).not.toHaveBeenCalled()
    expect(queueManager.enqueue).not.toHaveBeenCalled()
    expect(db.exec).toHaveBeenCalled()
  })
})
