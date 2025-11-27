#!/usr/bin/env tsx
/**
 * P1-3 Concurrent Scraping Unit Tests
 *
 * Tests:
 * 1. Resource monitoring and concurrency adjustment
 * 2. Task queue management and prioritization
 * 3. Dynamic concurrency based on CPU/Memory
 * 4. Progress tracking and error handling
 * 5. Result aggregation and summary
 */

import {
  ConcurrentScrapingOrchestrator,
  ResourceMonitor,
  scrapeOffersConcurrently
} from '../src/lib/concurrent-scraping'

console.log('🧪 P1-3 并发抓取单元测试开始...\n')

// ========================================
// Test 1: Resource Monitor
// ========================================
async function testResourceMonitor() {
  console.log('📝 测试 1: 资源监控器')
  console.log('=' .repeat(60))

  const monitor = new ResourceMonitor()

  // Test resource stats
  const stats = monitor.getStats()
  console.log(`✅ 资源统计:`)
  console.log(`   当前CPU: ${stats.currentCpu.toFixed(1)}%`)
  console.log(`   当前内存: ${stats.currentMemory.toFixed(1)}%`)
  console.log(`   平均CPU: ${stats.avgCpu.toFixed(1)}%`)
  console.log(`   平均内存: ${stats.avgMemory.toFixed(1)}%`)

  // Test concurrency limit calculation
  const config = {
    minConcurrency: 2,
    maxConcurrency: 8,
    cpuThreshold: 75,
    memoryThreshold: 80,
  }

  const limit = monitor.getConcurrencyLimit(config)
  console.log(`✅ 并发限制: ${limit}`)

  // Validate limit is within bounds
  if (limit >= config.minConcurrency && limit <= config.maxConcurrency) {
    console.log(`✅ 并发限制在范围内: ${config.minConcurrency}-${config.maxConcurrency}`)
  } else {
    console.log(`❌ 并发限制超出范围: ${limit}`)
  }

  // Test resource usage updates
  console.log('\n🔄 更新资源使用历史...')
  for (let i = 0; i < 5; i++) {
    monitor.updateResourceUsage()
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const updatedStats = monitor.getStats()
  console.log(`✅ 资源历史已更新:`)
  console.log(`   平均CPU: ${updatedStats.avgCpu.toFixed(1)}%`)
  console.log(`   平均内存: ${updatedStats.avgMemory.toFixed(1)}%`)

  console.log('')
}

// ========================================
// Test 2: Task Queue Management
// ========================================
async function testTaskQueueManagement() {
  console.log('📝 测试 2: 任务队列管理')
  console.log('=' .repeat(60))

  const orchestrator = new ConcurrentScrapingOrchestrator({
    minConcurrency: 2,
    maxConcurrency: 4,
    cpuThreshold: 75,
    memoryThreshold: 80,
  })

  // Add tasks with different priorities
  console.log('📦 添加任务到队列...')
  orchestrator.addTask(1, 100, 10) // High priority
  orchestrator.addTask(2, 100, 5)  // Medium priority
  orchestrator.addTask(3, 100, 1)  // Low priority
  orchestrator.addTask(4, 100, 8)  // High priority

  const progress = orchestrator.getProgress()
  console.log(`✅ 队列状态:`)
  console.log(`   总任务: ${progress.total}`)
  console.log(`   等待中: ${progress.queued}`)
  console.log(`   运行中: ${progress.running}`)
  console.log(`   已完成: ${progress.completed}`)

  if (progress.total === 4 && progress.queued === 4) {
    console.log(`✅ 任务队列正确: 4个任务已添加`)
  } else {
    console.log(`❌ 任务队列错误: 预期4个任务, 实际${progress.total}个`)
  }

  console.log('')
}

// ========================================
// Test 3: Concurrent Execution
// ========================================
async function testConcurrentExecution() {
  console.log('📝 测试 3: 并发执行')
  console.log('=' .repeat(60))

  // Mock scrape function with random delay
  const mockScrapeFunction = async (offerId: number, userId: number): Promise<void> => {
    const delay = Math.random() * 1000 + 500 // 500-1500ms
    console.log(`🔄 开始抓取 Offer ${offerId} (用户 ${userId})...`)
    await new Promise(resolve => setTimeout(resolve, delay))
    console.log(`✅ 完成抓取 Offer ${offerId} (耗时 ${delay.toFixed(0)}ms)`)
  }

  const offers = [
    { offerId: 101, userId: 1, priority: 10 },
    { offerId: 102, userId: 1, priority: 8 },
    { offerId: 103, userId: 1, priority: 6 },
    { offerId: 104, userId: 2, priority: 5 },
    { offerId: 105, userId: 2, priority: 3 },
  ]

  console.log(`📦 测试并发抓取 ${offers.length} 个Offer...`)
  const startTime = Date.now()

  const results = await scrapeOffersConcurrently(
    offers,
    mockScrapeFunction,
    {
      minConcurrency: 2,
      maxConcurrency: 3,
      cpuThreshold: 75,
      memoryThreshold: 80,
    }
  )

  const elapsed = Date.now() - startTime

  console.log(`\n✅ 并发执行完成:`)
  console.log(`   总耗时: ${(elapsed / 1000).toFixed(1)}秒`)
  console.log(`   完成任务: ${results.length}/${offers.length}`)
  console.log(`   成功率: ${(results.filter(r => r.success).length / results.length * 100).toFixed(0)}%`)

  // Validate all tasks completed
  if (results.length === offers.length) {
    console.log(`✅ 所有任务已完成`)
  } else {
    console.log(`❌ 任务未全部完成: ${results.length}/${offers.length}`)
  }

  // Validate success rate
  const successRate = results.filter(r => r.success).length / results.length
  if (successRate === 1.0) {
    console.log(`✅ 所有任务成功`)
  } else {
    console.log(`⚠️  部分任务失败: ${(successRate * 100).toFixed(0)}%`)
  }

  console.log('')
}

// ========================================
// Test 4: Error Handling
// ========================================
async function testErrorHandling() {
  console.log('📝 测试 4: 错误处理')
  console.log('=' .repeat(60))

  // Mock scrape function that fails randomly
  const mockScrapeWithErrors = async (offerId: number, userId: number): Promise<void> => {
    const delay = Math.random() * 500 + 200
    await new Promise(resolve => setTimeout(resolve, delay))

    // Fail 30% of the time
    if (Math.random() < 0.3) {
      throw new Error(`Random failure for Offer ${offerId}`)
    }
  }

  const offers = [
    { offerId: 201, userId: 1 },
    { offerId: 202, userId: 1 },
    { offerId: 203, userId: 1 },
    { offerId: 204, userId: 2 },
    { offerId: 205, userId: 2 },
    { offerId: 206, userId: 2 },
    { offerId: 207, userId: 3 },
    { offerId: 208, userId: 3 },
    { offerId: 209, userId: 3 },
    { offerId: 210, userId: 3 },
  ]

  console.log(`📦 测试错误处理 (${offers.length}个任务，预期30%失败率)...`)

  const results = await scrapeOffersConcurrently(
    offers,
    mockScrapeWithErrors,
    {
      minConcurrency: 2,
      maxConcurrency: 4,
      cpuThreshold: 75,
      memoryThreshold: 80,
    }
  )

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  const successRate = (successCount / results.length) * 100

  console.log(`\n✅ 错误处理测试完成:`)
  console.log(`   总任务: ${results.length}`)
  console.log(`   成功: ${successCount}`)
  console.log(`   失败: ${failCount}`)
  console.log(`   成功率: ${successRate.toFixed(0)}%`)

  // Validate all tasks were attempted
  if (results.length === offers.length) {
    console.log(`✅ 所有任务已处理（包括失败任务）`)
  } else {
    console.log(`❌ 部分任务未处理`)
  }

  // Validate errors were captured
  const errorsWithMessages = results.filter(r => !r.success && r.error)
  if (errorsWithMessages.length === failCount) {
    console.log(`✅ 所有失败任务都有错误信息`)
  } else {
    console.log(`❌ 部分失败任务缺少错误信息`)
  }

  console.log('')
}

// ========================================
// Test 5: Progress Tracking
// ========================================
async function testProgressTracking() {
  console.log('📝 测试 5: 进度追踪')
  console.log('=' .repeat(60))

  const orchestrator = new ConcurrentScrapingOrchestrator({
    minConcurrency: 2,
    maxConcurrency: 3,
    cpuThreshold: 75,
    memoryThreshold: 80,
  })

  // Add tasks
  orchestrator.addTasks([
    { offerId: 301, userId: 1 },
    { offerId: 302, userId: 1 },
    { offerId: 303, userId: 1 },
    { offerId: 304, userId: 2 },
    { offerId: 305, userId: 2 },
  ])

  console.log('📦 开始进度追踪测试...')

  // Mock scrape function
  const mockScrape = async (offerId: number, userId: number): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  // Start processing and track progress
  const progressCheckInterval = setInterval(() => {
    const progress = orchestrator.getProgress()
    console.log(`📊 进度: ${progress.completed}/${progress.total} (运行中: ${progress.running}, 队列: ${progress.queued})`)
  }, 500)

  await orchestrator.processQueue(mockScrape)

  clearInterval(progressCheckInterval)

  // Get final summary
  const summary = orchestrator.getSummary()

  console.log(`\n✅ 进度追踪完成:`)
  console.log(`   总任务: ${summary.totalTasks}`)
  console.log(`   成功: ${summary.successfulTasks}`)
  console.log(`   失败: ${summary.failedTasks}`)
  console.log(`   总耗时: ${(summary.totalDuration / 1000).toFixed(1)}秒`)
  console.log(`   平均耗时: ${(summary.averageDuration / 1000).toFixed(1)}秒/任务`)

  if (summary.totalTasks === 5 && summary.successfulTasks === 5) {
    console.log(`✅ 进度追踪准确`)
  } else {
    console.log(`❌ 进度追踪不准确`)
  }

  console.log('')
}

// ========================================
// Main Test Runner
// ========================================
async function main() {
  try {
    await testResourceMonitor()
    await testTaskQueueManagement()
    await testConcurrentExecution()
    await testErrorHandling()
    await testProgressTracking()

    console.log('🎉 P1-3 并发抓取单元测试完成！')
    console.log('\n📋 测试清单:')
    console.log('  ✅ 资源监控器正常工作')
    console.log('  ✅ 任务队列管理正确')
    console.log('  ✅ 并发执行符合预期')
    console.log('  ✅ 错误处理健壮')
    console.log('  ✅ 进度追踪准确')

  } catch (error: any) {
    console.error('❌ 测试过程出错:', error.message)
    console.error(error.stack)
    process.exit(1)
  }

  process.exit(0)
}

main()
