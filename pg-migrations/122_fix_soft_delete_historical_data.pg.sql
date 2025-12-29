-- Migration: 122_fix_soft_delete_historical_data.pg.sql
-- Description: 修复软删除机制，确保历史performance数据得到保留
-- Author: AutoBB
-- Date: 2025-12-29
-- Database: PostgreSQL
-- Priority: P0 - 阻止历史数据丢失

-- ==========================================
-- 问题背景
-- ==========================================
-- 1. Campaign删除使用了DELETE而非软删除，导致performance数据级联删除
-- 2. 统计查询不一致：部分过滤is_deleted，部分不过滤
-- 3. 已删除的campaigns无法体现在历史统计数据中

-- ==========================================
-- 修复内容
-- ==========================================
-- 1. ✅ 代码层面：campaigns.ts deleteCampaign改为UPDATE软删除
-- 2. ✅ 代码层面：所有查询API统一处理is_deleted过滤
-- 3. 🔧 数据库层面：添加索引优化软删除查询性能
-- 4. 📊 数据验证：检查现有数据一致性

-- ==========================================
-- Step 1: 添加索引优化软删除查询
-- ==========================================

-- campaigns表：优化is_deleted + user_id查询
CREATE INDEX IF NOT EXISTS idx_campaigns_user_is_deleted
ON campaigns(user_id, is_deleted, created_at DESC);

-- offers表：优化is_deleted + user_id查询（如果索引不存在）
CREATE INDEX IF NOT EXISTS idx_offers_user_is_deleted
ON offers(user_id, is_deleted);

-- ==========================================
-- Step 2: 数据验证和统计
-- ==========================================

-- 验证：检查是否有campaigns没有正确设置is_deleted字段
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

  RAISE NOTICE 'Data Validation: Campaigns without is_deleted field: %', null_count;

  -- 统计软删除数量
  SELECT COUNT(*) INTO deleted_campaigns
  FROM campaigns
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Statistics: Soft-deleted campaigns: %', deleted_campaigns;

  SELECT COUNT(*) INTO deleted_offers
  FROM offers
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Statistics: Soft-deleted offers: %', deleted_offers;

  -- 检查已删除campaigns的performance数据
  SELECT COUNT(DISTINCT cp.campaign_id) INTO perf_count
  FROM campaign_performance cp
  INNER JOIN campaigns c ON cp.campaign_id = c.id
  WHERE c.is_deleted = TRUE;

  RAISE NOTICE 'Performance data for deleted campaigns: %', perf_count;
END $$;

-- ==========================================
-- Step 3: 修复NULL值（防御性修复）
-- ==========================================

-- 将NULL is_deleted字段设置为FALSE（未删除）
UPDATE campaigns
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE offers
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

-- ==========================================
-- Step 4: 验证结果
-- ==========================================

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
  RAISE NOTICE 'SUCCESS: Migration 122 completed';
  RAISE NOTICE 'Deleted campaigns: %', deleted_campaigns;
  RAISE NOTICE 'Deleted offers: %', deleted_offers;
  RAISE NOTICE 'Total performance records: %', total_performance;
  RAISE NOTICE '========================================';
END $$;
