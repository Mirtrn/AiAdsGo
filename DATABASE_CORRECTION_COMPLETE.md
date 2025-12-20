# 数据库矫正完成报告

## 问题概述

**错误信息**：
```
PostgresError: duplicate key value violates unique constraint "idx_system_settings_category_key_unique"
Detail: Key (category, key)=(proxy, urls) already exists.
```

**根本原因**：
1. 084迁移错误地删除了全局模板（`value = NULL` 的记录）
2. 唯一性约束只覆盖用户配置（`value IS NOT NULL`），未覆盖全局模板
3. 导致允许多个全局模板存在，破坏双层架构

## 修复过程

### 步骤1：清理有问题的084迁移文件
- ❌ 删除：`084_add_system_settings_unique_constraint.sql`（原版，有缺陷）
- ❌ 删除：`084_add_system_settings_unique_constraint.pg.sql`（原版，有缺陷）
- ✅ 保留：`084_add_system_settings_unique_constraint_FIXED.sql`（修复版）
- ✅ 保留：`084_add_system_settings_unique_constraint_FIXED.pg.sql`（修复版）

### 步骤2：重命名修复版084为正式版本
```bash
mv 084_add_system_settings_unique_constraint_FIXED.sql \
   084_add_system_settings_unique_constraint.sql
mv 084_add_system_settings_unique_constraint_FIXED.pg.sql \
   084_add_system_settings_unique_constraint.pg.sql
```

### 步骤3：执行085迁移（插入全局模板）
- ✅ SQLite：`085_add_missing_proxy_urls_template.sql`
- ✅ PostgreSQL：`085_add_missing_proxy_urls_template.pg.sql`
- 幂等性：✅ 验证通过（INSERT 0，已存在则不插入）

### 步骤4：执行086迁移（修复唯一性约束）
- ✅ SQLite：`086_fix_system_settings_unique_constraint.sql`
- ✅ PostgreSQL：`086_fix_system_settings_unique_constraint.pg.sql`

**086迁移功能**：
1. 删除重复的全局模板
2. 创建用户配置唯一性约束：`idx_system_settings_user_config_unique`
3. 创建全局模板唯一性约束：`idx_system_settings_global_template_unique`

## 修复结果验证

### 本地SQLite数据库
```sql
user_id | category | key  | status
--------|----------|------|--------
NULL    | proxy    | urls | NULL         <- 唯一全局模板
1       | proxy    | urls | HAS_VALUE    <- 用户配置
```

### 生产环境PostgreSQL数据库
```sql
user_id | category | key  | status
--------|----------|------|--------
NULL    | proxy    | urls | NULL         <- 唯一全局模板
7       | proxy    | urls | HAS_VALUE    <- 用户配置
```

### PostgreSQL迁移历史
```
084_add_system_settings_unique_constraint.pg.sql       | 2025-12-20 04:13:53
085_add_missing_proxy_urls_template.pg.sql             | 2025-12-20 04:57:31
086_fix_system_settings_unique_constraint.pg.sql       | 2025-12-20 05:38:29
```

### 约束验证
- ✅ 尝试插入重复全局模板：SQLite正确拒绝（UNIQUE constraint failed）
- ✅ 尝试插入重复全局模板：PostgreSQL正确拒绝（duplicate key value violates unique constraint）
- ✅ 用户更新配置操作：成功执行，无冲突

## 幂等性验证

### 084迁移幂等性
- SQLite：DELETE 0（无重复记录）
- PostgreSQL：DELETE 0（无重复记录）
- ✅ 幂等

### 085迁移幂等性
- SQLite：INSERT OR IGNORE（已存在则忽略）
- PostgreSQL：WHERE NOT EXISTS（已存在则不插入）
- ✅ 幂等

### 086迁移幂等性
- SQLite：已删除重复记录，不会重复删除
- PostgreSQL：DELETE 0（无重复记录）
- ✅ 幂等

## 当前迁移文件结构

```
migrations/
├── 084_add_system_settings_unique_constraint.sql      ✅ 修复版（保留全局模板）
├── 085_add_missing_proxy_urls_template.sql            ✅ 幂等插入全局模板
└── 086_fix_system_settings_unique_constraint.sql      ✅ 修复唯一性约束

pg-migrations/
├── 084_add_system_settings_unique_constraint.pg.sql   ✅ 修复版（保留全局模板）
├── 085_add_missing_proxy_urls_template.pg.sql         ✅ 幂等插入全局模板
└── 086_fix_system_settings_unique_constraint.pg.sql   ✅ 修复唯一性约束
```

## 核心架构原则

### system_settings表双层架构

| 层级 | user_id | value | 用途 | 唯一性约束 |
|------|---------|-------|------|------------|
| 全局模板 | NULL | NULL | 定义配置项元数据 | `idx_system_settings_global_template_unique` |
| 用户配置 | 用户ID | JSON | 存储实际配置值 | `idx_system_settings_user_config_unique` |

### 唯一性约束设计

**用户配置约束**：
```sql
CREATE UNIQUE INDEX idx_system_settings_user_config_unique
  ON system_settings(category, key, user_id)
  WHERE user_id IS NOT NULL AND value IS NOT NULL AND value <> '';
```

**全局模板约束**：
```sql
CREATE UNIQUE INDEX idx_system_settings_global_template_unique
  ON system_settings(category, key)
  WHERE user_id IS NULL AND value IS NULL;
```

## 预防措施

### 1. 更新的第31条基本原则
```
添加system_settings配置项时，必须插入全局模板记录（user_id IS NULL）用于定义元数据，
同时创建用户配置记录（user_id = 用户ID）存储实际值；创建迁移文件时注意SQLite使用
INSERT OR IGNORE和0/1布尔值，PostgreSQL使用WHERE NOT EXISTS和false/true布尔值，需同时
创建.sql和.pg.sql两个版本；严禁在迁移中删除value为NULL的记录（包括全局模板），唯一性
约束idx_system_settings_category_key_unique只应对value不为NULL的记录生效，全局模板
（value=NULL）和用户配置（value=JSON）必须能共存
```

### 2. 迁移文件检查清单
- [ ] 不会删除 `user_id IS NULL` 的全局模板记录
- [ ] 不会删除 `value IS NULL` 的记录
- [ ] 为全局模板和用户配置分别创建唯一性约束
- [ ] 同时创建SQLite和PostgreSQL版本
- [ ] 注意布尔值差异（SQLite: 0/1, PostgreSQL: false/true）
- [ ] 确保迁移文件可以幂等执行

## 总结

✅ **问题完全解决**：
- 修复了唯一性约束冲突
- 确保全局模板和用户配置的区分
- 所有迁移文件可幂等执行
- 重复插入被正确拒绝

✅ **数据库状态**：
- 本地SQLite：正常
- 生产环境PostgreSQL：正常

✅ **核心原则**：
- 全局模板：定义元数据，唯一
- 用户配置：存储实际值，唯一
- 严禁删除value=NULL的记录

🎉 **数据库矫正完成！**
