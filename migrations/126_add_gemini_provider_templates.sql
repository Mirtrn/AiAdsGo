-- Migration: 126_add_gemini_provider_templates
-- Description: 补充 gemini_provider 和 gemini_endpoint 的全局模板记录
-- Date: 2025-12-30
-- 问题：gemini_provider 和 gemini_endpoint 在代码中添加，但缺少数据库全局模板
-- 遵循 docs/BasicPrinciples/MustKnowV1.md 第31条：模板+实例双层架构

-- SQLite 版本

-- 1. 检查并插入 gemini_provider 全局模板
INSERT OR IGNORE INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES (NULL, 'ai', 'gemini_provider', NULL, 'string', 0, 0, 'Gemini API 服务商（official/relay/vertex）');

-- 2. 检查并插入 gemini_endpoint 全局模板
INSERT OR IGNORE INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES (NULL, 'ai', 'gemini_endpoint', NULL, 'string', 0, 0, 'Gemini API 端点（系统自动计算）');

-- 3. 验证：列出所有 AI 分类的全局模板
SELECT
  'global_template' as record_type,
  category,
  key,
  description
FROM system_settings
WHERE user_id IS NULL
  AND value IS NULL
  AND category = 'ai'
ORDER BY key;
