#!/bin/bash
# ============================================================
# 新加坡服务器一键部署脚本
# 用法: bash scripts/deploy-singapore.sh
# SSH 别名: singapore-server (配置在 ~/.ssh/config)
# 服务器路径: /home/ubuntu/autoads
# Git remote: mirtrn → https://github.com/Mirtrn/AiAdsGo.git
# ============================================================

set -e

SSH_HOST="singapore-server"
REMOTE_DIR="/home/ubuntu/autoads"
COMPOSE_FILE="docker-compose.single.yml"
IMAGE_NAME="autoads:single"
CONTAINER_NAME="autoads"

echo "🚀 开始部署到新加坡服务器..."
echo "   SSH Host: $SSH_HOST"
echo "   路径: $REMOTE_DIR"
echo ""

# Step 1: 推送本地代码到 GitHub
echo "📤 Step 1: 推送代码到 GitHub..."
git push
echo "✅ GitHub 推送完成"
echo ""

# Step 2: 服务器 git pull
echo "📥 Step 2: 服务器拉取最新代码..."
ssh "$SSH_HOST" "cd $REMOTE_DIR && git fetch mirtrn && git merge mirtrn/main"
echo "✅ 代码同步完成"
echo ""

# Step 3: 后台 docker build + restart（重建 5-10 分钟）
echo "🔨 Step 3: 启动后台 Docker 构建并重启容器..."
echo "   日志文件: /tmp/deploy.log（可在服务器上 tail -f /tmp/deploy.log 查看进度）"

ssh "$SSH_HOST" "cd $REMOTE_DIR && nohup bash -c '
  echo \"[$(date)] 开始 Docker 构建...\" >> /tmp/deploy.log
  sudo docker build -t $IMAGE_NAME . >> /tmp/deploy.log 2>&1
  echo \"[$(date)] 构建完成，重启容器...\" >> /tmp/deploy.log
  sudo docker stop $CONTAINER_NAME >> /tmp/deploy.log 2>&1 || true
  sudo docker rm $CONTAINER_NAME >> /tmp/deploy.log 2>&1 || true
  sudo docker-compose -f $COMPOSE_FILE up -d >> /tmp/deploy.log 2>&1
  echo \"[$(date)] DEPLOY_DONE\" >> /tmp/deploy.log
' >> /tmp/deploy.log 2>&1 &"

echo ""
echo "✅ 部署任务已提交到服务器后台！"
echo ""
echo "📊 查看构建进度（需要等 5-10 分钟）："
echo "   ssh $SSH_HOST 'tail -f /tmp/deploy.log'"
echo ""
echo "🔍 验证部署结果："
echo "   ssh $SSH_HOST 'sudo docker ps && sudo docker logs $CONTAINER_NAME --tail 20'"
