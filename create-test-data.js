const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath)

try {
  // 获取管理员ID
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get()
  
  if (!admin) {
    console.log('❌ 管理员账号不存在')
    process.exit(1)
  }
  
  console.log(`✅ 找到管理员账号 ID: ${admin.id}`)
  
  // 检查是否已有Offer
  const existingOffer = db.prepare("SELECT id FROM offers WHERE user_id = ?").get(admin.id)
  
  if (existingOffer) {
    console.log(`✅ 已存在Offer ID: ${existingOffer.id}`)
  } else {
    // 创建测试Offer
    const result = db.prepare(`
      INSERT INTO offers (
        user_id,
        offer_name,
        url,
        brand,
        target_country,
        target_language,
        affiliate_link,
        scrape_status,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      admin.id,
      'Reolink_US_01',
      'https://www.amazon.com/stores/page/201E3A4F-C63F-48A6-87B7-524F985330DA',
      'Reolink',
      'US',
      'English',
      'https://pboost.me/UKTs4I6',
      'completed',
      1
    )
    
    console.log(`✅ 创建测试Offer ID: ${result.lastInsertRowid}`)
  }
  
} catch (error) {
  console.error('❌ 错误:', error)
  process.exit(1)
} finally {
  db.close()
}
