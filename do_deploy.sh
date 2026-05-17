#!/bin/bash
#
# ╔══════════════════════════════════════════════════════════════════╗
# ║                  ⚠️  部署规范 — 必读  ⚠️                        ║
# ╠══════════════════════════════════════════════════════════════════╣
# ║                                                                  ║
# ║  【服务器信息】                                                  ║
# ║    SSH 别名  : singapore-server                                  ║
# ║    用户@主机 : ubuntu@<singapore-server 的 IP>                   ║
# ║    项目路径  : /home/ubuntu/autobb                               ║
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
# ║                                                                  ║
# ║  【为什么？】                                                     ║
# ║    docker-compose.single.yml 中映射的是 80:80 端口。             ║
# ║    Cloudflare → 源站走 80 端口，手动 docker run -p 3000:3000     ║
# ║    只绑定 3000 端口，80 端口无监听，Cloudflare 立即报            ║
# ║    "521 Web server is down"，网站完全无法访问。                  ║
# ║                                                                  ║
# ║  【紧急热更新（无需重新 build）】                                 ║
# ║    sudo docker-compose -f docker-compose.single.yml \            ║
# ║         up -d --no-deps autoads                                  ║
# ║                                                                  ║
# ╚══════════════════════════════════════════════════════════════════╝

# ──────────────────────────────────────────────
# 自动判断：本地执行 → SSH 到服务器再运行自身
# ──────────────────────────────────────────────
SERVER_DIR="/home/ubuntu/autobb"
SSH_HOST="singapore-server"   # 对应 ~/.ssh/config 中的 Host 别名

if [ ! -d "$SERVER_DIR" ]; then
  echo "📡 本地环境检测到，SSH 到 ${SSH_HOST} 执行部署..."
  ssh "$SSH_HOST" "cd $SERVER_DIR && git pull origin main && bash do_deploy.sh"
  echo "✅ 远程部署指令已发送，查看日志: ssh $SSH_HOST 'tail -f /tmp/deploy2.log'"
  exit 0
fi

# ──────────────────────────────────────────────
# 以下在服务器上执行
# ──────────────────────────────────────────────
cd "$SERVER_DIR"
echo "[start $(date)]" >> /tmp/deploy2.log
sudo docker build -t autoads:single . >> /tmp/deploy2.log 2>&1
sudo docker stop autoads >> /tmp/deploy2.log 2>&1 || true
sudo docker rm autoads >> /tmp/deploy2.log 2>&1 || true
# ⚠️ 必须用 docker-compose 启动，不可替换为 docker run，详见文件头部说明
sudo docker-compose -f docker-compose.single.yml up -d >> /tmp/deploy2.log 2>&1
# 清理 Docker build cache 和未使用旧镜像，防止磁盘积累
sudo docker builder prune -af >> /tmp/deploy2.log 2>&1
sudo docker image prune -af >> /tmp/deploy2.log 2>&1
echo "[DEPLOY_DONE $(date)]" >> /tmp/deploy2.log
