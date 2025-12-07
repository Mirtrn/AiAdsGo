/**
 * useOfferExtractionV2
 *
 * 任务队列架构版本的Offer提取Hook
 *
 * 流程：
 * 1. 调用 POST /api/offers/extract 创建任务，获取taskId
 * 2. 使用 GET /api/offers/extract/stream/[taskId] 订阅SSE进度推送
 * 3. SSE失败时自动fallback到轮询 GET /api/offers/extract/status/[taskId]
 *
 * 优势：
 * - 任务持久化，支持页面刷新后重连
 * - SSE连接与任务执行解耦，避免controller closed错误
 * - 自动fallback机制，提高稳定性
 */

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  ProgressStage,
  ProgressStatus,
  ProgressEvent,
} from '@/types/progress'

interface ExtractionResult {
  finalUrl: string
  finalUrlSuffix: string
  brand: string
  productDescription?: string
  targetLanguage: string
  productCount?: number
  [key: string]: any
}

interface TaskStatus {
  taskId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: string | null
  progress: number
  message: string | null
  result: ExtractionResult | null
  error: any | null
}

interface UseOfferExtractionV2Return {
  // State
  isExtracting: boolean
  taskId: string | null
  currentStage: ProgressStage
  currentStatus: ProgressStatus
  currentMessage: string
  progress: number // 0-100
  result: ExtractionResult | null
  error: string | null

  // Connection state
  connectionType: 'sse' | 'polling' | null

  // Actions
  startExtraction: (affiliateLink: string, targetCountry: string) => Promise<void>
  reconnect: (taskId: string) => Promise<void>
  reset: () => void
}

export function useOfferExtractionV2(): UseOfferExtractionV2Return {
  const [isExtracting, setIsExtracting] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<ProgressStage>('resolving_link')
  const [currentStatus, setCurrentStatus] = useState<ProgressStatus>('pending')
  const [currentMessage, setCurrentMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connectionType, setConnectionType] = useState<'sse' | 'polling' | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const sseReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  // 清理函数
  const cleanup = useCallback(() => {
    // 关闭SSE连接
    if (sseReaderRef.current) {
      sseReaderRef.current.cancel().catch(() => {})
      sseReaderRef.current = null
    }

    // 停止轮询
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }

    // 取消请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setConnectionType(null)
  }, [])

  // 启动轮询fallback
  const startPolling = useCallback(async (tid: string) => {
    console.log('🔄 Falling back to polling for task:', tid)
    setConnectionType('polling')

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/offers/extract/status/${tid}`)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data: TaskStatus = await response.json()

        // 更新状态
        setCurrentStage(data.stage as ProgressStage || 'resolving_link')
        setCurrentStatus(data.status as ProgressStatus)
        setCurrentMessage(data.message || '')
        setProgress(data.progress)

        // 任务完成
        if (data.status === 'completed') {
          setResult(data.result)
          setIsExtracting(false)
          cleanup()
        }

        // 任务失败
        if (data.status === 'failed') {
          setError(data.error?.message || '任务失败')
          setIsExtracting(false)
          cleanup()
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 1000) // 每秒轮询一次
  }, [cleanup])

  // 启动SSE订阅
  const startSSE = useCallback(async (tid: string) => {
    console.log('📡 Starting SSE subscription for task:', tid)
    setConnectionType('sse')

    try {
      abortControllerRef.current = new AbortController()

      const response = await fetch(`/api/offers/extract/stream/${tid}`, {
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      const reader = response.body.getReader()
      sseReaderRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log('✅ SSE stream completed')
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // 处理完整消息（由\n\n分隔）
        const messages = buffer.split('\n\n')
        buffer = messages.pop() || ''

        for (const message of messages) {
          if (!message.trim() || !message.startsWith('data: ')) continue

          try {
            const jsonStr = message.substring(6)
            const data = JSON.parse(jsonStr)

            console.log('📨 SSE Message:', data)

            if (data.type === 'progress') {
              // 后端发送格式: {type: 'progress', data: {stage, status, message, ...}}
              const progressData = data.data || data
              setCurrentStage(progressData.stage as ProgressStage)
              setCurrentStatus(progressData.status || 'in_progress')
              setCurrentMessage(progressData.message || '')
              // 根据stage计算进度百分比
              const progressMap: Record<string, number> = {
                proxy_warmup: 5,
                fetching_proxy: 10,
                resolving_link: 20,
                accessing_page: 35,
                extracting_brand: 50,
                scraping_products: 65,
                processing_data: 80,
                ai_analysis: 90,
                completed: 100,
                error: 0,
              }
              setProgress(progressMap[progressData.stage] || 0)
            } else if (data.type === 'complete') {
              // 后端发送格式: {type: 'complete', data: {...result}}
              setCurrentStage('completed')
              setCurrentStatus('completed')
              setCurrentMessage('提取完成！')
              setProgress(100)
              setResult(data.data || data.result)  // 兼容两种格式
              setIsExtracting(false)
              cleanup()
            } else if (data.type === 'error') {
              // 后端发送格式: {type: 'error', data: {message, stage, details}}
              const errorData = data.data || data.error || {}
              setCurrentStage('error')
              setCurrentStatus('error')
              setError(errorData.message || '任务失败')
              setCurrentMessage(errorData.message || '任务失败')
              setIsExtracting(false)
              cleanup()
            }
          } catch (parseError) {
            console.error('Failed to parse SSE message:', parseError, message)
          }
        }
      }
    } catch (err: any) {
      // SSE失败，fallback到轮询
      if (err.name !== 'AbortError') {
        console.warn('SSE failed, falling back to polling:', err)
        await startPolling(tid)
      }
    }
  }, [cleanup, startPolling])

  // 重置状态
  const reset = useCallback(() => {
    cleanup()
    setIsExtracting(false)
    setTaskId(null)
    setCurrentStage('resolving_link')
    setCurrentStatus('pending')
    setCurrentMessage('')
    setProgress(0)
    setResult(null)
    setError(null)
  }, [cleanup])

  // 开始提取
  const startExtraction = useCallback(async (affiliateLink: string, targetCountry: string) => {
    reset()
    setIsExtracting(true)
    setCurrentMessage('创建任务中...')

    try {
      // 1. 创建任务
      const response = await fetch('/api/offers/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          affiliate_link: affiliateLink,
          target_country: targetCountry,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }

      const data = await response.json()
      const tid = data.taskId

      if (!tid) {
        throw new Error('No taskId returned')
      }

      setTaskId(tid)
      console.log('✅ Task created:', tid)

      // 2. 订阅进度（SSE优先）
      await startSSE(tid)

    } catch (err: any) {
      console.error('Extraction failed:', err)
      setError(err.message || '创建任务失败')
      setCurrentMessage('创建任务失败，请重试')
      setIsExtracting(false)
    }
  }, [reset, startSSE])

  // 重连已有任务
  const reconnect = useCallback(async (tid: string) => {
    reset()
    setIsExtracting(true)
    setTaskId(tid)
    setCurrentMessage('重新连接中...')

    try {
      // 先查询一次当前状态
      const response = await fetch(`/api/offers/extract/status/${tid}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data: TaskStatus = await response.json()

      // 如果已经完成或失败，直接显示结果
      if (data.status === 'completed') {
        setResult(data.result)
        setCurrentStage('completed')
        setCurrentStatus('completed')
        setProgress(100)
        setCurrentMessage('提取完成！')
        setIsExtracting(false)
        return
      }

      if (data.status === 'failed') {
        setError(data.error?.message || '任务失败')
        setCurrentStage('error')
        setCurrentStatus('error')
        setCurrentMessage(data.error?.message || '任务失败')
        setIsExtracting(false)
        return
      }

      // 否则，订阅进度
      setCurrentStage(data.stage as ProgressStage || 'resolving_link')
      setProgress(data.progress)
      setCurrentMessage(data.message || '处理中...')

      await startSSE(tid)

    } catch (err: any) {
      console.error('Reconnect failed:', err)
      setError(err.message || '重连失败')
      setIsExtracting(false)
    }
  }, [reset, startSSE])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    isExtracting,
    taskId,
    currentStage,
    currentStatus,
    currentMessage,
    progress,
    result,
    error,
    connectionType,
    startExtraction,
    reconnect,
    reset,
  }
}
