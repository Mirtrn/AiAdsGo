-- 修正历史遗留数据：将 mcc_customer_id 中的横杠和空格去除，统一为纯10位数字
-- 背景：旧版 POST /api/google-ads/service-account 直接把前端输入值（可能包含 "-" 或空格）写入数据库，
--       新版代码查询时使用 cleanMccId（纯数字），导致历史记录永远无法被 MCC 路由匹配。
-- 此迁移将一次性清洗所有带横杠/空格的 mcc_customer_id，不影响已经是纯数字的记录。

UPDATE google_ads_service_accounts
SET mcc_customer_id = REPLACE(REPLACE(mcc_customer_id, '-', ''), ' ', ''),
    updated_at = NOW()
WHERE mcc_customer_id LIKE '%-%'
   OR mcc_customer_id LIKE '% %';
