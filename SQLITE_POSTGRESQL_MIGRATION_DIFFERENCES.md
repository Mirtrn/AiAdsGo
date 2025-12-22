# SQLite vs PostgreSQL 迁移文件差异说明

## 文件信息

- **SQLite版本**: `migrations/090_update_keyword_intent_clustering_v4.15.sql`
- **PostgreSQL版本**: `pg-migrations/090_update_keyword_intent_clustering_v4.15.pg.sql`
- **创建日期**: 2025-12-22

---

## 关键差异对比

### 1️⃣ 布尔值类型

| 场景 | SQLite | PostgreSQL | 说明 |
|------|--------|------------|------|
| 设置活跃状态 | `SET is_active = 1` | `SET is_active = TRUE` | PostgreSQL使用标准布尔值 |
| 检查活跃状态 | `WHERE is_active = 1` | `WHERE is_active = TRUE` | 条件判断不同 |
| 插入数据 | `is_active = 1` | `is_active = TRUE` | 插入值格式不同 |

**示例对比**：

```sql
-- SQLite版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = 1;

INSERT INTO prompt_versions (...) VALUES (
  ...
  is_active,
  change_notes
) VALUES (
  ...
  1,
  'v4.15 更新内容...'
);
```

```sql
-- PostgreSQL版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

INSERT INTO prompt_versions (...) VALUES (
  ...
  is_active,
  change_notes
) VALUES (
  ...
  TRUE,
  'v4.15 更新内容...'
);
```

### 2️⃣ JSON数据类型

| 场景 | SQLite | PostgreSQL | 说明 |
|------|--------|------------|------|
| 列定义 | `TEXT` | `JSONB` | PostgreSQL有专门的JSON类型 |
| 默认值 | `TEXT DEFAULT '[]'` | `JSONB DEFAULT '[]'::jsonb` | 类型转换不同 |
| 查询性能 | 较慢 | 优化后更快 | JSONB有索引支持 |

**示例对比**：

```sql
-- SQLite版本
ALTER TABLE offer_keyword_pools
ADD COLUMN bucket_d_keywords TEXT DEFAULT '[]';

-- PostgreSQL版本
ALTER TABLE offer_keyword_pools
ADD COLUMN bucket_d_keywords JSONB DEFAULT '[]'::jsonb;
```

### 3️⃣ 字符串转义

| 场景 | SQLite | PostgreSQL | 说明 |
|------|--------|------------|------|
| 单引号转义 | `''` | `''` | **相同**，都使用双单引号 |
| 双引号 | 支持 | 支持 | 标识符转义相同 |
| 美元符号 | 不支持 | `$$...$$` | PostgreSQL支持美元符号引用 |

**示例**：

```sql
-- 两者相同
UPDATE table SET description = 'It''s a test';
-- 结果: It's a test
```

### 4️⃣ 事务控制

| 场景 | SQLite | PostgreSQL | 说明 |
|------|--------|------------|------|
| 默认行为 | 自动提交 | 每个语句一个事务 | 隐式事务不同 |
| 显式事务 | `BEGIN; ... COMMIT;` | `BEGIN; ... COMMIT;` | 语法相同 |
| 嵌套事务 | 不支持 | 支持SAVEPOINT | PostgreSQL更强大 |

### 5️⃣ 函数和特性

| 功能 | SQLite | PostgreSQL | 说明 |
|------|--------|------------|------|
| 条件判断 | `IF EXISTS` | `IF EXISTS` | 语法相同 |
| 约束操作 | 部分支持 | 完全支持 | PostgreSQL更完整 |
| 序列 | `AUTOINCREMENT` | `SERIAL` | 自增字段不同 |

---

## 迁移执行命令对比

### SQLite

```bash
# 执行迁移
sqlite3 data/autoads.db < migrations/090_update_keyword_intent_clustering_v4.15.sql

# 验证迁移
sqlite3 data/autoads.db "SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id = 'keyword_intent_clustering';"
```

### PostgreSQL

```bash
# 执行迁移
psql -U username -d database -f pg-migrations/090_update_keyword_intent_clustering_v4.15.pg.sql

# 验证迁移
psql -U username -d database -c "SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id = 'keyword_intent_clustering';"
```

---

## 常见错误及解决方案

### 错误1: 布尔值不匹配

**错误信息**：
```sql
ERROR: column "is_active" is of type boolean but expression is of type integer
```

**解决方案**：
- SQLite使用`1/0`，PostgreSQL使用`TRUE/FALSE`
- 确保迁移文件中使用正确的布尔值格式

### 错误2: JSON类型错误

**错误信息**：
```sql
ERROR: invalid input syntax for type json
```

**解决方案**：
- PostgreSQL需要明确的类型转换：`'[]'::jsonb`
- 确保默认值格式正确

### 错误3: 约束操作不支持

**错误信息**：
```sql
ERROR: ALTER TABLE ADD COLUMN IF NOT EXISTS cannot be used on legacy tables
```

**解决方案**：
- PostgreSQL的旧版本可能不支持`IF NOT EXISTS`
- 检查PostgreSQL版本兼容性

---

## 最佳实践

### 1. 迁移文件命名规范

```
SQLite: migrations/{number}_{description}.sql
PostgreSQL: pg-migrations/{number}_{description}.pg.sql
```

### 2. 注释规范

每个迁移文件顶部包含：
```sql
-- Migration: {编号}_{描述}
-- Description: {详细描述}
-- Created: {日期}
-- Version: {版本变更}
-- Database: {SQLite|PostgreSQL}
-- Author: {作者}
```

### 3. 兼容性检查

迁移前检查：
- [ ] 布尔值使用正确格式
- [ ] JSON类型使用正确语法
- [ ] 字符串转义正确
- [ ] 约束操作兼容目标数据库

### 4. 测试验证

迁移后验证：
- [ ] 执行查询验证数据完整性
- [ ] 检查活跃版本是否正确设置
- [ ] 验证所有相关表结构正确

---

## 本次迁移的关键点

### D桶整合迁移 (090)

**SQLite版本特点**：
- 使用`1/0`表示布尔值
- JSON存储为`TEXT`类型
- 适用于轻量级应用

**PostgreSQL版本特点**：
- 使用`TRUE/FALSE`表示布尔值
- JSON存储为`JSONB`类型，支持索引和查询优化
- 适用于企业级应用

**共同点**：
- 相同的业务逻辑
- 相同的提示词内容
- 相同的迁移编号（090）

---

## 参考资源

- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [SQL Differences Guide](https://www.sqlines.com/sqlite/postgresql)

---

**维护者**: Claude Code
**更新日期**: 2025-12-22
**状态**: ✅ 完成
