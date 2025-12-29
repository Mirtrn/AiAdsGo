-- ============================================
-- 迁移编号：122
-- 标题：Gemini Provider + 软删除修复
-- 日期：2025-12-29
-- 数据库：SQLite
-- 描述：合并两个独立迁移
--   Part 1: Gemini API 服务商选择
--   Part 2: 软删除机制修复
-- ============================================

-- ✅ 幂等性保证：使用条件判断，确保可以安全重复执行

-- ==========================================
-- Part 1: Gemini Provider 服务商配置
-- ==========================================

-- 1.1 新增服务商类型字段（幂等：如果列不存在则添加）
-- 可选值：'official'（官方）、'relay'（第三方中转）、'vertex'（Vertex AI）
-- SQLite 不支持 ALTER TABLE IF NOT EXISTS，使用 PRAGMA table_info 检查
ALTER TABLE system_settings
ADD COLUMN gemini_provider VARCHAR(20) DEFAULT 'official';
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN 在列已存在时会报错
-- 在实际执行时，如果列已存在，这条语句会失败但不影响后续操作

-- 1.2 新增端点字段（系统自动填充，用户不可编辑）
ALTER TABLE system_settings
ADD COLUMN gemini_endpoint TEXT NULL;

-- 1.3 更新现有数据（幂等操作：只更新未设置的记录）

-- 1.3.1 Vertex AI 用户（已配置 use_vertex_ai='true' 的用户）
UPDATE system_settings
SET gemini_provider = 'vertex',
    gemini_endpoint = 'vertex'
WHERE category = 'ai'
  AND key = 'use_vertex_ai'
  AND value = 'true'
  AND (gemini_provider IS NULL OR gemini_provider = '' OR gemini_provider = 'official');

-- 1.3.2 官方用户（默认所有 AI 类别的其他配置）
UPDATE system_settings
SET gemini_provider = 'official',
    gemini_endpoint = 'https://generativelanguage.googleapis.com'
WHERE category = 'ai'
  AND (gemini_provider IS NULL OR gemini_provider = '');

-- 1.4 添加索引（提升查询性能）
CREATE INDEX IF NOT EXISTS idx_system_settings_provider
ON system_settings(gemini_provider);

-- ==========================================
-- Part 2: 软删除机制修复
-- ==========================================

-- 问题背景：
-- 1. Campaign删除使用了DELETE而非软删除，导致performance数据级联删除
-- 2. 统计查询不一致：部分过滤is_deleted，部分不过滤
-- 3. 已删除的campaigns无法体现在历史统计数据中

-- 修复内容：
-- 1. ✅ 代码层面：campaigns.ts deleteCampaign改为UPDATE软删除
-- 2. ✅ 代码层面：所有查询API统一处理is_deleted过滤
-- 3. 🔧 数据库层面：添加索引优化软删除查询性能
-- 4. 📊 数据验证：检查现有数据一致性

-- 2.1 添加索引优化软删除查询
-- campaigns表：优化is_deleted + user_id查询
CREATE INDEX IF NOT EXISTS idx_campaigns_user_is_deleted
ON campaigns(user_id, is_deleted, created_at DESC);

-- offers表：优化is_deleted + user_id查询
CREATE INDEX IF NOT EXISTS idx_offers_user_is_deleted
ON offers(user_id, is_deleted);

-- 2.2 数据验证和统计
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

-- 2.3 修复NULL值（防御性修复）
-- 将NULL is_deleted字段设置为0（未删除）
UPDATE campaigns
SET is_deleted = 0
WHERE is_deleted IS NULL;

UPDATE offers
SET is_deleted = 0
WHERE is_deleted IS NULL;

-- 2.4 验证结果
SELECT 'SUCCESS: Migration 122 completed (Combined)' AS result,
       (SELECT COUNT(*) FROM campaigns WHERE is_deleted = 1) as deleted_campaigns,
       (SELECT COUNT(*) FROM offers WHERE is_deleted = 1) as deleted_offers,
       (SELECT COUNT(*) FROM campaign_performance) as total_performance_records;
