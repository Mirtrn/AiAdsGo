#!/bin/sh
# Docker容器启动入口脚本
# 在supervisord启动前执行数据库初始化

set -e

echo "========================================"
echo "🚀 AutoAds 服务启动初始化"
echo "========================================"

# 检查数据库连接
if [ -z "$DATABASE_URL" ]; then
    echo "❌ 错误: DATABASE_URL 环境变量未设置"
    exit 1
fi

# 执行数据库初始化脚本
cd /app
node dist/db-init.js

# 初始化 OpenClaw 目录并授权
mkdir -p /app/.openclaw /app/.openclaw/workspace /app/.openclaw/canvas /app/data/backups
chown -R nextjs:nodejs /app/.openclaw /app/data/backups

# OpenClaw 配置同步（失败不影响主服务启动）
if [ -f /app/dist/openclaw-sync.js ]; then
    node dist/openclaw-sync.js || echo "⚠️  OpenClaw 配置同步失败，已跳过"
fi

echo ""
echo "========================================"
echo "✅ 初始化完成，启动服务..."
echo "========================================"
echo ""

# 为 supervisord 变量插值提供默认值（避免未注入时启动失败）
: "${NODE_MAX_OLD_SPACE_SIZE_WEB:=6144}"
: "${NODE_MAX_OLD_SPACE_SIZE_SCHEDULER:=1024}"
: "${NODE_MAX_OLD_SPACE_SIZE_BACKGROUND_WORKER:=2048}"
: "${NODE_MAX_OLD_SPACE_SIZE_OPENCLAW:=1536}"
export NODE_MAX_OLD_SPACE_SIZE_WEB
export NODE_MAX_OLD_SPACE_SIZE_SCHEDULER
export NODE_MAX_OLD_SPACE_SIZE_BACKGROUND_WORKER
export NODE_MAX_OLD_SPACE_SIZE_OPENCLAW

# 启动supervisord
exec /usr/bin/supervisord -c /etc/supervisord.conf
