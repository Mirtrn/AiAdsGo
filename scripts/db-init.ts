#!/usr/bin/env node
/**
 * Docker 容器启动时的数据库初始化脚本
 * 检查数据库是否已初始化，如果没有则执行初始化
 */

import postgres from 'postgres';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { hashPassword } from '../src/lib/crypto.js';

const DATABASE_URL = process.env.DATABASE_URL;
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD;

if (!DATABASE_URL) {
  console.error('❌ 错误: DATABASE_URL 环境变量未设置');
  process.exit(1);
}

/**
 * 从 DATABASE_URL 中提取数据库名和基础连接字符串
 * 例如: postgresql://user:pass@host:port/autoads -> { dbName: 'autoads', baseUrl: 'postgresql://user:pass@host:port/postgres' }
 * 如果URL末尾没有数据库名，默认使用'postgres'
 */
function parseDatabaseUrl(url: string): { dbName: string; baseUrl: string } {
  // 匹配带数据库名的URL: postgresql://user:pass@host:port/dbname
  const matchWithDb = url.match(/^(postgresql?:\/\/[^/]+)\/([^/?]+)(\?.*)?$/);
  if (matchWithDb) {
    const [, baseWithoutDb, dbName, queryString = ''] = matchWithDb;
    return {
      dbName,
      baseUrl: `${baseWithoutDb}/postgres${queryString}`,
    };
  }

  // 匹配不带数据库名的URL: postgresql://user:pass@host:port/ 或 postgresql://user:pass@host:port
  const matchWithoutDb = url.match(/^(postgresql?:\/\/[^/]+)\/?(\?.*)?$/);
  if (matchWithoutDb) {
    const [, baseWithoutDb, queryString = ''] = matchWithoutDb;
    console.log('⚠️  DATABASE_URL未指定数据库名，使用默认数据库: postgres');
    return {
      dbName: 'postgres',  // 默认使用postgres数据库
      baseUrl: `${baseWithoutDb}/postgres${queryString}`,
    };
  }

  throw new Error('无效的 DATABASE_URL 格式');
}

/**
 * 检查目标数据库是否存在
 */
async function checkDatabaseExists(sql: ReturnType<typeof postgres>, dbName: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM pg_database WHERE datname = ${dbName}
  `;
  return result.length > 0;
}

/**
 * 创建目标数据库
 */
async function createDatabase(sql: ReturnType<typeof postgres>, dbName: string): Promise<void> {
  console.log(`📦 创建数据库: ${dbName}...`);
  await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  console.log(`✅ 数据库 ${dbName} 创建成功`);
}

async function waitForDatabase(sql: ReturnType<typeof postgres>, maxRetries = 30): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await sql`SELECT 1`;
      return true;
    } catch (error) {
      console.log(`⏳ 等待数据库就绪... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function checkDatabaseInitialized(sql: ReturnType<typeof postgres>): Promise<boolean> {
  try {
    // 检查多个核心表是否存在，确保数据库完整初始化
    const coreTables = ['users', 'offers', 'ad_creatives', 'campaigns', 'prompt_versions'];

    const result = await sql`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${coreTables})
    `;

    const existingTables = parseInt(result[0].count);
    const allTablesExist = existingTables === coreTables.length;

    if (existingTables > 0 && !allTablesExist) {
      console.log(`⚠️  数据库部分初始化: ${existingTables}/${coreTables.length} 核心表存在`);
    }

    return allTablesExist;
  } catch (error) {
    return false;
  }
}

async function initializeDatabase(sql: ReturnType<typeof postgres>): Promise<void> {
  // 支持本地开发和 Docker 容器两种路径
  const possiblePaths = [
    resolve('/app/pg-migrations/000_init_schema_v2.pg.sql'),  // Docker 容器
    resolve(__dirname, '../pg-migrations/000_init_schema_v2.pg.sql'),  // 本地开发
    resolve(process.cwd(), 'pg-migrations/000_init_schema_v2.pg.sql'),  // 当前目录
  ];

  let migrationPath = '';
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      migrationPath = path;
      break;
    }
  }

  if (!migrationPath) {
    throw new Error(`找不到迁移文件，尝试过以下路径:\n${possiblePaths.join('\n')}`);
  }

  console.log(`📄 使用迁移文件: ${migrationPath}`);

  const migration = readFileSync(migrationPath, 'utf8');
  await sql.unsafe(migration);

  console.log('✅ 数据库初始化完成');
}

async function ensureAdminAccount(sql: ReturnType<typeof postgres>): Promise<void> {
  if (!DEFAULT_ADMIN_PASSWORD) {
    console.log('⚠️  警告: DEFAULT_ADMIN_PASSWORD 未设置，跳过管理员账号初始化');
    return;
  }

  console.log('👤 检查管理员账号...');

  // 检查管理员是否存在
  const existingAdmin = await sql`
    SELECT id, username, email FROM users WHERE username = 'autoads'
  `;

  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);

  if (existingAdmin.length === 0) {
    // 创建新管理员
    console.log('➕ 管理员账号不存在，正在创建...');

    await sql`
      INSERT INTO users (
        username, email, password_hash, display_name, role,
        package_type, package_expires_at, must_change_password,
        is_active, created_at, updated_at
      ) VALUES (
        'autoads', 'admin@autoads.com', ${passwordHash}, 'AutoAds Administrator', 'admin',
        'lifetime', '2099-12-31 23:59:59', false,
        true, NOW(), NOW()
      )
    `;

    console.log('✅ 管理员账号创建成功');
    console.log('   用户名: autoads');
    console.log('   邮箱: admin@autoads.com');
  } else {
    // 重置密码
    console.log('🔄 管理员账号已存在，正在重置密码...');

    await sql`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = NOW()
      WHERE username = 'autoads'
    `;

    console.log('✅ 管理员密码已重置');
  }
}

async function main() {
  console.log('========================================');
  console.log('🚀 AutoAds 数据库初始化');
  console.log('========================================');
  console.log('');
  console.log('📦 数据库类型: PostgreSQL');

  // 解析 DATABASE_URL 获取数据库名
  const { dbName, baseUrl } = parseDatabaseUrl(DATABASE_URL!);
  console.log(`🎯 目标数据库: ${dbName}`);
  console.log('🔗 连接到 PostgreSQL 服务器...');

  // 首先连接到默认的 postgres 数据库，检查目标数据库是否存在
  const adminSql = postgres(baseUrl);

  try {
    // 等待数据库服务器可用
    const serverReady = await waitForDatabase(adminSql);
    if (!serverReady) {
      console.error('❌ 错误: 无法连接到 PostgreSQL 服务器');
      process.exit(1);
    }
    console.log('✅ PostgreSQL 服务器连接成功');

    // 检查目标数据库是否存在
    console.log(`🔍 检查数据库 ${dbName} 是否存在...`);
    const dbExists = await checkDatabaseExists(adminSql, dbName);

    if (!dbExists) {
      await createDatabase(adminSql, dbName);
    } else {
      console.log(`✅ 数据库 ${dbName} 已存在`);
    }

    // 关闭管理连接
    await adminSql.end();

    // 连接到目标数据库
    console.log(`🔗 连接到数据库 ${dbName}...`);
    const sql = postgres(DATABASE_URL!);

    // 等待目标数据库可用
    const connected = await waitForDatabase(sql);
    if (!connected) {
      console.error('❌ 错误: 无法连接到目标数据库');
      process.exit(1);
    }
    console.log('✅ 数据库连接成功');

    // 检查数据库是否已初始化
    console.log('🔍 检查数据库表结构...');
    const initialized = await checkDatabaseInitialized(sql);

    if (!initialized) {
      console.log('📋 数据库未初始化，开始初始化...');
      await initializeDatabase(sql);
    } else {
      console.log('✅ 数据库表结构已初始化');
    }

    // 确保管理员账号存在
    await ensureAdminAccount(sql);

    console.log('');
    console.log('========================================');
    console.log('✅ 数据库初始化完成');
    console.log('========================================');

    await sql.end();

  } catch (error) {
    console.error('❌ 初始化失败:', (error as Error).message);
    process.exit(1);
  }
}

main();
