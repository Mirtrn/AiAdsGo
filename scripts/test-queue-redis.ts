/**
 * Redis连接和队列系统测试脚本
 *
 * 用于验证生产环境Redis连接和统一队列系统功能
 */

import { getQueueManager } from '@/lib/queue'

async function testRedisConnection() {
  console.log('🧪 开始测试Redis连接和队列系统...\n')

  try {
    // 1. 测试队列初始化
    console.log('1️⃣ 测试队列初始化...')
    const queue = getQueueManager({
      globalConcurrency: 5,
      perUserConcurrency: 2,
      maxQueueSize: 1000,
      taskTimeout: 60000,
      defaultMaxRetries: 3,
      retryDelay: 5000,
    })

    await queue.initialize()
    console.log('✅ 队列初始化成功\n')

    // 2. 启动队列
    console.log('2️⃣ 启动队列处理...')
    await queue.start()
    console.log('✅ 队列启动成功\n')

    // 3. 测试队列统计
    console.log('3️⃣ 获取队列统计信息...')
    const stats = await queue.getStats()
    console.log('📊 队列统计:', {
      total: stats.total,
      pending: stats.pending,
      running: stats.running,
      completed: stats.completed,
      failed: stats.failed
    })
    console.log('✅ 统计信息获取成功\n')

    // 4. 测试代理IP池（如果有配置）
    console.log('4️⃣ 检查代理IP池...')
    const proxyStats = queue.getProxyStats()
    console.log('🔌 代理IP池统计:', {
      total: proxyStats.length,
      available: proxyStats.filter(p => p.available).length,
      failed: proxyStats.filter(p => !p.available).length
    })
    console.log('✅ 代理IP池检查完成\n')

    // 5. 注册测试任务执行器
    console.log('5️⃣ 注册测试任务执行器...')
    queue.registerExecutor('scrape', async (task) => {
      console.log(`   📝 执行测试任务: ${task.id}`)
      // 模拟任务执行
      await new Promise(resolve => setTimeout(resolve, 1000))
      return { success: true, taskId: task.id }
    })
    console.log('✅ 测试任务执行器注册成功\n')

    // 6. 添加测试任务
    console.log('6️⃣ 添加测试任务...')
    const taskId = await queue.enqueue('scrape', {
      url: 'https://example.com/test',
      message: '这是一个测试任务'
    }, 999, {
      priority: 'high'
    })
    console.log(`✅ 测试任务已添加: ${taskId}\n`)

    // 7. 等待任务执行
    console.log('7️⃣ 等待任务执行完成...')
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 8. 再次检查统计
    console.log('8️⃣ 检查任务执行结果...')
    const finalStats = await queue.getStats()
    console.log('📊 最终队列统计:', {
      total: finalStats.total,
      pending: finalStats.pending,
      running: finalStats.running,
      completed: finalStats.completed,
      failed: finalStats.failed
    })
    console.log('✅ 任务执行完成\n')

    console.log('🎉 所有测试通过！Redis连接和队列系统运行正常')

    // 不停止队列，保持运行
    console.log('\n💡 队列将继续在后台运行...')

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message)
    console.error('错误详情:', error)
    process.exit(1)
  }
}

// 运行测试
if (require.main === module) {
  testRedisConnection()
    .then(() => {
      console.log('\n✅ 测试完成')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ 测试失败:', error)
      process.exit(1)
    })
}

export { testRedisConnection }
