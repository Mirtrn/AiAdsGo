-- =====================================================================================
-- 修复补点击任务时区不匹配问题
--
-- 问题描述：
-- 生产环境中有多个补点击任务的 timezone 被错误设置为 'Europe/London'，
-- 与关联 Offer 的 target_country 不匹配
--
-- 影响范围：
-- - 任务执行时间不准确（例如美国任务按伦敦时间执行）
-- - 每小时点击分布错位
-- - 用户体验差
--
-- 修复策略：
-- 根据 Offer 的 target_country 自动设置正确的 timezone
-- =====================================================================================

-- Step 1: 备份当前错误数据（用于审计）
CREATE TEMP TABLE timezone_fix_backup AS
SELECT
  cft.id,
  cft.offer_id,
  cft.timezone AS old_timezone,
  o.target_country,
  CASE
    WHEN o.target_country = 'US' THEN 'America/New_York'
    WHEN o.target_country = 'GB' THEN 'Europe/London'
    WHEN o.target_country = 'DE' THEN 'Europe/Berlin'
    WHEN o.target_country = 'FR' THEN 'Europe/Paris'
    WHEN o.target_country = 'IT' THEN 'Europe/Rome'
    WHEN o.target_country = 'ES' THEN 'Europe/Madrid'
    WHEN o.target_country = 'CN' THEN 'Asia/Shanghai'
    WHEN o.target_country = 'JP' THEN 'Asia/Tokyo'
    WHEN o.target_country = 'KR' THEN 'Asia/Seoul'
    WHEN o.target_country = 'AU' THEN 'Australia/Sydney'
    ELSE 'America/New_York'  -- 默认美东时间
  END AS correct_timezone
FROM click_farm_tasks cft
JOIN offers o ON cft.offer_id = o.id
WHERE cft.is_deleted = false
  AND cft.timezone != CASE
    WHEN o.target_country = 'US' THEN 'America/New_York'
    WHEN o.target_country = 'GB' THEN 'Europe/London'
    WHEN o.target_country = 'DE' THEN 'Europe/Berlin'
    WHEN o.target_country = 'FR' THEN 'Europe/Paris'
    WHEN o.target_country = 'IT' THEN 'Europe/Rome'
    WHEN o.target_country = 'ES' THEN 'Europe/Madrid'
    WHEN o.target_country = 'CN' THEN 'Asia/Shanghai'
    WHEN o.target_country = 'JP' THEN 'Asia/Tokyo'
    WHEN o.target_country = 'KR' THEN 'Asia/Seoul'
    WHEN o.target_country = 'AU' THEN 'Australia/Sydney'
    ELSE 'America/New_York'
  END;

-- Step 2: 显示将要修复的任务
SELECT
  id,
  offer_id,
  target_country,
  old_timezone,
  correct_timezone,
  old_timezone || ' → ' || correct_timezone AS change
FROM timezone_fix_backup;

-- Step 3: 执行修复
UPDATE click_farm_tasks cft
SET
  timezone = (
    SELECT correct_timezone
    FROM timezone_fix_backup b
    WHERE b.id = cft.id
  ),
  updated_at = NOW()
WHERE cft.id IN (SELECT id FROM timezone_fix_backup);

-- Step 4: 验证修复结果
SELECT
  'Fixed' AS status,
  COUNT(*) AS task_count
FROM timezone_fix_backup;

-- Step 5: 显示修复后的任务状态
SELECT
  cft.id,
  cft.offer_id,
  o.brand,
  o.target_country,
  cft.timezone AS new_timezone,
  CASE
    WHEN cft.timezone = CASE
      WHEN o.target_country = 'US' THEN 'America/New_York'
      WHEN o.target_country = 'GB' THEN 'Europe/London'
      WHEN o.target_country = 'DE' THEN 'Europe/Berlin'
      WHEN o.target_country = 'FR' THEN 'Europe/Paris'
      WHEN o.target_country = 'IT' THEN 'Europe/Rome'
      WHEN o.target_country = 'ES' THEN 'Europe/Madrid'
      WHEN o.target_country = 'CN' THEN 'Asia/Shanghai'
      WHEN o.target_country = 'JP' THEN 'Asia/Tokyo'
      WHEN o.target_country = 'KR' THEN 'Asia/Seoul'
      WHEN o.target_country = 'AU' THEN 'Australia/Sydney'
      ELSE 'America/New_York'
    END THEN '✅ 正确'
    ELSE '❌ 仍不匹配'
  END AS verification
FROM click_farm_tasks cft
JOIN offers o ON cft.offer_id = o.id
WHERE cft.is_deleted = false
ORDER BY cft.created_at DESC;

-- =====================================================================================
-- 执行完成后，需要手动检查：
-- 1. 所有任务的 timezone 是否正确匹配其 Offer 的 target_country
-- 2. next_run_at 字段是否需要重新计算（根据新的 timezone）
--
-- 如果需要重新计算 next_run_at，请运行额外的脚本或重启相关任务
-- =====================================================================================
