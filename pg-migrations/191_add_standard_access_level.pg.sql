-- 添加 standard 到 api_access_level CHECK 约束
-- google_ads_service_accounts 表
ALTER TABLE google_ads_service_accounts
  DROP CONSTRAINT IF EXISTS google_ads_service_accounts_api_access_level_check;

ALTER TABLE google_ads_service_accounts
  ADD CONSTRAINT google_ads_service_accounts_api_access_level_check
  CHECK (api_access_level = ANY (ARRAY['test'::text, 'explorer'::text, 'basic'::text, 'standard'::text]));

-- google_ads_credentials 表（如有约束一并修复）
ALTER TABLE google_ads_credentials
  DROP CONSTRAINT IF EXISTS google_ads_credentials_api_access_level_check;

ALTER TABLE google_ads_credentials
  ADD CONSTRAINT google_ads_credentials_api_access_level_check
  CHECK (api_access_level = ANY (ARRAY['test'::text, 'explorer'::text, 'basic'::text, 'standard'::text]));
