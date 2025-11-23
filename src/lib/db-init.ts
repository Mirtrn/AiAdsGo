/**
 * 数据库自动初始化模块
 *
 * 在应用启动时自动检查并初始化数据库：
 * 1. 检测数据库类型（SQLite 或 PostgreSQL）
 * 2. 创建数据库表结构（如果不存在）
 * 3. 创建默认管理员账号
 * 4. 导入管理员配置（PostgreSQL 生产环境）
 * 5. 插入默认系统配置
 */

import { getDatabase } from './db'
import { initializePostgreSQLSchema } from './db-schema-pg'
import { hashPassword } from './crypto'
import fs from 'fs'
import path from 'path'

// 默认管理员信息
// 安全说明：密码从环境变量读取，如果未设置则生成32位随机密码
const crypto = require('crypto')
const DEFAULT_ADMIN = {
  username: 'autoads',
  email: 'admin@autoads.com',
  password: process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64'),
  display_name: 'AutoAds Administrator',
  role: 'admin',
  package_type: 'lifetime',
  package_expires_at: '2099-12-31T23:59:59.000Z',
}

// 配置导出文件路径
const CONFIG_EXPORT_PATH = path.join(process.cwd(), 'secrets', 'admin-config-export.json')

/**
 * 检查数据库是否已初始化
 */
async function isDatabaseInitialized(): Promise<boolean> {
  const db = getDatabase()

  if (db.type === 'sqlite') {
    // SQLite: 检查 users 表是否存在
    try {
      const result = await db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='users'"
      )
      return result[0].count > 0
    } catch (error) {
      return false
    }
  } else {
    // PostgreSQL: 检查 users 表是否存在
    try {
      const result = await db.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')"
      )
      return result[0].exists
    } catch (error) {
      return false
    }
  }
}

/**
 * 初始化 SQLite 数据库
 */
async function initializeSQLite(): Promise<void> {
  console.log('📦 Initializing SQLite database...')

  // SQLite 初始化逻辑由现有的 scripts/init-database.ts 处理
  // 这里我们只需要确保数据库文件存在
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
  const dataDir = path.dirname(dbPath)

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log(`✅ Created data directory: ${dataDir}`)
  }

  console.log('⚠️  SQLite database needs manual initialization.')
  console.log('   Please run: npm run init-db')
}

/**
 * 初始化 PostgreSQL 数据库
 */
async function initializePostgreSQL(): Promise<void> {
  console.log('🐘 Initializing PostgreSQL database...')

  try {
    // 1. 创建表结构
    await initializePostgreSQLSchema()

    // 2. 创建默认管理员账号
    await createDefaultAdmin()

    // 3. 插入默认系统配置
    await insertDefaultSystemSettings()

    // 4. 导入管理员配置（如果存在）
    await importAdminConfig()

    // 5. 插入行业基准数据
    await insertIndustryBenchmarks()

    console.log('\n✅ PostgreSQL database initialized successfully!')
  } catch (error) {
    console.error('❌ PostgreSQL initialization failed:', error)
    throw error
  }
}

/**
 * 创建默认管理员账号
 */
async function createDefaultAdmin(): Promise<void> {
  console.log('\n👤 Creating default admin account...')

  const db = getDatabase()
  const asyncDb = db.type === 'postgres' ? getDatabase() : null

  try {
    // 检查管理员是否已存在
    let existingAdmin: any

    if (db.type === 'sqlite') {
      existingAdmin = db.queryOne(
        'SELECT id FROM users WHERE username = ? OR role = ?',
        [DEFAULT_ADMIN.username, 'admin']
      )
    } else {
      const result = await asyncDb!.query(
        'SELECT id FROM users WHERE username = $1 OR role = $2',
        [DEFAULT_ADMIN.username, 'admin']
      )
      existingAdmin = result[0]
    }

    // 生成密码哈希
    const passwordHash = await hashPassword(DEFAULT_ADMIN.password)

    if (existingAdmin) {
      console.log('⚠️  Admin account already exists, updating password...')

      if (db.type === 'sqlite') {
        db.exec(
          'UPDATE users SET password_hash = ?, is_active = 1 WHERE username = ? OR role = ?',
          [passwordHash, DEFAULT_ADMIN.username, 'admin']
        )
      } else {
        await asyncDb!.query(
          'UPDATE users SET password_hash = $1, is_active = TRUE WHERE username = $2 OR role = $3',
          [passwordHash, DEFAULT_ADMIN.username, 'admin']
        )
      }

      console.log('✅ Admin password updated')
    } else {
      if (db.type === 'sqlite') {
        db.exec(
          `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
          ]
        )
      } else {
        await asyncDb!.query(
          `INSERT INTO users (username, email, password_hash, display_name, role, package_type, package_expires_at, must_change_password, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, TRUE)`,
          [
            DEFAULT_ADMIN.username,
            DEFAULT_ADMIN.email,
            passwordHash,
            DEFAULT_ADMIN.display_name,
            DEFAULT_ADMIN.role,
            DEFAULT_ADMIN.package_type,
            DEFAULT_ADMIN.package_expires_at,
          ]
        )
      }

      console.log('✅ Default admin account created')
      console.log('\n🔑 Admin credentials:')
      console.log(`   Username: ${DEFAULT_ADMIN.username}`)
      console.log(`   Password: ${DEFAULT_ADMIN.password}`)
      console.log(`   Email: ${DEFAULT_ADMIN.email}`)
      console.log('\n⚠️  Security Notice:')
      if (process.env.DEFAULT_ADMIN_PASSWORD) {
        console.log('   ✅ Using password from DEFAULT_ADMIN_PASSWORD environment variable')
      } else {
        console.log('   ⚠️  Random password generated! Please save it immediately:')
        console.log(`   👉 ${DEFAULT_ADMIN.password}`)
        console.log('   Recommended: Set DEFAULT_ADMIN_PASSWORD in production environment')
      }
    }
  } catch (error) {
    console.error('❌ Failed to create admin account:', error)
    throw error
  }
}

/**
 * 插入默认系统配置
 */
async function insertDefaultSystemSettings(): Promise<void> {
  console.log('\n⚙️  Inserting default system settings...')

  const db = getDatabase()
  const asyncDb = db.type === 'postgres' ? getDatabase() : null

  const defaultSettings = [
    // Google Ads API配置
    { category: 'google_ads', key: 'client_id', dataType: 'string', isSensitive: true, isRequired: true, description: 'Google Ads API Client ID' },
    { category: 'google_ads', key: 'client_secret', dataType: 'string', isSensitive: true, isRequired: true, description: 'Google Ads API Client Secret' },
    { category: 'google_ads', key: 'developer_token', dataType: 'string', isSensitive: true, isRequired: true, description: 'Google Ads Developer Token' },

    // AI配置 - Gemini直接API模式
    { category: 'ai', key: 'gemini_api_key', dataType: 'string', isSensitive: true, isRequired: false, description: 'Gemini API密钥（直接API模式）' },
    { category: 'ai', key: 'gemini_model', dataType: 'string', isSensitive: false, isRequired: true, description: 'Gemini模型版本', defaultValue: 'gemini-2.5-pro' },

    // AI配置 - Vertex AI模式（优先使用）
    { category: 'ai', key: 'use_vertex_ai', dataType: 'boolean', isSensitive: false, isRequired: false, description: '是否使用Vertex AI', defaultValue: 'false' },
    { category: 'ai', key: 'gcp_project_id', dataType: 'string', isSensitive: true, isRequired: false, description: 'GCP项目ID（Vertex AI）' },
    { category: 'ai', key: 'gcp_location', dataType: 'string', isSensitive: false, isRequired: false, description: 'GCP区域（Vertex AI）', defaultValue: 'us-central1' },
    { category: 'ai', key: 'gcp_service_account_json', dataType: 'text', isSensitive: true, isRequired: false, description: 'GCP Service Account JSON（Vertex AI）' },

    // 代理配置
    { category: 'proxy', key: 'urls', dataType: 'json', isSensitive: false, isRequired: false, description: '代理URL配置列表（JSON格式）' },

    // 系统配置
    { category: 'system', key: 'currency', dataType: 'string', isSensitive: false, isRequired: true, description: '默认货币', defaultValue: 'CNY' },
    { category: 'system', key: 'language', dataType: 'string', isSensitive: false, isRequired: true, description: '系统语言', defaultValue: 'zh-CN' },
    { category: 'system', key: 'sync_interval_hours', dataType: 'number', isSensitive: false, isRequired: true, description: '数据同步间隔(小时)', defaultValue: '6' },
    { category: 'system', key: 'link_check_enabled', dataType: 'boolean', isSensitive: false, isRequired: true, description: '是否启用链接检查', defaultValue: 'true' },
    { category: 'system', key: 'link_check_time', dataType: 'string', isSensitive: false, isRequired: true, description: '链接检查时间', defaultValue: '02:00' },
  ]

  try {
    for (const setting of defaultSettings) {
      if (db.type === 'sqlite') {
        // 检查配置是否已存在
        const existing = db.queryOne(
          'SELECT id FROM system_settings WHERE category = ? AND config_key = ? AND user_id IS NULL',
          [setting.category, setting.key]
        )

        if (!existing) {
          db.exec(
            `INSERT INTO system_settings (user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description)
             VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
            [
              setting.category,
              setting.key,
              setting.dataType,
              setting.isSensitive ? 1 : 0,
              setting.isRequired ? 1 : 0,
              setting.defaultValue || null,
              setting.description,
            ]
          )
        }
      } else {
        // PostgreSQL
        const existing = await asyncDb!.query(
          'SELECT id FROM system_settings WHERE category = $1 AND config_key = $2 AND user_id IS NULL',
          [setting.category, setting.key]
        )

        if (existing.length === 0) {
          await asyncDb!.query(
            `INSERT INTO system_settings (user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description)
             VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)`,
            [
              setting.category,
              setting.key,
              setting.dataType,
              setting.isSensitive,
              setting.isRequired,
              setting.defaultValue || null,
              setting.description,
            ]
          )
        }
      }
    }

    console.log(`✅ Inserted ${defaultSettings.length} default settings`)
  } catch (error) {
    console.error('❌ Failed to insert default settings:', error)
    throw error
  }
}

/**
 * 导入管理员配置（从导出文件）
 */
async function importAdminConfig(): Promise<void> {
  // 只在 PostgreSQL 生产环境导入
  const db = getDatabase()
  if (db.type !== 'postgres') {
    return
  }

  if (!fs.existsSync(CONFIG_EXPORT_PATH)) {
    console.log('\n⏭️  No admin config export file found, skipping import')
    return
  }

  console.log('\n📥 Importing admin configuration...')

  try {
    const exportData = JSON.parse(fs.readFileSync(CONFIG_EXPORT_PATH, 'utf-8'))
    const asyncDb = getDatabase()

    // 查找管理员用户ID
    const adminResult = await asyncDb.query<{ id: number }>(
      'SELECT id FROM users WHERE username = $1 OR role = $2',
      ['autoads', 'admin']
    )

    if (adminResult.length === 0) {
      console.error('❌ Admin user not found, cannot import config')
      return
    }

    const adminUserId = adminResult[0].id

    // 导入配置
    for (const setting of exportData.settings) {
      // 检查配置是否已存在
      const existing = await asyncDb.query(
        'SELECT id FROM system_settings WHERE category = $1 AND config_key = $2 AND (user_id = $3 OR user_id IS NULL)',
        [setting.category, setting.config_key, setting.user_id === null ? null : adminUserId]
      )

      if (existing.length > 0) {
        // 更新现有配置
        await asyncDb.query(
          `UPDATE system_settings
           SET config_value = $1, encrypted_value = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [setting.config_value, setting.encrypted_value, existing[0].id]
        )
      } else {
        // 插入新配置
        await asyncDb.query(
          `INSERT INTO system_settings (
            user_id, category, config_key, config_value, encrypted_value,
            data_type, is_sensitive, is_required, default_value, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            setting.user_id === null ? null : adminUserId,
            setting.category,
            setting.config_key,
            setting.config_value,
            setting.encrypted_value,
            setting.data_type,
            setting.is_sensitive === 1,
            setting.is_required === 1,
            setting.default_value,
            setting.description,
          ]
        )
      }
    }

    console.log(`✅ Imported ${exportData.settings.length} admin settings`)
  } catch (error) {
    console.error('❌ Failed to import admin config:', error)
    throw error
  }
}

/**
 * 插入行业基准数据
 */
async function insertIndustryBenchmarks(): Promise<void> {
  console.log('\n📊 Inserting industry benchmarks...')

  const db = getDatabase()
  const asyncDb = db.type === 'postgres' ? getDatabase() : null

  // 行业基准数据（30个二级分类）
  const benchmarks = [
    // E-commerce 电商（6个子类）
    { l1: 'E-commerce', l2: 'Fashion & Apparel', code: 'ecom_fashion', ctr: 2.41, cpc: 0.45, cvr: 2.77 },
    { l1: 'E-commerce', l2: 'Electronics & Gadgets', code: 'ecom_electronics', ctr: 2.04, cpc: 0.68, cvr: 1.91 },
    { l1: 'E-commerce', l2: 'Home & Garden', code: 'ecom_home', ctr: 2.53, cpc: 0.52, cvr: 2.23 },
    { l1: 'E-commerce', l2: 'Health & Beauty', code: 'ecom_beauty', ctr: 2.78, cpc: 0.41, cvr: 3.19 },
    { l1: 'E-commerce', l2: 'Sports & Outdoors', code: 'ecom_sports', ctr: 2.35, cpc: 0.58, cvr: 2.01 },
    { l1: 'E-commerce', l2: 'Food & Beverage', code: 'ecom_food', ctr: 2.67, cpc: 0.38, cvr: 2.85 },

    // Travel 旅游（4个子类）
    { l1: 'Travel', l2: 'Luggage & Travel Gear', code: 'travel_luggage', ctr: 3.18, cpc: 0.95, cvr: 2.47 },
    { l1: 'Travel', l2: 'Hotels & Accommodation', code: 'travel_hotels', ctr: 4.68, cpc: 1.22, cvr: 2.57 },
    { l1: 'Travel', l2: 'Flights & Transportation', code: 'travel_flights', ctr: 4.29, cpc: 0.84, cvr: 2.14 },
    { l1: 'Travel', l2: 'Tours & Activities', code: 'travel_tours', ctr: 3.87, cpc: 0.76, cvr: 3.01 },

    // Technology 科技（4个子类）
    { l1: 'Technology', l2: 'Software & SaaS', code: 'tech_saas', ctr: 2.41, cpc: 3.50, cvr: 3.04 },
    { l1: 'Technology', l2: 'Consumer Electronics', code: 'tech_consumer', ctr: 2.18, cpc: 0.72, cvr: 1.84 },
    { l1: 'Technology', l2: 'B2B Tech Services', code: 'tech_b2b', ctr: 2.09, cpc: 4.21, cvr: 2.58 },
    { l1: 'Technology', l2: 'Mobile Apps', code: 'tech_apps', ctr: 3.24, cpc: 0.52, cvr: 4.12 },

    // Finance 金融（4个子类）
    { l1: 'Finance', l2: 'Banking & Credit', code: 'finance_banking', ctr: 2.91, cpc: 3.77, cvr: 4.19 },
    { l1: 'Finance', l2: 'Insurance', code: 'finance_insurance', ctr: 2.13, cpc: 4.52, cvr: 1.87 },
    { l1: 'Finance', l2: 'Investment & Trading', code: 'finance_investment', ctr: 1.92, cpc: 5.14, cvr: 2.23 },
    { l1: 'Finance', l2: 'Cryptocurrency', code: 'finance_crypto', ctr: 2.47, cpc: 2.89, cvr: 1.56 },

    // Education 教育（3个子类）
    { l1: 'Education', l2: 'Online Courses', code: 'edu_online', ctr: 3.39, cpc: 2.13, cvr: 3.67 },
    { l1: 'Education', l2: 'Academic Programs', code: 'edu_academic', ctr: 2.87, cpc: 3.42, cvr: 2.94 },
    { l1: 'Education', l2: 'Professional Training', code: 'edu_professional', ctr: 2.65, cpc: 2.78, cvr: 3.21 },

    // Healthcare 医疗健康（3个子类）
    { l1: 'Healthcare', l2: 'Medical Services', code: 'health_medical', ctr: 3.12, cpc: 2.89, cvr: 3.78 },
    { l1: 'Healthcare', l2: 'Pharmaceuticals', code: 'health_pharma', ctr: 2.68, cpc: 1.95, cvr: 2.47 },
    { l1: 'Healthcare', l2: 'Wellness & Fitness', code: 'health_wellness', ctr: 3.45, cpc: 0.89, cvr: 3.92 },

    // Automotive 汽车（2个子类）
    { l1: 'Automotive', l2: 'Vehicle Sales', code: 'auto_sales', ctr: 2.14, cpc: 2.46, cvr: 2.53 },
    { l1: 'Automotive', l2: 'Auto Parts & Services', code: 'auto_parts', ctr: 2.67, cpc: 1.24, cvr: 3.14 },

    // Real Estate 房地产（2个子类）
    { l1: 'Real Estate', l2: 'Residential', code: 'realestate_residential', ctr: 2.03, cpc: 1.89, cvr: 1.94 },
    { l1: 'Real Estate', l2: 'Commercial', code: 'realestate_commercial', ctr: 1.87, cpc: 2.67, cvr: 1.72 },

    // Entertainment 娱乐（2个子类）
    { l1: 'Entertainment', l2: 'Gaming', code: 'entertainment_gaming', ctr: 3.56, cpc: 0.47, cvr: 2.87 },
    { l1: 'Entertainment', l2: 'Streaming & Media', code: 'entertainment_media', ctr: 3.21, cpc: 0.65, cvr: 2.34 },
  ]

  try {
    for (const benchmark of benchmarks) {
      if (db.type === 'sqlite') {
        // 使用 INSERT OR IGNORE 避免重复
        db.exec(
          `INSERT OR IGNORE INTO industry_benchmarks (industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [benchmark.l1, benchmark.l2, benchmark.code, benchmark.ctr, benchmark.cpc, benchmark.cvr]
        )
      } else {
        // PostgreSQL: 使用 ON CONFLICT DO NOTHING
        await asyncDb!.query(
          `INSERT INTO industry_benchmarks (industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (industry_code) DO NOTHING`,
          [benchmark.l1, benchmark.l2, benchmark.code, benchmark.ctr, benchmark.cpc, benchmark.cvr]
        )
      }
    }

    console.log(`✅ Inserted ${benchmarks.length} industry benchmarks`)
  } catch (error) {
    console.error('❌ Failed to insert industry benchmarks:', error)
    throw error
  }
}

/**
 * 主初始化函数
 */
export async function initializeDatabase(): Promise<void> {
  console.log('🔍 Checking database initialization status...')

  const isInitialized = await isDatabaseInitialized()

  if (isInitialized) {
    console.log('✅ Database already initialized, skipping initialization')
    return
  }

  console.log('⚠️  Database not initialized, starting initialization...\n')

  const db = getDatabase()

  if (db.type === 'sqlite') {
    await initializeSQLite()
  } else {
    await initializePostgreSQL()
  }
}
