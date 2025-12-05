import { randomUUID } from 'crypto'
import type {
  Task,
  TaskType,
  TaskPriority,
  TaskExecutor,
  QueueConfig,
  QueueStats,
  QueueStorageAdapter,
  ProxyConfig
} from './types'
import { MemoryQueueAdapter } from './memory-adapter'
import { RedisQueueAdapter } from './redis-adapter'
import { SimpleProxyManager } from './proxy-manager'

/**
 * 统一队列管理器
 *
 * 核心功能:
 * 1. Redis优先 + 内存回退
 * 2. 三层并发控制 (全局/用户/类型)
 * 3. 代理IP池管理
 * 4. 任务执行器注册
 * 5. 自动重试机制
 */
export class UnifiedQueueManager {
  private adapter: QueueStorageAdapter
  private config: QueueConfig
  private executors: Map<TaskType, TaskExecutor> = new Map()
  private proxyManager: SimpleProxyManager
  private running: boolean = false
  private processingLoop: NodeJS.Timeout | null = null

  // 并发控制
  private globalRunningCount: number = 0
  private perUserRunningCount: Map<number, number> = new Map()
  private perTypeRunningCount: Map<TaskType, number> = new Map()

  constructor(config: Partial<QueueConfig> = {}) {
    // 合并默认配置
    this.config = {
      globalConcurrency: config.globalConcurrency || 5,
      perUserConcurrency: config.perUserConcurrency || 2,
      perTypeConcurrency: config.perTypeConcurrency || {
        scrape: 3,
        'ai-analysis': 2,
        sync: 1,
        backup: 1,
        email: 3,
        export: 2
      },
      maxQueueSize: config.maxQueueSize || 1000,
      taskTimeout: config.taskTimeout || 60000,
      defaultMaxRetries: config.defaultMaxRetries || 3,
      retryDelay: config.retryDelay || 5000,
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      redisKeyPrefix: config.redisKeyPrefix || 'autoads:queue:',
      proxyPool: config.proxyPool || [],
      proxyRotation: config.proxyRotation !== false
    }

    // 初始化代理管理器
    this.proxyManager = new SimpleProxyManager(this.config.proxyPool || [])

    // 初始化存储适配器（Redis优先 → 内存回退）
    this.adapter = this.createAdapter()
  }

  /**
   * 创建存储适配器（Redis优先 → 内存回退）
   */
  private createAdapter(): QueueStorageAdapter {
    if (this.config.redisUrl) {
      console.log('🔄 尝试连接Redis队列...')
      return new RedisQueueAdapter(
        this.config.redisUrl,
        this.config.redisKeyPrefix
      )
    } else {
      console.log('⚠️ REDIS_URL未配置，使用内存队列')
      return new MemoryQueueAdapter()
    }
  }

  /**
   * 初始化队列（连接存储）
   */
  async initialize(): Promise<void> {
    try {
      await this.adapter.connect()
      console.log(`✅ 队列已初始化: ${this.adapter.constructor.name}`)
    } catch (error: any) {
      console.error('❌ Redis连接失败，回退到内存队列:', error.message)

      // 回退到内存队列
      this.adapter = new MemoryQueueAdapter()
      await this.adapter.connect()
      console.log('✅ 内存队列已启用')
    }
  }

  /**
   * 启动队列处理
   */
  async start(): Promise<void> {
    if (this.running) return

    this.running = true
    console.log('🚀 队列处理已启动')

    // 启动处理循环（每100ms检查一次）
    this.processingLoop = setInterval(() => {
      this.processQueue()
    }, 100)
  }

  /**
   * 停止队列处理
   */
  async stop(): Promise<void> {
    if (!this.running) return

    this.running = false

    if (this.processingLoop) {
      clearInterval(this.processingLoop)
      this.processingLoop = null
    }

    await this.adapter.disconnect()
    console.log('⏹️ 队列处理已停止')
  }

  /**
   * 注册任务执行器
   */
  registerExecutor<T = any, R = any>(
    type: TaskType,
    executor: TaskExecutor<T, R>
  ): void {
    this.executors.set(type, executor)
    console.log(`📝 已注册执行器: ${type}`)
  }

  /**
   * 添加任务到队列
   */
  async enqueue<T = any>(
    type: TaskType,
    data: T,
    userId: number,
    options: {
      priority?: TaskPriority
      requireProxy?: boolean
      proxyConfig?: ProxyConfig
      maxRetries?: number
    } = {}
  ): Promise<string> {
    const task: Task<T> = {
      id: randomUUID(),
      type,
      data,
      userId,
      priority: options.priority || 'normal',
      status: 'pending',
      requireProxy: options.requireProxy || false,
      proxyConfig: options.proxyConfig,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultMaxRetries
    }

    await this.adapter.enqueue(task)
    console.log(`📥 任务已入队: ${task.id} (${type}, user=${userId})`)

    return task.id
  }

  /**
   * 队列处理循环
   */
  private async processQueue(): Promise<void> {
    if (!this.running) return

    // 检查是否达到全局并发限制
    if (this.globalRunningCount >= this.config.globalConcurrency) {
      return
    }

    try {
      // 尝试获取任务
      const task = await this.adapter.dequeue()
      if (!task) return

      // 检查是否有对应的执行器
      const executor = this.executors.get(task.type)
      if (!executor) {
        console.warn(`⚠️ 未找到执行器: ${task.type}`)
        await this.adapter.updateTaskStatus(task.id, 'failed', 'No executor found')
        return
      }

      // 检查并发限制
      if (!this.canExecuteTask(task)) {
        // 放回队列
        task.status = 'pending'
        await this.adapter.enqueue(task)
        return
      }

      // 执行任务
      this.executeTask(task, executor)
    } catch (error: any) {
      console.error('❌ 队列处理错误:', error.message)
    }
  }

  /**
   * 检查是否可以执行任务（并发控制）
   */
  private canExecuteTask(task: Task): boolean {
    // 1. 全局并发检查
    if (this.globalRunningCount >= this.config.globalConcurrency) {
      return false
    }

    // 2. 用户并发检查
    const userRunning = this.perUserRunningCount.get(task.userId) || 0
    if (userRunning >= this.config.perUserConcurrency) {
      return false
    }

    // 3. 类型并发检查
    const typeRunning = this.perTypeRunningCount.get(task.type) || 0
    const typeLimit = this.config.perTypeConcurrency[task.type] || 2
    if (typeRunning >= typeLimit) {
      return false
    }

    return true
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: Task, executor: TaskExecutor): Promise<void> {
    // 更新并发计数
    this.incrementConcurrency(task)

    try {
      // 准备代理配置
      if (task.requireProxy && !task.proxyConfig) {
        task.proxyConfig = this.proxyManager.getProxy() || undefined
      }

      // 执行任务（带超时）
      const result = await this.executeWithTimeout(
        executor(task),
        this.config.taskTimeout
      )

      // 标记代理成功
      if (task.proxyConfig) {
        this.proxyManager.markProxySuccess(task.proxyConfig)
      }

      // 更新任务状态
      await this.adapter.updateTaskStatus(task.id, 'completed')
      console.log(`✅ 任务完成: ${task.id} (${task.type})`)
    } catch (error: any) {
      console.error(`❌ 任务失败: ${task.id}:`, error.message)

      // 标记代理失败
      if (task.proxyConfig) {
        this.proxyManager.markProxyFailed(task.proxyConfig)
      }

      // 重试逻辑
      const shouldRetry = (task.retryCount || 0) < (task.maxRetries || 0)
      if (shouldRetry) {
        task.retryCount = (task.retryCount || 0) + 1
        task.status = 'pending'

        console.log(`🔄 任务重试 (${task.retryCount}/${task.maxRetries}): ${task.id}`)

        // 延迟后重新入队
        setTimeout(async () => {
          await this.adapter.enqueue(task)
        }, this.config.retryDelay)
      } else {
        // 标记为失败
        await this.adapter.updateTaskStatus(task.id, 'failed', error.message)
      }
    } finally {
      // 减少并发计数
      this.decrementConcurrency(task)
    }
  }

  /**
   * 执行任务并设置超时
   */
  private executeWithTimeout<T>(
    promise: Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Task timeout')), timeout)
      )
    ])
  }

  /**
   * 增加并发计数
   */
  private incrementConcurrency(task: Task): void {
    this.globalRunningCount++
    this.perUserRunningCount.set(
      task.userId,
      (this.perUserRunningCount.get(task.userId) || 0) + 1
    )
    this.perTypeRunningCount.set(
      task.type,
      (this.perTypeRunningCount.get(task.type) || 0) + 1
    )
  }

  /**
   * 减少并发计数
   */
  private decrementConcurrency(task: Task): void {
    this.globalRunningCount--
    this.perUserRunningCount.set(
      task.userId,
      Math.max(0, (this.perUserRunningCount.get(task.userId) || 0) - 1)
    )
    this.perTypeRunningCount.set(
      task.type,
      Math.max(0, (this.perTypeRunningCount.get(task.type) || 0) - 1)
    )
  }

  /**
   * 获取队列统计
   */
  async getStats(): Promise<QueueStats> {
    return this.adapter.getStats()
  }

  /**
   * 获取代理统计
   */
  getProxyStats() {
    return this.proxyManager.getDetailedStats()
  }

  /**
   * 清理已完成任务
   */
  async clearCompleted(): Promise<number> {
    return this.adapter.clearCompleted()
  }

  /**
   * 清理失败任务
   */
  async clearFailed(): Promise<number> {
    return this.adapter.clearFailed()
  }

  /**
   * 获取任务详情
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.adapter.getTask(taskId)
  }

  /**
   * 更新队列配置
   */
  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config }
    console.log('🔄 队列配置已更新')
  }
}

// 导出单例实例
let queueInstance: UnifiedQueueManager | null = null

export function getQueueManager(config?: Partial<QueueConfig>): UnifiedQueueManager {
  if (!queueInstance) {
    queueInstance = new UnifiedQueueManager(config)
  }
  return queueInstance
}
