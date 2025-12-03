/**
 * 数据库自动初始化模块
 *
 * 在应用启动时自动检查并初始化数据库：
 * 1. 检测数据库类型（SQLite 或 PostgreSQL）
 * 2. 创建数据库表结构（如果不存在）
 * 3. 创建默认管理员账号
 * 4. 导入管理员配置（PostgreSQL 生产环境）
 * 5. 插入默认系统配置
 * 6. 自动执行增量迁移（新增）
 */

import { getDatabase } from './db'
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
 *
 * 检查多个关键表是否存在，而不仅仅是 users 表
 * 只有当所有关键表都存在时，才认为数据库已初始化
 */
async function isDatabaseInitialized(): Promise<boolean> {
  const db = getDatabase()

  // 定义关键表列表 - 这些表必须全部存在才认为数据库已初始化
  const criticalTables = [
    'users',              // 用户表
    'offers',             // Offer 表
    'campaigns',          // Campaign 表
    'system_settings',    // 系统设置表
    'industry_benchmarks' // 行业基准表
  ]

  if (db.type === 'sqlite') {
    // SQLite: 检查所有关键表是否存在
    try {
      for (const table of criticalTables) {
        const result = await db.query<{ count: number }>(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?",
          [table]
        )
        if (result[0].count === 0) {
          console.log(`⚠️ 数据库初始化检查: 缺少关键表 '${table}'`)
          return false
        }
      }
      console.log('✅ 数据库初始化检查: 所有关键表都存在')
      return true
    } catch (error) {
      console.error('❌ 数据库初始化检查失败:', error)
      return false
    }
  } else {
    // PostgreSQL: 检查所有关键表是否存在
    try {
      for (const table of criticalTables) {
        const result = await db.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
          [table]
        )
        if (!result[0].exists) {
          console.log(`⚠️ 数据库初始化检查: 缺少关键表 '${table}'`)
          return false
        }
      }
      console.log('✅ 数据库初始化检查: 所有关键表都存在')
      return true
    } catch (error) {
      console.error('❌ 数据库初始化检查失败:', error)
      return false
    }
  }
}

/**
 * 初始化 SQLite 数据库
 */
async function initializeSQLite(): Promise<void> {
  console.log('📦 Initializing SQLite database...')

  // SQLite 初始化需要先通过命令行脚本完成
  // 因为 better-sqlite3 的 exec 方法可以执行多条 SQL 语句
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
  const dataDir = path.dirname(dbPath)
  const sqlPath = path.join(process.cwd(), 'migrations', '000_init_schema.sqlite.sql')

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log(`✅ Created data directory: ${dataDir}`)
  }

  if (!fs.existsSync(sqlPath)) {
    console.log('⚠️  SQLite schema file not found.')
    console.log('   Please run: npm run db:schema && npm run db:init')
    return
  }

  console.log('⚠️  SQLite database needs manual initialization.')
  console.log('   Please run: npm run db:init')
}

/**
 * 初始化 PostgreSQL 数据库
 */
async function initializePostgreSQL(): Promise<void> {
  console.log('🐘 Initializing PostgreSQL database...')

  try {
    // 1. 从生成的SQL文件创建表结构
    const sqlPath = path.join(process.cwd(), 'migrations', '000_init_schema.pg.sql')
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`PostgreSQL schema file not found: ${sqlPath}. Please run: npm run db:schema`)
    }

    const sqlContent = fs.readFileSync(sqlPath, 'utf-8')
    const db = getDatabase()
    const sql = (db as any).getRawConnection()

    console.log('\n📋 Creating database tables...')
    await sql.begin(async (tx: any) => {
      await tx.unsafe(sqlContent)
    })
    console.log('✅ Schema created from migrations/000_init_schema.pg.sql')

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
    { category: 'google_ads', key: 'login_customer_id', dataType: 'string', isSensitive: false, isRequired: true, description: 'Google Ads Login Customer ID (MCC账户ID)' },
    { category: 'google_ads', key: 'client_id', dataType: 'string', isSensitive: true, isRequired: false, description: 'Google Ads API Client ID（可选）' },
    { category: 'google_ads', key: 'client_secret', dataType: 'string', isSensitive: true, isRequired: false, description: 'Google Ads API Client Secret（可选）' },
    { category: 'google_ads', key: 'developer_token', dataType: 'string', isSensitive: true, isRequired: false, description: 'Google Ads Developer Token（可选）' },

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
    console.log('✅ Database already initialized, checking for pending migrations...')
    // 数据库已初始化，执行增量迁移
    await runPendingMigrations()
    // 检查未完成的队列任务
    await checkUnfinishedQueueTasks()
    return
  }

  console.log('⚠️  Database not initialized, starting initialization...\n')

  const db = getDatabase()

  if (db.type === 'sqlite') {
    await initializeSQLite()
  } else {
    await initializePostgreSQL()
  }

  // 初始化完成后也执行迁移（确保所有增量迁移都被应用）
  await runPendingMigrations()
}

/**
 * 自动执行增量迁移
 *
 * 核心功能：
 * 1. 扫描 migrations/ 目录下的所有 .sql 文件
 * 2. 检查 migration_history 表，跳过已执行的迁移
 * 3. 按文件名顺序执行未执行的迁移
 * 4. 记录执行结果到 migration_history 表
 *
 * 迁移文件命名规范：
 * - SQLite: {编号}_{描述}.sql (如 037_add_keywords.sql)
 * - PostgreSQL: {编号}_{描述}.pg.sql (如 037_add_keywords.pg.sql)
 * - 000 开头的是初始化 schema，不参与增量迁移
 */
async function runPendingMigrations(): Promise<void> {
  const db = getDatabase()
  const migrationsDir = path.join(process.cwd(), 'migrations')

  // 检查迁移目录是否存在
  if (!fs.existsSync(migrationsDir)) {
    console.log('⚠️  Migrations directory not found, skipping migrations')
    return
  }

  // 确保 migration_history 表存在
  await ensureMigrationHistoryTable()

  // 获取所有迁移文件
  const allFiles = fs.readdirSync(migrationsDir)

  // 根据数据库类型选择对应的迁移文件
  const fileExtension = db.type === 'postgres' ? '.pg.sql' : '.sql'
  const excludeExtension = db.type === 'postgres' ? '.sql' : '.pg.sql'

  const migrationFiles = allFiles
    .filter(file => {
      // 排除 README 和其他非 SQL 文件
      if (!file.endsWith('.sql')) return false
      // 排除初始化 schema（000 开头）
      if (file.startsWith('000_')) return false
      // PostgreSQL: 只选择 .pg.sql 文件
      if (db.type === 'postgres') {
        return file.endsWith('.pg.sql')
      }
      // SQLite: 排除 .pg.sql 文件，选择普通 .sql 文件
      return !file.endsWith('.pg.sql')
    })
    .sort() // 按文件名排序

  if (migrationFiles.length === 0) {
    console.log('📋 No migration files found')
    return
  }

  // 获取已执行的迁移
  const executedMigrations = await getExecutedMigrations()

  // 过滤出未执行的迁移（已执行集合已包含所有可能的变体）
  const pendingMigrations = migrationFiles.filter(file => {
    return !executedMigrations.has(file)
  })

  if (pendingMigrations.length === 0) {
    console.log('✅ All migrations are up to date')
    return
  }

  console.log(`\n📦 Found ${pendingMigrations.length} pending migrations:`)
  pendingMigrations.forEach(f => console.log(`   - ${f}`))
  console.log('')

  // 执行每个迁移
  let successCount = 0
  let failCount = 0

  for (const migrationFile of pendingMigrations) {
    const filePath = path.join(migrationsDir, migrationFile)
    const sqlContent = fs.readFileSync(filePath, 'utf-8')

    console.log(`🔄 Executing: ${migrationFile}`)

    try {
      await executeMigration(migrationFile, sqlContent)
      await recordMigration(migrationFile)
      console.log(`✅ Completed: ${migrationFile}`)
      successCount++
    } catch (error) {
      console.error(`❌ Failed: ${migrationFile}`)
      console.error(`   Error:`, error instanceof Error ? error.message : error)
      failCount++
      // 继续执行其他迁移，不中断流程
      // 但记录错误，让运维人员知道需要手动处理
    }
  }

  console.log(`\n📊 Migration summary:`)
  console.log(`   ✅ Success: ${successCount}`)
  if (failCount > 0) {
    console.log(`   ❌ Failed: ${failCount}`)
    console.log(`   ⚠️  Please check failed migrations and fix manually`)
  }
}

/**
 * 确保 migration_history 表存在
 */
async function ensureMigrationHistoryTable(): Promise<void> {
  const db = getDatabase()

  if (db.type === 'sqlite') {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  } else {
    await db.query(`
      CREATE TABLE IF NOT EXISTS migration_history (
        id SERIAL PRIMARY KEY,
        migration_name TEXT NOT NULL UNIQUE,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  }
}

/**
 * 获取已执行的迁移列表
 */
async function getExecutedMigrations(): Promise<Set<string>> {
  const db = getDatabase()
  const executed = new Set<string>()

  try {
    // 注意：db.query() 返回 Promise<T[]>，需要 await
    const results = await db.query<{ migration_name: string }>(
      'SELECT migration_name FROM migration_history'
    )

    // 标准化所有迁移名称（处理历史记录中可能存在的不同格式）
    results.forEach(row => {
      const name = row.migration_name
      executed.add(name)
      // 标准化：同时添加基础名称（去除 .sql 和 .pg.sql 后缀）
      const baseName = name.replace(/\.(pg\.)?sql$/, '')
      if (baseName !== name) {
        // 如果原始记录有后缀，也添加不带后缀和带其他后缀的版本
        executed.add(baseName)
        executed.add(baseName + '.sql')
        executed.add(baseName + '.pg.sql')
      } else {
        // 如果原始记录没有后缀，添加带后缀的版本
        executed.add(name + '.sql')
        executed.add(name + '.pg.sql')
      }
    })
  } catch (error) {
    // 表可能不存在，返回空集合
    console.error('⚠️ Failed to get executed migrations:', error)
  }

  return executed
}

/**
 * 执行单个迁移
 */
async function executeMigration(name: string, sql: string): Promise<void> {
  const db = getDatabase()

  // 分割多个 SQL 语句（按分号分割，但忽略字符串中的分号）
  const statements = splitSqlStatements(sql)

  if (db.type === 'sqlite') {
    // SQLite: 逐条执行
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          db.exec(stmt)
        } catch (error) {
          // 忽略 "column already exists" 等幂等性错误
          const errorMsg = error instanceof Error ? error.message : String(error)
          if (
            errorMsg.includes('duplicate column name') ||
            errorMsg.includes('already exists')
          ) {
            console.log(`   ⏭️  Skipped (already exists): ${stmt.substring(0, 60)}...`)
          } else {
            throw error
          }
        }
      }
    }
  } else {
    // PostgreSQL: 使用事务
    const rawSql = (db as any).getRawConnection()
    await rawSql.begin(async (tx: any) => {
      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            await tx.unsafe(stmt)
          } catch (error) {
            // 忽略 "column already exists" 等幂等性错误
            const errorMsg = error instanceof Error ? error.message : String(error)
            if (
              errorMsg.includes('already exists') ||
              errorMsg.includes('duplicate')
            ) {
              console.log(`   ⏭️  Skipped (already exists): ${stmt.substring(0, 60)}...`)
            } else {
              throw error
            }
          }
        }
      }
    })
  }
}

/**
 * 记录迁移执行历史
 */
async function recordMigration(name: string): Promise<void> {
  const db = getDatabase()

  if (db.type === 'sqlite') {
    db.exec(
      'INSERT OR IGNORE INTO migration_history (migration_name) VALUES (?)',
      [name]
    )
  } else {
    await db.query(
      'INSERT INTO migration_history (migration_name) VALUES ($1) ON CONFLICT DO NOTHING',
      [name]
    )
  }
}

/**
 * 分割 SQL 语句（支持 PostgreSQL DO $$ ... END $$; 语法块）
 *
 * 处理逻辑：
 * 1. 检测 DO $$ 开始的语法块，将整个块作为一条语句
 * 2. 普通语句按分号分割
 * 3. 移除单行注释（以 -- 开头的行）
 */
function splitSqlStatements(sql: string): string[] {
  // 移除单行注释（整行注释，但保留行内注释）
  const lines = sql.split('\n')
  const cleanedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // 跳过纯注释行
    if (trimmed.startsWith('--')) {
      continue
    }
    cleanedLines.push(line)
  }

  const cleanedSql = cleanedLines.join('\n')

  const statements: string[] = []
  let currentStatement = ''
  let inDollarBlock = false
  let dollarTag = ''

  // 逐字符扫描，处理 $$ 语法块
  let i = 0
  while (i < cleanedSql.length) {
    const char = cleanedSql[i]

    // 检测 dollar quoting 开始/结束
    if (char === '$') {
      // 查找完整的 dollar tag (如 $$, $tag$)
      let tag = '$'
      let j = i + 1
      while (j < cleanedSql.length && (cleanedSql[j].match(/[a-zA-Z0-9_]/) || cleanedSql[j] === '$')) {
        tag += cleanedSql[j]
        if (cleanedSql[j] === '$') {
          j++
          break
        }
        j++
      }

      // 如果找到有效的 dollar tag (以 $ 结尾)
      if (tag.endsWith('$') && tag.length >= 2) {
        if (!inDollarBlock) {
          // 开始 dollar block
          inDollarBlock = true
          dollarTag = tag
          currentStatement += tag
          i = j
          continue
        } else if (tag === dollarTag) {
          // 结束 dollar block
          inDollarBlock = false
          currentStatement += tag
          i = j
          dollarTag = ''
          continue
        }
      }
    }

    // 在 dollar block 内，所有字符都保留（包括分号）
    if (inDollarBlock) {
      currentStatement += char
      i++
      continue
    }

    // 普通语句：按分号分割
    if (char === ';') {
      currentStatement += char
      const trimmed = currentStatement.trim()
      if (trimmed && trimmed !== ';') {
        statements.push(trimmed)
      }
      currentStatement = ''
      i++
      continue
    }

    currentStatement += char
    i++
  }

  // 处理最后一条语句（可能没有分号结尾）
  const trimmed = currentStatement.trim()
  if (trimmed && trimmed !== ';') {
    statements.push(trimmed)
  }

  return statements
}

// 全局标记：是否需要恢复队列任务（声明在全局作用域）
declare global {
  // eslint-disable-next-line no-var
  var __queueRecoveryPending: boolean | undefined
  // eslint-disable-next-line no-var
  var __queueRecoveryData: Array<{
    id: number
    user_id: number
    url: string
    brand: string | null
  }> | undefined
}

/**
 * 检查未完成的队列任务
 *
 * 场景：服务重启时，内存队列中的任务会丢失
 * 解决：从数据库查询 pending/in_progress 状态的Offer，标记为待恢复
 *
 * 注意：这里只做查询，实际恢复在首次API请求时触发
 * 原因：instrumentation阶段无法安全导入复杂模块（offer-scraping有复杂依赖）
 *
 * 恢复执行：由 @/lib/queue-recovery.ts 的 executeQueueRecoveryIfNeeded() 函数完成
 */
async function checkUnfinishedQueueTasks(): Promise<void> {
  const db = getDatabase()

  // 只支持 SQLite（PostgreSQL 暂不支持）
  if (db.type !== 'sqlite') {
    return
  }

  try {
    // 查询未完成的任务（7天内的，排除已删除的）
    const unfinishedOffers = await db.query<{
      id: number
      user_id: number
      url: string
      brand: string | null
      scrape_status: string
      created_at: string
    }>(`
      SELECT id, user_id, url, brand, scrape_status, created_at
      FROM offers
      WHERE scrape_status IN ('pending', 'in_progress')
        AND created_at > datetime('now', '-7 days')
        AND deleted_at IS NULL
      ORDER BY
        CASE scrape_status
          WHEN 'in_progress' THEN 1
          WHEN 'pending' THEN 2
        END,
        created_at ASC
    `)

    if (unfinishedOffers.length === 0) {
      console.log('✅ 队列恢复：没有未完成的任务需要恢复')
      global.__queueRecoveryPending = false
      return
    }

    // 统计信息
    const inProgressCount = unfinishedOffers.filter(o => o.scrape_status === 'in_progress').length
    const pendingCount = unfinishedOffers.filter(o => o.scrape_status === 'pending').length

    console.log(`📋 队列恢复：发现 ${unfinishedOffers.length} 个未完成任务`)
    console.log(`   - in_progress: ${inProgressCount}`)
    console.log(`   - pending: ${pendingCount}`)
    console.log(`   (将在首次API请求时自动恢复)`)

    // 存储待恢复数据到全局变量
    global.__queueRecoveryPending = true
    global.__queueRecoveryData = unfinishedOffers.map(o => ({
      id: o.id,
      user_id: o.user_id,
      url: o.url,
      brand: o.brand
    }))
  } catch (error) {
    console.error('❌ 检查队列任务失败:', error)
    global.__queueRecoveryPending = false
  }
}
