# 全局共享数据表分类审查报告

**审查时间**: 2025-12-04
**数据库**: AutoAds SQLite

---

## 📊 分类统计

| 类别 | 数量 | 百分比 |
|-----|------|--------|
| 全局共享表 | 8 | 20% |
| 用户数据表 | 30 | 75% |
| **总计** | **38** | **95%** |

**注**: AB Test 相关表已下线，system_settings 重新分类为用户表

---

## 🌍 全局共享表（不需要用户隔离）

### 1. 系统核心表 (4个)
| 表名 | 说明 | 理由 |
|-----|------|------|
| `users` | 用户主表 | 用户数据本身，不需要隔离 |
| `migration_history` | 数据库迁移记录 | 系统级操作日志 |
| `backup_logs` | 备份日志 | 系统级操作日志 |
| `login_attempts` | 登录尝试记录 | 安全审计日志（跨用户） |

### 2. AI 提示模板表 (2个)
| 表名 | 说明 | 理由 |
|-----|------|------|
| `prompt_versions` | AI Prompt 模板 | 系统级模板（所有用户共享）|
| `prompt_usage_stats` | Prompt 使用统计 | 系统级聚合统计 |

### 3. 全局数据资源 (2个)
| 表名 | 说明 | 理由 |
|-----|------|------|
| `global_keywords` | 全局关键词数据库 | 公共资源（所有用户共享）|
| `industry_benchmarks` | 行业基准数据 | 公共资源（所有用户共享）|

---

## 👤 用户数据表（需要用户隔离）

### 1. 核心业务表 (5个)
| 表名 | user_id | 说明 |
|-----|---------|------|
| `offers` | ✅ NOT NULL | 用户 Offer |
| `ad_creatives` | ✅ NOT NULL | 广告创意 |
| `campaigns` | ✅ NOT NULL | 广告活动 |
| `ad_groups` | ✅ NOT NULL | 广告组 |
| `keywords` | ✅ NOT NULL | 关键词 |

### 2. 性能数据表 (5个)
| 表名 | user_id | 说明 |
|-----|---------|------|
| `ad_creative_performance` | ✅ | 创意性能数据 |
| `ad_performance` | ✅ | 广告性能数据 |
| `campaign_performance` | ✅ | 活动性能数据 |
| `creative_performance_scores` | ✅ | 创意评分 |
| `search_term_reports` | ✅ | 搜索词报告 |

### 3. 优化和分析表 (6个)
| 表名 | user_id | 说明 |
|-----|---------|------|
| `optimization_tasks` | ✅ NOT NULL | 优化任务 |
| `optimization_recommendations` | ✅ | 优化建议 |
| `weekly_recommendations` | ✅ | 每周建议 |
| `creative_learning_patterns` | ✅ NOT NULL | 创意学习模式 |
| `launch_scores` | ✅ NOT NULL | 投放评分 |
| `score_analysis_history` | ✅ | 评分分析历史 |

### 4. 辅助功能表 (7个)
| 表名 | user_id | 说明 |
|-----|---------|------|
| `creative_versions` | ✅ NOT NULL | 创意版本 |
| `scraped_products` | ✅ NOT NULL | 抓取的产品 |
| `conversion_feedback` | ✅ | 转化反馈 |
| `link_check_history` | ✅ | 链接检查历史 |
| `ad_strength_history` | ✅ NOT NULL | 广告强度历史 |
| `cpc_adjustment_history` | ✅ | CPC 调整历史 |
| `sync_logs` | ✅ | 同步日志 |

### 5. Google Ads 集成表 (3个)
| 表名 | user_id | 说明 |
|-----|---------|------|
| `google_ads_accounts` | ✅ | Google Ads 账号 |
| `google_ads_credentials` | ✅ | Google Ads 凭证 |
| `google_ads_api_usage` | ✅ NOT NULL | API 使用记录 |

### 6. 资源管理表 (2个)
| 表名 | user_id | 说明 |
|-----|---------|------|
| `ai_token_usage` | ✅ NOT NULL | AI Token 使用 |
| `rate_limits` | ✅ NOT NULL | API 限流记录 |

### 7. 配置管理表 (1个) - **重新分类**
| 表名 | user_id | 说明 |
|-----|---------|------|
| `system_settings` | ✅ (nullable) | 用户配置和系统配置（混合表）|

**system_settings 说明**:
- 虽然命名为 "system_settings"，但本质是用户数据表
- `user_id IS NULL` 的记录表示全局系统配置
- `user_id = ?` 的记录表示用户特定配置
- 代码中通过 `WHERE user_id IS NULL OR user_id = ?` 实现配置继承
- **归类原则**: 有 user_id 字段且存储用户数据的表都归为用户表

### 8. 临时/备份表 (1个)
| 表名 | user_id | 说明 |
|-----|---------|------|
| `scraped_products_new` | ✅ | 产品抓取临时表 |

---

## ✅ 分类修正已完成

### system_settings 重新分类

**原分类**: 全局共享表（混合表）
**新分类**: 用户数据表（配置管理表）

**修正理由**:
1. 表有 `user_id` 字段，支持用户级配置
2. 虽然部分记录 `user_id IS NULL`（全局配置），但本质是用户数据表
3. 命名虽为 "system_settings"，但功能是存储用户和系统配置
4. **归类原则**: 有 user_id 字段且存储用户数据的表都归为用户表

**实际使用模式**:
```sql
-- 查询全局配置
SELECT * FROM system_settings WHERE user_id IS NULL

-- 查询用户配置（带继承）
SELECT * FROM system_settings
WHERE category = ? AND config_key = ?
AND (user_id IS NULL OR user_id = ?)
ORDER BY user_id DESC LIMIT 1
```

---

## 🎯 最终分类清单

### 全局共享表（8个）
```
users
migration_history
backup_logs
login_attempts
prompt_versions
prompt_usage_stats
global_keywords
industry_benchmarks
```

### 用户数据表（30个）
```
# 核心业务 (5)
offers, ad_creatives, campaigns, ad_groups, keywords

# 性能数据 (5)
ad_creative_performance, ad_performance, campaign_performance,
creative_performance_scores, search_term_reports

# 优化分析 (6)
optimization_tasks, optimization_recommendations, weekly_recommendations,
creative_learning_patterns, launch_scores, score_analysis_history

# 辅助功能 (7)
creative_versions, scraped_products, conversion_feedback,
link_check_history, ad_strength_history, cpc_adjustment_history, sync_logs

# Google Ads (3)
google_ads_accounts, google_ads_credentials, google_ads_api_usage

# 资源管理 (2)
ai_token_usage, rate_limits

# 配置管理 (1)
system_settings

# 临时表 (1)
scraped_products_new
```

---

## ✅ 下一步行动

所有分类修正已完成，无需进一步操作。

---

**报告生成时间**: 2025-12-04
**最后修正时间**: 2025-12-04
**建议复审周期**: 每季度一次
