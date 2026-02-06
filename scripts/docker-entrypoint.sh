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
mkdir -p /app/.openclaw /app/.openclaw/workspace
chown -R nextjs:nodejs /app/.openclaw

# OpenClaw 配置同步（失败不影响主服务启动）
if [ -f /app/dist/openclaw-sync.js ]; then
    node dist/openclaw-sync.js || echo "⚠️  OpenClaw 配置同步失败，已跳过"
fi

echo ""
echo "========================================"
echo "✅ 初始化完成，启动服务..."
echo "========================================"
echo ""

# 启动supervisord
exec /usr/bin/supervisord -c /etc/supervisord.conf
