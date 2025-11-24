/**
 * Crawlee错误处理和统计监控模块
 *
 * 功能：
 * - 错误分类和智能处理
 * - 实时统计监控（成功率、失败率、平均耗时）
 * - 进度跟踪事件
 * - Dataset错误记录
 */

import { Dataset } from '@crawlee/playwright';

/**
 * 错误类型分类
 */
export enum CrawleeErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',           // 网络错误（超时、连接失败）
  PROXY_ERROR = 'PROXY_ERROR',               // 代理错误
  BLOCKED_ERROR = 'BLOCKED_ERROR',           // 被封禁/验证码
  SELECTOR_ERROR = 'SELECTOR_ERROR',         // 选择器错误（页面结构变化）
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',           // 超时错误
  PARSING_ERROR = 'PARSING_ERROR',           // 数据解析错误
  SESSION_ERROR = 'SESSION_ERROR',           // Session错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',           // 未知错误
}

/**
 * 错误详情接口
 */
export interface CrawleeErrorDetail {
  type: CrawleeErrorType;
  url: string;
  message: string;
  stack?: string;
  timestamp: string;
  retryable: boolean;
  retryCount?: number;
}

/**
 * 统计信息接口
 */
export interface CrawleeStatistics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  failureRate: number;
  averageDuration: number;
  totalDuration: number;
  errorsByType: Record<CrawleeErrorType, number>;
  lastError?: CrawleeErrorDetail;
  startTime: number;
  endTime?: number;
}

/**
 * 进度事件接口
 */
export interface CrawleeProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  url?: string;
  current: number;
  total: number;
  progress: number; // 0-100
  statistics: CrawleeStatistics;
  timestamp: number;
}

/**
 * 进度监听器类型
 */
export type CrawleeProgressListener = (event: CrawleeProgressEvent) => void;

/**
 * Crawlee统计监控类
 */
export class CrawleeStatsMonitor {
  private stats: CrawleeStatistics;
  private requestStartTimes: Map<string, number> = new Map();
  private progressListeners: CrawleeProgressListener[] = [];
  private totalUrlsToProcess: number = 0;

  constructor() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      successRate: 0,
      failureRate: 0,
      averageDuration: 0,
      totalDuration: 0,
      errorsByType: {} as Record<CrawleeErrorType, number>,
      startTime: Date.now(),
    };

    // 初始化错误计数器
    Object.values(CrawleeErrorType).forEach((type) => {
      this.stats.errorsByType[type] = 0;
    });
  }

  /**
   * 添加进度监听器
   */
  addProgressListener(listener: CrawleeProgressListener): void {
    this.progressListeners.push(listener);
  }

  /**
   * 触发进度事件
   */
  private emitProgress(
    type: 'start' | 'progress' | 'complete' | 'error',
    url?: string
  ): void {
    const event: CrawleeProgressEvent = {
      type,
      url,
      current: this.stats.successfulRequests + this.stats.failedRequests,
      total: this.totalUrlsToProcess,
      progress: this.totalUrlsToProcess > 0
        ? Math.round(
            ((this.stats.successfulRequests + this.stats.failedRequests) /
              this.totalUrlsToProcess) *
              100
          )
        : 0,
      statistics: { ...this.stats },
      timestamp: Date.now(),
    };

    this.progressListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('进度监听器错误:', error);
      }
    });
  }

  /**
   * 设置总URL数量
   */
  setTotalUrls(total: number): void {
    this.totalUrlsToProcess = total;
    this.emitProgress('start');
  }

  /**
   * 记录请求开始
   */
  recordRequestStart(url: string): void {
    this.stats.totalRequests++;
    this.requestStartTimes.set(url, Date.now());
  }

  /**
   * 记录请求成功
   */
  recordRequestSuccess(url: string): void {
    this.stats.successfulRequests++;
    this.updateDuration(url);
    this.updateRates();
    this.emitProgress('progress', url);
  }

  /**
   * 记录请求失败
   */
  recordRequestFailure(url: string, errorDetail: CrawleeErrorDetail): void {
    this.stats.failedRequests++;
    this.stats.errorsByType[errorDetail.type]++;
    this.stats.lastError = errorDetail;
    this.updateDuration(url);
    this.updateRates();
    this.emitProgress('error', url);

    // 保存错误到Dataset
    this.saveErrorToDataset(errorDetail).catch((err) => {
      console.error('保存错误到Dataset失败:', err);
    });
  }

  /**
   * 更新请求耗时
   */
  private updateDuration(url: string): void {
    const startTime = this.requestStartTimes.get(url);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.stats.totalDuration += duration;
      this.stats.averageDuration =
        this.stats.totalDuration / (this.stats.successfulRequests + this.stats.failedRequests);
      this.requestStartTimes.delete(url);
    }
  }

  /**
   * 更新成功率和失败率
   */
  private updateRates(): void {
    const total = this.stats.successfulRequests + this.stats.failedRequests;
    if (total > 0) {
      this.stats.successRate = (this.stats.successfulRequests / total) * 100;
      this.stats.failureRate = (this.stats.failedRequests / total) * 100;
    }
  }

  /**
   * 保存错误到Dataset
   */
  private async saveErrorToDataset(errorDetail: CrawleeErrorDetail): Promise<void> {
    await Dataset.pushData({
      dataType: 'error',
      ...errorDetail,
    });
  }

  /**
   * 完成统计
   */
  complete(): CrawleeStatistics {
    this.stats.endTime = Date.now();
    this.emitProgress('complete');
    return this.getStats();
  }

  /**
   * 获取当前统计信息
   */
  getStats(): CrawleeStatistics {
    return { ...this.stats };
  }

  /**
   * 打印统计报告
   */
  printReport(): void {
    console.log('\n📊 ========== Crawlee抓取统计报告 ==========');
    console.log(`📦 总请求数: ${this.stats.totalRequests}`);
    console.log(`✅ 成功: ${this.stats.successfulRequests}`);
    console.log(`❌ 失败: ${this.stats.failedRequests}`);
    console.log(`📈 成功率: ${this.stats.successRate.toFixed(2)}%`);
    console.log(`📉 失败率: ${this.stats.failureRate.toFixed(2)}%`);
    console.log(`⏱️  平均耗时: ${(this.stats.averageDuration / 1000).toFixed(2)}秒`);
    console.log(`⏱️  总耗时: ${(this.stats.totalDuration / 1000).toFixed(2)}秒`);

    // 打印错误分类统计
    const errorTypes = Object.entries(this.stats.errorsByType).filter(
      ([_, count]) => count > 0
    );
    if (errorTypes.length > 0) {
      console.log('\n🔍 错误分类统计:');
      errorTypes.forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
    }

    if (this.stats.lastError) {
      console.log(`\n⚠️  最后错误: ${this.stats.lastError.message}`);
    }
    console.log('===========================================\n');
  }
}

/**
 * 错误分类器 - 智能识别错误类型
 */
export function classifyError(error: Error, context?: { url?: string; pageTitle?: string }): CrawleeErrorDetail {
  const message = error.message;
  const stack = error.stack;
  let type: CrawleeErrorType = CrawleeErrorType.UNKNOWN_ERROR;
  let retryable = true;

  // 网络错误
  if (
    message.includes('net::ERR_') ||
    message.includes('Network') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT')
  ) {
    type = CrawleeErrorType.NETWORK_ERROR;
    retryable = true;
  }
  // 代理错误
  else if (
    message.includes('Proxy') ||
    message.includes('407') ||
    message.includes('proxy authentication')
  ) {
    type = CrawleeErrorType.PROXY_ERROR;
    retryable = true;
  }
  // 封禁错误
  else if (
    message.includes('blocked') ||
    message.includes('captcha') ||
    message.includes('Robot Check') ||
    context?.pageTitle?.includes('Sorry! Something went wrong!')
  ) {
    type = CrawleeErrorType.BLOCKED_ERROR;
    retryable = true; // Crawlee会换Session重试
  }
  // 超时错误
  else if (
    message.includes('timeout') ||
    message.includes('Timeout') ||
    message.includes('Navigation timeout')
  ) {
    type = CrawleeErrorType.TIMEOUT_ERROR;
    retryable = true;
  }
  // 选择器错误
  else if (
    message.includes('selector') ||
    message.includes('element not found') ||
    message.includes('waiting for selector')
  ) {
    type = CrawleeErrorType.SELECTOR_ERROR;
    retryable = false; // 页面结构变化，重试无意义
  }
  // 解析错误
  else if (
    message.includes('parse') ||
    message.includes('JSON') ||
    message.includes('undefined')
  ) {
    type = CrawleeErrorType.PARSING_ERROR;
    retryable = false; // 数据格式问题，重试无意义
  }
  // Session错误
  else if (message.includes('session') || message.includes('Session')) {
    type = CrawleeErrorType.SESSION_ERROR;
    retryable = true;
  }

  return {
    type,
    url: context?.url || 'unknown',
    message,
    stack,
    timestamp: new Date().toISOString(),
    retryable,
  };
}

/**
 * 格式化错误信息用于日志输出
 */
export function formatErrorLog(errorDetail: CrawleeErrorDetail): string {
  const icon = errorDetail.retryable ? '🔄' : '❌';
  return `${icon} [${errorDetail.type}] ${errorDetail.url} - ${errorDetail.message}`;
}

/**
 * 判断错误是否应该重试
 */
export function shouldRetryError(errorDetail: CrawleeErrorDetail, currentRetryCount: number, maxRetries: number = 3): boolean {
  // 已达到最大重试次数
  if (currentRetryCount >= maxRetries) {
    return false;
  }

  // 不可重试的错误类型
  if (!errorDetail.retryable) {
    return false;
  }

  // 某些错误类型需要更谨慎的重试
  if (errorDetail.type === CrawleeErrorType.BLOCKED_ERROR && currentRetryCount >= 2) {
    return false; // 封禁错误最多重试2次
  }

  return true;
}
