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

echo ""
echo "========================================"
echo "✅ 初始化完成，启动服务..."
echo "========================================"
echo ""

# 启动supervisord
exec /usr/bin/supervisord -c /etc/supervisord.conf
