#!/bin/bash
#
# ╔══════════════════════════════════════════════════════════════════╗
# ║                  ⚠️  部署规范 — 必读  ⚠️                        ║
# ╠══════════════════════════════════════════════════════════════════╣
# ║                                                                  ║
# ║  【服务器信息】                                                  ║
# ║    SSH 别名  : singapore-server                                  ║
# ║    用户@主机 : ubuntu@<singapore-server 的 IP>                   ║
# ║    项目路径  : /home/ubuntu/autoads                              ║
# ║                                                                  ║
# ║  【本地触发部署（Windows / Mac / Linux 均可）】                   ║
# ║    bash do_deploy.sh                                             ║
# ║    → 脚本自动检测当前环境，不在服务器则 SSH 远程执行             ║
# ║                                                                  ║
# ║  【唯一正确的启动方式】                                          ║
# ║    sudo docker-compose -f docker-compose.single.yml up -d        ║
# ║                                                                  ║
# ║  【绝对禁止】手动执行以下命令启动容器：                          ║
# ║    ✗  docker run -p 3000:3000 ...                                ║
# ║    ✗  docker run -p 3000:3000 --env-file ...                     ║
# ║    ✗  docker compose up -d --no-deps autoads  （会断网络！）     ║
# ║                                                                  ║
# ║  【为什么？】                                                     ║
# ║    docker-compose.single.yml 中映射的是 80:80 端口。             ║
# ║    Cloudflare → 源站走 80 端口，手动 docker run -p 3000:3000     ║
# ║    只绑定 3000 端口，80 端口无监听，Cloudflare 立即报            ║
# ║    "521 Web server is down"，网站完全无法访问。                  ║
# ║                                                                  ║
# ║  【--no-deps 的危险】                                            ║
# ║    单独 up --no-deps autoads 会创建新容器，新容器只加入          ║
# ║    autoads_autoads-network，而 postgres 在                       ║
# ║    autobb_autoads-network，导致数据库连接失败。                  ║
# ║    本脚本部署后会自动检测并修复网络。                            ║
# ║                                                                  ║
# ╚══════════════════════════════════════════════════════════════════╝

# ──────────────────────────────────────────────
# 自动判断：本地执行 → SSH 到服务器再运行自身
# ──────────────────────────────────────────────
SERVER_DIR="/home/ubuntu/autoads"
SSH_HOST="singapore-server"   # 对应 ~/.ssh/config 中的 Host 别名

if [ ! -d "$SERVER_DIR" ]; then
  echo "📡 本地环境检测到，SSH 到 ${SSH_HOST} 执行部署..."
  ssh "$SSH_HOST" "cd $SERVER_DIR && git pull origin main && bash do_deploy.sh"
  echo "✅ 远程部署指令已发送，查看日志: ssh $SSH_HOST 'cat /tmp/deploy.log'"
  exit 0
fi

# ──────────────────────────────────────────────
# 以下在服务器上执行
# ──────────────────────────────────────────────
cd "$SERVER_DIR"
LOG=/tmp/deploy.log
echo "" >> $LOG
echo "========================================" >> $LOG
echo "[DEPLOY START $(date)]" >> $LOG
echo "========================================" >> $LOG

echo "🔨 Step 1/5: 构建镜像..."
sudo docker build -t autoads:single . >> $LOG 2>&1
echo "✅ 镜像构建完成" | tee -a $LOG

echo "🛑 Step 2/5: 停止并删除旧容器..."
sudo docker stop autoads >> $LOG 2>&1 || true
sudo docker rm autoads   >> $LOG 2>&1 || true

echo "🚀 Step 3/5: 启动新容器（docker-compose）..."
# ⚠️ 必须用 docker-compose 启动，不可替换为 docker run 或 --no-deps，详见文件头部说明
sudo docker compose -f docker-compose.single.yml up -d >> $LOG 2>&1
echo "✅ 容器已启动" | tee -a $LOG

echo "🔌 Step 4/5: 修复容器网络（防止无法连接 PostgreSQL）..."
# postgres 容器所在网络可能与 autoads 新容器不同，自动检测并连接
POSTGRES_NETWORKS=$(sudo docker inspect autoads_postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null || echo "")
for NET in $POSTGRES_NETWORKS; do
  ALREADY=$(sudo docker inspect autoads --format "{{range \$k,\$v := .NetworkSettings.Networks}}{{if eq \$k \"$NET\"}}yes{{end}}{{end}}" 2>/dev/null || echo "")
  if [ "$ALREADY" != "yes" ]; then
    echo "  ⚠️  autoads 未连接到网络: $NET，正在修复..." | tee -a $LOG
    sudo docker network connect "$NET" autoads >> $LOG 2>&1 && echo "  ✅ 已连接到 $NET" | tee -a $LOG
    # 连接新网络后需要重启才能解析新的 hostname
    echo "  🔄 重启容器以激活新网络连接..." | tee -a $LOG
    sudo docker restart autoads >> $LOG 2>&1
  else
    echo "  ✅ 网络 $NET 已连接" | tee -a $LOG
  fi
done

echo "🏥 Step 5/5: 健康检查..."
# 等待容器启动（最多60秒）
HEALTHY=false
for i in $(seq 1 12); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' autoads 2>/dev/null || echo "unknown")
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 http://localhost:80/ 2>/dev/null || echo "000")
  echo "  [${i}/12] 容器状态: $STATUS | HTTP: $HTTP_CODE" | tee -a $LOG
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    HEALTHY=true
    break
  fi
  sleep 5
done

# 检查容器内 Python 服务（端口 8001）是否运行
echo "" | tee -a $LOG
echo "🐍 检查 Python Ads Service (端口 8001)..." | tee -a $LOG
PYTHON_STATUS=$(sudo docker exec autoads curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 http://localhost:8001/health 2>/dev/null || echo "000")
if [ "$PYTHON_STATUS" = "200" ]; then
  echo "  ✅ Python 服务运行正常 (HTTP $PYTHON_STATUS)" | tee -a $LOG
else
  echo "  ⚠️  Python 服务异常 (HTTP $PYTHON_STATUS)，尝试重启..." | tee -a $LOG
  sudo docker exec autoads supervisorctl restart python-ads-service >> $LOG 2>&1 || \
  sudo docker exec autoads sh -c "cd /app/python-service && nohup python3 main.py >> /tmp/python-ads.log 2>&1 &" >> $LOG 2>&1
  sleep 5
  PYTHON_STATUS2=$(sudo docker exec autoads curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 http://localhost:8001/health 2>/dev/null || echo "000")
  echo "  重启后 Python 服务状态: HTTP $PYTHON_STATUS2" | tee -a $LOG
fi

# 清理 Docker build cache 和未使用旧镜像，防止磁盘积累
echo "" | tee -a $LOG
echo "🧹 清理 Docker 旧镜像缓存..." | tee -a $LOG
sudo docker builder prune -af >> $LOG 2>&1
sudo docker image prune -af   >> $LOG 2>&1

echo "" | tee -a $LOG
echo "========================================" | tee -a $LOG
if [ "$HEALTHY" = "true" ]; then
  echo "✅ [DEPLOY SUCCESS $(date)]" | tee -a $LOG
  echo "   网站已恢复访问，HTTP $HTTP_CODE" | tee -a $LOG
else
  echo "❌ [DEPLOY WARNING $(date)]" | tee -a $LOG
  echo "   容器已启动但健康检查未通过，请手动检查:" | tee -a $LOG
  echo "   sudo docker logs autoads --tail 50" | tee -a $LOG
fi
echo "========================================" | tee -a $LOG
