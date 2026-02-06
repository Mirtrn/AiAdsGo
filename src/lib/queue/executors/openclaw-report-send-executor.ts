import type { Task } from '@/lib/queue/types'
import { sendDailyReportToFeishu } from '@/lib/openclaw/reports'

export type OpenclawReportSendTaskData = {
  userId: number
  target?: string
  date?: string
  trigger?: 'cron' | 'manual' | 'retry'
}

export async function executeOpenclawReportSend(task: Task<OpenclawReportSendTaskData>) {
  const data = task.data
  if (!data?.userId) {
    throw new Error('任务参数不完整')
  }

  await sendDailyReportToFeishu({
    userId: data.userId,
    target: data.target,
    date: data.date,
    deliveryTaskId: task.id,
  })

  return {
    success: true,
    userId: data.userId,
    date: data.date,
    trigger: data.trigger || 'cron',
  }
}
