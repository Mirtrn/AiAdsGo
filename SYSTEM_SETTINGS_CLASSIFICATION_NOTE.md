# system_settings 表分类说明

**创建时间**: 2025-12-04
**目的**: 澄清 system_settings 表的用户隔离分类

---

## 📋 表分类：用户数据表

虽然 `system_settings` 表命名为 "系统设置"，但根据用户隔离归类原则，它应归类为**用户数据表**。

---

## 🏗️ 表结构

```sql
CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,  -- 允许 NULL（设计为混合表）
  category TEXT NOT NULL,
  config_key TEXT NOT NULL,
  config_value TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## 🎯 归类原则

**核心原则**: 有 `user_id` 字段且存储用户数据的表都归为用户表

**system_settings 归类为用户表的理由**:

1. ✅ **有 user_id 字段**: 表结构包含 user_id
2. ✅ **支持用户级数据**: 可以存储每个用户的特定配置
3. ✅ **外键关联用户表**: 有 `FOREIGN KEY (user_id) REFERENCES users(id)`
4. ✅ **混合使用模式**: 同时支持全局配置和用户配置

---

## 💡 混合表设计模式

### 设计意图

`system_settings` 采用混合表设计，通过 `user_id IS NULL` 实现配置继承：

```typescript
// 全局配置（所有用户共享）
user_id = NULL

// 用户特定配置（覆盖全局配置）
user_id = 1, 2, 3, ...
```

### 查询模式

#### 模式 1: 查询全局配置
```sql
SELECT * FROM system_settings
WHERE category = 'google_ads'
AND config_key = 'client_id'
AND user_id IS NULL;
```

#### 模式 2: 查询用户配置（带继承）
```sql
-- 优先返回用户配置，回退到全局配置
SELECT * FROM system_settings
WHERE category = ? AND config_key = ?
AND (user_id IS NULL OR user_id = ?)
ORDER BY user_id DESC LIMIT 1;
```

#### 模式 3: 查询所有用户配置
```sql
SELECT * FROM system_settings
WHERE user_id = ?;
```

---

## 🔍 实际使用场景

### 全局配置（user_id IS NULL）
- Google Ads OAuth 配置（client_id, client_secret, developer_token）
- 代理池配置（proxy URLs, rotation settings）
- 队列配置（workers, timeouts）
- AI 模型默认配置（default model, temperature）

### 用户级配置（user_id = ?）
- 用户特定的 AI 模型选择
- 用户自定义的优化策略
- 用户偏好设置
- 用户特定的 API 配额限制

---

## ⚠️ 审查工具警告说明

当运行 `tests/audit-user-isolation.ts` 时，会看到以下警告：

```
⚠️  system_settings: user_id 允许 NULL
```

**这是预期行为，不是问题**：

1. **设计决策**: user_id 允许 NULL 是有意为之，用于存储全局配置
2. **数据安全**: 全局配置对所有用户可见，但只有管理员可修改
3. **数据隔离**: 用户特定配置正确隔离（WHERE user_id = ?）
4. **不需要修复**: 这不是 Bug，是特性

---

## ✅ 验证步骤

### 1. 验证表结构
```sql
PRAGMA table_info(system_settings);
-- 确认 user_id 字段存在且允许 NULL
```

### 2. 验证全局配置
```sql
SELECT COUNT(*) FROM system_settings WHERE user_id IS NULL;
-- 应该返回全局配置数量
```

### 3. 验证用户配置
```sql
SELECT COUNT(*) FROM system_settings WHERE user_id IS NOT NULL;
-- 应该返回用户特定配置数量
```

### 4. 验证外键约束
```sql
PRAGMA foreign_key_list(system_settings);
-- 确认有 user_id 外键关联到 users 表
```

---

## 📊 分类对比

| 项目 | 全局表 | 用户表 |
|-----|--------|--------|
| **有 user_id 字段** | ❌ | ✅ |
| **存储用户数据** | ❌ | ✅ |
| **外键关联用户** | ❌ | ✅ |
| **system_settings** | ❌ | ✅ |

**结论**: system_settings 应归类为**用户表**，尽管它也存储全局配置。

---

## 🎓 归类准则总结

### 判断逻辑
```
IF 表有 user_id 字段 THEN
  归类为用户表
ELSE IF 表存储用户相关数据 THEN
  应该添加 user_id 字段，然后归类为用户表
ELSE
  归类为全局表
END IF
```

### 全局表特征
- ❌ 没有 user_id 字段
- ✅ 数据跨用户共享
- ✅ 示例：users, migration_history, global_keywords

### 用户表特征
- ✅ 有 user_id 字段
- ✅ 数据按用户隔离
- ✅ 示例：offers, campaigns, **system_settings**

---

## 🔄 历史修正

### 原始分类（错误）
- **分类**: 全局共享表（混合表）
- **理由**: 有 user_id IS NULL 的记录

### 修正后分类（正确）
- **分类**: 用户数据表（配置管理表）
- **理由**: 有 user_id 字段，支持用户级配置
- **修正日期**: 2025-12-04

---

## 📚 相关文档

- [用户隔离审查报告](USER_ISOLATION_AUDIT_REPORT.md)
- [全局表分类报告](GLOBAL_TABLES_CLASSIFICATION_REPORT.md)
- [AB Test 下线和全局表报告](AB_TEST_OFFLINE_AND_GLOBAL_TABLES_REPORT.md)

---

**文档维护**: 每次用户隔离架构变更时更新
**负责人**: 开发团队
