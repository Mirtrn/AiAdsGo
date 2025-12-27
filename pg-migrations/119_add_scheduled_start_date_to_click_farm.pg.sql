-- Migration: 119_add_scheduled_start_date_to_click_farm
-- Description: 添加scheduled_start_date字段支持未来日期开始任务
-- PostgreSQL版本
-- Author: Claude
-- Date: 2024-12-28

-- 添加scheduled_start_date字段（DATE类型，默认当天）
ALTER TABLE click_farm_tasks ADD COLUMN scheduled_start_date DATE DEFAULT CURRENT_DATE;

-- 🔥 为已存在的任务设置scheduled_start_date为created_at的日期
UPDATE click_farm_tasks
SET scheduled_start_date = DATE(created_at)
WHERE scheduled_start_date IS NULL;

-- 创建索引优化Cron调度器查询
CREATE INDEX IF NOT EXISTS idx_click_farm_tasks_scheduled_start
ON click_farm_tasks(scheduled_start_date, status);
