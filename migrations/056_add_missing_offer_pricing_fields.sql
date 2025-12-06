-- Migration: 056_add_missing_offer_pricing_fields.sql
-- Purpose: 添加offers表缺失的产品价格和佣金比例字段
-- Date: 2025-12-06
-- Issue: 创建Offer时报错 "table offers has no column named product_price"

-- 添加产品价格字段（可选）
-- 示例：$699.00, ¥5999.00
ALTER TABLE offers ADD COLUMN product_price TEXT;

-- 添加佣金比例字段（可选）
-- 示例：6.75%, 8.5%
ALTER TABLE offers ADD COLUMN commission_payout TEXT;

-- 添加pricing JSON字段（存储解析后的价格信息）
ALTER TABLE offers ADD COLUMN pricing TEXT;

-- 添加is_active字段（标记offer是否激活）
ALTER TABLE offers ADD COLUMN is_active INTEGER DEFAULT 1;

-- 注释说明
-- product_price: 产品价格，用于计算建议最大CPC
-- commission_payout: 佣金比例，用于计算建议最大CPC
-- pricing: 解析后的价格JSON（包含current, original, discount等）
-- is_active: 是否激活（1=激活, 0=停用）
-- 建议最大CPC公式：max_cpc = product_price * commission_payout / 50
