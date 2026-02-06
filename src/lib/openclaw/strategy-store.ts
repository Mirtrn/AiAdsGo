import crypto from 'crypto'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'

export async function createStrategyRun(params: {
  userId: number
  mode: string
  runDate: string
  configJson?: string | null
}): Promise<string> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const runId = crypto.randomUUID()

  const insertSql = `INSERT INTO openclaw_strategy_runs
     (id, user_id, mode, status, run_date, config_json, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ${nowFunc}, ${nowFunc})`

  await db.exec(insertSql, [
    runId,
    params.userId,
    params.mode,
    params.runDate,
    params.configJson || null,
  ])

  return runId
}

export async function updateStrategyRun(params: {
  runId: string
  status?: string
  statsJson?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}): Promise<void> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const fields: string[] = []
  const values: any[] = []

  if (params.status) {
    fields.push('status = ?')
    values.push(params.status)
  }
  if (params.statsJson !== undefined) {
    fields.push('stats_json = ?')
    values.push(params.statsJson)
  }
  if (params.errorMessage !== undefined) {
    fields.push('error_message = ?')
    values.push(params.errorMessage)
  }
  if (params.startedAt !== undefined) {
    fields.push('started_at = ?')
    values.push(params.startedAt)
  }
  if (params.completedAt !== undefined) {
    fields.push('completed_at = ?')
    values.push(params.completedAt)
  }

  if (fields.length === 0) return

  await db.exec(
    `UPDATE openclaw_strategy_runs
     SET ${fields.join(', ')}, updated_at = ${nowFunc}
     WHERE id = ?`,
    [...values, params.runId]
  )
}

export async function recordStrategyAction(params: {
  runId: string
  userId: number
  actionType: string
  targetType?: string | null
  targetId?: string | null
  status?: string
  requestJson?: string | null
  responseJson?: string | null
  errorMessage?: string | null
}): Promise<number> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const insertSql = db.type === 'postgres'
    ? `INSERT INTO openclaw_strategy_actions
       (run_id, user_id, action_type, target_type, target_id, status, request_json, response_json, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}) RETURNING id`
    : `INSERT INTO openclaw_strategy_actions
       (run_id, user_id, action_type, target_type, target_id, status, request_json, response_json, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc})`

  const result = await db.exec(insertSql, [
    params.runId,
    params.userId,
    params.actionType,
    params.targetType || null,
    params.targetId || null,
    params.status || 'pending',
    params.requestJson || null,
    params.responseJson || null,
    params.errorMessage || null,
  ])

  return getInsertedId(result, db.type)
}

export async function updateStrategyAction(params: {
  actionId: number
  status?: string
  responseJson?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const db = await getDatabase()
  const fields: string[] = []
  const values: any[] = []

  if (params.status) {
    fields.push('status = ?')
    values.push(params.status)
  }
  if (params.responseJson !== undefined) {
    fields.push('response_json = ?')
    values.push(params.responseJson)
  }
  if (params.errorMessage !== undefined) {
    fields.push('error_message = ?')
    values.push(params.errorMessage)
  }

  if (fields.length === 0) return

  await db.exec(
    `UPDATE openclaw_strategy_actions SET ${fields.join(', ')} WHERE id = ?`,
    [...values, params.actionId]
  )
}
