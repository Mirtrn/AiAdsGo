-- 072: 添加综合创意桶类型 'S' (Synthetic)
-- 用于第4个综合广告创意，包含所有品牌词+高搜索量非品牌词
--
-- SQLite不支持ALTER TABLE ADD/DROP CONSTRAINT
-- keyword_bucket字段是TEXT类型，无需修改表结构
-- 'S'值的验证在应用层处理
--
-- 此迁移为空操作（SQLite版本）
-- PostgreSQL版本见 pg-migrations/072_add_synthetic_bucket.pg.sql

SELECT 1;
