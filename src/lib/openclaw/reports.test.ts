import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  execMock: vi.fn(),
  invokeOpenclawToolMock: vi.fn(),
  resolveUserFeishuAccountIdMock: vi.fn(),
  writeDailyReportToBitableMock: vi.fn(),
  writeDailyReportToDocMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: async () => ({
    type: 'sqlite',
    queryOne: hoisted.queryOneMock,
    exec: hoisted.execMock,
  }),
}))

vi.mock('@/lib/openclaw/gateway', () => ({
  invokeOpenclawTool: hoisted.invokeOpenclawToolMock,
}))

vi.mock('@/lib/openclaw/feishu-accounts', () => ({
  resolveUserFeishuAccountId: hoisted.resolveUserFeishuAccountIdMock,
}))

vi.mock('@/lib/openclaw/feishu-docs', () => ({
  writeDailyReportToBitable: hoisted.writeDailyReportToBitableMock,
  writeDailyReportToDoc: hoisted.writeDailyReportToDocMock,
}))

import { sendDailyReportToFeishu } from './reports'

describe('sendDailyReportToFeishu', () => {
  const cachedReportPayload = {
    date: '2026-02-14',
    generatedAt: '2026-02-14T01:02:03.000Z',
  }

  beforeEach(() => {
    hoisted.queryOneMock.mockReset()
    hoisted.execMock.mockReset()
    hoisted.invokeOpenclawToolMock.mockReset()
    hoisted.resolveUserFeishuAccountIdMock.mockReset()
    hoisted.writeDailyReportToBitableMock.mockReset()
    hoisted.writeDailyReportToDocMock.mockReset()

    hoisted.execMock.mockResolvedValue({ changes: 1 })
    hoisted.invokeOpenclawToolMock.mockResolvedValue({ ok: true })
    hoisted.resolveUserFeishuAccountIdMock.mockResolvedValue(null)
    hoisted.writeDailyReportToBitableMock.mockResolvedValue(undefined)
    hoisted.writeDailyReportToDocMock.mockResolvedValue(undefined)
  })

  it('skips duplicate delivery when same task already marked as sent', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return { payload_json: JSON.stringify(cachedReportPayload) }
      }
      if (sql.includes('SELECT sent_status, last_delivery_task_id')) {
        return { sent_status: 'sent', last_delivery_task_id: 'delivery-1' }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-14',
      deliveryTaskId: 'delivery-1',
    })

    expect(hoisted.execMock).not.toHaveBeenCalled()
    expect(hoisted.invokeOpenclawToolMock).not.toHaveBeenCalled()
    expect(hoisted.writeDailyReportToBitableMock).not.toHaveBeenCalled()
    expect(hoisted.writeDailyReportToDocMock).not.toHaveBeenCalled()
  })

  it('passes deterministic idempotency key to gateway when delivery task id is provided', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return { payload_json: JSON.stringify(cachedReportPayload) }
      }
      if (sql.includes('SELECT sent_status, last_delivery_task_id')) {
        return { sent_status: 'pending', last_delivery_task_id: 'delivery-0' }
      }
      return undefined
    })

    await sendDailyReportToFeishu({
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-14',
      deliveryTaskId: 'delivery-2',
    })

    expect(hoisted.invokeOpenclawToolMock).toHaveBeenCalledTimes(1)
    expect(hoisted.invokeOpenclawToolMock.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: 'daily-report:7:2026-02-14:ou_xxx:delivery-2',
    })
  })

  it('coalesces concurrent delivery calls for same delivery task id', async () => {
    hoisted.queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT payload_json FROM openclaw_daily_reports')) {
        return { payload_json: JSON.stringify(cachedReportPayload) }
      }
      if (sql.includes('SELECT sent_status, last_delivery_task_id')) {
        return { sent_status: 'pending', last_delivery_task_id: 'delivery-0' }
      }
      return undefined
    })
    hoisted.invokeOpenclawToolMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      return { ok: true }
    })

    const params = {
      userId: 7,
      target: 'ou_xxx',
      date: '2026-02-14',
      deliveryTaskId: 'delivery-3',
    }
    await Promise.all([
      sendDailyReportToFeishu(params),
      sendDailyReportToFeishu(params),
    ])

    expect(hoisted.invokeOpenclawToolMock).toHaveBeenCalledTimes(1)
    expect(hoisted.writeDailyReportToBitableMock).toHaveBeenCalledTimes(1)
    expect(hoisted.writeDailyReportToDocMock).toHaveBeenCalledTimes(1)
    expect(hoisted.execMock).toHaveBeenCalledTimes(2)
  })
})
