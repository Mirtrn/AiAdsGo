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

    try {
      await initializeDatabase()
    } catch (error) {
      console.error('❌ Database initialization failed during server startup:', error)
      // 不阻止服务器启动，但记录错误
    }
  }
}
