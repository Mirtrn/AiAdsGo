-- 添加 standard 到 api_access_level CHECK 约束
-- 防御性写法：若列尚未存在（如全新数据库中 204 尚未运行），则跳过
-- 对于已有数据库（列已存在），执行约束更新

-- google_ads_service_accounts 表
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_service_accounts'
      AND column_name = 'api_access_level'
  ) THEN
    ALTER TABLE google_ads_service_accounts
      DROP CONSTRAINT IF EXISTS google_ads_service_accounts_api_access_level_check;

    ALTER TABLE google_ads_service_accounts
      ADD CONSTRAINT google_ads_service_accounts_api_access_level_check
      CHECK (api_access_level = ANY (ARRAY['test'::text, 'explorer'::text, 'basic'::text, 'standard'::text]));
  END IF;
END $$;

-- google_ads_credentials 表（如有约束一并修复）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_credentials'
      AND column_name = 'api_access_level'
  ) THEN
    ALTER TABLE google_ads_credentials
      DROP CONSTRAINT IF EXISTS google_ads_credentials_api_access_level_check;

    ALTER TABLE google_ads_credentials
      ADD CONSTRAINT google_ads_credentials_api_access_level_check
      CHECK (api_access_level = ANY (ARRAY['test'::text, 'explorer'::text, 'basic'::text, 'standard'::text]));
  END IF;
END $$;
