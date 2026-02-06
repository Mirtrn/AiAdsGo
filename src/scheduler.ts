/**
 * 持续运行的定时任务调度服务
 * 使用node-cron实现定时调度，由supervisord管理进程
 *
 * 功能：
 * 1. 每小时执行补点击任务（迁移到统一队列系统）
 * 2. 每6小时同步Google Ads数据
 * 3. 每天凌晨2点备份数据库
 * 4. 每天凌晨3点清理90天前的数据
 * 5. 每天凌晨2点检查链接可用性和账号状态（需求20优化）
 * 6. 每天定时暂停禁用/过期用户的后台任务（补点击/换链接）
 * 6. [已禁用] A/B测试监控 - 当前业务场景未使用，暂时禁用以减少日志噪音
 */

import cron from 'node-cron'
import { getDatabase, getSQLiteDatabase } from './lib/db'
import { getQueueManager } from './lib/queue/unified-queue-manager'
// 🔄 已迁移到统一队列系统
import { triggerDataSync, triggerBackup, triggerLinkCheck, triggerCleanup } from './lib/queue-triggers'
// [已禁用] A/B测试功能当前未使用，暂时注释以避免无意义的定时任务执行
// import { runABTestMonitor } from './scheduler/ab-test-monitor'
import fs from 'fs'
import path from 'path'

// 日志函数
function log(message: string) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}

function logError(message: string, error: any) {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] ${message}`, error instanceof Error ? error.message : String(error))
}

function parseBoolean(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = String(value).trim().toLowerCase()
  return ['true', '1', 'yes', 'on'].includes(normalized)
}

const openclawStrategySchedules = new Map<number, { cron: string; task: cron.ScheduledTask }>()

async function enqueueOpenclawStrategy(userId: number, mode: string) {
  try {
    const queue = getQueueManager()
    await queue.enqueue(
      'openclaw-strategy',
      { userId, mode, trigger: 'cron' },
      userId,
      { priority: 'normal', maxRetries: 0 }
    )
    log(`🧠 OpenClaw策略已入队 (user=${userId}, mode=${mode})`)
  } catch (error) {
    logError(`❌ OpenClaw策略入队失败 (user=${userId})`, error)
  }
}

async function refreshOpenclawStrategySchedules() {
  const db = await getDatabase()
  const rows = await db.query<{
    user_id: number
    enabled: string | null
    cron: string | null
  }>(`
    SELECT
      ss.user_id,
      MAX(CASE WHEN ss.key = 'openclaw_strategy_enabled' THEN ss.value END) as enabled,
      MAX(CASE WHEN ss.key = 'openclaw_strategy_cron' THEN ss.value END) as cron
    FROM system_settings ss
    INNER JOIN users u ON u.id = ss.user_id
    WHERE ss.category = 'openclaw'
      AND ss.user_id IS NOT NULL
      AND ss.key IN ('openclaw_strategy_enabled', 'openclaw_strategy_cron')
      AND u.is_active = ?
      AND u.openclaw_enabled = ?
    GROUP BY ss.user_id
  `, [true, true])

  const activeUsers = new Set<number>()
  for (const row of rows || []) {
    const enabled = parseBoolean(row.enabled)
    if (!enabled) continue
    const cronExpr = (row.cron || '0 9 * * *').trim() || '0 9 * * *'
    if (!cron.validate(cronExpr)) {
      logError(`❌ OpenClaw策略cron无效 (user=${row.user_id})`, cronExpr)
      continue
    }

    activeUsers.add(row.user_id)
    const existing = openclawStrategySchedules.get(row.user_id)
    if (!existing || existing.cron !== cronExpr) {
      if (existing) {
        existing.task.stop()
      }
      const task = cron.schedule(cronExpr, async () => {
        await enqueueOpenclawStrategy(row.user_id, 'auto')
      }, {
        scheduled: true,
        timezone: 'Asia/Shanghai'
      })
      openclawStrategySchedules.set(row.user_id, { cron: cronExpr, task })
      log(`✅ OpenClaw策略调度已更新 (user=${row.user_id}, cron=${cronExpr})`)
    }
  }

  for (const [userId, schedule] of openclawStrategySchedules.entries()) {
    if (!activeUsers.has(userId)) {
      schedule.task.stop()
      openclawStrategySchedules.delete(userId)
      log(`⏸️  OpenClaw策略调度已移除 (user=${userId})`)
    }
  }
}

/**
 * 任务0: 补点击任务调度
 * 频率: 每小时执行一次
 * 🔄 已迁移到统一队列系统，自动检查并执行待处理的补点击任务
 */
async function clickFarmSchedulerTask() {
  log('🖱️ 开始执行补点击任务调度...')

  try {
    // 直接调用内部触发函数，不依赖外部cron
    const { triggerAllPendingTasks } = await import('./lib/click-farm/click-farm-scheduler-trigger')
    const result = await triggerAllPendingTasks()

    log(`🖱️ 补点击任务调度完成 - 处理: ${result.processed}, 入队: ${result.queued}, 跳过: ${result.skipped}, 暂停: ${result.paused}`)
  } catch (error) {
    logError('❌ 补点击任务调度执行失败:', error)
  }
}

/**
 * 任务1: 数据同步任务
 * 频率：根据用户在/settings页面配置的sync_interval_hours执行
 * 🔄 已迁移到统一队列系统，按用户配置执行
 */
async function syncDataTask() {
  log('📊 开始执行数据同步任务...')

  const db = await getDatabase()

  try {
    // 获取所有活跃用户及其同步配置
    // 🔥 修复（2025-12-13）：只选择配置了Google Ads凭证（refresh_token）的用户
    const activeUsers = await db.query<{
      id: number
      username: string
      email: string | null
      sync_interval_hours: string | null
      last_sync_at: string | null
    }>(`
      SELECT DISTINCT
        u.id,
        u.username,
        u.email,
        ss.value as sync_interval_hours,
        (SELECT MAX(started_at) FROM sync_logs WHERE user_id = u.id AND status = 'success') as last_sync_at
      FROM users u
      INNER JOIN google_ads_accounts ga ON u.id = ga.user_id
      LEFT JOIN system_settings ss ON ss.user_id = u.id
        AND ss.category = 'system'
        AND ss.key = 'sync_interval_hours'
      WHERE u.is_active = ?
        AND ga.is_active = ?
        AND ga.refresh_token IS NOT NULL
        AND ga.refresh_token != ''
    `, [true, true])

    log(`找到 ${activeUsers.length} 个活跃用户`)

    const now = new Date()
    let queuedCount = 0

    // 🔄 为每个用户检查是否需要同步
    for (const user of activeUsers) {
      // 获取用户配置的同步间隔（默认6小时）
      const syncIntervalHours = parseInt(user.sync_interval_hours || '6', 10)

      // 检查是否需要同步（距离上次同步超过配置的间隔）
      if (user.last_sync_at) {
        const lastSyncTime = new Date(user.last_sync_at)
        const hoursSinceLastSync = (now.getTime() - lastSyncTime.getTime()) / (1000 * 60 * 60)

        if (hoursSinceLastSync < syncIntervalHours) {
          log(`⏭️ 用户 ${user.username} 跳过同步（距上次同步 ${hoursSinceLastSync.toFixed(1)} 小时，配置间隔 ${syncIntervalHours} 小时）`)
          continue
        }
      }

      try {
        log(`正在为用户 ${user.username} (ID: ${user.id}) 入队同步任务...`)

        const taskId = await triggerDataSync(user.id, {
          syncType: 'auto',
          priority: 'normal'
        })

        log(`📥 用户 ${user.username} 同步任务已入队: ${taskId}`)
        queuedCount++
      } catch (error) {
        logError(`❌ 用户 ${user.username} 入队失败:`, error)
        // 继续处理下一个用户
        continue
      }
    }

    log(`📊 数据同步任务入队完成 - 已入队: ${queuedCount}/${activeUsers.length}`)
  } catch (error) {
    logError('❌ 数据同步任务执行失败:', error)
  }
}

/**
 * 任务2: 数据库备份任务
 * 频率：每天凌晨2点
 * 🔄 已迁移到统一队列系统
 */
async function backupDatabaseTask() {
  log('💾 开始执行数据库备份任务...')

  try {
    // 🔄 使用队列系统触发备份任务
    const taskId = await triggerBackup({
      backupType: 'auto'
    })
    log(`📥 数据库备份任务已入队: ${taskId}`)
  } catch (error) {
    logError('❌ 数据库备份任务入队失败:', error)
  }
}

/**
 * 任务3: 清理旧数据任务
 * 频率：每天凌晨3点
 * 🔄 已迁移到统一队列系统
 */
async function cleanupOldDataTask() {
  log('🗑️ 开始执行数据清理任务...')

  try {
    // 🔄 使用队列系统触发清理任务
    const taskId = await triggerCleanup({
      cleanupType: 'daily',
      retentionDays: 90,
      backupRetentionDays: 7,
      targets: ['performance', 'sync_logs', 'backups', 'link_check_history']
    })
    log(`📥 数据清理任务已入队: ${taskId}`)
  } catch (error) {
    logError('❌ 数据清理任务入队失败:', error)
  }
}

/**
 * 任务5: 禁用/过期用户后台任务暂停
 * 频率：每天一次（可配置）
 *
 * 策略：
 * - click-farm：标记为 stopped
 * - url-swap：标记为 disabled
 * - 清理队列中已入队但未执行的 click-farm/url-swap 任务（pending/delayed）
 *
 * 注意：任务不会在用户重新启用/续费后自动恢复，需用户手动重新开启。
 */
async function suspendInactiveOrExpiredUserTasksTask() {
  log('⛔️ 开始检查禁用/过期用户，并暂停补点击/换链接任务...')

  try {
    const { suspendBackgroundTasksForInactiveOrExpiredUsers } = await import('./lib/background-task-suspension')
    const result = await suspendBackgroundTasksForInactiveOrExpiredUsers({ purgeQueue: true })

    log(
      `⛔️ 完成 - affectedUsers=${result.affectedUserIds.length}, stoppedClickFarm=${result.clickFarmStopped}, disabledUrlSwap=${result.urlSwapDisabled}, purgedQueue=${result.queuePurged}`
    )
  } catch (error) {
    logError('❌ 禁用/过期用户任务暂停执行失败:', error)
  }
}

/**
 * 任务6: OpenClaw 每日报表推送（飞书）
 * 频率：每天上午9点（Asia/Shanghai）
 */
async function openclawDailyReportTask() {
  log('📨 开始推送 OpenClaw 每日报表...')

  const db = await getDatabase()

  try {
    const rows = await db.query<{
      user_id: number
      target: string | null
      doc_folder: string | null
      bitable_app: string | null
    }>(`
      SELECT
        ss.user_id,
        MAX(CASE WHEN ss.key = 'feishu_target' THEN ss.value END) as target,
        MAX(CASE WHEN ss.key = 'feishu_doc_folder_token' THEN ss.value END) as doc_folder,
        MAX(CASE WHEN ss.key = 'feishu_bitable_app_token' THEN ss.value END) as bitable_app
      FROM system_settings ss
      INNER JOIN users u ON u.id = ss.user_id
      WHERE ss.category = 'openclaw'
        AND ss.user_id IS NOT NULL
        AND ss.value IS NOT NULL
        AND ss.value != ''
        AND ss.key IN ('feishu_target', 'feishu_doc_folder_token', 'feishu_bitable_app_token')
        AND u.is_active = ?
      GROUP BY ss.user_id
    `, [true])

    if (!rows || rows.length === 0) {
      log('📭 未找到需要推送的OpenClaw用户')
      return
    }

    const { sendDailyReportToFeishu } = await import('./lib/openclaw/reports')

    let successCount = 0
    for (const row of rows) {
      try {
        await sendDailyReportToFeishu({
          userId: row.user_id,
          target: row.target || undefined,
        })
        successCount++
      } catch (error) {
        logError(`❌ OpenClaw报表推送失败 (user=${row.user_id})`, error)
      }
    }

    log(`📨 OpenClaw 报表推送完成 - 成功: ${successCount}/${rows.length}`)
  } catch (error) {
    logError('❌ OpenClaw 报表推送执行失败:', error)
  }
}

/**
 * 清理旧备份文件
 */
async function cleanupOldBackups(daysToKeep: number) {
  const backupDir = path.join(process.cwd(), 'data', 'backups')

  if (!fs.existsSync(backupDir)) {
    return
  }

  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000
  const files = fs.readdirSync(backupDir)

  let deletedCount = 0

  for (const file of files) {
    const filePath = path.join(backupDir, file)
    const stats = fs.statSync(filePath)

    if (stats.mtimeMs < cutoffTime) {
      fs.unlinkSync(filePath)
      deletedCount++
      log(`🗑️ 删除旧备份文件: ${file}`)
    }
  }

  if (deletedCount > 0) {
    log(`✅ 清理了 ${deletedCount} 个旧备份文件`)
  }
}

/**
 * 任务4: 链接可用性和账号状态检查
 * 频率：根据用户在/settings页面配置的link_check_time执行
 * 需求20优化：后续异步操作 - Ads账号状态检测、推广链接检测
 * 🔄 已迁移到统一队列系统，按用户配置执行
 */
async function linkAndAccountCheckTask() {
  log('🔍 开始执行链接可用性和账号状态检查任务...')

  const db = await getDatabase()

  try {
    // 获取所有启用了链接检查的用户配置
    const userConfigs = await db.query<{
      user_id: number
      link_check_enabled: string
      link_check_time: string
    }>(`
      SELECT
        ss.user_id,
        MAX(CASE WHEN ss.key = 'link_check_enabled' THEN ss.value END) as link_check_enabled,
        MAX(CASE WHEN ss.key = 'link_check_time' THEN ss.value END) as link_check_time
      FROM system_settings ss
      WHERE ss.category = 'system'
        AND ss.key IN ('link_check_enabled', 'link_check_time')
        AND ss.user_id IS NOT NULL
      GROUP BY ss.user_id
    `)

    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    let queuedCount = 0

    for (const config of userConfigs) {
      // 检查是否启用了链接检查
      if (config.link_check_enabled !== 'true') {
        continue
      }

      // 检查是否到了执行时间（允许5分钟误差）
      const checkTime = config.link_check_time || '02:00'
      if (!isTimeMatch(currentTime, checkTime, 5)) {
        continue
      }

      try {
        // 🔄 使用队列系统触发链接检查任务
        const taskId = await triggerLinkCheck({
          checkType: 'daily',
          userId: config.user_id,
          useUrlResolver: true  // 使用URL解析器验证链接
        })
        log(`📥 用户 ${config.user_id} 链接检查任务已入队: ${taskId}`)
        queuedCount++
      } catch (error) {
        logError(`❌ 用户 ${config.user_id} 链接检查任务入队失败:`, error)
      }
    }

    log(`🔍 链接检查任务入队完成 - 已入队: ${queuedCount}`)
  } catch (error) {
    logError('❌ 链接和账号检查任务执行失败:', error)
  }
}

/**
 * 检查当前时间是否匹配目标时间（允许一定分钟误差）
 */
function isTimeMatch(currentTime: string, targetTime: string, toleranceMinutes: number): boolean {
  const [currentHour, currentMin] = currentTime.split(':').map(Number)
  const [targetHour, targetMin] = targetTime.split(':').map(Number)

  const currentTotalMin = currentHour * 60 + currentMin
  const targetTotalMin = targetHour * 60 + targetMin

  return Math.abs(currentTotalMin - targetTotalMin) <= toleranceMinutes
}

/**
 * 启动调度器
 */
function startScheduler() {
  log('🚀 定时任务调度器启动')
  log('📅 任务调度计划:')
  log('  - 补点击任务: 每小时整点 (0 * * * *)')
  log('  - 数据同步: 每6小时 (0, 6, 12, 18点)')
  log('  - 数据库备份: 每天凌晨2点')
  log('  - 链接和账号检查: 每天凌晨2点 (需求20优化)')
  log('  - 数据清理: 每天凌晨3点')
  log('  - 禁用/过期用户任务暂停: 每天一次 (默认凌晨4点)')
  log('  - OpenClaw 每日报表推送: 每天上午9点')
  log('  - OpenClaw 策略调度: 按用户配置')
  log('  - A/B测试监控: [已禁用] 当前业务未使用')

  // 任务0: 每小时整点执行补点击任务调度
  // 注意：调度器的时区只影响触发时机，实际执行时间判断使用每个任务自己的时区
  console.log(`[Scheduler] 补点击任务调度器启动，当前时间: ${new Date().toISOString()}`);
  cron.schedule('0 * * * *', async () => {
    await clickFarmSchedulerTask()
  }, {
    scheduled: true
    // 不指定时区，使用系统默认 UTC
    // 每个任务的执行时间范围由其自身的 timezone 配置决定
  })

  // 任务1: 每6小时同步数据 (0, 6, 12, 18点)
  cron.schedule('0 */6 * * *', async () => {
    await syncDataTask()
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai' // 使用中国时区
  })

  // 任务2: 每天凌晨2点备份数据库
  cron.schedule('0 2 * * *', async () => {
    await backupDatabaseTask()
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  })

  // 任务3: 每天凌晨2点检查链接和账号状态（需求20优化）
  // 使用环境变量控制是否启用
  const linkCheckEnabled = process.env.LINK_CHECK_ENABLED !== 'false'
  const linkCheckCron = process.env.LINK_CHECK_CRON || '0 2 * * *'

  if (linkCheckEnabled) {
    cron.schedule(linkCheckCron, async () => {
      await linkAndAccountCheckTask()
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    })
    log(`✅ 链接和账号检查任务已启动 (cron: ${linkCheckCron})`)
  } else {
    log('⏸️  链接和账号检查任务已禁用 (LINK_CHECK_ENABLED=false)')
  }

  // 任务4: 每天凌晨3点清理旧数据
  cron.schedule('0 3 * * *', async () => {
    await cleanupOldDataTask()
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  })

  // 任务5: 每天定时暂停禁用/过期用户的后台任务（补点击/换链接）
  // 可通过环境变量控制启用与 Cron 表达式
  const userTaskSweepEnabled = process.env.USER_TASK_SWEEP_ENABLED !== 'false'
  const userTaskSweepCron = process.env.USER_TASK_SWEEP_CRON || '0 4 * * *'

  if (userTaskSweepEnabled) {
    cron.schedule(userTaskSweepCron, async () => {
      await suspendInactiveOrExpiredUserTasksTask()
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    })
    log(`✅ 禁用/过期用户任务暂停已启动 (cron: ${userTaskSweepCron})`)
  } else {
    log('⏸️  禁用/过期用户任务暂停已禁用 (USER_TASK_SWEEP_ENABLED=false)')
  }

  // 任务6: OpenClaw 每日报表推送
  cron.schedule('0 9 * * *', async () => {
    await openclawDailyReportTask()
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  })

  // 任务7: OpenClaw 策略调度（按用户配置）
  refreshOpenclawStrategySchedules().catch((error) => {
    logError('❌ OpenClaw策略调度初始化失败:', error)
  })
  cron.schedule('*/10 * * * *', async () => {
    await refreshOpenclawStrategySchedules()
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  })

  // [已禁用] 任务5: A/B测试监控
  // 原因：当前业务场景未使用A/B测试功能，数据库中无测试记录
  // 禁用以避免无意义的定时任务执行和日志噪音
  // 如需重新启用，取消以下注释并恢复顶部的import语句
  /*
  cron.schedule('0 * * * *', async () => {
    try {
      log('🔬 开始A/B测试监控任务...')
      await runABTestMonitor()
      log('✅ A/B测试监控任务完成')
    } catch (error: any) {
      logError('❌ A/B测试监控任务失败:', error)
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  })
  */

  log('✅ 所有定时任务已启动')

  // 启动时立即执行一次数据同步（可选）
  if (process.env.RUN_SYNC_ON_START === 'true') {
    log('🔄 启动时立即执行数据同步...')
    syncDataTask().catch((error) => {
      logError('启动同步失败:', error)
    })
  }
}

/**
 * 优雅退出
 */
function gracefulShutdown(signal: string) {
  log(`📴 收到 ${signal} 信号，正在优雅退出...`)

  // 给正在运行的任务最多30秒完成时间
  setTimeout(() => {
    log('✅ 调度器已停止')
    process.exit(0)
  }, 30000)
}

// 监听退出信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// 全局错误处理
process.on('uncaughtException', (error) => {
  logError('❌ 未捕获的异常:', error)
  // 不退出进程，让supervisord管理重启
})

process.on('unhandledRejection', (reason, promise) => {
  logError('❌ 未处理的Promise拒绝:', reason)
  // 不退出进程，让supervisord管理重启
})

// 启动调度器
startScheduler()

// 保持进程运行
log('💡 调度器进程运行中，按 Ctrl+C 停止')
