/**
 * 检查新加坡服务器上的autoads用户状态
 */
const { Client } = require('pg')

async function checkAutoadsUser() {
  const connectionString = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'
  
  const client = new Client({
    connectionString,
    ssl: false,
  })

  try {
    console.log('🔌 连接到新加坡服务器数据库...')
    await client.connect()
    console.log('✅ 连接成功\n')

    // 查询autoads用户的详细信息
    const query = `
      SELECT 
        id,
        username,
        email,
        role,
        is_active,
        locked_until,
        failed_login_count,
        last_failed_login,
        package_type,
        package_expires_at,
        created_at,
        updated_at
      FROM users 
      WHERE username = 'autoads' OR role = 'admin'
      ORDER BY id;
    `

    console.log('📊 查询autoads用户状态...\n')
    const result = await client.query(query)

    if (result.rows.length === 0) {
      console.log('❌ 未找到autoads用户')
      return
    }

    console.log(`找到 ${result.rows.length} 个管理员用户：\n`)
    
    for (const user of result.rows) {
      console.log('='.repeat(60))
      console.log(`👤 用户ID: ${user.id}`)
      console.log(`   用户名: ${user.username}`)
      console.log(`   邮箱: ${user.email}`)
      console.log(`   角色: ${user.role}`)
      console.log(`   激活状态: ${user.is_active ? '✅ 已激活' : '❌ 已禁用'}`)
      console.log(`   锁定状态: ${user.locked_until ? `🔒 锁定至 ${user.locked_until}` : '🔓 未锁定'}`)
      console.log(`   失败登录次数: ${user.failed_login_count}`)
      console.log(`   最后失败登录: ${user.last_failed_login || '无'}`)
      console.log(`   套餐类型: ${user.package_type}`)
      console.log(`   套餐过期时间: ${user.package_expires_at}`)
      console.log(`   创建时间: ${user.created_at}`)
      console.log(`   更新时间: ${user.updated_at}`)
      console.log('='.repeat(60))
      console.log()

      // 分析问题
      if (!user.is_active) {
        console.log('⚠️  问题分析：')
        console.log('   账户被禁用 (is_active = false)')
        console.log('\n💡 解决方案：')
        console.log('   需要执行以下SQL来启用账户：')
        console.log(`   UPDATE users SET is_active = true WHERE id = ${user.id};`)
      }

      if (user.locked_until) {
        const lockedUntil = new Date(user.locked_until)
        const now = new Date()
        if (lockedUntil > now) {
          console.log('⚠️  问题分析：')
          console.log(`   账户被锁定至 ${user.locked_until}`)
          console.log(`   剩余锁定时间: ${Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000 / 60)} 分钟`)
          console.log('\n💡 解决方案：')
          console.log('   需要执行以下SQL来解锁账户：')
          console.log(`   UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE id = ${user.id};`)
        }
      }
    }

    // 查询最近的登录历史
    console.log('\n📜 查询最近的登录历史...\n')
    const loginHistoryQuery = `
      SELECT 
        id,
        user_id,
        username,
        success,
        ip_address,
        user_agent,
        failure_reason,
        created_at
      FROM login_history 
      WHERE username = 'autoads'
      ORDER BY created_at DESC
      LIMIT 10;
    `

    const loginHistory = await client.query(loginHistoryQuery)
    
    if (loginHistory.rows.length > 0) {
      console.log('最近10次登录记录：')
      for (const record of loginHistory.rows) {
        const status = record.success ? '✅ 成功' : '❌ 失败'
        console.log(`  ${record.created_at} | ${status} | IP: ${record.ip_address || 'N/A'} | ${record.failure_reason || ''}`)
      }
    } else {
      console.log('未找到登录历史记录')
    }

  } catch (error) {
    console.error('❌ 错误:', error)
    throw error
  } finally {
    await client.end()
    console.log('\n🔌 数据库连接已关闭')
  }
}

checkAutoadsUser().catch(console.error)
