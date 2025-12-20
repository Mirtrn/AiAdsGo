# PostgreSQL唯一性约束冲突修复方案

## 问题分析

### 错误信息
```sql
PostgresError: duplicate key value violates unique constraint "idx_system_settings_category_key_unique"
Detail: Key (category, key)=(proxy, urls) already exists.
```

### 根本原因

084迁移文件 `084_add_system_settings_unique_constraint.sql` 中的清理逻辑有严重缺陷：

```sql
-- ❌ 错误：删除所有value为NULL的记录（包括全局模板）
DELETE FROM system_settings
WHERE value IS NULL OR value = '';

-- 删除重复记录
DELETE FROM system_settings
WHERE EXISTS (
  SELECT 1 FROM system_settings s2
  WHERE s2.category = system_settings.category
    AND s2.key = system_settings.key
    AND s2.value IS NOT NULL
    AND s2.value <> ''
    AND s2.updated_at > system_settings.updated_at
);
```

**问题**：
- 全局模板记录的 `value = NULL`
- 第7-8行删除了所有 `value IS NULL` 的记录
- **全局模板被意外删除**！
- 只保留了用户配置记录

### 错误发生流程

1. **084迁移执行**：
   - 删除全局模板（value = NULL）
   - 创建唯一性约束，只对value不为NULL的记录生效

2. **085迁移执行**：
   - 插入新的全局模板（value = NULL）
   - 用户配置记录仍然存在（value = JSON）

3. **用户更新配置**：
   - 尝试创建新的用户配置记录
   - 但可能全局模板的value被意外更新为JSON
   - 违反唯一性约束

## 修复方案

### 方案1：修复084迁移（推荐）

修改084迁移，只删除重复的用户配置，保留全局模板：

```sql
-- 修复后的084迁移
-- Step 1: 清理重复记录（但保留全局模板）
-- 只删除用户配置中的重复记录，保留全局模板
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
    AND s1.updated_at < s2.updated_at  -- 删除旧记录
);

-- Step 2: 删除value为NULL或空的用户配置（但不删除全局模板）
DELETE FROM system_settings
WHERE user_id IS NOT NULL  -- 只删除用户配置
  AND (value IS NULL OR value = '');

-- Step 3: 创建唯一性约束
CREATE UNIQUE INDEX idx_system_settings_category_key_unique
  ON system_settings(category, key)
  WHERE value IS NOT NULL AND value <> '';
```

### 方案2：数据库直接修复（紧急方案）

在生产环境中直接执行修复：

```sql
-- 1. 检查当前数据状态
SELECT user_id, category, key,
       CASE WHEN value IS NULL THEN 'NULL' ELSE 'HAS_VALUE' END as value_status,
       COUNT(*) as count
FROM system_settings
WHERE category = 'proxy' AND key = 'urls'
GROUP BY user_id, category, key,
         CASE WHEN value IS NULL THEN 'NULL' ELSE 'HAS_VALUE' END;

-- 2. 如果全局模板缺失，重新插入
INSERT INTO system_settings (
  user_id, category, key, value, data_type,
  is_sensitive, is_required, description
)
SELECT
  NULL, 'proxy', 'urls', NULL, 'json',
  false, false, '代理URL配置，JSON格式存储国家与代理URL的映射'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'proxy' AND key = 'urls' AND user_id IS NULL
);

-- 3. 检查唯一性约束冲突
SELECT category, key, COUNT(*) as count
FROM system_settings
WHERE value IS NOT NULL AND value <> ''
GROUP BY category, key
HAVING COUNT(*) > 1;

-- 4. 如果有冲突，删除多余的记录（保留最新的）
DELETE FROM system_settings s1
WHERE s1.value IS NOT NULL
  AND s1.value <> ''
  AND EXISTS (
    SELECT 1 FROM system_settings s2
    WHERE s2.category = s1.category
      AND s2.key = s1.key
      AND s2.value IS NOT NULL
      AND s2.value <> ''
      AND s2.updated_at > s1.updated_at
      AND s2.id != s1.id
  );
```

## 预防措施

### 1. 修改084迁移文件

创建修复版084迁移：
- 保留全局模板（user_id IS NULL, value = NULL）
- 只清理用户配置的重复记录
- 不删除全局模板

### 2. 更新迁移执行顺序

确保：
1. 先执行修复版084迁移
2. 再执行085迁移（插入全局模板）

### 3. 添加数据完整性检查

在迁移文件中添加验证查询：

```sql
-- 验证查询：检查全局模板是否存在
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'ERROR: No global template found'
    WHEN COUNT(*) > 1 THEN 'ERROR: Multiple global templates found'
    ELSE 'OK: Global template exists'
  END as status
FROM system_settings
WHERE category = ? AND key = ? AND user_id IS NULL;
```

## 核心问题总结

**system_settings表的双层架构**：
- 全局模板（user_id IS NULL, value = NULL）：定义配置项元数据
- 用户配置（user_id = 用户ID, value = JSON）：存储实际值

**084迁移的错误**：
- 错误地删除了所有value为NULL的记录
- 包括全局模板记录
- 破坏了双层架构

**唯一性约束设计**：
- 只对value不为NULL且不为空的记录生效
- 允许全局模板（value = NULL）和用户配置（value = JSON）共存

**修复原则**：
- 全局模板是系统配置的基础，永远不能被删除
- 唯一性约束只应该应用于用户配置
- 迁移逻辑必须严格区分全局模板和用户配置
