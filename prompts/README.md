# Prompts Directory

此目录用于存放Prompt内容文件，供 `scripts/update-prompt.sh` 脚本使用。

## 使用方法

1. 创建Prompt内容文件（如：`ad_creative_v3.txt`）
2. 运行更新脚本：
   ```bash
   ./scripts/update-prompt.sh <prompt_id> <new_version> <prompt_file>
   ```

## 示例

```bash
# 更新广告创意生成Prompt到v3.0
./scripts/update-prompt.sh ad_creative_generation v3.0 prompts/ad_creative_v3.txt

# 更新竞品分析Prompt到v2.1
./scripts/update-prompt.sh competitor_analysis v2.1 prompts/competitor_analysis_v2.1.txt
```

## 文件命名建议

- 使用描述性文件名：`{prompt_id}_v{version}.txt`
- 使用`.txt`扩展名以便于编辑
- 保持与prompt_id的一致性

## 注意事项

- Prompt内容文件应包含完整的prompt文本
- 不要在文件中包含SQL或迁移语法，只保存纯prompt内容
- 脚本会自动处理单引号转义和SQL格式化
