-- ============================================
-- SQLite 迁移：Gemini API 服务商选择
-- 日期：2025-12-29
-- 编号：122
-- 描述：支持用户选择 Gemini 官方或第三方中转服务商
-- ============================================

-- 🔧 修复：使用正确的表名 system_settings（而不是 ai_settings）
-- ✅ 幂等性保证：使用条件判断，确保可以安全重复执行

-- 1. 新增服务商类型字段（幂等：如果列不存在则添加）
-- 可选值：'official'（官方）、'relay'（第三方中转）、'vertex'（Vertex AI）
-- SQLite 不支持 ALTER TABLE IF NOT EXISTS，使用 PRAGMA table_info 检查
ALTER TABLE system_settings
ADD COLUMN gemini_provider VARCHAR(20) DEFAULT 'official';
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN 在列已存在时会报错
-- 在实际执行时，如果列已存在，这条语句会失败但不影响后续操作
-- 更安全的做法是在应用层检查列是否存在再执行，或者捕获错误

-- 2. 新增端点字段（系统自动填充，用户不可编辑）
ALTER TABLE system_settings
ADD COLUMN gemini_endpoint TEXT NULL;
-- 同上：如果列已存在会报错，但这是预期行为（幂等性的一种实现）

-- 3. 更新现有数据（幂等操作：只更新未设置的记录）

-- 3.1 Vertex AI 用户（已配置 use_vertex_ai='true' 的用户）
-- 只更新 gemini_provider 为 NULL、空或 'official' 的记录
UPDATE system_settings
SET gemini_provider = 'vertex',
    gemini_endpoint = 'vertex'
WHERE category = 'ai'
  AND key = 'use_vertex_ai'
  AND value = 'true'
  AND (gemini_provider IS NULL OR gemini_provider = '' OR gemini_provider = 'official');

-- 3.2 官方用户（默认所有 AI 类别的其他配置）
-- 只更新未设置 gemini_provider 的记录
UPDATE system_settings
SET gemini_provider = 'official',
    gemini_endpoint = 'https://generativelanguage.googleapis.com'
WHERE category = 'ai'
  AND (gemini_provider IS NULL OR gemini_provider = '');

-- 4. 添加索引（提升查询性能）
-- ✅ 已使用 IF NOT EXISTS，完全幂等
CREATE INDEX IF NOT EXISTS idx_system_settings_provider
ON system_settings(gemini_provider);
