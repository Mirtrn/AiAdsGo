-- Migration: 199_affiliate_products_merchant_id.pg.sql
-- Date: 2026-03-04
-- Description: affiliate_products 增加 merchant_id（PartnerBoost 商家ID）并建立索引，避免 MID 筛选扫描 raw_json

ALTER TABLE affiliate_products
  ADD COLUMN IF NOT EXISTS merchant_id TEXT;

UPDATE affiliate_products
SET merchant_id = NULLIF(
  BTRIM(
    COALESCE(
      substring(raw_json from '"brand_id"\s*:\s*"([^"]+)"'),
      substring(raw_json from '"brand_id"\s*:\s*([0-9]+)'),
      substring(raw_json from '"brandId"\s*:\s*"([^"]+)"'),
      substring(raw_json from '"brandId"\s*:\s*([0-9]+)'),
      substring(raw_json from '"bid"\s*:\s*"([^"]+)"'),
      substring(raw_json from '"bid"\s*:\s*([0-9]+)')
    )
  ),
  ''
)
WHERE platform = 'partnerboost'
  AND COALESCE(BTRIM(merchant_id), '') = '';

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_platform_merchant_id
  ON affiliate_products(user_id, platform, merchant_id);
