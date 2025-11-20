import Redis from 'ioredis'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  console.error('❌ REDIS_URL environment variable is not set')
  process.exit(1)
}

const redis = new Redis(redisUrl)

async function clearCache(pattern?: string) {
  try {
    console.log('🚀 开始清理Redis缓存...')

    const searchPattern = pattern || 'scrape:*'
    console.log(`🔍 搜索模式: ${searchPattern}`)

    // 使用SCAN命令批量获取键（避免KEYS命令阻塞）
    const keys: string[] = []
    let cursor = '0'

    do {
      const result = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', 100)
      cursor = result[0]
      keys.push(...result[1])
    } while (cursor !== '0')

    if (keys.length === 0) {
      console.log('✨ 没有找到匹配的缓存键')
      return
    }

    console.log(`\n📋 找到 ${keys.length} 个缓存键:`)

    // 显示前10个键作为示例
    keys.slice(0, 10).forEach(key => {
      console.log(`   - ${key}`)
    })
    if (keys.length > 10) {
      console.log(`   ... 还有 ${keys.length - 10} 个键`)
    }

    console.log('\n🗑️  开始删除...')

    // 批量删除（每次删除100个）
    let deletedCount = 0
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100)
      await redis.del(...batch)
      deletedCount += batch.length
      console.log(`   进度: ${deletedCount}/${keys.length}`)
    }

    console.log(`\n✅ 清理完成！删除了 ${deletedCount} 个缓存键`)

  } catch (error) {
    console.error('❌ 清理失败:', error)
    process.exit(1)
  } finally {
    await redis.quit()
  }
}

// 从命令行参数获取搜索模式
const pattern = process.argv[2]

if (pattern) {
  console.log(`📌 使用自定义模式: ${pattern}`)
}

clearCache(pattern)
