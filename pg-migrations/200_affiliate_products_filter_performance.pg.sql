-- Migration: 200_affiliate_products_filter_performance.pg.sql
-- Date: 2026-03-04
-- Description: 优化 /products 常见筛选条件索引（MID、搜索、国家、日期、数值区间）

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_created_at
  ON affiliate_products(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_price_amount
  ON affiliate_products(user_id, price_amount);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_commission_rate
  ON affiliate_products(user_id, commission_rate);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_commission_amount
  ON affiliate_products(user_id, commission_amount);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_platform_merchant_id_id
  ON affiliate_products(user_id, platform, merchant_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_search_text_trgm
  ON affiliate_products
  USING gin (
    LOWER(
      COALESCE(mid, '')
      || ' '
      || COALESCE(asin, '')
      || ' '
      || COALESCE(product_name, '')
      || ' '
      || COALESCE(brand, '')
    ) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_affiliate_products_allowed_countries_trgm
  ON affiliate_products
  USING gin (LOWER(allowed_countries_json) gin_trgm_ops)
  WHERE allowed_countries_json IS NOT NULL;
