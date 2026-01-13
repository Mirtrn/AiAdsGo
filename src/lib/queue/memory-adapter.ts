import type {
  Task,
  TaskType,
  TaskStatus,
  QueueStats,
  QueueStorageAdapter
} from './types'

/**
 * 内存队列存储适配器
 *
 * 用于Redis不可用时的回退方案
 */
export class MemoryQueueAdapter implements QueueStorageAdapter {
  private tasks: Map<string, Task> = new Map()
  private pendingQueue: Task[] = []
  private runningTasks: Set<string> = new Set()
  private connected: boolean = false

  async connect(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.tasks.clear()
    this.pendingQueue = []
    this.runningTasks.clear()
  }

  isConnected(): boolean {
    return this.connected
  }

  async enqueue(task: Task): Promise<void> {
    if (!this.connected) {
      throw new Error('MemoryQueueAdapter: not connected')
    }

    this.tasks.set(task.id, task)
    this.pendingQueue.push(task)

    // 排序规则与 Redis 一致：
    // 1) 先按可执行时间（notBefore/createdAt）排序，避免未来任务阻塞当前可执行任务
    // 2) 同一时间点内按优先级排序（high > normal > low）
    // 3) 最后按 createdAt 兜底
    this.pendingQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 }
      const aAvailableAt = (a as any).notBefore ?? a.createdAt
      const bAvailableAt = (b as any).notBefore ?? b.createdAt
      if (aAvailableAt !== bAvailableAt) return aAvailableAt - bAvailableAt
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.createdAt - b.createdAt
    })
  }

  async dequeue(type?: TaskType): Promise<Task | null> {
    if (!this.connected || this.pendingQueue.length === 0) {
      return null
    }

    const now = Date.now()

    // 查找第一个“已到可执行时间”的任务（如果指定类型，则同时匹配类型）
    const index = type
      ? this.pendingQueue.findIndex((t) => t.type === type && (((t as any).notBefore ?? 0) <= now))
      : this.pendingQueue.findIndex((t) => (((t as any).notBefore ?? 0) <= now))

    if (index === -1) return null

    const task = this.pendingQueue.splice(index, 1)[0]
    task.status = 'running'
    task.startedAt = Date.now()
    delete (task as any).notBefore
    delete (task as any).deferCount
    this.runningTasks.add(task.id)
    this.tasks.set(task.id, task)

    return task
  }

  async peek(): Promise<Task | null> {
    if (!this.connected || this.pendingQueue.length === 0) {
      return null
    }
    return this.pendingQueue[0]
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    error?: string
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('MemoryQueueAdapter: not connected')
    }

    const task = this.tasks.get(taskId)
    if (!task) return

    task.status = status
    if (error) task.error = error
    if (status === 'completed' || status === 'failed') {
      task.completedAt = Date.now()
      this.runningTasks.delete(taskId)
    }

    this.tasks.set(taskId, task)
  }

  async getTask(taskId: string): Promise<Task | null> {
    if (!this.connected) return null
    return this.tasks.get(taskId) || null
  }

  async getStats(): Promise<QueueStats> {
    if (!this.connected) {
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

    // 🔥 修复：过滤有效用户，确保全局和用户统计一致
    const allTasks = Array.from(this.tasks.values()).filter(
      (task) => task.userId && task.userId > 0
    )

    const byType: Record<TaskType, number> = {} as Record<TaskType, number>
    const byUser: Record<number, any> = {}

    // 状态计数器
    let totalPending = 0
    let totalRunning = 0
    let totalCompleted = 0
    let totalFailed = 0

    allTasks.forEach((task) => {
      // 按类型统计
      byType[task.type] = (byType[task.type] || 0) + 1

      // 按用户统计
      if (!byUser[task.userId]) {
        byUser[task.userId] = { pending: 0, running: 0, completed: 0, failed: 0 }
      }
      byUser[task.userId][task.status]++

      // 全局状态统计（与用户统计使用相同逻辑）
      if (task.status === 'pending') totalPending++
      else if (task.status === 'running') totalRunning++
      else if (task.status === 'completed') totalCompleted++
      else if (task.status === 'failed') totalFailed++
    })

    return {
      total: allTasks.length,
      pending: totalPending,
      running: totalRunning,
      completed: totalCompleted,
      failed: totalFailed,
      byType,
      byUser
    }
  }

  async getRunningTasks(): Promise<Task[]> {
    if (!this.connected) return []
    return Array.from(this.runningTasks)
      .map((id) => this.tasks.get(id))
      .filter((t): t is Task => t !== undefined)
  }

  async getPendingTasks(type?: TaskType): Promise<Task[]> {
    if (!this.connected) return []
    if (type) {
      return this.pendingQueue.filter((t) => t.type === type)
    }
    return [...this.pendingQueue]
  }

  async clearCompleted(): Promise<number> {
    if (!this.connected) return 0
    let count = 0
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed') {
        this.tasks.delete(id)
        count++
      }
    }
    return count
  }

  async clearFailed(): Promise<number> {
    if (!this.connected) return 0
    let count = 0
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'failed') {
        this.tasks.delete(id)
        count++
      }
    }
    return count
  }

  /**
   * 🔥 按类型和状态删除任务（用于服务重启时清理特定任务）
   *
   * @param type 任务类型（如 'url-swap'）
   * @param status 任务状态（'pending' 或 'running'）
   * @returns 删除的任务数量
   */
  async deleteTasksByTypeAndStatus(
    type: TaskType,
    status: 'pending' | 'running'
  ): Promise<number> {
    if (!this.connected) return 0

    let deletedCount = 0

    if (status === 'pending') {
      // 过滤出非指定类型的任务（保留其他任务）
      const originalLength = this.pendingQueue.length
      this.pendingQueue = this.pendingQueue.filter((task) => {
        if (task.type === type) {
          // 从tasks Map中删除
          this.tasks.delete(task.id)
          return false  // 不保留
        }
        return true  // 保留
      })

      deletedCount = originalLength - this.pendingQueue.length
    } else {
      // running状态
      const runningTasksToDelete: string[] = []

      // 找出需要删除的running任务
      for (const taskId of this.runningTasks) {
        const task = this.tasks.get(taskId)
        if (task && task.type === type) {
          runningTasksToDelete.push(taskId)
        }
      }

      // 删除任务
      for (const taskId of runningTasksToDelete) {
        this.runningTasks.delete(taskId)
        this.tasks.delete(taskId)
        deletedCount++
      }
    }

    if (deletedCount > 0) {
      console.log(`[Memory] 删除 ${deletedCount} 个 type=${type} status=${status} 的任务`)
    }

    return deletedCount
  }

  /**
   * 🔥 获取所有pending任务（用于批量任务取消）
   */
  async getAllPendingTasks(): Promise<Task[]> {
    if (!this.connected) return []
    return [...this.pendingQueue]
  }

  /**
   * 🔥 从队列中移除指定任务（用于批量任务取消）
   */
  async removeTask(taskId: string): Promise<void> {
    if (!this.connected) return

    // 从pending队列中移除
    const index = this.pendingQueue.findIndex((t) => t.id === taskId)
    if (index !== -1) {
      this.pendingQueue.splice(index, 1)
      console.log(`🗑️ 已从内存队列移除任务: ${taskId}`)
    }

    // 从tasks map中删除
    this.tasks.delete(taskId)

    // 从running set中删除（如果存在）
    this.runningTasks.delete(taskId)
  }
}
