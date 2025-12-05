import Redis from 'ioredis'
import type {
  Task,
  TaskType,
  TaskStatus,
  QueueStats,
  QueueStorageAdapter
} from './types'

/**
 * Redis队列存储适配器
 *
 * 使用Redis作为持久化队列存储
 * 支持分布式环境和任务持久化
 */
export class RedisQueueAdapter implements QueueStorageAdapter {
  private client: Redis | null = null
  private keyPrefix: string
  private connected: boolean = false

  constructor(
    private redisUrl: string,
    keyPrefix: string = 'queue:'
  ) {
    this.keyPrefix = keyPrefix
  }

  async connect(): Promise<void> {
    if (this.connected) return

    try {
      this.client = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) return null // 停止重试
          return Math.min(times * 100, 2000) // 指数退避
        },
        enableReadyCheck: true,
        lazyConnect: true
      })

      // 连接Redis
      await this.client.connect()

      // 监听连接状态
      this.client.on('error', (err) => {
        console.error('🔴 Redis连接错误:', err.message)
        this.connected = false
      })

      this.client.on('ready', () => {
        console.log('✅ Redis队列已连接')
        this.connected = true
      })

      this.connected = true
    } catch (error: any) {
      console.error('❌ Redis连接失败:', error.message)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit()
      this.client = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client !== null
  }

  private getKey(suffix: string): string {
    return `${this.keyPrefix}${suffix}`
  }

  async enqueue(task: Task): Promise<void> {
    if (!this.client) throw new Error('Redis not connected')

    const pipeline = this.client.pipeline()

    // 1. 存储任务详情
    pipeline.hset(
      this.getKey('tasks'),
      task.id,
      JSON.stringify(task)
    )

    // 2. 添加到优先级队列（使用sorted set，分数为优先级+时间戳）
    const priorityScore = this.getPriorityScore(task)
    pipeline.zadd(
      this.getKey(`pending:${task.type}`),
      priorityScore,
      task.id
    )

    // 3. 添加到全局pending队列
    pipeline.zadd(
      this.getKey('pending:all'),
      priorityScore,
      task.id
    )

    // 4. 添加到用户队列
    pipeline.zadd(
      this.getKey(`user:${task.userId}:pending`),
      priorityScore,
      task.id
    )

    await pipeline.exec()
  }

  async dequeue(type?: TaskType): Promise<Task | null> {
    if (!this.client) return null

    const queueKey = type
      ? this.getKey(`pending:${type}`)
      : this.getKey('pending:all')

    // 使用ZPOPMIN原子操作获取最高优先级任务
    const result = await this.client.zpopmin(queueKey)
    if (!result || result.length === 0) return null

    const taskId = result[0]

    // 获取任务详情
    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return null

    const task: Task = JSON.parse(taskJson)

    // 更新任务状态为running
    task.status = 'running'
    task.startedAt = Date.now()

    const pipeline = this.client.pipeline()

    // 1. 更新任务详情
    pipeline.hset(this.getKey('tasks'), task.id, JSON.stringify(task))

    // 2. 添加到running集合
    pipeline.sadd(this.getKey('running'), task.id)

    // 3. 从用户pending队列移除
    pipeline.zrem(this.getKey(`user:${task.userId}:pending`), task.id)

    // 4. 从全局pending队列移除（如果是通过类型队列dequeue的）
    if (type) {
      pipeline.zrem(this.getKey('pending:all'), task.id)
    }

    await pipeline.exec()

    return task
  }

  async peek(): Promise<Task | null> {
    if (!this.client) return null

    // 查看最高优先级任务（不移除）
    const result = await this.client.zrange(
      this.getKey('pending:all'),
      0,
      0
    )
    if (!result || result.length === 0) return null

    const taskId = result[0]
    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return null

    return JSON.parse(taskJson)
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    error?: string
  ): Promise<void> {
    if (!this.client) throw new Error('Redis not connected')

    // 获取任务
    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return

    const task: Task = JSON.parse(taskJson)
    task.status = status
    if (error) task.error = error
    if (status === 'completed' || status === 'failed') {
      task.completedAt = Date.now()
    }

    const pipeline = this.client.pipeline()

    // 1. 更新任务详情
    pipeline.hset(this.getKey('tasks'), task.id, JSON.stringify(task))

    // 2. 从running集合移除
    if (status === 'completed' || status === 'failed') {
      pipeline.srem(this.getKey('running'), taskId)

      // 3. 添加到completed或failed集合
      const targetSet = status === 'completed' ? 'completed' : 'failed'
      pipeline.sadd(this.getKey(targetSet), taskId)
    }

    await pipeline.exec()
  }

  async getTask(taskId: string): Promise<Task | null> {
    if (!this.client) return null

    const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
    if (!taskJson) return null

    return JSON.parse(taskJson)
  }

  async getStats(): Promise<QueueStats> {
    if (!this.client) {
      return {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        byType: {} as Record<TaskType, number>,
        byUser: {}
      }
    }

    const pipeline = this.client.pipeline()

    // 获取各状态任务数量
    pipeline.zcard(this.getKey('pending:all'))
    pipeline.scard(this.getKey('running'))
    pipeline.scard(this.getKey('completed'))
    pipeline.scard(this.getKey('failed'))

    const results = await pipeline.exec()
    if (!results) throw new Error('Failed to get stats')

    const [pendingRes, runningRes, completedRes, failedRes] = results

    const pending = (pendingRes?.[1] as number) || 0
    const running = (runningRes?.[1] as number) || 0
    const completed = (completedRes?.[1] as number) || 0
    const failed = (failedRes?.[1] as number) || 0

    // 获取所有任务详情用于类型和用户统计
    const allTaskIds = await this.client.hkeys(this.getKey('tasks'))
    const byType: Record<TaskType, number> = {} as Record<TaskType, number>
    const byUser: Record<number, any> = {}

    for (const taskId of allTaskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (!taskJson) continue

      const task: Task = JSON.parse(taskJson)

      // 按类型统计
      byType[task.type] = (byType[task.type] || 0) + 1

      // 按用户统计
      if (!byUser[task.userId]) {
        byUser[task.userId] = { pending: 0, running: 0, completed: 0, failed: 0 }
      }
      byUser[task.userId][task.status]++
    }

    return {
      total: pending + running + completed + failed,
      pending,
      running,
      completed,
      failed,
      byType,
      byUser
    }
  }

  async getRunningTasks(): Promise<Task[]> {
    if (!this.client) return []

    const taskIds = await this.client.smembers(this.getKey('running'))
    const tasks: Task[] = []

    for (const taskId of taskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (taskJson) {
        tasks.push(JSON.parse(taskJson))
      }
    }

    return tasks
  }

  async getPendingTasks(type?: TaskType): Promise<Task[]> {
    if (!this.client) return []

    const queueKey = type
      ? this.getKey(`pending:${type}`)
      : this.getKey('pending:all')

    const taskIds = await this.client.zrange(queueKey, 0, -1)
    const tasks: Task[] = []

    for (const taskId of taskIds) {
      const taskJson = await this.client.hget(this.getKey('tasks'), taskId)
      if (taskJson) {
        tasks.push(JSON.parse(taskJson))
      }
    }

    return tasks
  }

  async clearCompleted(): Promise<number> {
    if (!this.client) return 0

    const taskIds = await this.client.smembers(this.getKey('completed'))
    if (taskIds.length === 0) return 0

    const pipeline = this.client.pipeline()

    for (const taskId of taskIds) {
      pipeline.hdel(this.getKey('tasks'), taskId)
    }
    pipeline.del(this.getKey('completed'))

    await pipeline.exec()
    return taskIds.length
  }

  async clearFailed(): Promise<number> {
    if (!this.client) return 0

    const taskIds = await this.client.smembers(this.getKey('failed'))
    if (taskIds.length === 0) return 0

    const pipeline = this.client.pipeline()

    for (const taskId of taskIds) {
      pipeline.hdel(this.getKey('tasks'), taskId)
    }
    pipeline.del(this.getKey('failed'))

    await pipeline.exec()
    return taskIds.length
  }

  /**
   * 计算优先级分数
   * high: 0-999, normal: 1000-1999, low: 2000-2999
   * 同优先级按时间戳排序（越早越小）
   */
  private getPriorityScore(task: Task): number {
    const priorityBase = { high: 0, normal: 1000, low: 2000 }
    return priorityBase[task.priority] + (task.createdAt % 1000)
  }
}
