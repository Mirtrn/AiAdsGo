# 数据库迁移脚本

## 目录结构

```
migrations/
├── README.md                    # 本文件
├── 000_init_schema.sql          # 初始化schema（34个核心表）
├── 001_add_user_management.sql  # 用户管理字段
├── 002_create_backup_logs.sql   # 备份日志表
...
```

## 迁移脚本命名规范

格式：`{编号}_{描述}.sql`

- **编号**：3位数字（000-999），按时间顺序递增
- **描述**：snake_case格式，简洁描述功能
- **000**：保留给初始化schema

## 已有迁移列表

### 核心Schema（000）
- `000_init_schema.pg.sql` - PostgreSQL初始化38个核心表

### 用户管理（001-004）
- `001_add_user_management_fields.sql` - 添加username、package等字段
- `002_create_backup_logs_table.sql` - 创建备份日志表
- `003_add_offer_pricing_fields.sql` - Offer价格和佣金字段
- `004_add_creative_versions_table.sql` - 创意版本管理表

### 优化功能（005-008）
- `005_create_optimization_recommendations_table.sql` - 优化建议表
- `006_create_optimization_tasks_table.sql` - 优化任务表
- `007_create_risk_alerts_tables.sql` - 风险预警表
- `008_add_performance_indexes.sql` - 性能索引优化

### Offer字段扩展（009-010）
- `009_add_offer_name_and_language.sql` - Offer名称和语言字段
- `010_add_pricing_fields.sql` - 产品价格字段（重复，可能需要合并）

### 数据分析（011-015）
- `011_create_creative_learning_patterns_table.sql` - 创意学习模式表
- `012_create_scraped_products_table.sql` - 产品抓取数据表
- `013_add_review_analysis_field.sql` - 评论分析字段
- `014_add_competitor_analysis_field.sql` - 竞品分析字段
- `015_add_visual_analysis_field.sql` - 视觉分析字段

### URL和创意（016-018）
- `016_add_offer_final_url_fields.sql` - Offer Final URL字段
- `017_add_creative_final_url_suffix.sql` - 创意URL后缀
- `018_create_ad_strength_history.sql` - 广告强度历史表

### API和评分（019-021）
- `019_create_google_ads_api_usage.sql` - Google Ads API使用统计
- `020_create_bonus_score_tables.sql` - 加分系统表
- `021_add_offers_industry_code.sql` - Offer行业分类

### Prompt和元素提取（022-023）
- `022_create_prompt_versions.sql` - Prompt版本管理表
- `023_add_extracted_ad_elements.sql` - 广告元素提取字段

## PostgreSQL特殊说明

PostgreSQL迁移脚本使用相同的编号体系，但文件名添加`.pg`后缀：
- `000_init_schema.pg.sql` - PostgreSQL初始化脚本
- `001_add_user_management.pg.sql` - PostgreSQL版本的用户管理迁移

## 使用方法

### SQLite数据库
```bash
# 初始化数据库
npm run db:init

# 运行所有迁移
npm run db:migrate

# 运行指定迁移
npm run db:migrate -- 001
```

### PostgreSQL数据库
```bash
# 设置环境变量
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# 初始化数据库
npm run db:init:pg

# 运行所有迁移
npm run db:migrate:pg

# 运行指定迁移
npm run db:migrate:pg -- 001
```

## 迁移状态追踪

迁移执行记录存储在 `migration_history` 表中：

```sql
CREATE TABLE migration_history (
  id SERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 注意事项

1. **不要修改已执行的迁移脚本** - 已执行的迁移应视为不可变
2. **新功能使用新迁移** - 不要在旧迁移中添加新功能
3. **测试后再部署** - 所有迁移脚本必须在本地测试通过
4. **保持幂等性** - 使用 `IF NOT EXISTS` 确保脚本可重复执行
5. **数据安全** - 删除表或列前必须备份数据
