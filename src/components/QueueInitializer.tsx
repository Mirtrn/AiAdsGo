'use client'

/**
 * 队列系统初始化组件
 *
 * 在应用启动时自动初始化统一队列系统
 * 使用客户端组件确保只在浏览器端触发一次初始化
 */

import { useEffect, useRef } from 'react'

export function QueueInitializer() {
  const initialized = useRef(false)

  useEffect(() => {
    // 确保只初始化一次
    if (initialized.current) return
    initialized.current = true

    // 调用服务端API触发队列初始化
    const initQueue = async () => {
      try {
        // 通过health check API触发队列初始化
        const response = await fetch('/api/queue/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (response.ok) {
          const data = await response.json()
          console.log('✅ 队列系统初始化成功:', data.message)
        } else {
          console.warn('⚠️ 队列系统初始化响应异常:', response.status)
        }
      } catch (error) {
        // 初始化失败不影响应用运行，队列会在首次使用时懒加载
        console.warn('⚠️ 队列系统初始化请求失败（将在首次使用时懒加载）:', error)
      }
    }

    initQueue()
  }, [])

  // 不渲染任何内容
  return null
}
