-- ============================================
-- PostgreSQL 迁移编号：122
-- 标题：Gemini API 服务商选择
-- 日期：2025-12-29
-- 数据库：PostgreSQL
-- 描述：支持用户选择 Gemini 官方或第三方中转服务商
-- ============================================

-- 🔧 修复：使用正确的表名 system_settings（而不是 ai_settings）
-- ✅ 幂等性保证：使用 IF NOT EXISTS 和条件检查，确保可以安全重复执行

-- ==========================================
-- Part 1: Gemini Provider 服务商配置
-- ==========================================

-- 1. 新增服务商类型字段（带枚举约束）
-- 可选值：'official'（官方）、'relay'（第三方中转）、'vertex'（Vertex AI）
DO $$
BEGIN
  -- 只在列不存在时添加
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings' AND column_name = 'gemini_provider'
  ) THEN
    ALTER TABLE system_settings
    ADD COLUMN gemini_provider VARCHAR(20)
    DEFAULT 'official'
    CHECK (gemini_provider IN ('official', 'relay', 'vertex'));

    RAISE NOTICE '✅ 已添加 gemini_provider 列';
  ELSE
    RAISE NOTICE '⏭️  gemini_provider 列已存在，跳过';
  END IF;
END $$;

-- 2. 新增端点字段（系统自动填充，用户不可编辑）
DO $$
BEGIN
  -- 只在列不存在时添加
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings' AND column_name = 'gemini_endpoint'
  ) THEN
    ALTER TABLE system_settings
    ADD COLUMN gemini_endpoint TEXT NULL;

    RAISE NOTICE '✅ 已添加 gemini_endpoint 列';
  ELSE
    RAISE NOTICE '⏭️  gemini_endpoint 列已存在，跳过';
  END IF;
END $$;

-- 3. 更新现有数据（幂等操作：只更新未设置的记录）

-- 3.1 Vertex AI 用户（已配置 use_vertex_ai 的用户）
-- 先检查是否存在 use_vertex_ai 列
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings' AND column_name = 'use_vertex_ai'
  ) THEN
    -- 只更新 gemini_provider 为 NULL 或 'official' 的记录
    UPDATE system_settings
    SET gemini_provider = 'vertex',
        gemini_endpoint = 'vertex'
    WHERE category = 'ai'
      AND key = 'use_vertex_ai'
      AND value = 'true'
      AND (gemini_provider IS NULL OR gemini_provider = '' OR gemini_provider = 'official');

    RAISE NOTICE '✅ 已更新 Vertex AI 用户配置';
  ELSE
    RAISE NOTICE '⏭️  未找到 use_vertex_ai 列，跳过 Vertex AI 用户迁移';
  END IF;
END $$;

-- 3.2 官方用户（默认所有 AI 类别的其他配置）
-- 只更新未设置 gemini_provider 的记录
UPDATE system_settings
SET gemini_provider = 'official',
    gemini_endpoint = 'https://generativelanguage.googleapis.com'
WHERE category = 'ai'
  AND (gemini_provider IS NULL OR gemini_provider = '');

-- 4. 添加索引（提升查询性能）
CREATE INDEX IF NOT EXISTS idx_system_settings_provider
ON system_settings(gemini_provider);

-- 5. 添加字段注释
COMMENT ON COLUMN system_settings.gemini_provider IS 'Gemini 服务商类型：official(官方), relay(第三方中转), vertex(Vertex AI)';
COMMENT ON COLUMN system_settings.gemini_endpoint IS 'Gemini API 端点 URL（系统自动填充，用户不可编辑）';
