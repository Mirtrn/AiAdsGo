#!/usr/bin/env tsx
/**
 * 检查生产环境队列状态
 *
 * 用途：
 * 1. 查看Redis中的所有任务状态
 * 2. 查看PostgreSQL数据库中的未完成任务
 * 3. 诊断为何/admin/queue显示8个运行中任务
 *
 * 使用方法：
 * DATABASE_URL=postgresql://<db_user>:<db_password>@<db_host>:<db_port>/<db_name> \
 * REDIS_URL=redis://<redis_user>:<redis_password>@<redis_host>:<redis_port> \
 * tsx scripts/inspect-production-queue.ts
 */

import postgres from 'postgres'
import Redis from 'ioredis'

const DATABASE_URL = process.env.DATABASE_URL
const REDIS_URL = process.env.REDIS_URL || 'redis://<redis_user>:<redis_password>@<redis_host>:<redis_port>'

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 环境变量未设置')
  process.exit(1)
}

async function main() {
  console.log('========================================')
  console.log('🔍 生产环境队列诊断工具')
  console.log('========================================\n')

  // 1. 检查 Redis
  console.log('📦 连接到 Redis...')
  const redis = new Redis(REDIS_URL)

  try {
    const redisKeyPrefix = 'autoads:queue:'

    console.log('\n🔍 扫描 Redis 队列任务...\n')

    // 检查所有可能的key pattern
    const allKeys = await redis.keys(`${redisKeyPrefix}*`)
    console.log(`  📋 Redis Keys 总数: ${allKeys.length}`)
    console.log(`  Keys: ${allKeys.join(', ')}\n`)

    // 获取所有 pending 任务
    const pendingAllCount = await redis.zcard(`${redisKeyPrefix}pending:all`)
    console.log(`  📋 Pending All 任务数: ${pendingAllCount}`)

    // 获取所有 running 任务
    const runningTasks = await redis.smembers(`${redisKeyPrefix}running`)
    console.log(`  🔄 Running 任务数: ${runningTasks.length}`)

    if (runningTasks.length > 0) {
      console.log(`  Running Task IDs:`)
      for (const taskId of runningTasks) {
        const taskData = await redis.hget(`${redisKeyPrefix}tasks`, taskId)
        if (taskData) {
          const task = JSON.parse(taskData)
          console.log(`    - ${taskId}: type=${task.type}, user=${task.userId}, status=${task.status}`)
        } else {
          console.log(`    - ${taskId}: [Task data not found]`)
        }
      }
    }

    // 获取所有 completed 任务
    const completedCount = await redis.scard(`${redisKeyPrefix}completed`)
    console.log(`  ✅ Completed 任务数: ${completedCount}`)

    // 获取所有 failed 任务
    const failedCount = await redis.scard(`${redisKeyPrefix}failed`)
    console.log(`  ❌ Failed 任务数: ${failedCount}`)

    // 检查任务类型分布
    console.log('\n  📊 任务类型分布:')
    const taskTypes = [
      'scrape',
      'offer-extraction',
      'batch-offer-creation',
      'ai-analysis',
      'sync',
      'backup',
      'email',
      'export',
      'link-check',
      'cleanup'
    ]

    for (const taskType of taskTypes) {
      const pendingCount = await redis.zcard(`${redisKeyPrefix}pending:${taskType}`)
      if (pendingCount > 0) {
        console.log(`    ${taskType}: ${pendingCount} pending`)
      }
    }

    // 检查用户队列
    const userKeys = await redis.keys(`${redisKeyPrefix}user:*:pending`)
    console.log(`\n  👥 用户队列数: ${userKeys.length}`)
    for (const key of userKeys) {
      const userId = key.match(/user:(\d+):pending/)?.[1]
      const count = await redis.zcard(key)
      if (count > 0) {
        console.log(`    User ${userId}: ${count} pending`)
      }
    }

  } catch (error) {
    console.error('❌ Redis 检查失败:', error)
  } finally {
    await redis.quit()
  }

  // 2. 检查 PostgreSQL
  console.log('\n📦 连接到 PostgreSQL...')
  const sql = postgres(DATABASE_URL)

  try {
    // 检查 offer_tasks 表
    const offerTasksExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'offer_tasks'
      )
    `

    if (offerTasksExists[0].exists) {
      console.log('\n🔍 检查 offer_tasks 表...\n')

      // 统计任务状态
      const stats = await sql`
        SELECT
          status,
          COUNT(*) as count
        FROM offer_tasks
        GROUP BY status
        ORDER BY count DESC
      `

      console.log('  📊 任务状态统计:')
      for (const row of stats) {
        console.log(`    ${row.status}: ${row.count}`)
      }

      // 显示最近的running任务详情
      const runningTasks = await sql`
        SELECT id, user_id, status, stage, message, progress, created_at, started_at
        FROM offer_tasks
        WHERE status = 'running'
        ORDER BY started_at DESC
        LIMIT 10
      `

      if (runningTasks.length > 0) {
        console.log(`\n  🔄 Running 任务详情:`)
        for (const task of runningTasks) {
          console.log(`    - ID: ${task.id}`)
          console.log(`      User: ${task.user_id}`)
          console.log(`      Stage: ${task.stage}`)
          console.log(`      Progress: ${task.progress}%`)
          console.log(`      Message: ${task.message}`)
          console.log(`      Created: ${task.created_at}`)
          console.log(`      Started: ${task.started_at}`)
          console.log('')
        }
      }
    } else {
      console.log('⚠️  offer_tasks 表不存在')
    }

    // 检查 batch_tasks 表
    const batchTasksExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'batch_tasks'
      )
    `

    if (batchTasksExists[0].exists) {
      console.log('\n🔍 检查 batch_tasks 表...\n')

      // 统计批量任务状态
      const batchStats = await sql`
        SELECT
          status,
          COUNT(*) as count
        FROM batch_tasks
        GROUP BY status
        ORDER BY count DESC
      `

      console.log('  📊 批量任务状态统计:')
      for (const row of batchStats) {
        console.log(`    ${row.status}: ${row.count}`)
      }

      // 显示最近的running批量任务
      const runningBatches = await sql`
        SELECT id, user_id, status, total_count, completed_count, failed_count, created_at, started_at
        FROM batch_tasks
        WHERE status = 'running'
        ORDER BY started_at DESC
        LIMIT 10
      `

      if (runningBatches.length > 0) {
        console.log(`\n  🔄 Running 批量任务详情:`)
        for (const batch of runningBatches) {
          console.log(`    - ID: ${batch.id}`)
          console.log(`      User: ${batch.user_id}`)
          console.log(`      Total: ${batch.total_count}, Completed: ${batch.completed_count}, Failed: ${batch.failed_count}`)
          console.log(`      Created: ${batch.created_at}`)
          console.log(`      Started: ${batch.started_at}`)
          console.log('')
        }
      }
    } else {
      console.log('⚠️  batch_tasks 表不存在')
    }

  } catch (error) {
    console.error('❌ PostgreSQL 检查失败:', error)
  } finally {
    await sql.end()
  }

  console.log('========================================')
  console.log('✅ 诊断完成')
  console.log('========================================')
}

main().catch(console.error)
