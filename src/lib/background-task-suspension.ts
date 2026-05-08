import { getDatabase } from '@/lib/db'
import { boolParam, nowFunc, toBool } from '@/lib/db-helpers'
import { getBackgroundQueueManager, getQueueManager } from '@/lib/queue'
import { ALL_TASK_TYPES, type TaskType } from '@/lib/queue/types'
import { pauseUrlSwapTargetsByUserIds } from '@/lib/url-swap'
import { clearUserExecutionEligibilityCache } from '@/lib/user-execution-eligibility'

// 队列止血默认覆盖所有用户任务类型；通过 userId 维度删除，不影响系统任务（userId<=0）。
export const USER_SUSPENDED_TASK_TYPES: TaskType[] = [...ALL_TASK_TYPES]

export type UserSuspensionReason = 'manual_disable' | 'package_expired' | 'daily_sweep'

function isExpired(packageExpiresAt: string | null | undefined, now: Date): boolean {
  if (!packageExpiresAt) return false
  const expiry = new Date(packageExpiresAt)
  if (!Number.isFinite(expiry.getTime())) return true
  return expiry.getTime() < now.getTime()
}

async function purgeUserPendingQueueTasks(
  userId: number,
  types: TaskType[]
): Promise<number> {
  const queueManagers = [getQueueManager(), getBackgroundQueueManager()]
  let removedCount = 0

  for (const queue of queueManagers) {
    try {
      const result = await queue.purgePendingTasksByUserAndTypes(userId, types)
      removedCount += result.removedCount
    } catch (error: any) {
      console.warn(
        `[user-task-suspension] purge pending tasks failed (userId=${userId}, prefix=${queue.getConfig().redisKeyPrefix || 'memory'}):`,
        error?.message || String(error)
      )
    }
  }

  return removedCount
}

export async function suspendUserBackgroundTasks(
  userId: number,
  opts: { reason: UserSuspensionReason; purgeQueue?: boolean }
): Promise<{
  clickFarmStopped: number
  urlSwapDisabled: number
  queuePurged: number
}> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  const clickFarmStopped = (
    await db.exec(
      `
        UPDATE click_farm_tasks
        SET status = 'stopped',
            updated_at = ${nowSql}
        WHERE user_id = ?
          AND status IN ('pending', 'running', 'paused')
          AND IS_DELETED_FALSE
      `,
      [userId]
    )
  ).changes

  // Fix29: 同步清理 creative_tasks DB 中的 pending 记录（只清 pending，不动 running）
  // 场景：用户被暂停时队列层已清除 pending 任务，但 DB 记录仍为 pending
  // 后果：账号恢复后 Fix26 的 30min 窗口会误认为任务仍在进行，阻止重新入队
  // 注意：creative_tasks.status CHECK 约束仅允许 pending/running/completed/failed，使用 failed
  try {
    await db.exec(
      `UPDATE creative_tasks
       SET status = 'failed',
           message = '账号暂停，任务已取消',
           updated_at = ${nowSql}
       WHERE user_id = ?
         AND status = 'pending'`,
      [userId]
    )
  } catch (err: any) {
    console.warn(`[user-task-suspension] Fix29: 清理 creative_tasks pending 记录失败 (userId=${userId}):`, err?.message || String(err))
  }

  const urlSwapNotDeletedCondition =
    db.type === 'postgres'
      ? '(is_deleted = FALSE OR is_deleted IS NULL)'
      : '(is_deleted = 0 OR is_deleted IS NULL)'

  const urlSwapDisabled = (
    await db.exec(
      `
        UPDATE url_swap_tasks
        SET status = 'disabled',
            updated_at = ${nowSql}
        WHERE user_id = ?
          AND status = 'enabled'
          AND ${urlSwapNotDeletedCondition}
      `,
      [userId]
    )
  ).changes
  await pauseUrlSwapTargetsByUserIds([userId])

  const purgeQueue = opts.purgeQueue ?? true
  let queuePurged = 0

  if (purgeQueue) {
    queuePurged = await purgeUserPendingQueueTasks(userId, USER_SUSPENDED_TASK_TYPES)
  }

  clearUserExecutionEligibilityCache(userId)

  return { clickFarmStopped, urlSwapDisabled, queuePurged }
}

export async function suspendBackgroundTasksForInactiveOrExpiredUsers(opts?: {
  purgeQueue?: boolean
}): Promise<{
  affectedUserIds: number[]
  clickFarmStopped: number
  urlSwapDisabled: number
  queuePurged: number
}> {
  const db = await getDatabase()
  const now = new Date()

  // 仅拉取“可能不合规”的用户：is_active=false 或 package_expires_at 不为空（后续在应用层判断是否过期）
  const candidates = await db.query<{
    id: number
    is_active: any
    package_expires_at: string | null
  }>(
    `
      SELECT id, is_active, package_expires_at
      FROM users
      WHERE is_active = ?
         OR package_expires_at IS NOT NULL
    `,
    [boolParam(false, db.type)]
  )

  const affectedUserIds = Array.from(
    new Set(
      candidates
        .filter((u) => !toBool(u.is_active) || isExpired(u.package_expires_at, now))
        .map((u) => u.id)
    )
  )

  if (affectedUserIds.length === 0) {
    return { affectedUserIds: [], clickFarmStopped: 0, urlSwapDisabled: 0, queuePurged: 0 }
  }

  const placeholders = affectedUserIds.map(() => '?').join(', ')
  const nowSql = nowFunc(db.type)

  const clickFarmStopped = (
    await db.exec(
      `
        UPDATE click_farm_tasks
        SET status = 'stopped',
            updated_at = ${nowSql}
        WHERE user_id IN (${placeholders})
          AND status IN ('pending', 'running', 'paused')
          AND IS_DELETED_FALSE
      `,
      [...affectedUserIds]
    )
  ).changes

  // Fix29b: 同步清理 creative_tasks DB 中的 pending 记录（批量暂停版本）
  // 与单用户版 Fix29 对齐：队列层已 purge，DB pending 记录需同步标 failed
  try {
    await db.exec(
      `UPDATE creative_tasks
       SET status = 'failed',
           message = '账号暂停，任务已取消',
           updated_at = ${nowSql}
       WHERE user_id IN (${placeholders})
         AND status = 'pending'`,
      [...affectedUserIds]
    )
  } catch (err: any) {
    console.warn(`[user-task-suspension] Fix29b: 批量清理 creative_tasks pending 记录失败:`, err?.message || String(err))
  }

  const urlSwapNotDeletedCondition =
    db.type === 'postgres'
      ? '(is_deleted = FALSE OR is_deleted IS NULL)'
      : '(is_deleted = 0 OR is_deleted IS NULL)'

  const urlSwapDisabled = (
    await db.exec(
      `
        UPDATE url_swap_tasks
        SET status = 'disabled',
            updated_at = ${nowSql}
        WHERE user_id IN (${placeholders})
          AND status = 'enabled'
          AND ${urlSwapNotDeletedCondition}
      `,
      [...affectedUserIds]
    )
  ).changes
  await pauseUrlSwapTargetsByUserIds(affectedUserIds)

  const purgeQueue = opts?.purgeQueue ?? true
  let queuePurged = 0
  if (purgeQueue) {
    for (const userId of affectedUserIds) {
      queuePurged += await purgeUserPendingQueueTasks(userId, USER_SUSPENDED_TASK_TYPES)
    }
  }

  for (const userId of affectedUserIds) {
    clearUserExecutionEligibilityCache(userId)
  }

  return { affectedUserIds, clickFarmStopped, urlSwapDisabled, queuePurged }
}
