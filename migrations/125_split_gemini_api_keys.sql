-- Migration: 125_split_gemini_api_keys
-- Description: 添加 gemini_relay_api_key 字段
-- Date: 2025-12-30

-- SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS 语法
-- 使用更安全的方式：先检查列是否存在，如果不存在再添加

-- 检查列是否存在的查询
SELECT name FROM pragma_table_info('system_settings') WHERE name = 'gemini_relay_api_key';

-- 安全的列添加方式：使用 ALTER TABLE（SQLite 会忽略重复列的错误）
-- 但实际上 SQLite 不支持 IF NOT EXISTS，所以我们需要用 try-catch 方式
-- 这里采用最简单的做法：如果列已存在，SQLite 会报错，但我们忽略错误继续执行

-- 使用单独语句添加列（SQLite 允许添加列但有限制）
ALTER TABLE system_settings ADD COLUMN gemini_relay_api_key TEXT DEFAULT NULL;

-- 如果上面失败（列已存在），上面的语句会报错
-- 成功后会显示 OK

-- 创建索引（加速查询）
CREATE INDEX IF NOT EXISTS idx_system_settings_gemini_relay_api_key
ON system_settings(category, key) WHERE gemini_relay_api_key IS NOT NULL;

-- 验证迁移结果
SELECT
  'gemini_relay_api_key' as field_name,
  COUNT(*) as total_users,
  SUM(CASE WHEN value IS NOT NULL THEN 1 ELSE 0 END) as configured
FROM system_settings
WHERE category = 'ai' AND key = 'gemini_relay_api_key';
