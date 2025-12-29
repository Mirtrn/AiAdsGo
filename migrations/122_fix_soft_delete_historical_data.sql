-- Migration: 122_fix_soft_delete_historical_data.sql
-- Description: 修复软删除机制，确保历史performance数据得到保留
-- Author: AutoBB
-- Date: 2025-12-29
-- Database: SQLite
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
SELECT 'Data Validation: Campaigns without is_deleted field' AS check_name,
       COUNT(*) as count
FROM campaigns
WHERE is_deleted IS NULL;

-- 统计：当前软删除的campaigns数量
SELECT 'Statistics: Soft-deleted campaigns' AS metric,
       COUNT(*) as count
FROM campaigns
WHERE is_deleted = 1;

-- 统计：当前软删除的offers数量
SELECT 'Statistics: Soft-deleted offers' AS metric,
       COUNT(*) as count
FROM offers
WHERE is_deleted = 1;

-- 验证：检查已删除campaigns的performance数据是否保留
SELECT 'Data Validation: Performance data for deleted campaigns' AS check_name,
       COUNT(DISTINCT cp.campaign_id) as deleted_campaigns_with_performance
FROM campaign_performance cp
INNER JOIN campaigns c ON cp.campaign_id = c.id
WHERE c.is_deleted = 1;

-- ==========================================
-- Step 3: 修复NULL值（防御性修复）
-- ==========================================

-- 将NULL is_deleted字段设置为0（未删除）
UPDATE campaigns
SET is_deleted = 0
WHERE is_deleted IS NULL;

UPDATE offers
SET is_deleted = 0
WHERE is_deleted IS NULL;

-- ==========================================
-- Step 4: 验证结果
-- ==========================================

SELECT 'SUCCESS: Migration 122 completed' AS result,
       (SELECT COUNT(*) FROM campaigns WHERE is_deleted = 1) as deleted_campaigns,
       (SELECT COUNT(*) FROM offers WHERE is_deleted = 1) as deleted_offers,
       (SELECT COUNT(*) FROM campaign_performance) as total_performance_records;
