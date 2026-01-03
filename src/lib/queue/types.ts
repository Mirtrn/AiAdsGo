/**
 * 统一队列系统类型定义
 *
 * 支持Redis优先 + 内存回退架构
 * 支持代理IP池管理
 */

/**
 * 任务类型枚举
 */
export type TaskType =
  | 'scrape'          // 网页抓取
  | 'ai-analysis'     // AI分析（Enhanced优化）
  | 'sync'            // Google Ads数据同步
  | 'backup'          // 数据库备份
  | 'email'           // 邮件发送
  | 'export'          // 报表导出
  | 'link-check'      // 链接可用性检查
  | 'cleanup'         // 数据清理
  | 'offer-extraction'      // Offer信息提取（完整流程：URL解析 + 品牌识别 + AI分析）
  | 'batch-offer-creation'  // 批量Offer创建（父任务：协调多个offer-extraction子任务）
  | 'ad-creative'           // 广告创意生成（多轮优化 + Ad Strength评估）
  | 'campaign-publish'      // 🆕 广告系列发布到Google Ads（异步处理，避免504超时）
  | 'click-farm'            // 🆕 补点击任务（单次点击执行，带代理和超时控制）
  | 'url-swap'              // 🆕 换链接任务（自动监测和更新Google Ads广告链接）

/**
 * 任务优先级
 */
export type TaskPriority = 'high' | 'normal' | 'low'

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * 代理配置
 */
export interface ProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
  protocol?: 'http' | 'https' | 'socks5'
  // 原始URL，用于IPRocket等动态代理服务
  originalUrl?: string
  // 国家代码
  country?: string
}

/**
 * 任务基础接口
 */
export interface Task<T = any> {
  id: string
  type: TaskType
  data: T
  userId: number
  priority: TaskPriority
  status: TaskStatus
  requireProxy?: boolean  // 是否需要代理IP
  proxyConfig?: ProxyConfig  // 指定代理配置
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: string
  retryCount?: number
  maxRetries?: number
}

/**
 * 任务执行器接口
 */
export interface TaskExecutor<T = any, R = any> {
  (task: Task<T>): Promise<R>
}

/**
 * 队列统计信息
 */
export interface QueueStats {
  total: number
  pending: number
  running: number
  completed: number
  failed: number
  byType: Record<TaskType, number>
  byUser: Record<number, {
    pending: number
    running: number
    completed: number
    failed: number
  }>
}

/**
 * 队列配置
 */
export interface QueueConfig {
  // 并发控制
  globalConcurrency: number      // 全局最大并发
  perUserConcurrency: number     // 单用户最大并发
  perTypeConcurrency: Record<TaskType, number>  // 单类型最大并发

  // 队列限制
  maxQueueSize: number           // 最大队列长度
  taskTimeout: number            // 任务超时时间(ms)

  // 重试策略
  defaultMaxRetries: number      // 默认最大重试次数
  retryDelay: number             // 重试延迟(ms)

  // Redis配置（可选）
  redisUrl?: string              // Redis连接URL
  redisKeyPrefix?: string        // Redis键前缀

  // 代理配置
  proxyPool?: ProxyConfig[]      // 代理IP池
  proxyRotation?: boolean        // 是否自动轮换代理
}

/**
 * 队列存储适配器接口
 */
export interface QueueStorageAdapter {
  // 任务操作
  enqueue(task: Task): Promise<void>
  dequeue(type?: TaskType): Promise<Task | null>
  peek(): Promise<Task | null>

  // 状态管理
  updateTaskStatus(taskId: string, status: TaskStatus, error?: string): Promise<void>
  getTask(taskId: string): Promise<Task | null>

  // 统计查询
  getStats(): Promise<QueueStats>
  getRunningTasks(): Promise<Task[]>
  getPendingTasks(type?: TaskType): Promise<Task[]>

  // 清理操作
  clearCompleted(): Promise<number>
  clearFailed(): Promise<number>

  // 🔥 按类型和状态删除任务（用于服务重启时清理特定任务）
  deleteTasksByTypeAndStatus?(
    type: TaskType,
    status: 'pending' | 'running'
  ): Promise<number>

  // 🔥 启动时清理操作（可选，Redis适配器实现）
  clearAllUnfinished?(): Promise<{
    pendingCleared: number
    runningCleared: number
    userQueuesCleared: number
    totalCleared: number
  }>

  // 🔥 超时任务清理（可选，Redis适配器实现）
  cleanupStaleRunningTasks?(timeoutMs?: number): Promise<{
    cleanedCount: number
    cleanedTaskIds: string[]
  }>

  // 🔥 无效用户任务清理（可选，Redis适配器实现）
  cleanupInvalidUserTasks?(): Promise<{
    cleanedCount: number
    cleanedTaskIds: string[]
  }>

  // 🔥 批量任务取消支持（可选）
  getAllPendingTasks?(): Promise<Task[]>
  removeTask?(taskId: string): Promise<void>

  // 连接管理
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
}

/**
 * 代理管理器接口
 */
export interface ProxyManager {
  // 获取可用代理
  getProxy(): ProxyConfig | null

  // 标记代理状态
  markProxyFailed(proxy: ProxyConfig): void
  markProxySuccess(proxy: ProxyConfig): void

  // 代理池管理
  addProxy(proxy: ProxyConfig): void
  removeProxy(proxy: ProxyConfig): void
  getAvailableProxies(): ProxyConfig[]

  // 统计信息
  getStats(): {
    total: number
    available: number
    failed: number
  }
}
