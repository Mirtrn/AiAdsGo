/**
 * Next.js Instrumentation API
 *
 * 在服务器启动时运行初始化代码
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 只在 Node.js 运行时执行，不在 Edge Runtime 执行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeDatabase } = await import('./lib/db-init')
    const { initializeQueue } = await import('./lib/queue/init-queue')

    try {
      await initializeDatabase()
    } catch (error) {
      console.error('❌ Database initialization failed during server startup:', error)
    }

    try {
      await initializeQueue()
    } catch (error) {
      console.error('❌ Queue initialization failed during server startup:', error)
    }
  }
}
