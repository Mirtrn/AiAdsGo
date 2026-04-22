#!/bin/bash
cd /home/ubuntu/autoads
echo > /tmp/deploy.log
nohup bash -c '
  echo "[$(date)] 开始 Docker 构建..." >> /tmp/deploy.log
  sudo docker build -t autoads:single . >> /tmp/deploy.log 2>&1
  echo "[$(date)] 构建完成，重启容器..." >> /tmp/deploy.log
  sudo docker stop autoads >> /tmp/deploy.log 2>&1 || true
  sudo docker rm autoads >> /tmp/deploy.log 2>&1 || true
  sudo docker-compose -f docker-compose.single.yml up -d >> /tmp/deploy.log 2>&1
  echo "[$(date)] DEPLOY_DONE" >> /tmp/deploy.log
' >> /tmp/deploy.log 2>&1 &
echo "后台构建已启动，PID=$!"
