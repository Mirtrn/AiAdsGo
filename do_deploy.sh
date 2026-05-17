#!/bin/bash
#
# ╔══════════════════════════════════════════════════════════════════╗
# ║                  ⚠️  部署规范 — 必读  ⚠️                        ║
# ╠══════════════════════════════════════════════════════════════════╣
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
# ║  【此脚本已正确使用 docker-compose，请勿绕过此脚本手动启动】    ║
# ╚══════════════════════════════════════════════════════════════════╝

cd /home/ubuntu/autobb
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
