# 数据库迁移指南：SQLite vs PostgreSQL

## 概述

本项目同时支持SQLite（开发环境）和PostgreSQL（生产环境）两种数据库。本文档详细说明了两种数据库在迁移文件编写时的关键差异和最佳实践。

## 目录结构

```
autobb/
├── migrations/              # SQLite迁移文件
│   └── 076_*.sql
└── pg-migrations/           # PostgreSQL迁移文件
    └── 076_*.pg.sql
```

## 核心差异对比

### 1. 布尔值类型

| 特性 | SQLite | PostgreSQL |
|------|--------|------------|
| 数据类型 | `INTEGER` (0/1) | `BOOLEAN` (TRUE/FALSE) |
| UPDATE语句 | `SET is_active = 0` | `SET is_active = FALSE` |
| WHERE条件 | `WHERE is_active = 1` | `WHERE is_active = TRUE` |
| INSERT VALUES | `VALUES (..., 1, ...)` | `VALUES (..., TRUE, ...)` |

**示例**：

```sql
-- SQLite
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'test' AND is_active = 1;

INSERT INTO prompt_versions (..., is_active, ...)
VALUES (..., 1, ...);

-- PostgreSQL
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'test' AND is_active = TRUE;

INSERT INTO prompt_versions (..., is_active, ...)
VALUES (..., TRUE, ...);
```

### 2. 冲突处理机制

| 特性 | SQLite | PostgreSQL |
|------|--------|------------|
| 重复键处理 | 直接报错 | `ON CONFLICT` 优雅处理 |
| 幂等性保证 | 需手动实现 | `DO NOTHING` 自动保证 |
| 语法支持 | 基础 `INSERT` | `INSERT ... ON CONFLICT` |

**推荐策略**：

```sql
-- SQLite：简单策略（假设不会重复执行）
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'test' AND is_active = 1;

INSERT INTO prompt_versions (prompt_id, version, ...)
VALUES ('test', 'v1.0', ...);

-- PostgreSQL：幂等策略（支持重复执行）
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'test' AND is_active = TRUE;

INSERT INTO prompt_versions (prompt_id, version, ...)
VALUES ('test', 'v1.0', ...)
ON CONFLICT (prompt_id, version) DO NOTHING;
```

### 3. 数据类型差异

| 类型 | SQLite | PostgreSQL |
|------|--------|------------|
| 自增主键 | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| 文本字段 | `TEXT` | `TEXT` 或 `VARCHAR(n)` |
| 日期时间 | `TEXT` (ISO8601格式) | `TIMESTAMP` 或 `TEXT` |
| JSON | `TEXT` | `JSON` 或 `JSONB` |

## 迁移文件编写规范

### 文件命名

```
{序号}_{描述}.sql           # SQLite
{序号}_{描述}.pg.sql        # PostgreSQL
```

示例：
- `076_update_all_prompts_v4.14.sql` (SQLite)
- `076_update_all_prompts_v4.14.pg.sql` (PostgreSQL)

### 文件头部注释

```sql
-- Migration: 076_update_all_prompts_v4.14
-- Description: 批量更新所有Prompt到 v4.14 版本
-- Created: 2025-12-17
-- Version: v4.13 → v4.14
-- Prompts: 12 个
-- Database: SQLite / PostgreSQL  -- 标注数据库类型
```

### 迁移策略对比

#### SQLite策略（简单直接）

```sql
-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  ...
) VALUES (
  'ad_creative_generation',
  'v4.14',
  '广告创意生成',
  ...
);
```

**优点**：
- 简单直观
- 代码量少

**缺点**：
- 不支持重复执行
- 如果记录已存在会报错

#### PostgreSQL策略（健壮幂等）

```sql
-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2. 插入新版本（幂等处理）
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  ...
) VALUES (
  'ad_creative_generation',
  'v4.14',
  '广告创意生成',
  ...
)
ON CONFLICT (prompt_id, version) DO NOTHING;
```

**优点**：
- 支持重复执行
- 幂等性保证
- 生产环境更安全

**缺点**：
- 语法稍复杂
- 需要理解ON CONFLICT机制

## 常见错误及解决方案

### 错误1：布尔值类型不匹配

**错误信息**：
```
operator does not exist: integer = boolean
```

**原因**：
在PostgreSQL中使用了SQLite的整数布尔值（0/1）

**解决方案**：
```sql
-- ❌ 错误
WHERE is_active = 1

-- ✅ 正确
WHERE is_active = TRUE
```

### 错误2：重复键冲突

**错误信息**：
```
duplicate key value violates unique constraint "prompt_versions_pkey"
```

**原因**：
尝试插入已存在的记录，没有使用ON CONFLICT处理

**解决方案**：
```sql
-- ❌ 错误（会在重复执行时失败）
INSERT INTO prompt_versions (...) VALUES (...);

-- ✅ 正确（支持重复执行）
INSERT INTO prompt_versions (...) VALUES (...)
ON CONFLICT (prompt_id, version) DO NOTHING;
```

### 错误3：字段不存在

**错误信息**：
```
column "updated_at" does not exist
```

**原因**：
在ON CONFLICT的UPDATE子句中引用了表中不存在的字段

**解决方案**：
```sql
-- 检查表结构
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'prompt_versions';

-- 只更新存在的字段
ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  -- 不要引用不存在的字段
  -- updated_at = CURRENT_TIMESTAMP  -- ❌ 如果字段不存在
```

## SQLite转PostgreSQL自动化脚本

### 基础转换脚本

```bash
#!/bin/bash
# convert_migration.sh

INPUT_FILE=$1
OUTPUT_FILE=$2

sed '
# 转换布尔值 (UPDATE/WHERE语句)
s/SET is_active = 0/SET is_active = FALSE/g
s/SET is_active = 1/SET is_active = TRUE/g
s/AND is_active = 0/AND is_active = FALSE/g
s/AND is_active = 1/AND is_active = TRUE/g
s/WHERE is_active = 0/WHERE is_active = FALSE/g
s/WHERE is_active = 1/WHERE is_active = TRUE/g

# 转换布尔值 (INSERT VALUES)
s/  1,$/  TRUE,/g
s/  0,$/  FALSE,/g

# 添加ON CONFLICT处理（在);前）
s/^);$/)\nON CONFLICT (prompt_id, version) DO NOTHING;/g

# 更新数据库类型注释
s/-- Database: SQLite/-- Database: PostgreSQL/g
' "$INPUT_FILE" > "$OUTPUT_FILE"

echo "转换完成: $INPUT_FILE -> $OUTPUT_FILE"
```

### 使用方法

```bash
# 转换单个文件
./convert_migration.sh \
  migrations/076_update_all_prompts_v4.14.sql \
  pg-migrations/076_update_all_prompts_v4.14.pg.sql

# 批量转换
for file in migrations/*.sql; do
  basename=$(basename "$file" .sql)
  ./convert_migration.sh "$file" "pg-migrations/${basename}.pg.sql"
done
```

## ON CONFLICT详解

### DO NOTHING策略

**适用场景**：
- 记录已存在时跳过
- 保持原有数据不变
- 仅插入不存在的记录

```sql
INSERT INTO prompt_versions (prompt_id, version, ...)
VALUES ('test', 'v1.0', ...)
ON CONFLICT (prompt_id, version) DO NOTHING;
```

**效果**：
- 首次执行：插入成功
- 重复执行：静默跳过，不报错
- 幂等性：多次执行结果一致

### DO UPDATE策略

**适用场景**：
- 记录存在时需要更新
- 保持最新数据
- UPSERT操作

```sql
INSERT INTO prompt_versions (prompt_id, version, category, name, ...)
VALUES ('test', 'v1.0', 'new_category', 'new_name', ...)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  is_active = EXCLUDED.is_active;
```

**效果**：
- 首次执行：插入新记录
- 重复执行：更新现有记录
- 确保数据为最新版本

### 选择建议

| 场景 | 推荐策略 | 理由 |
|------|---------|------|
| 版本化数据（不应修改） | `DO NOTHING` | 历史版本不应改变 |
| 配置数据（需要更新） | `DO UPDATE` | 保持配置最新 |
| 迁移脚本 | `DO NOTHING` | 简单安全，避免意外覆盖 |

## 最佳实践

### 1. 开发流程

```
1. 编写SQLite迁移文件（开发环境测试）
   └─ migrations/076_xxx.sql

2. 使用转换脚本生成PostgreSQL版本
   └─ pg-migrations/076_xxx.pg.sql

3. 手动检查PostgreSQL文件
   ├─ 验证布尔值转换
   ├─ 确认ON CONFLICT语法
   └─ 测试重复执行

4. 提交两个文件
   └─ 保持序号和功能一致
```

### 2. 测试清单

**SQLite测试**：
- [ ] 首次执行成功
- [ ] 数据正确插入
- [ ] 约束条件生效

**PostgreSQL测试**：
- [ ] 首次执行成功
- [ ] 重复执行不报错（幂等性）
- [ ] 数据状态正确
- [ ] 布尔值类型正确

### 3. 代码审查要点

**必查项**：
- [ ] 布尔值是否正确转换（0/1 → FALSE/TRUE）
- [ ] 是否添加ON CONFLICT处理
- [ ] ON CONFLICT子句是否引用不存在的字段
- [ ] 文件命名是否一致（序号和描述）
- [ ] 注释是否标注正确的数据库类型

**可选项**：
- [ ] 是否可以合并多个INSERT为批量操作
- [ ] 是否需要添加事务包装
- [ ] 是否需要添加回滚脚本

## 故障排查

### 问题诊断流程

```
1. 检查错误类型
   ├─ 语法错误 → 检查SQL语法
   ├─ 类型错误 → 检查布尔值和数据类型
   ├─ 约束错误 → 检查唯一键和外键
   └─ 权限错误 → 检查数据库权限

2. 验证表结构
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'your_table';

3. 检查现有数据
   SELECT * FROM your_table
   WHERE prompt_id = 'xxx' AND version = 'vX.X';

4. 测试迁移片段
   -- 在测试数据库中逐段执行
   -- 隔离问题所在
```

### 常用调试SQL

```sql
-- 检查表结构
\d prompt_versions  -- PostgreSQL
PRAGMA table_info(prompt_versions);  -- SQLite

-- 检查约束
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'prompt_versions';

-- 检查现有版本
SELECT prompt_id, version, is_active, created_at
FROM prompt_versions
ORDER BY prompt_id, version;

-- 检查重复记录
SELECT prompt_id, version, COUNT(*)
FROM prompt_versions
GROUP BY prompt_id, version
HAVING COUNT(*) > 1;
```

## 参考资源

### PostgreSQL官方文档
- [INSERT ... ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
- [Boolean Type](https://www.postgresql.org/docs/current/datatype-boolean.html)
- [Data Types](https://www.postgresql.org/docs/current/datatype.html)

### SQLite官方文档
- [Data Types](https://www.sqlite.org/datatype3.html)
- [INSERT Statement](https://www.sqlite.org/lang_insert.html)

## 版本历史

- **2025-12-17**: 初始版本，基于迁移076的问题总结
- 总结了布尔值、冲突处理、幂等性三大核心差异
- 提供了转换脚本和最佳实践指南
