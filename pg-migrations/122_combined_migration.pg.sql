-- ============================================
-- PostgreSQL 迁移编号：122
-- 标题：Gemini Provider + 软删除修复
-- 日期：2025-12-29
-- 数据库：PostgreSQL
-- 描述：合并两个独立迁移
--   Part 1: Gemini API 服务商选择
--   Part 2: 软删除机制修复
-- ============================================

-- ✅ 幂等性保证：使用 IF NOT EXISTS 和条件检查，确保可以安全重复执行

-- ==========================================
-- Part 1: Gemini Provider 服务商配置
-- ==========================================

-- 1.1 新增服务商类型字段（带枚举约束）
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

    RAISE NOTICE '✅ Part 1.1: 已添加 gemini_provider 列';
  ELSE
    RAISE NOTICE '⏭️  Part 1.1: gemini_provider 列已存在，跳过';
  END IF;
END $$;

-- 1.2 新增端点字段（系统自动填充，用户不可编辑）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings' AND column_name = 'gemini_endpoint'
  ) THEN
    ALTER TABLE system_settings
    ADD COLUMN gemini_endpoint TEXT NULL;

    RAISE NOTICE '✅ Part 1.2: 已添加 gemini_endpoint 列';
  ELSE
    RAISE NOTICE '⏭️  Part 1.2: gemini_endpoint 列已存在，跳过';
  END IF;
END $$;

-- 1.3 更新现有数据（幂等操作：只更新未设置的记录）

-- 1.3.1 Vertex AI 用户
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings' AND column_name = 'use_vertex_ai'
  ) THEN
    UPDATE system_settings
    SET gemini_provider = 'vertex',
        gemini_endpoint = 'vertex'
    WHERE category = 'ai'
      AND key = 'use_vertex_ai'
      AND value = 'true'
      AND (gemini_provider IS NULL OR gemini_provider = '' OR gemini_provider = 'official');

    RAISE NOTICE '✅ Part 1.3.1: 已更新 Vertex AI 用户配置';
  ELSE
    RAISE NOTICE '⏭️  Part 1.3.1: 未找到 use_vertex_ai 列，跳过';
  END IF;
END $$;

-- 1.3.2 官方用户
UPDATE system_settings
SET gemini_provider = 'official',
    gemini_endpoint = 'https://generativelanguage.googleapis.com'
WHERE category = 'ai'
  AND (gemini_provider IS NULL OR gemini_provider = '');

-- 1.4 添加索引
CREATE INDEX IF NOT EXISTS idx_system_settings_provider
ON system_settings(gemini_provider);

-- 1.5 添加字段注释
COMMENT ON COLUMN system_settings.gemini_provider IS 'Gemini 服务商类型：official(官方), relay(第三方中转), vertex(Vertex AI)';
COMMENT ON COLUMN system_settings.gemini_endpoint IS 'Gemini API 端点 URL（系统自动填充，用户不可编辑）';

-- ==========================================
-- Part 2: 软删除机制修复
-- ==========================================

-- 问题背景：
-- 1. Campaign删除使用了DELETE而非软删除，导致performance数据级联删除
-- 2. 统计查询不一致：部分过滤is_deleted，部分不过滤
-- 3. 已删除的campaigns无法体现在历史统计数据中

-- 修复内容：
-- 1. ✅ 添加 is_deleted 列到 campaigns 表（如果不存在）
-- 2. ✅ 代码层面：campaigns.ts deleteCampaign改为UPDATE软删除
-- 3. ✅ 代码层面：所有查询API统一处理is_deleted过滤
-- 4. 🔧 数据库层面：添加索引优化软删除查询性能
-- 5. 📊 数据验证：检查现有数据一致性

-- 2.1 添加 is_deleted 列到 campaigns 表（PostgreSQL 幂等性处理）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE campaigns
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ Part 2.1: 已添加 campaigns.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  Part 2.1: campaigns.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 2.2 添加 deleted_at 列到 campaigns 表（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE campaigns
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ Part 2.2: 已添加 campaigns.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  Part 2.2: campaigns.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 2.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_campaigns_user_is_deleted
ON campaigns(user_id, is_deleted, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offers_user_is_deleted
ON offers(user_id, is_deleted);

-- 2.4 数据验证和统计
DO $$
DECLARE
  null_count INTEGER;
  deleted_campaigns INTEGER;
  deleted_offers INTEGER;
  perf_count INTEGER;
BEGIN
  -- 检查NULL值
  SELECT COUNT(*) INTO null_count
  FROM campaigns
  WHERE is_deleted IS NULL;

  RAISE NOTICE 'Part 2.4: Data Validation - Campaigns without is_deleted field: %', null_count;

  -- 统计软删除数量
  SELECT COUNT(*) INTO deleted_campaigns
  FROM campaigns
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Part 2.4: Statistics - Soft-deleted campaigns: %', deleted_campaigns;

  SELECT COUNT(*) INTO deleted_offers
  FROM offers
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Part 2.4: Statistics - Soft-deleted offers: %', deleted_offers;

  -- 检查已删除campaigns的performance数据
  SELECT COUNT(DISTINCT cp.campaign_id) INTO perf_count
  FROM campaign_performance cp
  INNER JOIN campaigns c ON cp.campaign_id = c.id
  WHERE c.is_deleted = TRUE;

  RAISE NOTICE 'Part 2.4: Performance data for deleted campaigns: %', perf_count;
END $$;

-- 2.5 修复NULL值（防御性修复）
UPDATE campaigns
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE offers
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

-- 2.6 最终验证
DO $$
DECLARE
  deleted_campaigns INTEGER;
  deleted_offers INTEGER;
  total_performance INTEGER;
BEGIN
  SELECT COUNT(*) INTO deleted_campaigns FROM campaigns WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO deleted_offers FROM offers WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO total_performance FROM campaign_performance;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUCCESS: Migration 122 completed (Combined)';
  RAISE NOTICE 'Part 1: Gemini Provider - ✅';
  RAISE NOTICE 'Part 2: Soft Delete - ✅';
  RAISE NOTICE 'Deleted campaigns: %', deleted_campaigns;
  RAISE NOTICE 'Deleted offers: %', deleted_offers;
  RAISE NOTICE 'Total performance records: %', total_performance;
  RAISE NOTICE '========================================';
END $$;
