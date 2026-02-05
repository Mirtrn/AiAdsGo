#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREBUILT_DIR="${ROOT_DIR}/openclaw-prebuilt"

if [[ ! -f "${PREBUILT_DIR}/dist/entry.js" ]]; then
  echo "❌ openclaw-prebuilt/dist/entry.js 不存在"
  exit 1
fi

if [[ ! -d "${PREBUILT_DIR}/node_modules" ]]; then
  echo "❌ openclaw-prebuilt/node_modules 不存在"
  exit 1
fi

node "${PREBUILT_DIR}/openclaw.mjs" --help >/dev/null
echo "✅ OpenClaw 预编译产物验证通过"
