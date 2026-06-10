import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
}))

const queueFns = vi.hoisted(() => ({
  ensureInitialized: vi.fn(),
  getRuntimeInfo: vi.fn(),
}))

const routingFns = vi.hoisted(() => ({
  getQueueRoutingDiagnostics: vi.fn(),
}))

const heartbeatFns = vi.hoisted(() => ({
  getBackgroundWorkerHeartbeatKey: vi.fn(),
  isBackgroundWorkerAlive: vi.fn(),
}))

const triggerFns = vi.hoisted(() => ({
  enqueueClickFarmTriggerRequest: vi.fn(),
  triggerTaskScheduling: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    type: 'postgres',
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/queue', () => ({
  getQueueManagerForTaskType: vi.fn(() => ({
    ensureInitialized: queueFns.ensureInitialized,
    getRuntimeInfo: queueFns.getRuntimeInfo,
  })),
}))

vi.mock('@/lib/queue/queue-routing', () => ({
  getQueueRoutingDiagnostics: routingFns.getQueueRoutingDiagnostics,
}))

vi.mock('@/lib/queue/background-worker-heartbeat', () => ({
  getBackgroundWorkerHeartbeatKey: heartbeatFns.getBackgroundWorkerHeartbeatKey,
  isBackgroundWorkerAlive: heartbeatFns.isBackgroundWorkerAlive,
}))

vi.mock('@/lib/click-farm/click-farm-scheduler-trigger', () => ({
  enqueueClickFarmTriggerRequest: triggerFns.enqueueClickFarmTriggerRequest,
  triggerTaskScheduling: triggerFns.triggerTaskScheduling,
}))

describe('POST /api/click-farm/tasks/[id]/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.exec.mockResolvedValue({ changes: 1 })
    queueFns.ensureInitialized.mockResolvedValue(undefined)
    queueFns.getRuntimeInfo.mockReturnValue({
      adapter: 'RedisQueueAdapter',
      connected: true,
    })
    routingFns.getQueueRoutingDiagnostics.mockReturnValue({
      splitEnabled: false,
    })
    heartbeatFns.getBackgroundWorkerHeartbeatKey.mockReturnValue('worker:heartbeat')
    heartbeatFns.isBackgroundWorkerAlive.mockResolvedValue(true)
    triggerFns.enqueueClickFarmTriggerRequest.mockResolvedValue({
      queueTaskId: 'click-farm-trigger:task-1',
    })
    triggerFns.triggerTaskScheduling.mockResolvedValue({
      taskId: 'task-1',
      status: 'queued',
      clickCount: 5,
    })
  })

  it('runs scheduling immediately and returns the scheduling result for manual triggers', async () => {
    const req = new NextRequest('http://localhost/api/click-farm/tasks/task-1/trigger', {
      method: 'POST',
      headers: {
        'x-user-id': '7',
        'x-request-id': 'req-1',
      },
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'task-1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.accepted).toBe(true)
    expect(data.message).toContain('5')
    expect(data.data).toMatchObject({
      taskId: 'task-1',
      schedulingStatus: 'queued',
      clickCount: 5,
    })
    expect(triggerFns.triggerTaskScheduling).toHaveBeenCalledWith('task-1', {
      parentRequestId: 'req-1',
    })
    expect(triggerFns.enqueueClickFarmTriggerRequest).not.toHaveBeenCalled()
  })
})
