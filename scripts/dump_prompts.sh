#!/bin/bash
# 导出所有活跃 prompt 内容到 /tmp/prompts_dump.txt

OUTPUT="/tmp/prompts_dump.txt"
> "$OUTPUT"

# 获取所有活跃 prompt 的 prompt_id 列表
IDS=$(sudo docker exec -i autoads_postgres psql -U autoads -d autoads \
  -c "SELECT prompt_id FROM prompt_versions WHERE is_active = true ORDER BY prompt_id;" \
  -A -t)

for PID in $IDS; do
  echo "========================================" >> "$OUTPUT"
  echo "PROMPT_ID: $PID" >> "$OUTPUT"

  # 获取该 prompt 的 version 和 name
  META=$(sudo docker exec -i autoads_postgres psql -U autoads -d autoads \
    -c "SELECT version, name FROM prompt_versions WHERE is_active = true AND prompt_id = '$PID';" \
    -A -t)
  echo "META: $META" >> "$OUTPUT"
  echo "========================================" >> "$OUTPUT"

  # 获取 prompt_content
  sudo docker exec -i autoads_postgres psql -U autoads -d autoads \
    -c "SELECT prompt_content FROM prompt_versions WHERE is_active = true AND prompt_id = '$PID';" \
    -A -t >> "$OUTPUT"

  echo "" >> "$OUTPUT"
  echo "" >> "$OUTPUT"
done

echo "===== DONE. Total lines: $(wc -l < $OUTPUT) =====" >> "$OUTPUT"
cat "$OUTPUT"
