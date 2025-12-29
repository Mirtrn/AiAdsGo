-- ============================================
-- 迁移：Gemini API 服务商选择
-- 日期：2025-12-29
-- 编号：122
-- 描述：支持用户选择 Gemini 官方或第三方中转服务商
-- ============================================

-- 🔧 修复：使用正确的表名 system_settings（而不是 ai_settings）

-- 1. 新增服务商类型字段
-- 可选值：'official'（官方）、'relay'（第三方中转）、'vertex'（Vertex AI）
ALTER TABLE system_settings
ADD COLUMN gemini_provider VARCHAR(20) DEFAULT 'official';

-- 2. 新增端点字段（系统自动填充，用户不可编辑）
ALTER TABLE system_settings
ADD COLUMN gemini_endpoint TEXT NULL;

-- 3. 更新现有数据

-- 3.1 Vertex AI 用户（已配置 use_vertex_ai='true' 的用户）
UPDATE system_settings
SET gemini_provider = 'vertex',
    gemini_endpoint = 'vertex'
WHERE category = 'ai'
  AND key = 'use_vertex_ai'
  AND value = 'true';

-- 3.2 官方用户（默认所有 AI 类别的其他配置）
UPDATE system_settings
SET gemini_provider = 'official',
    gemini_endpoint = 'https://generativelanguage.googleapis.com'
WHERE category = 'ai'
  AND (gemini_provider IS NULL OR gemini_provider = '');

-- 4. 添加索引（提升查询性能）
CREATE INDEX IF NOT EXISTS idx_system_settings_provider
ON system_settings(gemini_provider);
