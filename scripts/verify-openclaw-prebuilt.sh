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

if [[ ! -d "${PREBUILT_DIR}/extensions" ]]; then
  echo "❌ openclaw-prebuilt/extensions 不存在"
  exit 1
fi

if [[ ! -d "${PREBUILT_DIR}/skills" ]]; then
  echo "❌ openclaw-prebuilt/skills 不存在（Gateway 将无法加载内置技能）"
  exit 1
fi

for plugin in feishu memory-core; do
  if [[ ! -f "${PREBUILT_DIR}/extensions/${plugin}/package.json" ]]; then
    echo "❌ openclaw-prebuilt/extensions/${plugin} 缺失（插件未打包）"
    exit 1
  fi
done

for skill in autoads autoads-report-qa autoads-prd-writer; do
  if [[ ! -f "${PREBUILT_DIR}/skills/${skill}/SKILL.md" ]]; then
    echo "❌ openclaw-prebuilt/skills/${skill}/SKILL.md 缺失（内置技能未打包）"
    exit 1
  fi
done

# 防止把 dev 依赖打进镜像（历史问题：TypeScript native preview 二进制体积巨大）
if compgen -G "${PREBUILT_DIR}/node_modules/.pnpm/@typescript+native-preview*" > /dev/null; then
  echo "❌ 检测到 dev 依赖 @typescript/native-preview 被打包进 openclaw-prebuilt"
  exit 1
fi
if compgen -G "${PREBUILT_DIR}/node_modules/@typescript/native-preview*" > /dev/null; then
  echo "❌ 检测到 dev 依赖 @typescript/native-preview 被打包进 openclaw-prebuilt"
  exit 1
fi

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -p "parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo 0
}

run_help() {
  node "${PREBUILT_DIR}/openclaw.mjs" --help >/dev/null
}

MAJOR="$(node_major)"
if [[ "${MAJOR}" -ge 22 ]]; then
  run_help
  echo "✅ OpenClaw 预编译产物验证通过"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "${PREBUILT_DIR}:/out" \
    -w /out \
    node:22-bookworm-slim \
    node openclaw.mjs --help >/dev/null
  echo "✅ OpenClaw 预编译产物验证通过（Docker Node 22）"
  exit 0
fi

echo "❌ 当前 Node 版本 < 22，且未检测到 Docker，无法验证 openclaw 预编译产物"
exit 1
