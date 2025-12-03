# Prompt更新快速参考

## ⚡ 一键自动化更新（推荐）

```bash
# 1. 准备Prompt内容文件
echo "你的prompt内容" > prompts/ad_creative_v3.txt

# 2. 运行自动化脚本（一条命令完成所有操作）
./scripts/update-prompt.sh ad_creative_generation v3.0 prompts/ad_creative_v3.txt

# 脚本会自动完成：
# ✅ 查询当前版本信息
# ✅ 读取新Prompt内容
# ✅ 交互式输入变更说明
# ✅ 生成迁移文件
# ✅ 备份数据库
# ✅ 执行迁移
# ✅ Git提交和推送
```

**参数说明**:
- `<prompt_id>`: Prompt唯一标识（如：ad_creative_generation）
- `<new_version>`: 新版本号（如：v3.0）
- `<prompt_file>`: Prompt内容文件路径（如：prompts/ad_creative_v3.txt）

---

## 📋 手动更新流程（备用）

```bash
# 1. 查看当前版本
sqlite3 data/autoads.db "SELECT prompt_id, version FROM prompt_versions WHERE is_active=1;"

# 2. 创建迁移文件
# migrations/041_update_{prompt_id}_v{X}.sql

# 3. 编写迁移SQL（复制下方模板）

# 4. 本地测试
npm run dev
# 观察: ✅ Completed: 041_update_xxx.sql

# 5. 提交部署
git add migrations/041_update_xxx.sql
git commit -m "feat: 更新XXX prompt到vX"
git push origin main
```

---

## 📝 迁移文件模板（复制使用）

```sql
-- Migration: 041_update_{prompt_id}_v{X}
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
  'v{X}.0',
  '{category}',
  '{name} v{X}.0',
  '{description}',
  '{file_path}',
  '{function_name}',
  '
{在这里粘贴完整的prompt内容}
',
  'Chinese',
  1,
  '
v{X}.0 更新内容:
1. {变更点1}
2. {变更点2}
3. {变更点3}
'
);
```

---

## ✅ 验证命令

```bash
# 本地验证
sqlite3 data/autoads.db "
SELECT prompt_id, version, is_active, LENGTH(prompt_content)
FROM prompt_versions
WHERE prompt_id = '{prompt_id}'
ORDER BY version DESC LIMIT 2;
"

# 生产验证
docker logs autoads-prod | grep "041_update"
```

---

## 🔄 回滚模板

```sql
-- 紧急回滚到上一版本
BEGIN TRANSACTION;

UPDATE prompt_versions SET is_active = 0
WHERE prompt_id = '{prompt_id}' AND version = 'v{new}';

UPDATE prompt_versions SET is_active = 1
WHERE prompt_id = '{prompt_id}' AND version = 'v{old}';

COMMIT;
```

---

## 📚 现有Prompt列表

| Prompt ID | 当前版本 | 用途 |
|-----------|---------|------|
| ad_creative_generation | v2.0 | 广告创意生成 |
| competitor_analysis | v2.0 | 竞品分析 |
| competitor_keyword_inference | v2.0 | 竞品关键词推断 |
| creative_quality_scoring | v2.0 | 创意质量评分 |
| launch_score_evaluation | v2.0 | Launch Score评估 |
| ad_elements_descriptions | v2.0 | 广告描述生成 |

查看最新列表:
```bash
sqlite3 data/autoads.db "SELECT prompt_id, version, name FROM prompt_versions WHERE is_active=1;"
```

---

## 🎯 注意事项

1. **编号递增**: 新迁移文件编号必须大于当前最大编号
2. **is_active**: 同一prompt_id只能有一个is_active=1
3. **备份旧版本**: UPDATE而非DELETE旧版本（支持回滚）
4. **测试优先**: 开发环境测试后再部署生产
5. **完整内容**: prompt_content必须包含完整的prompt文本

---

## 📞 详细文档

完整指南: `docs/PROMPT_VERSION_MANAGEMENT.md`
