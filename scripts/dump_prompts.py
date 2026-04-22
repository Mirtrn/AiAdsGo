#!/usr/bin/env python3
import subprocess
import sys

def run_psql(sql):
    result = subprocess.run(
        ['sudo', 'docker', 'exec', '-i', 'autoads_postgres', 'psql', '-U', 'autoads', '-d', 'autoads', '-A', '-t', '-c', sql],
        capture_output=True, text=True
    )
    return result.stdout.strip()

# 获取所有活跃 prompt 的 ID
ids_raw = run_psql("SELECT prompt_id FROM prompt_versions WHERE is_active = true ORDER BY prompt_id;")
ids = [line.strip() for line in ids_raw.splitlines() if line.strip()]

print(f"共找到 {len(ids)} 个活跃 prompt\n")

for pid in ids:
    meta = run_psql(f"SELECT version, name FROM prompt_versions WHERE is_active = true AND prompt_id = '{pid}';")
    content = run_psql(f"SELECT prompt_content FROM prompt_versions WHERE is_active = true AND prompt_id = '{pid}';")
    
    print("=" * 80)
    print(f"PROMPT_ID: {pid}")
    print(f"META: {meta}")
    print("=" * 80)
    print(content)
    print()
    print()

print("===== ALL DONE =====")
