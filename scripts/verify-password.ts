import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'

async function main() {
  const db = new Database('./data/autoads.db')
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get('autoads') as any

  if (!user) {
    console.error('❌ 用户不存在')
    process.exit(1)
  }

  console.log('用户信息:')
  console.log('  ID:', user.id)
  console.log('  用户名:', user.username)
  console.log('  密码哈希:', user.password_hash)

  const testPasswords = [
    'LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk=',
    'autoads123',
    '123456'
  ]

  console.log('\n测试密码验证:')
  for (const pwd of testPasswords) {
    const match = await bcrypt.compare(pwd, user.password_hash)
    console.log(`  "${pwd}": ${match ? '✅ 匹配' : '❌ 不匹配'}`)
  }

  db.close()
}

main().catch(console.error)
