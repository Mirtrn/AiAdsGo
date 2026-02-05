#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_DIR="${ROOT_DIR}/openclaw"
OUT_DIR="${ROOT_DIR}/openclaw-prebuilt"
TMP_DIR="${ROOT_DIR}/.openclaw-prebuilt-tmp"

echo "🚧 构建 OpenClaw 预编译产物..."

rm -rf "${TMP_DIR}"
mkdir -p "${TMP_DIR}"

docker run --rm \
  -v "${OPENCLAW_DIR}:/openclaw" \
  -v "${TMP_DIR}:/out" \
  -w /openclaw \
  -e OPENCLAW_A2UI_SKIP_MISSING=1 \
  node:22-bookworm-slim \
  sh -lc '
    set -e
    apt-get update && apt-get install -y git python3 make g++ bash >/dev/null
    corepack enable
    corepack prepare pnpm@10.23.0 --activate
    pnpm install --no-frozen-lockfile
    OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
    mkdir -p /out/dist
    cp -r dist/* /out/dist/
    cp openclaw.mjs /out/openclaw.mjs
    cp package.json /out/package.json
  '

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
cp -r "${TMP_DIR}/"* "${OUT_DIR}/"
rm -rf "${TMP_DIR}"

echo "✅ OpenClaw 预编译产物已生成 -> ${OUT_DIR}"
