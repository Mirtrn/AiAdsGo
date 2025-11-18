/**
 * 定时数据同步脚本
 * 用于系统cron调度，自动同步Google Ads性能数据
 *
 * 使用方法：
 * 1. 添加到系统crontab（每6小时执行一次）
 * 2. 或使用PM2/Forever等进程管理器
 */

import { getDatabase } from '../src/lib/db'
import { dataSyncService } from '../src/lib/data-sync-service'

async function runSync() {
  console.log(`[${new Date().toISOString()}] 开始执行定时数据同步...`)

  const db = getDatabase()

  try {
    // 获取所有活跃用户
    const activeUsers = db
      .prepare(
        `
      SELECT DISTINCT u.id, u.email
      FROM users u
      INNER JOIN google_ads_accounts ga ON u.id = ga.user_id
      WHERE u.is_active = 1 AND ga.is_active = 1
    `
      )
      .all() as Array<{ id: number; email: string }>

    console.log(`找到 ${activeUsers.length} 个活跃用户需要同步数据`)

    // 为每个用户执行同步
    for (const user of activeUsers) {
      try {
        console.log(`正在为用户 ${user.email} (ID: ${user.id}) 同步数据...`)

        const result = await dataSyncService.syncPerformanceData(user.id, 'auto')

        console.log(
          `✅ 用户 ${user.email} 同步成功: ${result.record_count} 条记录, 耗时 ${result.duration_ms}ms`
        )
      } catch (error) {
        console.error(
          `❌ 用户 ${user.email} 同步失败:`,
          error instanceof Error ? error.message : String(error)
        )
        // 继续处理下一个用户
        continue
      }
    }

    console.log(`[${new Date().toISOString()}] 定时数据同步完成`)
  } catch (error) {
    console.error('❌ 定时数据同步失败:', error)
    process.exit(1)
  }
}

// 执行同步
runSync()
  .then(() => {
    console.log('✅ 同步任务执行完毕')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 同步任务执行失败:', error)
    process.exit(1)
  })
