# Prompt版本管理操作指南

本文档说明如何在开发环境更新Prompt，并自动同步到生产环境。

## 📋 目录
1. [系统原理](#系统原理)
2. [更新流程](#更新流程)
3. [迁移文件模板](#迁移文件模板)
4. [验证和回滚](#验证和回滚)
5. [最佳实践](#最佳实践)

---

## 🔍 系统原理

### 核心机制
```
开发环境更新Prompt
    ↓
创建迁移文件（XXX_update_prompt_vX.sql）
    ↓
Git提交并部署
    ↓
生产环境应用启动时自动执行迁移
    ↓
Prompt自动更新到最新版本
```

### 数据库表结构
- **prompt_versions**: 存储所有Prompt版本和内容
  - `prompt_id`: Prompt唯一标识（如 'ad_creative_generation'）
  - `version`: 版本号（如 'v1.0', 'v2.0', 'v3.0'）
  - `is_active`: 是否为活跃版本（1=活跃，0=历史版本）
  - `prompt_content`: Prompt完整内容
  - `change_notes`: 版本更新说明

---

## 🚀 更新流程

### 步骤1: 确定Prompt ID和当前版本

```bash
# 查看所有Prompt及其当前版本
sqlite3 data/autoads.db "
SELECT
  prompt_id,
  version,
  name,
  is_active,
  created_at
FROM prompt_versions
WHERE is_active = 1
ORDER BY prompt_id;
"
```

**示例输出**:
```
ad_creative_generation|v2.0|广告创意生成v2.0|1|2025-12-01 10:00:00
competitor_analysis|v2.0|竞品分析v2.0|1|2025-12-01 10:05:00
```

### 步骤2: 创建迁移文件

**命名规范**: `{编号}_update_{prompt_id}_v{新版本}.sql`

示例：`041_update_ad_creative_prompt_v3.sql`

### 步骤3: 编写迁移SQL（参考模板）

见下方"迁移文件模板"章节

### 步骤4: 本地验证

```bash
# 在开发环境测试迁移
npm run dev

# 观察启动日志
# 应该看到：
# 📦 Found 1 pending migrations:
#    - 041_update_ad_creative_prompt_v3.sql
# 🔄 Executing: 041_update_ad_creative_prompt_v3.sql
# ✅ Completed: 041_update_ad_creative_prompt_v3.sql
```

### 步骤5: 验证Prompt内容

```bash
# 查看新版本是否正确插入
sqlite3 data/autoads.db "
SELECT
  prompt_id,
  version,
  is_active,
  LENGTH(prompt_content) as content_length,
  change_notes
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 2;
"
```

**预期结果**:
```
ad_creative_generation|v3.0|1|2500|v3.0 更新内容: 增强情感化表达...
ad_creative_generation|v2.0|0|1800|v2.0 更新内容: 添加增强字段...
```

### 步骤6: Git提交

```bash
git add migrations/041_update_ad_creative_prompt_v3.sql
git commit -m "feat: 更新广告创意生成Prompt到v3.0，增强情感化表达"
git push origin main
```

### 步骤7: 部署到生产环境

```bash
# 生产环境执行
git pull origin main
docker restart autoads-prod

# 或使用CI/CD自动部署
```

### 步骤8: 验证生产环境

```bash
# 查看生产环境日志
docker logs autoads-prod | grep "041_update"

# 应该看到：
# ✅ Completed: 041_update_ad_creative_prompt_v3.sql

# 连接生产数据库验证
psql -h prod-db.example.com -U postgres -d autoads -c "
SELECT prompt_id, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;
"
```

---

## 📝 迁移文件模板

### 模板1: 更新现有Prompt

```sql
-- Migration: {编号}_update_{prompt_id}_v{新版本}
-- Description: {更新说明}
-- Created: {日期}

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = '{prompt_id}' AND is_active = 1;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  '{prompt_id}',
  'v{X.Y}',
  '{category}',
  '{name}',
  '{description}',
  '{file_path}',
  '{function_name}',
  '{prompt_content的完整内容}',
  'Chinese',
  1,
  '
v{X.Y} 更新内容:
1. {变更点1}
2. {变更点2}
3. {变更点3}
'
);
```

### 模板2: 注册全新Prompt

```sql
-- Migration: {编号}_register_{prompt_id}
-- Description: 注册新Prompt: {prompt_name}
-- Created: {日期}

INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  '{prompt_id}',
  'v1.0',
  '{category}',
  '{name}',
  '{description}',
  '{file_path}',
  '{function_name}',
  '{prompt_content的完整内容}',
  'Chinese',
  1,
  'v1.0 初始版本'
);
```

### 模板3: 批量更新多个Prompt

```sql
-- Migration: {编号}_batch_update_prompts_v{新版本}
-- Description: 批量更新多个Prompt以支持新功能
-- Created: {日期}

-- 更新 Prompt 1
UPDATE prompt_versions SET is_active = 0
WHERE prompt_id = 'prompt_1' AND is_active = 1;

INSERT INTO prompt_versions (...) VALUES (...);

-- 更新 Prompt 2
UPDATE prompt_versions SET is_active = 0
WHERE prompt_id = 'prompt_2' AND is_active = 1;

INSERT INTO prompt_versions (...) VALUES (...);

-- 更新 Prompt 3
UPDATE prompt_versions SET is_active = 0
WHERE prompt_id = 'prompt_3' AND is_active = 1;

INSERT INTO prompt_versions (...) VALUES (...);
```

---

## ✅ 验证和回滚

### 验证Prompt是否正确应用

**方法1: 数据库查询**
```bash
sqlite3 data/autoads.db "
SELECT
  prompt_id,
  version,
  is_active,
  SUBSTR(prompt_content, 1, 100) as content_preview,
  created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC;
"
```

**方法2: 通过API测试**
```bash
# 调用使用该Prompt的API，观察生成结果
curl -X POST http://localhost:3000/api/creatives/generate \
  -H "Content-Type: application/json" \
  -d '{
    "offerId": 1,
    "userId": 1
  }'
```

### 回滚到上一版本

如果新版本有问题，可以快速回滚：

```sql
-- 创建回滚迁移: 042_rollback_ad_creative_prompt_to_v2.sql

-- 1. 将v3.0设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND version = 'v3.0';

-- 2. 将v2.0重新激活
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v2.0';
```

**或手动执行（紧急情况）**:
```bash
sqlite3 data/autoads.db "
BEGIN TRANSACTION;

UPDATE prompt_versions SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND version = 'v3.0';

UPDATE prompt_versions SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v2.0';

COMMIT;
"

# 重启应用使改动生效
docker restart autoads-prod
```

---

## 📚 最佳实践

### 1. 版本号规范

```
v{major}.{minor}

- major: 重大变更（不兼容旧版本，改变输出格式）
  示例: v1.0 → v2.0

- minor: 小版本更新（改进措辞、增强功能，兼容旧版本）
  示例: v2.0 → v2.1
```

### 2. Prompt内容组织

```markdown
# {Prompt标题} v{版本号}

{角色定位和目标}

## 输入数据
{列举所有输入变量和格式}

## 生成要求
{详细说明输出规范和质量标准}

## 输出格式
{严格定义JSON或其他格式}

## 示例（可选）
{提供输入输出示例}
```

### 3. 变更说明规范

```sql
change_notes = '
v3.0 更新内容:
1. 【功能增强】增加情感化表达指导
2. 【结构优化】细化标题生成策略（5+5+5）
3. 【质量提升】明确Google Ads合规要求
4. 【性能改进】优化Prompt长度减少Token消耗

影响范围: 影响所有广告创意生成场景
向后兼容: 是（输出格式不变）
'
```

### 4. 测试清单

更新Prompt后必须测试：

- [ ] 数据库成功插入新版本
- [ ] is_active标记正确（新版本=1，旧版本=0）
- [ ] migration_history记录迁移
- [ ] API调用返回预期格式
- [ ] 生成质量符合预期
- [ ] 生产环境日志无错误

### 5. 文档同步

更新Prompt时同步更新：

1. **代码注释**: 更新调用该Prompt的函数注释
2. **API文档**: 如果输出格式变化，更新API文档
3. **变更日志**: 在项目CHANGELOG.md中记录
4. **团队通知**: 通知团队成员Prompt已更新

---

## 🔧 常见问题

### Q1: Prompt内容很长，如何在迁移文件中管理？

**方案A: 使用SQL多行字符串**
```sql
prompt_content = '
第一行内容
第二行内容
...
最后一行内容
'
```

**方案B: 读取外部文件（推荐）**
```sql
-- 先在 prompts/ 目录创建文件
-- prompts/ad_creative_generation_v3.txt

-- 然后在迁移中使用 readfile()（SQLite 3.35.0+）
INSERT INTO prompt_versions (...)
VALUES (
  ...,
  readfile('prompts/ad_creative_generation_v3.txt'),
  ...
);
```

### Q2: 如何A/B测试两个Prompt版本？

```sql
-- 保持两个版本都为活跃状态
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation'
AND version IN ('v2.0', 'v3.0');

-- 在代码中随机选择版本
SELECT * FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
AND is_active = 1
ORDER BY RANDOM()
LIMIT 1;
```

### Q3: 生产环境迁移失败怎么办？

1. **查看错误日志**
```bash
docker logs autoads-prod | grep "041_update"
```

2. **手动执行迁移**
```bash
# 进入容器
docker exec -it autoads-prod bash

# 执行迁移SQL
sqlite3 /app/data/autoads.db < /app/migrations/041_update_ad_creative_prompt_v3.sql

# 手动记录迁移历史
sqlite3 /app/data/autoads.db "
INSERT INTO migration_history (migration_name)
VALUES ('041_update_ad_creative_prompt_v3.sql');
"
```

3. **重启应用**
```bash
docker restart autoads-prod
```

---

## 📊 监控和维护

### 查看Prompt使用统计

```sql
SELECT
  pv.prompt_id,
  pv.version,
  pv.name,
  COUNT(pus.id) as usage_count,
  AVG(pus.execution_time_ms) as avg_time_ms,
  SUM(CASE WHEN pus.success = 1 THEN 1 ELSE 0 END) as success_count
FROM prompt_versions pv
LEFT JOIN prompt_usage_stats pus ON pv.prompt_id = pus.prompt_id AND pv.version = pus.version
WHERE pv.is_active = 1
GROUP BY pv.prompt_id, pv.version
ORDER BY usage_count DESC;
```

### 定期清理历史版本

```sql
-- 保留最近3个版本，删除更早的历史版本
DELETE FROM prompt_versions
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY prompt_id ORDER BY version DESC) as rn
    FROM prompt_versions
  )
  WHERE rn <= 3
);
```

---

## 📞 支持

遇到问题？
1. 查看应用日志: `docker logs autoads-prod`
2. 检查数据库状态: 运行上述验证SQL
3. 联系开发团队: 提供错误日志和迁移文件内容
