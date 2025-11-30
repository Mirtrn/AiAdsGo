import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { hashPassword } from '../src/lib/crypto'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const dataDir = path.dirname(dbPath)

console.log('🚀 开始初始化数据库...')
console.log('📍 数据库路径:', dbPath)

// 确保data目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
  console.log('✅ 创建data目录')
}

// 创建数据库连接
const db = new Database(dbPath)
console.log('✅ 数据库连接成功')

// 启用外键约束
db.pragma('foreign_keys = ON')

// 开始事务
const transaction = db.transaction(() => {
  console.log('\n📋 创建数据库表...\n')

  // 1. users表 - 用户信息
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      google_id TEXT UNIQUE,
      profile_picture TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      package_type TEXT NOT NULL DEFAULT 'trial',
      package_expires_at TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  console.log('✅ users表')

  // 2. google_ads_accounts表 - Google Ads账户关联
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_ads_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      customer_id TEXT NOT NULL,
      account_name TEXT,
      currency TEXT NOT NULL DEFAULT 'CNY',
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      is_manager_account INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, customer_id)
    )
  `)
  console.log('✅ google_ads_accounts表')

  // 3. offers表 - Offer产品信息
  db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      brand TEXT NOT NULL,
      product_name TEXT,
      category TEXT,
      target_country TEXT NOT NULL,
      affiliate_link TEXT,
      brand_description TEXT,
      unique_selling_points TEXT,
      product_highlights TEXT,
      target_audience TEXT,
      final_url TEXT,
      final_url_suffix TEXT,
      scrape_status TEXT NOT NULL DEFAULT 'pending',
      scrape_error TEXT,
      scraped_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ offers表')

  // 4. campaigns表 - 广告系列
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      offer_id INTEGER NOT NULL,
      google_ads_account_id INTEGER NOT NULL,
      campaign_id TEXT UNIQUE,
      campaign_name TEXT NOT NULL,
      budget_amount REAL NOT NULL,
      budget_type TEXT NOT NULL DEFAULT 'DAILY',
      target_cpa REAL,
      max_cpc REAL,
      status TEXT NOT NULL DEFAULT 'PAUSED',
      start_date TEXT,
      end_date TEXT,
      creation_status TEXT NOT NULL DEFAULT 'draft',
      creation_error TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),

      -- 创意关联和Google Ads ID（2025-11-22新增）
      ad_creative_id INTEGER,
      google_campaign_id TEXT,
      google_ad_group_id TEXT,
      google_ad_id TEXT,

      -- 广告配置和行为
      campaign_config TEXT,
      pause_old_campaigns INTEGER,

      -- A/B测试支持
      is_test_variant INTEGER DEFAULT 0,
      ab_test_id INTEGER,
      traffic_allocation REAL DEFAULT 1.0 CHECK(traffic_allocation >= 0 AND traffic_allocation <= 1),

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
      FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL,
      FOREIGN KEY (ab_test_id) REFERENCES ab_tests(id) ON DELETE SET NULL
    )
  `)
  console.log('✅ campaigns表')

  // 5. launch_scores表 - Launch Score评分
  db.exec(`
    CREATE TABLE IF NOT EXISTS launch_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      offer_id INTEGER NOT NULL,
      total_score INTEGER NOT NULL,
      keyword_score INTEGER NOT NULL,
      market_fit_score INTEGER NOT NULL,
      landing_page_score INTEGER NOT NULL,
      budget_score INTEGER NOT NULL,
      content_score INTEGER NOT NULL,
      keyword_analysis_data TEXT,
      market_analysis_data TEXT,
      landing_page_analysis_data TEXT,
      budget_analysis_data TEXT,
      content_analysis_data TEXT,
      recommendations TEXT,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ launch_scores表')

  // 6. creatives表 - AI生成的广告创意
  db.exec(`
    CREATE TABLE IF NOT EXISTS creatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      offer_id INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      headline_1 TEXT NOT NULL,
      headline_2 TEXT,
      headline_3 TEXT,
      description_1 TEXT NOT NULL,
      description_2 TEXT,
      final_url TEXT NOT NULL,
      final_url_suffix TEXT,
      path_1 TEXT,
      path_2 TEXT,
      ai_model TEXT NOT NULL,
      generation_prompt TEXT,
      quality_score REAL,
      is_approved INTEGER NOT NULL DEFAULT 0,
      approved_by INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id)
    )
  `)
  console.log('✅ creatives表')

  // 7. weekly_recommendations表 - 每周优化建议
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      google_ads_account_id INTEGER NOT NULL,
      recommendation_type TEXT NOT NULL,
      recommendation_data TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      status TEXT NOT NULL DEFAULT 'pending',
      applied_at TEXT,
      week_start_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ weekly_recommendations表')

  // 8. campaign_performance表 - 广告系列性能数据
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      ctr REAL,
      cpc REAL,
      cpa REAL,
      conversion_rate REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, date)
    )
  `)
  console.log('✅ campaign_performance表')

  // 9. search_term_reports表 - 搜索词报告
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_term_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      search_term TEXT NOT NULL,
      match_type TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ search_term_reports表')

  // 10. rate_limits表 - API速率限制记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      api_name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ rate_limits表')

  // 11. system_settings表 - 系统配置
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      category TEXT NOT NULL,
      config_key TEXT NOT NULL,
      config_value TEXT,
      encrypted_value TEXT,
      data_type TEXT NOT NULL DEFAULT 'string',
      is_sensitive INTEGER NOT NULL DEFAULT 0,
      is_required INTEGER NOT NULL DEFAULT 0,
      validation_status TEXT,
      validation_message TEXT,
      last_validated_at TEXT,
      default_value TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ system_settings表')

  // 12. cpc_adjustment_history表 - CPC调整历史
  db.exec(`
    CREATE TABLE IF NOT EXISTS cpc_adjustment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      offer_id INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_value REAL NOT NULL,
      affected_campaign_count INTEGER NOT NULL,
      campaign_ids TEXT NOT NULL,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ cpc_adjustment_history表')

  // 13. risk_alerts表 - 风险预警
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      risk_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      related_type TEXT,
      related_id INTEGER,
      related_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      resolved_at TEXT,
      resolved_by INTEGER,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    )
  `)
  console.log('✅ risk_alerts表')

  // 14. link_check_history表 - 链接检查历史
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_check_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      offer_id INTEGER NOT NULL,
      is_accessible INTEGER NOT NULL,
      http_status_code INTEGER,
      response_time_ms INTEGER,
      brand_found INTEGER,
      content_valid INTEGER,
      validation_message TEXT,
      proxy_used TEXT,
      target_country TEXT,
      error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ link_check_history表')

  // 15. creative_versions表 - 创意版本历史
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      offer_id INTEGER NOT NULL,
      creative_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      changes TEXT,
      changed_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
      FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES users(id)
    )
  `)
  console.log('✅ creative_versions表')

  // 16. sync_logs表 - 数据同步日志
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
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
  console.log('✅ sync_logs表')

  // 创意学习模式表 - 用户创意成功特征
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_learning_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      success_features TEXT NOT NULL,
      total_creatives_analyzed INTEGER NOT NULL DEFAULT 0,
      avg_ctr REAL,
      avg_conversion_rate REAL,
      min_ctr_threshold REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ creative_learning_patterns表')

  // 备份日志表 - 记录数据库备份历史
  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_type TEXT NOT NULL,
      status TEXT NOT NULL,
      backup_filename TEXT,
      backup_path TEXT,
      file_size_bytes INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `)
  console.log('✅ backup_logs表')

  // 18. ai_token_usage表 - AI Token使用统计
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      api_type TEXT NOT NULL DEFAULT 'gemini',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      date TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ ai_token_usage表')

  console.log('\n📋 创建索引...\n')

  // 创建索引以提升查询性能
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_offers_user_id ON offers(user_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_offer_id ON campaigns(offer_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_is_test_variant ON campaigns(is_test_variant);
    CREATE INDEX IF NOT EXISTS idx_campaigns_ab_test_id ON campaigns(ab_test_id);
    CREATE INDEX IF NOT EXISTS idx_creatives_offer_id ON creatives(offer_id);
    CREATE INDEX IF NOT EXISTS idx_performance_campaign_date ON campaign_performance(campaign_id, date);
    CREATE INDEX IF NOT EXISTS idx_performance_user_date ON campaign_performance(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_status ON risk_alerts(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_link_check_offer ON link_check_history(offer_id);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON sync_logs(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_creative_learning_user_id ON creative_learning_patterns(user_id);
    CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(status);
    CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user_date ON ai_token_usage(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_ai_token_usage_date ON ai_token_usage(date);
    CREATE INDEX IF NOT EXISTS idx_ai_token_usage_model ON ai_token_usage(model);
    CREATE INDEX IF NOT EXISTS idx_ai_token_usage_created_at ON ai_token_usage(created_at);
  `)
  console.log('✅ 索引创建完成')

  console.log('\n📋 插入默认系统配置...\n')

  // 插入默认系统配置
  const defaultSettings = [
    // Google Ads API配置
    { category: 'google_ads', key: 'client_id', dataType: 'string', isSensitive: 1, isRequired: 1, description: 'Google Ads API Client ID' },
    { category: 'google_ads', key: 'client_secret', dataType: 'string', isSensitive: 1, isRequired: 1, description: 'Google Ads API Client Secret' },
    { category: 'google_ads', key: 'developer_token', dataType: 'string', isSensitive: 1, isRequired: 1, description: 'Google Ads Developer Token' },

    // AI配置 - Gemini直接API模式
    { category: 'ai', key: 'gemini_api_key', dataType: 'string', isSensitive: 1, isRequired: 0, description: 'Gemini API密钥（直接API模式）' },
    { category: 'ai', key: 'gemini_model', dataType: 'string', isSensitive: 0, isRequired: 1, description: 'Gemini模型版本（gemini-2.5-pro/gemini-2.5-flash/gemini-3-pro-preview）', defaultValue: 'gemini-2.5-pro' },

    // AI配置 - Vertex AI模式（优先使用）
    { category: 'ai', key: 'use_vertex_ai', dataType: 'boolean', isSensitive: 0, isRequired: 0, description: '是否使用Vertex AI（优先于直接API）', defaultValue: 'false' },
    { category: 'ai', key: 'gcp_project_id', dataType: 'string', isSensitive: 1, isRequired: 0, description: 'GCP项目ID（Vertex AI）' },
    { category: 'ai', key: 'gcp_location', dataType: 'string', isSensitive: 0, isRequired: 0, description: 'GCP区域（Vertex AI）', defaultValue: 'us-central1' },
    { category: 'ai', key: 'gcp_service_account_json', dataType: 'text', isSensitive: 1, isRequired: 0, description: 'GCP Service Account JSON（Vertex AI）' },

    // 代理配置 - 支持多个国家的代理URL，JSON格式存储
    // 格式: [{ country: 'US', url: '...' }, { country: 'UK', url: '...' }]
    // 第一个URL作为默认兜底值
    { category: 'proxy', key: 'urls', dataType: 'json', isSensitive: 0, isRequired: 0, description: '代理URL配置列表（JSON格式），支持多个国家的代理URL' },

    // 系统配置
    { category: 'system', key: 'currency', dataType: 'string', isSensitive: 0, isRequired: 1, description: '默认货币', defaultValue: 'CNY' },
    { category: 'system', key: 'language', dataType: 'string', isSensitive: 0, isRequired: 1, description: '系统语言', defaultValue: 'zh-CN' },
    { category: 'system', key: 'sync_interval_hours', dataType: 'number', isSensitive: 0, isRequired: 1, description: '数据同步间隔(小时)', defaultValue: '6' },
    { category: 'system', key: 'link_check_enabled', dataType: 'boolean', isSensitive: 0, isRequired: 1, description: '是否启用链接检查', defaultValue: 'true' },
    { category: 'system', key: 'link_check_time', dataType: 'string', isSensitive: 0, isRequired: 1, description: '链接检查时间', defaultValue: '02:00' },
  ]

  const insertSetting = db.prepare(`
    INSERT INTO system_settings (
      user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const setting of defaultSettings) {
    insertSetting.run(
      null, // user_id = null表示全局配置
      setting.category,
      setting.key,
      setting.dataType,
      setting.isSensitive,
      setting.isRequired,
      setting.defaultValue || null,
      setting.description
    )
  }

  console.log('✅ 默认系统配置插入完成')
})

// 主初始化函数（使用async支持密码哈希）
async function initializeDatabase() {
  try {
    // 执行事务
    transaction()
    console.log('\n✅ 数据库初始化完成！\n')
    console.log('📊 统计信息:')

    const tableCount = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get() as { count: number }
    const indexCount = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='index'").get() as { count: number }
    const settingsCount = db.prepare("SELECT COUNT(*) as count FROM system_settings").get() as { count: number }

    console.log(`   - 数据表数量: ${tableCount.count}`)
    console.log(`   - 索引数量: ${indexCount.count}`)
    console.log(`   - 默认配置项: ${settingsCount.count}`)

    // 创建默认管理员账号
    console.log('\n👤 创建默认管理员账号...')

    const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ? OR role = ?').get('autoads', 'admin')

    // 使用hashPassword生成密码哈希（从环境变量获取，或生成随机密码）
    const crypto = require('crypto')
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64')
    const passwordHash = await hashPassword(defaultPassword)

    if (existingAdmin) {
      console.log('⚠️  管理员账号已存在，更新密码...')
      db.prepare(`
        UPDATE users
        SET password_hash = ?, is_active = 1
        WHERE username = ? OR role = ?
      `).run(passwordHash, 'autoads', 'admin')
      console.log('✅ 管理员密码已更新')
    } else {
      db.prepare(`
        INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'autoads',
        'admin@autoads.com',
        passwordHash,
        'AutoAds Administrator',
        'admin',
        'lifetime',
        '2099-12-31T23:59:59.000Z',
        0,
        1
      )

      console.log('✅ 默认管理员账号创建成功')
      console.log('\n🔑 管理员登录信息:')
      console.log('   用户名: autoads')
      console.log('   密码:', defaultPassword)
      console.log('   邮箱: admin@autoads.com')
      console.log('\n⚠️  重要提示:')
      console.log('   1. 请将密码保存到密码管理器')
      console.log('   2. 建议首次登录后立即修改密码')
      console.log('   3. 生产环境请使用 DEFAULT_ADMIN_PASSWORD 环境变量设置强密码')
    }

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error)
    process.exit(1)
  } finally {
    db.close()
  }
}

// 运行初始化
initializeDatabase()
