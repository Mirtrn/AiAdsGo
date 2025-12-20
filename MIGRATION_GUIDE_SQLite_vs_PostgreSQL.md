# SQLite vs PostgreSQL 迁移文件差异指南

## 概述
本项目使用**双迁移系统**：
- SQLite: `/migrations/*.sql`
- PostgreSQL: `/pg-migrations/*.pg.sql`

## 🔑 关键差异对比

### 1. 插入不存在记录

#### SQLite
```sql
INSERT OR IGNORE INTO table_name (...)
VALUES (...);
```

#### PostgreSQL
```sql
INSERT INTO table_name (...)
SELECT ...
WHERE NOT EXISTS (
  SELECT 1 FROM table_name WHERE ...
);
```

### 2. 布尔类型

#### SQLite
- 使用 `0` (false) 和 `1` (true)
- 数字类型存储

```sql
is_sensitive: 0
is_required: 1
```

#### PostgreSQL
- 使用 `false` 和 `true`
- 真正的布尔类型

```sql
is_sensitive: false
is_required: true
```

### 3. 删除重复记录

#### SQLite
```sql
DELETE FROM table_name
WHERE EXISTS (
  SELECT 1 FROM table_name s2
  WHERE s2.category = table_name.category
    AND s2.key = table_name.key
    AND s2.updated_at > table_name.updated_at
);
```

#### PostgreSQL
```sql
DELETE FROM table_name s1
WHERE EXISTS (
  SELECT 1 FROM table_name s2
  WHERE s2.category = s1.category
    AND s2.key = s1.key
    AND s2.updated_at > s1.updated_at
);
```

**差异**: PostgreSQL支持表别名，SQLite在DELETE语句中不支持别名。

### 4. 创建索引

#### SQLite & PostgreSQL
两者语法基本相同：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_name_column
  ON table_name(column)
  WHERE condition;
```

### 5. NULL处理

#### SQLite
- `NULL` 表示空值
- 可以使用 `IS NULL` 和 `IS NOT NULL`

#### PostgreSQL
- `NULL` 表示空值
- 额外支持 `<>` 操作符区分NULL
- 更好的NULL处理语义

### 6. 字符串比较

#### SQLite
```sql
WHERE value <> ''
```
- 空字符串和NULL需要分别处理

#### PostgreSQL
```sql
WHERE value <> ''
```
- 同样需要分别处理空字符串和NULL

## 📝 创建迁移文件的最佳实践

### 1. 文件命名
- SQLite: `XXX_description.sql`
- PostgreSQL: `XXX_description.pg.sql`

### 2. 注释规范
```sql
-- Migration: [简短描述]
-- Purpose: [详细说明]
-- Date: [YYYY-MM-DD]
```

### 3. 验证查询
在迁移文件末尾添加验证查询（注释形式）：

```sql
-- Verification query (commented out for production)
-- SELECT ... FROM table_name WHERE ...;
```

### 4. 数据类型映射

| 类型 | SQLite | PostgreSQL |
|------|--------|------------|
| 布尔 | `0/1` (integer) | `false/true` (boolean) |
| 字符串 | `TEXT` | `TEXT` |
| 数字 | `INTEGER/NUMERIC` | `INTEGER/NUMERIC` |
| JSON | `TEXT` (存储JSON字符串) | `JSONB` (可选) |

### 5. 常见陷阱

#### A. 布尔值类型错误
❌ 错误：
```sql
-- PostgreSQL中使用0/1
INSERT INTO settings (is_required) VALUES (0);
```

✅ 正确：
```sql
-- PostgreSQL中使用false/true
INSERT INTO settings (is_required) VALUES (false);
```

#### B. INSERT OR IGNORE语法错误
❌ 错误：
```sql
-- PostgreSQL中不存在INSERT OR IGNORE
INSERT OR IGNORE INTO settings (...) VALUES (...);
```

✅ 正确：
```sql
-- PostgreSQL中使用WHERE NOT EXISTS
INSERT INTO settings (...)
SELECT ...
WHERE NOT EXISTS (...);
```

#### C. 删除语句别名
❌ 错误：
```sql
-- SQLite中DELETE不支持别名
DELETE FROM table_name t1
WHERE EXISTS (...);
```

✅ 正确：
```sql
-- SQLite中使用表名而非别名
DELETE FROM table_name
WHERE EXISTS (
  SELECT 1 FROM table_name s2
  WHERE ...
);
```

## 🔍 示例：完整迁移文件

### SQLite版本 (`085_add_missing_proxy_urls_template.sql`)
```sql
-- Migration: Add missing proxy.urls global template (SQLite)
-- Purpose: Insert the missing global template record for proxy.urls configuration
-- Date: 2025-12-20

INSERT OR IGNORE INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  description
) VALUES (
  NULL,
  'proxy',
  'urls',
  NULL,
  'json',
  0,
  0,
  '代理URL配置，JSON格式存储国家与代理URL的映射'
);
```

### PostgreSQL版本 (`085_add_missing_proxy_urls_template.pg.sql`)
```sql
-- Migration: Add missing proxy.urls global template (PostgreSQL)
-- Purpose: Insert the missing global template record for proxy.urls configuration
-- Date: 2025-12-20

INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  description
)
SELECT
  NULL,
  'proxy',
  'urls',
  NULL,
  'json',
  false,
  false,
  '代理URL配置，JSON格式存储国家与代理URL的映射'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'proxy'
    AND key = 'urls'
    AND user_id IS NULL
);
```

## ✅ 迁移前检查清单

- [ ] 创建了SQLite版本的迁移文件（`.sql`）
- [ ] 创建了PostgreSQL版本的迁移文件（`.pg.sql`）
- [ ] SQLite使用 `INSERT OR IGNORE`，PostgreSQL使用 `WHERE NOT EXISTS`
- [ ] SQLite布尔值使用 `0/1`，PostgreSQL使用 `false/true`
- [ ] SQLite的DELETE语句不使用表别名
- [ ] 两个文件的逻辑完全一致
- [ ] 添加了注释说明迁移目的
- [ ] 包含验证查询（注释形式）

## 🚀 执行迁移

### SQLite
```bash
sqlite3 /path/to/database.db < migrations/XXX_description.sql
```

### PostgreSQL
```bash
psql -U username -d database -f pg-migrations/XXX_description.pg.sql
```

## 📚 参考资料

- [SQLite INSERT OR IGNORE文档](https://www.sqlite.org/lang_insert.html)
- [PostgreSQL INSERT...SELECT文档](https://www.postgresql.org/docs/current/sql-insert.html)
- [PostgreSQL布尔类型](https://www.postgresql.org/docs/current/datatype-boolean.html)
