-- =====================================================================================
-- 补点击任务时区监控脚本
--
-- 用途：定期检查是否有时区与目标国家不匹配的任务
-- 建议：每天运行一次，或在创建新任务后运行
-- =====================================================================================

-- 1. 检查所有活跃任务的时区是否与Offer国家匹配
WITH timezone_check AS (
  SELECT
    cft.id,
    cft.offer_id,
    o.brand,
    o.offer_name,
    o.target_country,
    cft.timezone AS actual_timezone,
    CASE
      WHEN o.target_country = 'US' THEN 'America/New_York'
      WHEN o.target_country = 'CA' THEN 'America/Toronto'
      WHEN o.target_country = 'MX' THEN 'America/Mexico_City'
      WHEN o.target_country = 'GB' THEN 'Europe/London'
      WHEN o.target_country = 'DE' THEN 'Europe/Berlin'
      WHEN o.target_country = 'FR' THEN 'Europe/Paris'
      WHEN o.target_country = 'IT' THEN 'Europe/Rome'
      WHEN o.target_country = 'ES' THEN 'Europe/Madrid'
      WHEN o.target_country = 'NL' THEN 'Europe/Amsterdam'
      WHEN o.target_country = 'CH' THEN 'Europe/Zurich'
      WHEN o.target_country = 'CN' THEN 'Asia/Shanghai'
      WHEN o.target_country = 'JP' THEN 'Asia/Tokyo'
      WHEN o.target_country = 'KR' THEN 'Asia/Seoul'
      WHEN o.target_country = 'IN' THEN 'Asia/Kolkata'
      WHEN o.target_country = 'AU' THEN 'Australia/Sydney'
      WHEN o.target_country = 'NZ' THEN 'Pacific/Auckland'
      WHEN o.target_country = 'BR' THEN 'America/Sao_Paulo'
      WHEN o.target_country = 'AR' THEN 'America/Argentina/Buenos_Aires'
      ELSE 'America/New_York'  -- 默认美东时间
    END AS expected_timezone,
    cft.status,
    cft.created_at,
    cft.updated_at
  FROM click_farm_tasks cft
  JOIN offers o ON cft.offer_id = o.id
  WHERE cft.is_deleted = false
)
SELECT
  id AS task_id,
  offer_id,
  brand,
  offer_name,
  target_country,
  expected_timezone,
  actual_timezone,
  CASE
    WHEN actual_timezone = expected_timezone THEN '✅ 正确'
    ELSE '❌ 不匹配'
  END AS status_check,
  status AS task_status,
  created_at,
  updated_at
FROM timezone_check
ORDER BY
  CASE WHEN actual_timezone = expected_timezone THEN 1 ELSE 0 END,  -- 不匹配的排在前面
  created_at DESC;

-- 2. 统计报告
SELECT
  '=== 时区匹配度统计 ===' AS report_section;

WITH timezone_check AS (
  SELECT
    cft.id,
    o.target_country,
    cft.timezone AS actual_timezone,
    CASE
      WHEN o.target_country = 'US' THEN 'America/New_York'
      WHEN o.target_country = 'GB' THEN 'Europe/London'
      WHEN o.target_country = 'DE' THEN 'Europe/Berlin'
      WHEN o.target_country = 'FR' THEN 'Europe/Paris'
      WHEN o.target_country = 'CN' THEN 'Asia/Shanghai'
      WHEN o.target_country = 'JP' THEN 'Asia/Tokyo'
      ELSE 'America/New_York'
    END AS expected_timezone
  FROM click_farm_tasks cft
  JOIN offers o ON cft.offer_id = o.id
  WHERE cft.is_deleted = false
)
SELECT
  COUNT(*) AS total_tasks,
  SUM(CASE WHEN actual_timezone = expected_timezone THEN 1 ELSE 0 END) AS correct_tasks,
  SUM(CASE WHEN actual_timezone != expected_timezone THEN 1 ELSE 0 END) AS incorrect_tasks,
  ROUND(
    100.0 * SUM(CASE WHEN actual_timezone = expected_timezone THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
    2
  ) || '%' AS match_percentage
FROM timezone_check;

-- 3. 按国家分组的时区使用情况
SELECT
  '=== 各国时区使用情况 ===' AS report_section;

SELECT
  o.target_country,
  cft.timezone,
  COUNT(*) AS task_count,
  CASE
    WHEN o.target_country = 'US' AND cft.timezone = 'America/New_York' THEN '✅'
    WHEN o.target_country = 'GB' AND cft.timezone = 'Europe/London' THEN '✅'
    WHEN o.target_country = 'DE' AND cft.timezone = 'Europe/Berlin' THEN '✅'
    WHEN o.target_country = 'FR' AND cft.timezone = 'Europe/Paris' THEN '✅'
    WHEN o.target_country = 'CN' AND cft.timezone = 'Asia/Shanghai' THEN '✅'
    WHEN o.target_country = 'JP' AND cft.timezone = 'Asia/Tokyo' THEN '✅'
    ELSE '❌'
  END AS correctness
FROM click_farm_tasks cft
JOIN offers o ON cft.offer_id = o.id
WHERE cft.is_deleted = false
GROUP BY o.target_country, cft.timezone
ORDER BY o.target_country, task_count DESC;

-- =====================================================================================
-- 如果发现不匹配的任务，请运行 fix-timezone-mismatch.sql 脚本进行修复
-- =====================================================================================
