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

    // 按优先级排序: high > normal > low，同优先级按创建时间排序
    this.pendingQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 }
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.createdAt - b.createdAt
    })
  }

  async dequeue(type?: TaskType): Promise<Task | null> {
    if (!this.connected || this.pendingQueue.length === 0) {
      return null
    }

    // 查找匹配类型的任务（如果指定类型）
    const index = type
      ? this.pendingQueue.findIndex((t) => t.type === type)
      : 0

    if (index === -1) return null

    const task = this.pendingQueue.splice(index, 1)[0]
    task.status = 'running'
    task.startedAt = Date.now()
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

    const allTasks = Array.from(this.tasks.values())
    const byType: Record<TaskType, number> = {} as Record<TaskType, number>
    const byUser: Record<number, any> = {}

    allTasks.forEach((task) => {
      // 按类型统计
      byType[task.type] = (byType[task.type] || 0) + 1

      // 按用户统计
      if (!byUser[task.userId]) {
        byUser[task.userId] = { pending: 0, running: 0, completed: 0, failed: 0 }
      }
      byUser[task.userId][task.status]++
    })

    return {
      total: allTasks.length,
      pending: allTasks.filter((t) => t.status === 'pending').length,
      running: this.runningTasks.size,
      completed: allTasks.filter((t) => t.status === 'completed').length,
      failed: allTasks.filter((t) => t.status === 'failed').length,
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
}
