import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🔄 Migration 004: 添加creative_versions表')
console.log('📍 数据库路径:', dbPath)

if (!fs.existsSync(dbPath)) {
  console.error('❌ 数据库文件不存在，请先运行 npm run db:init')
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

try {
  // 读取SQL文件
  const sqlPath = path.join(__dirname, '004_add_creative_versions_table.sql')
  const sql = fs.readFileSync(sqlPath, 'utf-8')

  // 执行迁移
  db.exec(sql)

  console.log('✅ creative_versions表创建成功')
  console.log('✅ 索引创建成功')
  console.log('✅ Migration 004 完成')
} catch (error) {
  console.error('❌ Migration失败:', error)
  process.exit(1)
} finally {
  db.close()
}
