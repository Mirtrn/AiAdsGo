-- Migration: 036_add_status_balance_to_google_ads_accounts
-- Description: 添加status和account_balance列到google_ads_accounts表
-- Created: 2025-12-03
-- Reason: 代码需要存储Google Ads API返回的账户状态和余额信息

-- 添加status列（账户状态：ENABLED, SUSPENDED, CANCELLED等）
ALTER TABLE google_ads_accounts ADD COLUMN status TEXT DEFAULT 'UNKNOWN';

-- 添加account_balance列（账户余额，单位为微单位，需要除以1000000）
ALTER TABLE google_ads_accounts ADD COLUMN account_balance REAL DEFAULT NULL;

-- 验证列已添加
SELECT
  name,
  type,
  dflt_value
FROM pragma_table_info('google_ads_accounts')
WHERE name IN ('status', 'account_balance');
