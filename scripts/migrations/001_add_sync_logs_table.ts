import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始执行迁移: 添加sync_logs表...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

try {
  // 检查表是否已存在
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_logs'"
  ).get()

  if (tableExists) {
    console.log('✅ sync_logs表已存在，跳过创建')
  } else {
    // 创建sync_logs表
    db.exec(`
      CREATE TABLE sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        google_ads_account_id INTEGER NOT NULL,
        sync_type TEXT NOT NULL,
        status TEXT NOT NULL,
        record_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
      )
    `)
    console.log('✅ sync_logs表创建成功')

    // 创建索引
    db.exec(`
      CREATE INDEX idx_sync_logs_user ON sync_logs(user_id, started_at DESC);
    `)
    console.log('✅ 索引创建成功')
  }

  console.log('\n✅ 迁移完成！')
} catch (error) {
  console.error('❌ 迁移失败:', error)
  process.exit(1)
} finally {
  db.close()
}
