# PostgreSQL唯一性约束冲突 - 完整修复报告

## 问题概述

**错误类型**：PostgreSQL唯一性约束冲突
**错误信息**：
```
PostgresError: duplicate key value violates unique constraint "idx_system_settings_category_key_unique"
Detail: Key (category, key)=(proxy, urls) already exists.
```

**影响**：用户无法更新 `proxy.urls` 配置项

## 根本原因分析

### 084迁移文件的致命错误

原084迁移文件 `084_add_system_settings_unique_constraint.sql` 中的清理逻辑：

```sql
-- ❌ 致命错误：删除所有value为NULL的记录
DELETE FROM system_settings
WHERE value IS NULL OR value = '';
```

**后果**：
- 所有全局模板记录（`user_id IS NULL, value = NULL`）被删除
- 破坏了 `system_settings` 表的"模板+实例"双层架构
- 唯一性约束无法正确工作

### system_settings表的双层架构

| 层级 | user_id | value | 用途 |
|------|---------|-------|------|
| 全局模板 | NULL | NULL | 定义配置项元数据（类型、描述、是否敏感等） |
| 用户配置 | 用户ID | JSON | 存储用户的实际配置值 |

### 唯一性约束设计

```sql
CREATE UNIQUE INDEX idx_system_settings_category_key_unique
  ON system_settings(category, key)
  WHERE value IS NOT NULL AND value <> '';
```

**约束逻辑**：
- 只对 `value` 不为NULL且不为空的记录生效
- 全局模板（`value = NULL`）不在索引中
- 用户配置（`value = JSON`）在索引中
- **应该允许全局模板和用户配置共存**

## 修复方案

### 方案1：重新执行迁移（开发环境）

#### 步骤1：执行修复版084迁移
```bash
# SQLite
sqlite3 /path/to/database.db < migrations/084_add_system_settings_unique_constraint_FIXED.sql

# PostgreSQL
psql -U username -d database -f pg-migrations/084_add_system_settings_unique_constraint_FIXED.pg.sql
```

#### 步骤2：执行085迁移
```bash
# SQLite
sqlite3 /path/to/database.db < migrations/085_add_missing_proxy_urls_template.sql

# PostgreSQL
psql -U username -d database -f pg-migrations/085_add_missing_proxy_urls_template.pg.sql
```

### 方案2：生产环境紧急修复（推荐）

直接执行紧急修复脚本：

```bash
psql -U username -d database -f scripts/fix-postgres-unique-constraint.sql
```

该脚本会：
1. 检查当前数据状态
2. 恢复缺失的全局模板
3. 清理重复记录
4. 验证修复结果

## 修复版084迁移的关键改进

### SQLite版本
```sql
-- ✅ 保留全局模板，只清理用户配置
DELETE FROM system_settings
WHERE id IN (
  SELECT s1.id
  FROM system_settings s1
  JOIN system_settings s2
    ON s1.category = s2.category
    AND s1.key = s2.key
    AND s1.user_id IS NOT NULL  -- 只删除用户配置
    AND s2.user_id IS NOT NULL  -- 只删除用户配置
    AND s1.value IS NOT NULL
    AND s1.value <> ''
    AND s2.value IS NOT NULL
    AND s2.value <> ''
    AND s1.updated_at < s2.updated_at  -- 保留最新记录
);

-- 删除空的用户配置（但不删除全局模板）
DELETE FROM system_settings
WHERE user_id IS NOT NULL  -- 只删除用户配置
  AND (value IS NULL OR value = '');
```

### PostgreSQL版本
```sql
-- ✅ 保留全局模板，只清理用户配置
DELETE FROM system_settings s1
WHERE s1.user_id IS NOT NULL  -- 只删除用户配置
  AND s1.value IS NOT NULL
  AND s1.value <> ''
  AND EXISTS (
    SELECT 1 FROM system_settings s2
    WHERE s2.category = s1.category
      AND s2.key = s1.key
      AND s2.user_id IS NOT NULL  -- 只比较用户配置
      AND s2.value IS NOT NULL
      AND s2.value <> ''
      AND s2.updated_at > s1.updated_at  -- 保留最新记录
      AND s2.id != s1.id
  );

-- 删除空的用户配置（但不删除全局模板）
DELETE FROM system_settings
WHERE user_id IS NOT NULL  -- 只删除用户配置
  AND (value IS NULL OR value = '');
```

## 创建的修复文件

1. **修复版迁移文件**：
   - `migrations/084_add_system_settings_unique_constraint_FIXED.sql`
   - `pg-migrations/084_add_system_settings_unique_constraint_FIXED.pg.sql`

2. **紧急修复脚本**：
   - `scripts/fix-postgres-unique-constraint.sql`

3. **详细文档**：
   - `PG_UNIQUE_CONSTRAINT_FIX.md` - 完整的问题分析和修复方案

4. **基本原则更新**：
   - `docs/BasicPrinciples/MustKnowV1.md` 第31条已更新

## 预防措施

### 1. 更新第31条基本原则
已更新 `docs/BasicPrinciples/MustKnowV1.md` 第31条：

> 添加system_settings配置项时，必须插入全局模板记录（user_id IS NULL）用于定义元数据，同时创建用户配置记录（user_id = 用户ID）存储实际值；创建迁移文件时注意SQLite使用INSERT OR IGNORE和0/1布尔值，PostgreSQL使用WHERE NOT EXISTS和false/true布尔值，需同时创建.sql和.pg.sql两个版本；**严禁在迁移中删除value为NULL的记录（包括全局模板），唯一性约束idx_system_settings_category_key_unique只应对value不为NULL的记录生效，全局模板（value=NULL）和用户配置（value=JSON）必须能共存**

### 2. 迁移文件检查清单

创建迁移文件时必须验证：
- [ ] 不会删除 `user_id IS NULL` 的全局模板记录
- [ ] 不会删除 `value IS NULL` 的记录
- [ ] 唯一性约束只对 `value IS NOT NULL AND value <> ''` 的记录生效
- [ ] 同时创建SQLite和PostgreSQL版本
- [ ] 注意布尔值差异（SQLite: 0/1, PostgreSQL: false/true）

### 3. 数据库完整性检查

在迁移后执行验证查询：

```sql
-- 检查全局模板存在
SELECT COUNT(*) as global_template_count
FROM system_settings
WHERE user_id IS NULL;

-- 检查无重复记录
SELECT category, key, COUNT(*) as count
FROM system_settings
WHERE value IS NOT NULL AND value <> ''
GROUP BY category, key
HAVING COUNT(*) > 1;

-- 预期结果：无重复记录
```

## 核心教训

### system_settings表的架构原则

1. **全局模板是基础**：
   - 定义所有可用配置项的元数据
   - 永远不能被删除或修改
   - `user_id = NULL, value = NULL`

2. **用户配置是实例**：
   - 存储用户的实际配置值
   - 可以有多个用户的配置
   - `user_id = 用户ID, value = JSON`

3. **唯一性约束的边界**：
   - 只约束有实际值的记录
   - 允许全局模板和用户配置共存
   - `WHERE value IS NOT NULL AND value <> ''`

### 迁移逻辑的正确写法

```sql
-- ✅ 正确：只删除用户配置的重复记录
DELETE FROM system_settings
WHERE user_id IS NOT NULL  -- 只操作用户配置
  AND (value IS NULL OR value = '');  -- 删除空配置

-- ❌ 错误：删除所有value为NULL的记录
DELETE FROM system_settings
WHERE value IS NULL OR value = '';
```

## 验证修复效果

### 修复后数据库状态

```sql
SELECT user_id, category, key,
       CASE WHEN value IS NULL THEN 'NULL' ELSE 'HAS_VALUE' END as value_status
FROM system_settings
WHERE category = 'proxy' AND key = 'urls'
ORDER BY user_id;

-- 预期结果：
-- user_id | category | key  | value_status
-- --------|----------|------|-------------
-- NULL    | proxy    | urls | NULL         <- 全局模板
-- 1       | proxy    | urls | HAS_VALUE    <- 用户配置
```

### 测试步骤

1. **前端测试**：
   - 访问设置页面
   - 修改代理URL配置
   - 保存成功

2. **API测试**：
   ```bash
   curl -X GET http://localhost:3000/api/settings/proxy/urls \
        -H "x-user-id: 1"
   ```

3. **数据库测试**：
   ```sql
   -- 验证全局模板存在
   SELECT * FROM system_settings
   WHERE category = 'proxy' AND key = 'urls' AND user_id IS NULL;

   -- 验证用户配置存在
   SELECT * FROM system_settings
   WHERE category = 'proxy' AND key = 'urls' AND user_id = 1;
   ```

## 总结

本次修复解决了PostgreSQL中因084迁移文件的缺陷导致的唯一性约束冲突问题。问题的根源是迁移逻辑错误地删除了全局模板记录，破坏了system_settings表的双层架构。

通过创建修复版084迁移和紧急修复脚本，以及更新基本原则文档，确保类似问题不再发生。

**关键原则**：全局模板是系统配置的基础，永远不能被删除；唯一性约束只应该应用于有实际值的用户配置记录。
