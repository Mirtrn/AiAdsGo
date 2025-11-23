/**
 * 调度器打包脚本
 * 使用esbuild将scheduler.ts打包为单个JS文件，包含所有依赖
 */

const esbuild = require('esbuild')
const path = require('path')

async function buildScheduler() {
  console.log('📦 开始打包调度器...')

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src', 'scheduler.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: path.join(__dirname, 'dist', 'scheduler.js'),
      external: [
        // 排除需要原生模块的依赖
        'better-sqlite3',
        'bcrypt',
      ],
      minify: false, // 保持可读性，便于调试
      sourcemap: false,
      logLevel: 'info',
    })

    console.log('✅ 调度器打包完成: dist/scheduler.js')
  } catch (error) {
    console.error('❌ 调度器打包失败:', error)
    process.exit(1)
  }
}

buildScheduler()
