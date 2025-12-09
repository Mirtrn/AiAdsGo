'use client'

import { useEffect, useRef } from 'react'

/**
 * 队列系统初始化组件
 * 在应用加载时自动调用 /api/queue/init 初始化队列系统
 */
export function QueueInitializer() {
  const initialized = useRef(false)

  useEffect(() => {
    // 防止重复初始化
    if (initialized.current) return
    initialized.current = true

    const initQueue = async () => {
      try {
        const response = await fetch('/api/queue/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })

        const data = await response.json()

        if (data.success) {
          console.log('✅ 队列系统初始化成功:', data.message)
        } else {
          console.warn('⚠️ 队列初始化响应:', data.message)
        }
      } catch (error) {
        console.error('❌ 队列系统初始化失败:', error)
      }
    }

    initQueue()
  }, [])

  // 不渲染任何内容
  return null
}
