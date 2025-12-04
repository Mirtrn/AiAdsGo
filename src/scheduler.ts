/**
 * 持续运行的定时任务调度服务
 * 使用node-cron实现定时调度，由supervisord管理进程
 *
 * 功能：
 * 1. 每6小时同步Google Ads数据
 * 2. 每天凌晨2点备份数据库
 * 3. 每天凌晨3点清理90天前的数据
 * 4. 每天凌晨2点检查链接可用性和账号状态（需求20优化）
 * 5. [已禁用] A/B测试监控 - 当前业务场景未使用，暂时禁用以减少日志噪音
 */

import cron from 'node-cron'
import { getDatabase, getSQLiteDatabase } from './lib/db'
import { dataSyncService } from './lib/data-sync-service'
import { backupDatabase } from './lib/backup'
import { dailyLinkCheck } from './lib/risk-alerts'
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

/**
 * 任务1: 数据同步任务
 * 频率：每6小时（0点、6点、12点、18点）
 */
async function syncDataTask() {
  log('📊 开始执行数据同步任务...')

  const db = await getDatabase()

  try {
    // 获取所有活跃用户
    const activeUsers = await db.query<{ id: number; username: string; email: string | null }>(
      `
      SELECT DISTINCT u.id, u.username, u.email
      FROM users u
      INNER JOIN google_ads_accounts ga ON u.id = ga.user_id
      WHERE u.is_active = ? AND ga.is_active = ?
      `,
      [true, true]
    )

    log(`找到 ${activeUsers.length} 个活跃用户需要同步数据`)

    let successCount = 0
    let failCount = 0

    // 为每个用户执行同步
    for (const user of activeUsers) {
      try {
        log(`正在为用户 ${user.username} (ID: ${user.id}) 同步数据...`)

        const result = await dataSyncService.syncPerformanceData(user.id, 'auto')

        log(
          `✅ 用户 ${user.username} 同步成功: ${result.record_count} 条记录, 耗时 ${result.duration_ms}ms`
        )
        successCount++
      } catch (error) {
        logError(`❌ 用户 ${user.username} 同步失败:`, error)
        failCount++
        // 继续处理下一个用户
        continue
      }
    }

    log(`📊 数据同步任务完成 - 成功: ${successCount}, 失败: ${failCount}`)
  } catch (error) {
    logError('❌ 数据同步任务执行失败:', error)
  }
}

/**
 * 任务2: 数据库备份任务
 * 频率：每天凌晨2点
 */
async function backupDatabaseTask() {
  log('💾 开始执行数据库备份任务...')

  try {
    const result = await backupDatabase('auto')
    if (result.success && result.backupPath) {
      log(`✅ 数据库备份成功: ${result.backupPath}`)
      // 清理7天前的备份文件
      await cleanupOldBackups(7)
    } else {
      logError('❌ 数据库备份失败:', result.errorMessage || '未知错误')
    }
  } catch (error) {
    logError('❌ 数据库备份失败:', error)
  }
}

/**
 * 任务3: 清理旧数据任务
 * 频率：每天凌晨3点
 */
async function cleanupOldDataTask() {
  log('🗑️ 开始执行数据清理任务...')

  const db = await getDatabase()

  try {
    // 计算90天前的日期
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 90)
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0]

    // 清理campaign_performance表
    const deletedCampaignRows = await db.exec(
      'DELETE FROM campaign_performance WHERE date < ?',
      [cutoffDateStr]
    )

    // 清理sync_logs表
    const deletedSyncLogs = await db.exec(
      'DELETE FROM sync_logs WHERE started_at < ?',
      [cutoffDateStr]
    )

    log(
      `✅ 数据清理完成 - 删除 ${deletedCampaignRows.changes} 条性能数据, ${deletedSyncLogs.changes} 条同步日志`
    )
  } catch (error) {
    logError('❌ 数据清理任务执行失败:', error)
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
 * 频率：每天凌晨2点
 * 需求20优化：后续异步操作 - Ads账号状态检测、推广链接检测
 */
async function linkAndAccountCheckTask() {
  log('🔍 开始执行链接可用性和账号状态检查任务...')

  try {
    const result = await dailyLinkCheck()

    log(
      `✅ 链接和账号检查完成 - 用户数: ${result.totalUsers}, 链接数: ${result.totalLinks}, 新风险提示: ${result.totalAlerts}`
    )
    log(
      `   账号检查: ${result.accountChecks.totalAccounts}个账号, ${result.accountChecks.problemAccounts}个异常`
    )

    // 详细统计
    const { totalLinks, results } = result
    let broken = 0
    let redirected = 0

    Object.values(results).forEach((r) => {
      broken += r.broken
      redirected += r.redirected
    })

    log(`   链接状态: ${broken}个失效, ${redirected}个重定向`)
  } catch (error) {
    logError('❌ 链接和账号检查任务执行失败:', error)
  }
}

/**
 * 启动调度器
 */
function startScheduler() {
  log('🚀 定时任务调度器启动')
  log('📅 任务调度计划:')
  log('  - 数据同步: 每6小时 (0, 6, 12, 18点)')
  log('  - 数据库备份: 每天凌晨2点')
  log('  - 链接和账号检查: 每天凌晨2点 (需求20优化)')
  log('  - 数据清理: 每天凌晨3点')
  log('  - A/B测试监控: [已禁用] 当前业务未使用')

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
