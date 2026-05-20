#!/bin/bash
# ============================================================
# Staging 服务器部署脚本
# 测试机 IP : 43.160.192.15
# SSH 别名  : staging-server（需在 ~/.ssh/config 配置）
# 项目路径  : /home/ubuntu/autobb
#
# 本地执行：bash deploy_staging.sh
# ============================================================

STAGING_SERVER="staging-server"   # ~/.ssh/config 中的 Host 别名
SERVER_DIR="/home/ubuntu/autobb"
COMPOSE_FILE="docker-compose.staging.yml"

# ── 自动判断：本地环境则 SSH 到 staging 服务器执行 ──
if [ ! -d "$SERVER_DIR" ]; then
  echo "📡 本地环境检测到，SSH 到 ${STAGING_SERVER} 部署..."
  ssh "$STAGING_SERVER" "cd $SERVER_DIR && git pull origin main && bash deploy_staging.sh"
  echo ""
  echo "✅ Staging 部署完成，查看日志："
  echo "   ssh $STAGING_SERVER 'tail -f /tmp/deploy_staging.log'"
  echo "   访问地址：http://43.160.192.15"
  exit 0
fi

# ── 以下在 staging 服务器上执行 ──
cd "$SERVER_DIR"
LOG="/tmp/deploy_staging.log"

echo "[START $(date)]" >> $LOG

echo "🔨 拉取最新代码..." | tee -a $LOG
git pull origin main >> $LOG 2>&1

echo "🐳 构建 staging 镜像..." | tee -a $LOG
sudo docker build -t autoads:staging . >> $LOG 2>&1

echo "🔄 重启 staging 容器..." | tee -a $LOG
sudo docker compose -f $COMPOSE_FILE down >> $LOG 2>&1
sudo docker compose -f $COMPOSE_FILE up -d >> $LOG 2>&1

echo "🧹 清理旧镜像..." | tee -a $LOG
sudo docker image prune -af >> $LOG 2>&1

echo "[DONE $(date)]" >> $LOG
echo "✅ Staging 部署完成！访问 http://43.160.192.15"
